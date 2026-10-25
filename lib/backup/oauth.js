/**
 * Admin-only Google Drive OAuth helpers.
 *
 * This is COMPLETELY SEPARATE from student authentication:
 *   - student sign-in is Supabase Auth's Google provider (migration 012,
 *     /auth/callback, lib/auth/*). None of that is touched here.
 *   - Drive uses the existing Drive-only OAuth client's own client id/secret and
 *     the exact production callback https://pccoe.in/api/backup/drive/callback.
 *   - PKCE + a hashed one-time state are stored encrypted in backup_private.
 *   - Scope is `drive.file`: only files this app creates are visible.
 */

import { createHash, randomBytes } from 'node:crypto';

import {
  DRIVE_SCOPE,
  GOOGLE_AUTH_URL,
  PRODUCTION_DRIVE_REDIRECT_URI,
  DRIVE_CALLBACK_PATH,
} from './constants.js';

export function generatePkce(random = randomBytes) {
  const verifier = Buffer.from(random(32)).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function generateState(random = randomBytes) {
  return Buffer.from(random(24)).toString('base64url');
}

/** Only the hash is stored, so a database read cannot replay the OAuth flow. */
export function stateHash(state) {
  return createHash('sha256').update(String(state)).digest('hex');
}

/**
 * Redirect URI policy. Production is pinned to the EXACT registered URL and an
 * override is rejected there. Local development may use a localhost override
 * (which must also be registered on the Google OAuth client).
 */
export function resolveRedirectUri(env = process.env) {
  const configured = typeof env.BACKUP_DRIVE_REDIRECT_URI === 'string'
    ? env.BACKUP_DRIVE_REDIRECT_URI.trim()
    : '';
  const isProduction = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
  if (isProduction) {
    if (configured && configured !== PRODUCTION_DRIVE_REDIRECT_URI) {
      throw new Error(`BACKUP_DRIVE_REDIRECT_URI must be exactly ${PRODUCTION_DRIVE_REDIRECT_URI} in production`);
    }
    return PRODUCTION_DRIVE_REDIRECT_URI;
  }
  if (configured) return configured;
  const origin = typeof env.BACKUP_PUBLIC_ORIGIN === 'string' && env.BACKUP_PUBLIC_ORIGIN.trim()
    ? env.BACKUP_PUBLIC_ORIGIN.trim().replace(/\/$/, '')
    : 'http://localhost:3000';
  return `${origin}${DRIVE_CALLBACK_PATH}`;
}

export function backupEnv(env = process.env) {
  return {
    clientId: env.GOOGLE_DRIVE_CLIENT_ID || null,
    clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET || null,
    redirectUri: resolveRedirectUri(env),
    encryptionKeys: env.BACKUP_ENCRYPTION_KEYS || env.BACKUP_ENCRYPTION_KEY || null,
    keyRef: env.BACKUP_ENCRYPTION_KEY_ID || 'primary',
    databaseUrl: env.BACKUP_DATABASE_URL || null,
    cronSecret: env.BACKUP_CRON_SECRET || env.CRON_SECRET || null,
    isProduction: env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production',
  };
}

export function assertOAuthClientConfig(config) {
  if (!config.clientId || !config.clientSecret) {
    throw new Error('GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET are required for the Drive connection');
  }
  return config;
}

/** The Google consent URL (no client secret ever reaches the browser). */
export function buildAuthorizationUrl({ clientId, redirectUri, state, codeChallenge }) {
  if (!clientId || !redirectUri || !state || !codeChallenge) {
    throw new Error('a client id, redirect URI, state and PKCE challenge are required');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Safe relative destination after the callback, never an open redirect. */
export function safeBackPath(value) {
  if (typeof value !== 'string') return '/admin?tab=backups';
  const path = value.trim();
  if (!path.startsWith('/admin') || path.startsWith('//') || path.includes('\\')) return '/admin?tab=backups';
  return path.slice(0, 200);
}
