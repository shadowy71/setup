/**
 * EXACT production callback: https://pccoe.in/api/backup/drive/callback
 *
 * Admin-only. Consumes the one-time PKCE flow, exchanges the code server-side,
 * creates a PRIVATE Drive folder (never a shared/public folder), verifies it has
 * no `anyone` permission, and stores the refresh token encrypted in
 * `backup_private`. Student authentication is completely untouched.
 */

import { NextResponse } from 'next/server';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { defaultKeyRing, openSecret, resolveKey, sealSecret } from '@/lib/backup/crypto.js';
import {
  DRIVE_FOLDER_NAME,
  GOOGLE_USERINFO_URL,
  PURPOSE_CREDENTIAL,
  PURPOSE_VERIFIER,
} from '@/lib/backup/constants.js';
import { DriveClient } from '@/lib/backup/drive.js';
import { assertOAuthClientConfig, backupEnv, stateHash } from '@/lib/backup/oauth.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BACKUPS_PATH = '/admin?tab=backups';

function done(origin, code) {
  const key = code === 'connected' ? 'backup_notice' : 'backup_error';
  return NextResponse.redirect(new URL(`${BACKUPS_PATH}&${key}=${encodeURIComponent(code)}`, origin));
}

async function accountSubject(accessToken, fetchImpl) {
  try {
    const response = await fetchImpl(`${GOOGLE_USERINFO_URL}?access_token=${encodeURIComponent(accessToken)}`);
    if (!response?.ok) return 'unknown';
    const data = await response.json();
    // Never copy the email into the public schema: only the opaque Google sub.
    return typeof data?.sub === 'string' && data.sub ? data.sub : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function GET(request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  if (providerError) return done(origin, 'cancelled');
  if (!code || !state) return done(origin, 'missing_code');

  try {
    const user = await getActiveUser();
    if (!user || !can(toActor(user), 'manage_backups')) return done(origin, 'forbidden');
    const config = assertOAuthClientConfig(backupEnv());
    const supabase = await getServerClient();
    if (!supabase) return done(origin, 'not_configured');

    const { data: flows, error: flowError } = await supabase.rpc('backup_take_oauth_flow', {
      p_state_hash: stateHash(state),
    });
    if (flowError) throw flowError;
    const flow = Array.isArray(flows) ? flows[0] : flows;
    if (!flow) return done(origin, 'state_expired');
    if (flow.redirect_uri && flow.redirect_uri !== config.redirectUri) {
      return done(origin, 'redirect_mismatch');
    }

    const keyRing = defaultKeyRing();
    const verifier = openSecret(
      {
        credential_ciphertext: flow.verifier_ciphertext,
        iv_b64: flow.iv_b64,
        tag_b64: flow.tag_b64,
        key_ref: flow.key_ref,
      },
      { keyRing, purpose: PURPOSE_VERIFIER },
    );

    const drive = new DriveClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });
    const tokens = await drive.exchangeCode(code, verifier, flow.redirect_uri || config.redirectUri);
    const subject = await accountSubject(tokens.access_token, globalThis.fetch);
    const folder = await drive.createRestrictedFolder(DRIVE_FOLDER_NAME, { subject: String(subject).slice(0, 60) });

    const sealed = sealSecret(JSON.stringify({ refresh_token: tokens.refresh_token }), {
      key: resolveKey(keyRing, config.keyRef),
      keyRef: config.keyRef,
      purpose: PURPOSE_CREDENTIAL,
    });
    const { error: storeError } = await supabase.rpc('backup_store_connection', {
      p_subject: subject,
      p_label: `Drive account ${String(subject).slice(0, 8)}`,
      p_folder_ref: folder.id,
      p_ciphertext: sealed.credential_ciphertext,
      p_iv_b64: sealed.iv_b64,
      p_tag_b64: sealed.tag_b64,
      p_key_ref: sealed.key_ref,
    });
    if (storeError) throw storeError;

    return done(origin, 'connected');
  } catch (error) {
    // Never put provider error bodies, tokens or state in the redirect URL.
    console.error('[backup] Drive OAuth callback failed:', error?.message || error);
    return done(origin, 'connect_failed');
  }
}
