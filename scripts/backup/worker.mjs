#!/usr/bin/env node
/**
 * CLI incremental worker — the same lease-protected, bounded engine as
 * /api/backup/worker and Admin → Backups → "Run incremental now".
 *
 * Usage:
 *   npm run backup:worker
 *   npm run backup:worker -- --loop --interval=60
 *
 * Routine operation does NOT need this: the admin page is the supported
 * control surface. The CLI exists for hosts without cron and for repair work.
 * Nothing here runs in a student request; the worker claims durable batches
 * from the outbox and only advances the checkpoint after Drive verification.
 */

import { loadEnv, parseArgs, banner, ok, bad, warn } from '../lib/env.mjs';
import { createBackupRuntime, createDriveForWorker } from '../../lib/backup/runtime.js';
import { PROCESS_LIMITS, processBackupRun, safeDiagnostic } from '../../lib/backup/processor.js';

const args = parseArgs();
const env = await loadEnv();

async function once() {
  const { config, keyRing, store } = createBackupRuntime({ env });
  const { drive, folderId, seal } = await createDriveForWorker({ store, config, keyRing });
  return processBackupRun({
    kind: 'incremental',
    store,
    drive,
    seal,
    folderId,
    workerId: `cli-${process.pid}-${Date.now()}`,
    limits: PROCESS_LIMITS.cron.incremental,
  });
}

banner('Campus+ Drive backup worker');
try {
  const first = await once();
  if (first.status === 'idle') ok('no pending changes');
  else if (first.status === 'drained') ok(first.message);
  else if (first.status === 'busy') warn('another run holds the backup lease; nothing was queued or duplicated');
  else if (first.verified) ok(`${first.verified} batch(es) verified in the restricted Drive folder`);
  else bad(`run ${first.status}: ${first.message}`);

  if (args.loop) {
    const seconds = Math.max(10, Number(args.interval) || 60);
    warn(`looping every ${seconds}s — Ctrl+C to stop`);
    setInterval(async () => {
      try {
        const result = await once();
        console.log(new Date().toISOString(), JSON.stringify({ status: result.status, verified: result.verified, failed: result.failed }));
      } catch (error) {
        console.error('[backup] loop iteration failed:', safeDiagnostic(error, 'run_failed').code);
      }
    }, seconds * 1000);
  } else if (first.status === 'failed') {
    process.exitCode = 1;
  }
} catch (error) {
  // A redacted, actionable diagnostic: a raw message can carry a connection
  // string or a token, and CI may capture stdout.
  const diagnostic = safeDiagnostic(error, 'run_failed');
  bad(`${diagnostic.code}: ${diagnostic.message}`);
  process.exitCode = 1;
}
