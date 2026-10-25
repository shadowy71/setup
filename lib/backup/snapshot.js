/**
 * Scheduled full snapshots (pure orchestration; all I/O is injected).
 *
 * Consistency model
 * -----------------
 * `backup_snapshot_watermark()` takes a brief SHARE ROW EXCLUSIVE lock on the
 * outbox, waits for in-flight application transactions to commit, and returns
 * horizon H. All table reads then happen in ONE `REPEATABLE READ READ ONLY`
 * transaction (PgStore), so the table images are mutually consistent and
 * contain every change with id <= H. Any write committed during the read has
 * id > H and is replayed on restore from the incremental objects.
 *
 * The manifest is explicit about what is NOT backed up: Supabase Auth, Storage,
 * Realtime, secrets, roles/grants and cron configuration. Restoring this file
 * is NOT complete disaster recovery.
 */

import {
  BACKUP_DEFAULTS,
  DISASTER_RECOVERY_NOTICE,
  EXCLUDED_SNAPSHOT_SCHEMAS,
  EXCLUDED_SNAPSHOT_TABLES,
  SNAPSHOT_FORMAT,
  SNAPSHOT_SCHEMAS,
  backupObjectName,
} from './constants.js';
import { sha256Hex } from './crypto.js';

/** Canonical, stable stringify for per-table digests. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function tableDigest(rows, keyColumns = []) {
  const sorted = [...(rows || [])].sort((a, b) => {
    for (const key of keyColumns) {
      const left = String(a?.[key] ?? '');
      const right = String(b?.[key] ?? '');
      if (left < right) return -1;
      if (left > right) return 1;
    }
    return 0;
  });
  return { row_count: sorted.length, sha256: sha256Hex(sorted.map(canonicalJson).join('\n')) };
}

export function buildSnapshotManifest({
  watermark,
  previousWatermark,
  tables,
  rowsByTable,
  keyRef,
  envelopeSha256,
  byteSize,
  createdAt,
  objectName,
}) {
  return {
    format: SNAPSHOT_FORMAT,
    created_at: createdAt || new Date().toISOString(),
    schemas: SNAPSHOT_SCHEMAS,
    watermark: Number(watermark),
    previous_watermark: Number(previousWatermark) || 0,
    consistent_checkpoint: 'outbox quiesce horizon H + repeatable-read table image + replay of changes with id > H',
    tables: tables.map((table) => {
      const name = table.table_name || table.name;
      const keyColumns = table.key_columns || [];
      const columns = table.columns || [];
      return {
        name,
        schema: 'public',
        key_columns: keyColumns,
        columns,
        column_types: table.column_types || {},
        ...tableDigest(rowsByTable[name] || [], keyColumns),
      };
    }),
    excluded_schemas: EXCLUDED_SNAPSHOT_SCHEMAS,
    excluded_tables: EXCLUDED_SNAPSHOT_TABLES,
    complete_disaster_recovery: false,
    notice: DISASTER_RECOVERY_NOTICE,
    restore: [
      'Create a fresh database from supabase/migrations (or the schema bundle).',
      'Restore every table in manifest.tables from snapshot.tables.',
      'Replay all incremental objects with first_change_id > manifest.watermark in ascending change id.',
      'Reprovision Auth users, Storage objects, secrets, OAuth provider settings and cron jobs separately.',
      'Run npm run backup:verify-restore against the restored target.',
    ],
    encryption: { algorithm: 'AES-256-GCM', key_ref: keyRef },
    object_name: objectName || null,
    envelope_sha256: envelopeSha256 || null,
    byte_size: byteSize || null,
  };
}

export function buildSnapshotPayload({ manifest, rowsByTable, createdAt }) {
  return {
    format: SNAPSHOT_FORMAT,
    created_at: createdAt || new Date().toISOString(),
    manifest,
    tables: rowsByTable,
  };
}

function errorMessage(error) {
  return String(error?.message || error || 'unknown snapshot failure').slice(0, 2000);
}

/**
 * Create, encrypt, upload and verify one full snapshot.
 * Returns `{ status: 'verified' | 'failed' | 'idle' }`.
 */
export async function createSnapshot({
  store,
  drive,
  seal,
  folderId,
  workerId = 'snapshot-worker',
  keepSnapshots = BACKUP_DEFAULTS.keepSnapshots,
  logger = null,
} = {}) {
  if (!store || !drive || !seal || !folderId) {
    throw new Error('createSnapshot requires a store, a Drive client, a sealer and a restricted folder');
  }

  let job = null;
  if (typeof store.claimJob === 'function') {
    const jobs = await store.claimJob('snapshot', workerId);
    job = Array.isArray(jobs) ? jobs[0] || null : jobs || null;
  }

  let snapshotId = null;
  try {
    const watermark = await store.snapshotWatermark();
    const checkpoint = store.getCheckpoint ? await store.getCheckpoint() : null;
    const previousWatermark = Number(checkpoint?.last_snapshot_watermark) || 0;
    const tables = await store.listTrackedTables();
    if (!tables.length) throw new Error('the snapshot table catalogue is empty');

    snapshotId = await store.startSnapshot({
      watermark,
      previousWatermark,
      manifest: { schemas: SNAPSHOT_SCHEMAS, table_count: tables.length, watermark },
    });

    // One repeatable-read transaction reads every tracked table (see PgStore).
    const rowsByTable = await store.readAllTables(tables);
    const createdAt = new Date().toISOString();
    // The object name is deterministic for this horizon/key so a duplicate
    // snapshot attempt can find and reuse the already-verified Drive object,
    // even though a fresh GCM IV makes the ciphertext different each attempt.
    const rangeDigest = sha256Hex(JSON.stringify({
      kind: 'snapshot', watermark, table_count: tables.length, key_ref: seal.keyRef || 'primary',
    }));
    const name = backupObjectName('snapshot', watermark, watermark, rangeDigest);
    const initialManifest = buildSnapshotManifest({
      watermark, previousWatermark, tables, rowsByTable,
      keyRef: seal.keyRef, createdAt, objectName: name,
    });
    const payload = buildSnapshotPayload({ manifest: initialManifest, rowsByTable, createdAt });
    const { body, sha256, size, envelope } = seal(payload);

    const appProperties = {
      kind: 'snapshot', sha256, payload_sha256: rangeDigest, watermark: String(watermark),
      range: `snapshot:${watermark}:${snapshotId}`, key_ref: envelope.key_ref,
    };

    let fileId = null;
    let uploadedSha256 = sha256;
    let uploadedSize = size;
    const existing = await drive.findByName(name, folderId);
    const candidate = (existing || []).find((file) => file?.appProperties?.payload_sha256 === rangeDigest)
      || (existing || []).find((file) => file?.appProperties?.sha256);
    if (candidate?.id && candidate.appProperties?.sha256) {
      const candidateSha = candidate.appProperties.sha256;
      const candidateSize = Number(candidate.size) || undefined;
      const reused = await drive.verifyFile({
        fileId: candidate.id, folderId, expectedSha256: candidateSha, expectedSize: candidateSize,
      });
      if (reused.ok) {
        fileId = candidate.id;
        uploadedSha256 = candidateSha;
        uploadedSize = Number(candidate.size) || size;
      } else {
        logger?.warn?.(`[backup] existing snapshot object ${candidate.id} failed verification: ${reused.reason}`);
      }
    }
    if (!fileId) {
      const uploaded = await drive.upload({ name, folderId, body, appProperties });
      if (!uploaded?.id) throw new Error('Drive snapshot upload returned no file id');
      fileId = uploaded.id;
    }

    const verification = await drive.verifyFile({
      fileId, folderId, expectedSha256: uploadedSha256, expectedSize: uploadedSize,
    });
    if (!verification.ok) throw new Error(`snapshot verification failed (${verification.reason || 'unknown'})`);

    const manifest = buildSnapshotManifest({
      watermark, previousWatermark, tables, rowsByTable,
      keyRef: envelope.key_ref, envelopeSha256: uploadedSha256, byteSize: uploadedSize,
      createdAt, objectName: name,
    });
    await store.completeSnapshot({
      snapshotId, fileId, sha256: uploadedSha256, byteSize: uploadedSize,
      manifest: { ...manifest, drive_file_ref: fileId, verified_sha256: verification.sha256 },
    });
    if (job && typeof store.finishJob === 'function') await store.finishJob(job.id, null);
    if (typeof store.pruneChangeLog === 'function') {
      const { runRetention } = await import('./worker.js');
      await runRetention({ store, drive, keepSnapshots, minAgeDays: BACKUP_DEFAULTS.minRetentionAgeDays, logger });
    }
    return {
      status: 'verified', snapshotId, fileId, sha256: uploadedSha256, watermark,
      tableCount: tables.length,
      rowCount: manifest.tables.reduce((total, table) => total + table.row_count, 0),
      reused: Boolean(candidate?.id) && fileId === candidate.id,
    };
  } catch (error) {
    const message = errorMessage(error);
    if (snapshotId && typeof store.failSnapshot === 'function') {
      try {
        await store.failSnapshot(snapshotId, message);
      } catch (failure) {
        logger?.error?.('[backup] could not record snapshot failure:', failure?.message || failure);
      }
    }
    if (job && typeof store.finishJob === 'function') {
      try {
        await store.finishJob(job.id, message);
      } catch (failure) {
        logger?.error?.('[backup] could not finish snapshot job:', failure?.message || failure);
      }
    }
    logger?.warn?.(`[backup] snapshot failed: ${message}`);
    return { status: 'failed', snapshotId, error: message };
  }
}
