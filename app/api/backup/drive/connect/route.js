/**
 * Start the ADMIN-ONLY Google Drive OAuth connection.
 *
 * This route is unrelated to student sign-in (`/auth/callback` and Supabase's
 * Google provider). It uses the existing Drive-only OAuth client and the exact
 * production callback URL. It performs no Drive data operation: it only stores
 * a one-time, encrypted PKCE verifier + hashed state in `backup_private` and
 * redirects the admin to Google's consent screen.
 */

import { NextResponse } from 'next/server';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { defaultKeyRing, resolveKey, sealSecret } from '@/lib/backup/crypto.js';
import { PURPOSE_VERIFIER } from '@/lib/backup/constants.js';
import {
  assertOAuthClientConfig,
  backupEnv,
  buildAuthorizationUrl,
  generatePkce,
  generateState,
  stateHash,
} from '@/lib/backup/oauth.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function fail(origin, code) {
  return NextResponse.redirect(new URL(`/admin?tab=backups&backup_error=${encodeURIComponent(code)}`, origin));
}

export async function GET(request) {
  const origin = new URL(request.url).origin;
  try {
    const user = await getActiveUser();
    if (!user || !can(toActor(user), 'manage_backups')) return fail(origin, 'forbidden');
    const config = assertOAuthClientConfig(backupEnv());
    const supabase = await getServerClient();
    if (!supabase) return fail(origin, 'not_configured');

    const keyRing = defaultKeyRing();
    const keyRef = config.keyRef;
    const { verifier, challenge } = generatePkce();
    const state = generateState();
    const sealed = sealSecret(verifier, { key: resolveKey(keyRing, keyRef), keyRef, purpose: PURPOSE_VERIFIER });
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await supabase.rpc('backup_start_oauth_flow', {
      p_state_hash: stateHash(state),
      p_redirect_uri: config.redirectUri,
      p_ciphertext: sealed.credential_ciphertext,
      p_iv_b64: sealed.iv_b64,
      p_tag_b64: sealed.tag_b64,
      p_key_ref: sealed.key_ref,
      p_expires_at: expiresAt,
    });
    if (error) throw error;

    const url = buildAuthorizationUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      codeChallenge: challenge,
    });
    return NextResponse.redirect(url);
  } catch (error) {
    console.error('[backup] Drive OAuth start failed:', error?.message || error);
    return fail(origin, 'start_failed');
  }
}
