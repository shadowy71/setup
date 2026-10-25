#!/usr/bin/env node
/**
 * CLI full snapshot runner — the same lease-protected engine as
 * /api/backup/snapshot and Admin → Backups → "Run full snapshot now".
 * Requires BACKUP_DATABASE_URL (direct Postgres session) for the
 * repeatable-read table image.
 *
 * Usage: npm run backup:snapshot
 */

import { loadEnv, banner, ok, bad, warn } from '../lib/env.mjs';
import { createBackupRuntime, createDriveForWorker } from '../../lib/backup/runtime.js';
import { PROCESS_LIMITS, processBackupRun, safeDiagnostic } from '../../lib/backup/processor.js';

const env = await loadEnv();

banner('Campus+ full database snapshot');
try {
  const { config, keyRing, store } = createBackupRuntime({ env });
  if (!config.databaseUrl) {
    throw new Error('BACKUP_DATABASE_URL is required for a consistent full snapshot');
  }
  const { drive, folderId, seal } = await createDriveForWorker({ store, config, keyRing });
  const result = await processBackupRun({
    kind: 'snapshot',
    store,
    drive,
    seal,
    folderId,
    workerId: `cli-snapshot-${process.pid}`,
    limits: PROCESS_LIMITS.cron.snapshot,
  });
  if (result.status === 'verified') {
    const [unit] = result.results || [{}];
    ok(`verified snapshot at change #${unit.watermark}, ${unit.tableCount} tables, ${unit.rowCount} rows`);
  } else if (result.status === 'busy') {
    warn('another snapshot run holds the lease; nothing was queued or duplicated');
    process.exitCode = 1;
  } else {
    bad(`snapshot ${result.status}: ${result.message}`);
    process.exitCode = 1;
  }
  console.log(JSON.stringify({ status: result.status, verified: result.verified, failed: result.failed }, null, 2));
} catch (error) {
  const diagnostic = safeDiagnostic(error, 'snapshot_failed');
  bad(`${diagnostic.code}: ${diagnostic.message}`);
  process.exitCode = 1;
}
