#!/usr/bin/env node
/**
 * Operator-only Google-side token revocation + local connection cleanup.
 *
 * Usage: npm run backup:disconnect
 *
 * The admin UI's Disconnect button already deletes the encrypted credential
 * locally. This script additionally asks Google to revoke the refresh token
 * (best effort) and then calls the same audited `backup_disconnect()` RPC.
 */

import { loadEnv, banner, ok, warn } from '../lib/env.mjs';
import { createBackupRuntime, createDriveForWorker } from '../../lib/backup/runtime.js';

const env = await loadEnv();

banner('Campus+ Drive disconnect');
try {
  const { config, keyRing, store } = createBackupRuntime({ env });
  try {
    const { drive } = await createDriveForWorker({ store, config, keyRing });
    const revoked = await drive.revoke();
    ok(revoked ? 'Google revoked the refresh token' : 'Google did not confirm revocation (credential is still deleted locally)');
  } catch (error) {
    warn(`could not load the credential for Google revocation: ${error?.message || error}`);
  }
  await store.client.rpc('backup_disconnect');
  ok('local connection metadata revoked and encrypted credential deleted');
} catch (error) {
  console.error('[backup] disconnect failed:', error?.message || error);
  process.exitCode = 1;
}
