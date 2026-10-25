/**
 * Production wiring for the background jobs. Server-only by convention: this
 * module reads secrets from process.env and creates a service-role Supabase
 * client. It is imported ONLY by cron route handlers, the admin OAuth routes
 * and the CLI scripts under scripts/backup/.
 */

import { createClient } from '@supabase/supabase-js';

import { PURPOSE_CREDENTIAL } from './constants.js';
import { createSealer, defaultKeyRing, openSecret, resolveKey, sealSecret } from './crypto.js';
import { DriveClient } from './drive.js';
import { assertOAuthClientConfig, backupEnv } from './oauth.js';
import { BackupStore } from './store.js';

export function getWorkerSupabaseClient(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error('the backup worker needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the server environment');
  }
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-campus-plus-client': 'backup-worker' } },
  });
}

export function createBackupRuntime({ env = process.env, client = null } = {}) {
  const config = backupEnv(env);
  const keyRing = defaultKeyRing(env);
  const supabase = client || getWorkerSupabaseClient(env);
  const store = new BackupStore({ client: supabase, databaseUrl: config.databaseUrl });
  return { config, keyRing, supabase, store };
}

/**
 * Load the active connection + encrypted refresh credential and build a
 * DriveClient that can refresh its own access token and rotate the credential.
 * The plaintext refresh token exists only in this process's memory.
 */
export async function createDriveForWorker({ store, config, keyRing, fetchImpl = globalThis.fetch } = {}) {
  assertOAuthClientConfig(config);
  const connection = await store.getActiveConnection();
  if (!connection) throw new Error('no active admin Google Drive connection — connect it from Admin → Backups');
  if (!connection.folder_restricted || !connection.folder_ref) {
    throw new Error('the Drive connection is not marked as a restricted folder');
  }
  const row = await store.getCredentials(connection.id);
  const credential = openSecret(row, { keyRing, purpose: PURPOSE_CREDENTIAL });

  const drive = new DriveClient({
    fetchImpl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    credential,
    onRotate: async (rotated) => {
      const keyRef = config.keyRef;
      const sealed = sealSecret(rotated, { key: resolveKey(keyRing, keyRef), keyRef, purpose: PURPOSE_CREDENTIAL });
      await store.rotateCredentials(connection.id, sealed);
    },
  });
  // `runBackupWorker()` / `createSnapshot()` take a callable seal(value), while
  // `createSnapshot()` also reads `seal.keyRef` for the manifest. Expose a
  // function with that metadata attached.
  const sealer = createSealer({ keyRing, keyRef: config.keyRef });
  const seal = Object.assign((value) => sealer.seal(value), { keyRef: sealer.keyRef });
  return { drive, folderId: connection.folder_ref, connection, seal };
}

/** Verify a cron/CLI bearer token without leaking it in logs. */
export function cronAuthorized(request, secret) {
  if (!secret) return false;
  const header = request?.headers?.get?.('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!provided || provided.length !== secret.length) return false;
  // Constant-time-ish comparison without importing node:crypto into edge code.
  let mismatch = 0;
  for (let i = 0; i < secret.length; i += 1) mismatch |= secret.charCodeAt(i) ^ provided.charCodeAt(i);
  return mismatch === 0;
}
