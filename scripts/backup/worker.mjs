#!/usr/bin/env node
/**
 * CLI incremental worker — same code path as /api/backup/worker.
 *
 * Usage:
 *   npm run backup:worker
 *   npm run backup:worker -- --loop --interval=60
 *
 * Nothing here runs in a student request. The worker claims a durable batch
 * from the transactional outbox and only advances the checkpoint after Drive
 * upload verification.
 */

import { loadEnv, parseArgs, banner, ok, bad, warn } from '../lib/env.mjs';
import { createBackupRuntime, createDriveForWorker } from '../../lib/backup/runtime.js';
import { runBackupWorker } from '../../lib/backup/worker.js';
import { BACKUP_DEFAULTS } from '../../lib/backup/constants.js';

const args = parseArgs();
const env = await loadEnv();

async function once() {
  const { config, keyRing, store } = createBackupRuntime({ env });
  const { drive, folderId, seal } = await createDriveForWorker({ store, config, keyRing });
  return runBackupWorker({
    store,
    drive,
    seal,
    folderId,
    workerId: `cli-${process.pid}-${Date.now()}`,
    batchSize: BACKUP_DEFAULTS.batchSize,
    leaseSeconds: BACKUP_DEFAULTS.leaseSeconds,
  });
}

banner('Campus+ Drive backup worker');
try {
  const first = await once();
  console.log(JSON.stringify(first, null, 2));
  if (first.status === 'verified') ok(`verified ${first.eventCount} change(s) → ${first.fileId}`);
  else if (first.status === 'idle') ok('no pending changes');
  else bad(`batch failed: ${first.error}`);

  if (args.loop) {
    const seconds = Math.max(10, Number(args.interval) || 60);
    warn(`looping every ${seconds}s — Ctrl+C to stop`);
    setInterval(async () => {
      try {
        const result = await once();
        console.log(new Date().toISOString(), JSON.stringify(result));
      } catch (error) {
        console.error('[backup] loop iteration failed:', error?.message || error);
      }
    }, seconds * 1000);
  } else if (first.status === 'failed') {
    process.exitCode = 1;
  }
} catch (error) {
  bad(error?.message || String(error));
  process.exitCode = 1;
}
