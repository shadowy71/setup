#!/usr/bin/env node
/**
 * Tested restoration procedure.
 *
 * Default: an OFFLINE end-to-end fixture. It encrypts/compresses a real
 * snapshot and a real incremental chain, decrypts them with a real key ring,
 * replays the changes into a target and compares the final state against an
 * independently computed expected state. This proves the restore code path,
 * NOT a production upload (no Google credentials are needed or used).
 *
 * Optional live mode (requires configured credentials):
 *   npm run backup:verify-restore -- --from-drive --snapshot <id> \
 *     --incremental <id1>,<id2> [--target postgres://…]
 *
 * Only when live mode downloads real Drive objects and restores into a real
 * target does the script print a live-restore success line.
 */

import { randomBytes } from 'node:crypto';

import { parseArgs, loadEnv, banner, ok, bad, warn } from '../lib/env.mjs';
import { createSealer, openJson, defaultKeyRing } from '../../lib/backup/crypto.js';
import {
  DISASTER_RECOVERY_NOTICE,
  INCREMENTAL_FORMAT,
  SNAPSHOT_FORMAT,
} from '../../lib/backup/constants.js';
import { buildIncrementalPayload } from '../../lib/backup/worker.js';
import { buildSnapshotManifest, tableDigest } from '../../lib/backup/snapshot.js';
import {
  applyChange,
  buildExpectedState,
  compareStates,
  createMemoryTarget,
  createState,
  restoreFromBackup,
  stateFromSnapshot,
} from '../../lib/backup/restore.js';
import { createBackupRuntime, createDriveForWorker } from '../../lib/backup/runtime.js';
import { PgTarget } from '../../lib/backup/postgres-target.js';

const args = parseArgs();

function fixture() {
  const keyRing = new Map([['primary', randomBytes(32)]]);
  const sealer = createSealer({ keyRing });
  const createdAt = '2026-10-25T00:00:00.000Z';

  const profileRows = [
    { id: '11111111-1111-4111-8111-111111111111', username: 'asha' },
    { id: '22222222-2222-4222-8222-222222222222', username: 'bharat' },
    { id: '33333333-3333-4333-8333-333333333333', username: 'chirag' },
  ];
  const postRows = [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', author_id: profileRows[0].id, body: 'hello campus' },
  ];
  const tableDefs = [
    { name: 'profiles', key_columns: ['id'], columns: ['id', 'username'], column_types: { id: 'uuid', username: 'text' } },
    { name: 'posts', key_columns: ['id'], columns: ['id', 'author_id', 'body'], column_types: { id: 'uuid', author_id: 'uuid', body: 'text' } },
  ];
  const tables = { profiles: profileRows, posts: postRows };
  const manifest = buildSnapshotManifest({
    watermark: 10,
    previousWatermark: 0,
    tables: tableDefs.map((table) => ({ table_name: table.name, ...table })),
    rowsByTable: tables,
    keyRef: 'primary',
    createdAt,
  });
  // The payload's manifest must include table digests (tableDigest is applied
  // by buildSnapshotManifest above) and be recognised by validateSnapshot().
  const snapshot = { format: SNAPSHOT_FORMAT, created_at: createdAt, manifest, tables };
  const { body: snapshotEnvelope } = sealer.seal(snapshot);

  const changes = [
    {
      id: 11, schema_name: 'public', table_name: 'profiles', operation: 'insert',
      row_pk: { id: '44444444-4444-4444-8444-444444444444' },
      row_data: { id: '44444444-4444-4444-8444-444444444444', username: 'devi' },
    },
    {
      id: 12, schema_name: 'public', table_name: 'profiles', operation: 'update',
      row_pk: { id: profileRows[1].id },
      row_data: { id: profileRows[1].id, username: 'bharat_edited' },
    },
    {
      id: 13, schema_name: 'public', table_name: 'profiles', operation: 'delete',
      row_pk: { id: profileRows[2].id }, row_data: null,
    },
    {
      id: 14, schema_name: 'public', table_name: 'posts', operation: 'delete',
      row_pk: { id: postRows[0].id }, row_data: null,
    },
  ];
  const incremental = buildIncrementalPayload({
    batch: { id: 'batch-1', range_key: 'incremental:11:14', first_change_id: 11, last_change_id: 14, attempt_count: 1 },
    changes,
    checkpointBefore: { last_change_id: 10 },
    trackedTables: tableDefs.map((table) => ({ table_name: table.name })),
    createdAt,
  });
  const { body: incrementalEnvelope } = sealer.seal(incremental);

  return { keyRing, snapshotEnvelope, incrementalEnvelopes: [incrementalEnvelope], snapshot, incremental };
}

async function offlineTest() {
  const { keyRing, snapshotEnvelope, incrementalEnvelopes, snapshot, incremental } = fixture();
  // Confirm the fixtures really are compressed + encrypted on the wire.
  const raw = Buffer.from(snapshotEnvelope);
  if (raw.includes(Buffer.from('asha'))) throw new Error('snapshot plaintext leaked into the encrypted envelope');
  const { value: decoded } = openJson(snapshotEnvelope, { keyRing });
  if (decoded.format !== SNAPSHOT_FORMAT) throw new Error('snapshot envelope could not be decrypted');
  if (incremental.format !== INCREMENTAL_FORMAT) throw new Error('incremental fixture has the wrong format');

  const target = createMemoryTarget();
  const result = await restoreFromBackup({
    snapshotEnvelope,
    incrementalEnvelopes,
    keyRing,
    target,
    verify: true,
  });
  if (!result.verified || result.replayedEvents !== 4) throw new Error('restore verification did not replay every change');

  // Independent expected state: snapshot + replay, computed separately.
  const expected = buildExpectedState(snapshot, [incremental]);
  const comparison = compareStates(expected, target.state());
  if (!comparison.ok) throw new Error(`restored state differs: ${comparison.differences.join('; ')}`);

  // And a third path: start from the snapshot rows and apply changes directly.
  const direct = stateFromSnapshot(snapshot);
  for (const change of incremental.changes) applyChange(direct, change);
  const directComparison = compareStates(direct, target.state());
  if (!directComparison.ok) throw new Error(`direct replay differs: ${directComparison.differences.join('; ')}`);

  const profiles = target.state().tables.get('profiles');
  if (profiles.size !== 3) throw new Error('expected 3 profiles after insert + delete');
  if (![...profiles.values()].some((row) => row.username === 'bharat_edited')) {
    throw new Error('update event was not applied');
  }
  if (target.state().tables.get('posts').size !== 0) throw new Error('delete tombstone was not applied');

  return {
    result,
    tableDigests: Object.fromEntries(snapshot.manifest.tables.map((entry) => [entry.name, tableDigest(snapshot.tables[entry.name], entry.key_columns).sha256])),
    unused: createState(),
  };
}

async function liveTest() {
  const env = await loadEnv();
  const { config, keyRing, store } = createBackupRuntime({ env });
  const { drive } = await createDriveForWorker({ store, config, keyRing });
  const snapshotId = String(args.snapshot || '');
  if (!snapshotId) throw new Error('--snapshot <driveFileId> is required in live mode');
  const incrementalIds = String(args.incremental || '').split(',').map((id) => id.trim()).filter(Boolean);
  const snapshotEnvelope = await drive.download(snapshotId);
  const incrementalEnvelopes = await Promise.all(incrementalIds.map((id) => drive.download(id)));
  // Verify each downloaded object by decrypting it before any target is touched.
  for (const envelope of [snapshotEnvelope, ...incrementalEnvelopes]) openJson(envelope, { keyRing: defaultKeyRing(env) });

  const targetUrl = args.target && args.target !== true ? String(args.target) : env.BACKUP_RESTORE_DATABASE_URL;
  const target = targetUrl ? new PgTarget({ connectionString: targetUrl }) : createMemoryTarget();
  if (targetUrl && !args['confirm-restore']) throw new Error('--confirm-restore is required with --target');
  return restoreFromBackup({
    snapshotEnvelope,
    incrementalEnvelopes,
    keyRing: defaultKeyRing(env),
    target,
    verify: true,
  });
}

banner('Campus+ restore verification');
try {
  if (args['from-drive']) {
    const result = await liveTest();
    ok(`LIVE Drive objects decrypted and restored: ${result.restoredTables} tables, ${result.replayedEvents} replayed events`);
    warn('This confirms the downloaded objects restore correctly; it does not prove the original upload succeeded unless the upload was verified separately.');
  } else {
    const { result } = await offlineTest();
    ok(`offline fixture: ${result.restoredTables} tables restored, ${result.replayedEvents} incremental events replayed, final state matched`);
    warn('OFFLINE FIXTURE ONLY — no production Drive upload or restore was performed.');
  }
  warn(DISASTER_RECOVERY_NOTICE);
} catch (error) {
  bad(error?.message || String(error));
  process.exitCode = 1;
}
