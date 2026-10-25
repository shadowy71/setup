#!/usr/bin/env node
/**
 * CLI full snapshot runner — same code path as /api/backup/snapshot.
 * Requires BACKUP_DATABASE_URL (direct Postgres session) for the repeatable-read
 * table image.
 *
 * Usage: npm run backup:snapshot
 */

import { loadEnv, banner, ok, bad } from '../lib/env.mjs';
import { createBackupRuntime, createDriveForWorker } from '../../lib/backup/runtime.js';
import { createSnapshot } from '../../lib/backup/snapshot.js';

const env = await loadEnv();

banner('Campus+ full database snapshot');
try {
  const { config, keyRing, store } = createBackupRuntime({ env });
  if (!config.databaseUrl) throw new Error('BACKUP_DATABASE_URL is required for a consistent full snapshot');
  const { drive, folderId, seal } = await createDriveForWorker({ store, config, keyRing });
  const result = await createSnapshot({ store, drive, seal, folderId, workerId: `cli-snapshot-${process.pid}` });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'verified') {
    ok(`verified snapshot at change #${result.watermark}, ${result.tableCount} tables, ${result.rowCount} rows`);
  } else {
    bad(`snapshot failed: ${result.error}`);
    process.exitCode = 1;
  }
} catch (error) {
  bad(error?.message || String(error));
  process.exitCode = 1;
}
