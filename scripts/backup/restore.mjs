#!/usr/bin/env node
/**
 * Restore a snapshot + incremental chain into a SEPARATE Postgres database.
 *
 * The encrypted objects can come from local files or directly from the private
 * Drive folder. Target data is REPLACED, so explicit confirmation flags are
 * required. Auth/Storage/Realtime state is never restored — see docs/BACKUPS.md.
 *
 * Examples:
 *   npm run backup:restore -- --snapshot ./snap.cpbe --incremental ./inc1.cpbe,./inc2.cpbe \
 *     --target 'postgres://…' --confirm-restore
 *   npm run backup:restore -- --from-drive --snapshot <driveFileId> \
 *     --incremental <id1>,<id2> --target 'postgres://…' --confirm-restore
 */

import { readFile } from 'node:fs/promises';

import { loadEnv, parseArgs, banner, ok, bad, warn } from '../lib/env.mjs';
import { defaultKeyRing } from '../../lib/backup/crypto.js';
import { createBackupRuntime, createDriveForWorker } from '../../lib/backup/runtime.js';
import { restoreFromBackup } from '../../lib/backup/restore.js';
import { PgTarget } from '../../lib/backup/postgres-target.js';
import { DISASTER_RECOVERY_NOTICE } from '../../lib/backup/constants.js';

const args = parseArgs();
const env = await loadEnv();

function list(value) {
  if (!value || value === true) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

async function readObjects() {
  if (!args['from-drive']) {
    if (!args.snapshot || args.snapshot === true) throw new Error('--snapshot <path> is required');
    return {
      snapshotEnvelope: await readFile(String(args.snapshot)),
      incrementalEnvelopes: await Promise.all(list(args.incremental).map((path) => readFile(path))),
    };
  }
  const { config, keyRing, store } = createBackupRuntime({ env });
  const { drive } = await createDriveForWorker({ store, config, keyRing });
  const snapshotId = String(args.snapshot || '');
  if (!snapshotId) throw new Error('--snapshot <driveFileId> is required with --from-drive');
  return {
    snapshotEnvelope: await drive.download(snapshotId),
    incrementalEnvelopes: await Promise.all(list(args.incremental).map((id) => drive.download(id))),
  };
}

banner('Campus+ restore from snapshot + incremental changes');
try {
  const keyRing = defaultKeyRing(env);
  const targetUrl = args.target && args.target !== true ? String(args.target) : env.BACKUP_RESTORE_DATABASE_URL;
  if (!targetUrl) throw new Error('--target <connection string> or BACKUP_RESTORE_DATABASE_URL is required');
  if (!args['confirm-restore']) {
    throw new Error('refusing to overwrite a database without --confirm-restore');
  }
  if (targetUrl === env.BACKUP_DATABASE_URL) {
    throw new Error('refusing to restore into the primary BACKUP_DATABASE_URL — use a separate target database');
  }

  const objects = await readObjects();
  const result = await restoreFromBackup({
    ...objects,
    keyRing,
    target: new PgTarget({ connectionString: targetUrl }),
    verify: true,
  });
  ok(`restored ${result.restoredTables} tables and replayed ${result.replayedEvents} change(s) from watermark #${result.watermark}`);
  warn(DISASTER_RECOVERY_NOTICE);
} catch (error) {
  bad(error?.message || String(error));
  process.exitCode = 1;
}
