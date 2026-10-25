/**
 * Incremental backup worker (pure orchestration; all I/O is injected).
 *
 * The worker is the ONLY component that talks to Drive for data. It is invoked
 * by a cron route or the CLI runner — never by a student request. Normal writes
 * only insert into `backup_change_log` inside their own database transaction.
 *
 * Lifecycle of one attempt:
 *   claim (durable lease) → read ordered changes → compress + encrypt →
 *   find-or-upload a deterministically named Drive object → download + SHA-256
 *   verification → completeBatch() (checkpoint + verification in ONE DB
 *   transaction) → optional retention.
 *
 * Any failure before verification calls failBatch() with exponential backoff.
 * Pending events are NEVER deleted on that path, and the checkpoint never moves.
 */

import { sha256Hex } from './crypto.js';
import {
  BACKUP_DEFAULTS,
  DISASTER_RECOVERY_NOTICE,
  EXCLUDED_SNAPSHOT_SCHEMAS,
  EXCLUDED_SNAPSHOT_TABLES,
  INCREMENTAL_FORMAT,
  SNAPSHOT_SCHEMAS,
  backupObjectName,
} from './constants.js';
import { assertRetentionPlan, planRetention } from './retention.js';

/** Exponential backoff with deterministic jitter derived from the batch id. */
export function computeBackoffSeconds(attempt = 1, {
  base = BACKUP_DEFAULTS.baseBackoffSeconds,
  max = BACKUP_DEFAULTS.maxBackoffSeconds,
  jitter = 0,
} = {}) {
  const exponent = Math.max(0, Math.min(20, Number(attempt) - 1));
  const raw = Math.min(max, base * 2 ** exponent);
  // jitter ∈ [0,1) — deterministic in tests, Math.random() in production.
  return Math.max(5, Math.round(raw * (0.85 + 0.15 * Math.max(0, Math.min(0.999999, jitter)))));
}

/** Reject a malformed/out-of-order range rather than uploading a partial batch. */
export function assertOrderedRange(changes, batch) {
  const rows = changes || [];
  if (!rows.length) throw new Error(`batch ${batch.range_key} has no change rows`);
  let previous = 0;
  for (const row of rows) {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= previous) {
      throw new Error(`change rows are not strictly increasing in ${batch.range_key}`);
    }
    previous = id;
  }
  if (rows[0].id !== batch.first_change_id || rows[rows.length - 1].id !== batch.last_change_id) {
    throw new Error(`change rows do not match the claimed range ${batch.range_key}`);
  }
  return rows;
}

export function buildIncrementalPayload({ batch, changes, checkpointBefore, trackedTables = [], createdAt }) {
  const counts = { insert: 0, update: 0, delete: 0 };
  for (const change of changes) {
    if (change.operation in counts) counts[change.operation] += 1;
  }
  return {
    format: INCREMENTAL_FORMAT,
    created_at: createdAt || new Date().toISOString(),
    batch: {
      id: batch.id,
      range_key: batch.range_key,
      first_change_id: batch.first_change_id,
      last_change_id: batch.last_change_id,
      attempt_count: batch.attempt_count,
    },
    checkpoint_before: Number(checkpointBefore?.last_change_id) || 0,
    manifest: {
      format: INCREMENTAL_FORMAT,
      schemas: SNAPSHOT_SCHEMAS,
      tables: trackedTables.map((table) => table.table_name || table),
      event_count: changes.length,
      operations: counts,
      first_change_id: batch.first_change_id,
      last_change_id: batch.last_change_id,
      ordering: 'backup_change_log.id ascending',
      excluded_schemas: EXCLUDED_SNAPSHOT_SCHEMAS,
      excluded_tables: EXCLUDED_SNAPSHOT_TABLES,
      complete_disaster_recovery: false,
      notice: DISASTER_RECOVERY_NOTICE,
    },
    changes,
  };
}

function errorMessage(error) {
  return String(error?.message || error || 'unknown backup failure').slice(0, 2000);
}

export async function runBackupWorker({
  store,
  drive,
  seal,
  folderId,
  workerId = 'worker',
  batchSize = BACKUP_DEFAULTS.batchSize,
  leaseSeconds = BACKUP_DEFAULTS.leaseSeconds,
  keepSnapshots = BACKUP_DEFAULTS.keepSnapshots,
  minAgeDays = BACKUP_DEFAULTS.minRetentionAgeDays,
  retention = true,
  jitter = Math.random(),
  logger = null,
} = {}) {
  if (!store || !drive || !seal || !folderId) {
    throw new Error('runBackupWorker requires a store, a Drive client, a sealer and a restricted folder');
  }

  // Admin "run now" jobs are claimed here; the scheduled run is otherwise
  // driven purely by the durable outbox.
  let job = null;
  if (typeof store.claimJob === 'function') {
    const jobs = await store.claimJob('incremental', workerId);
    job = Array.isArray(jobs) ? jobs[0] || null : jobs || null;
  }

  const batch = await store.claimBatch({ workerId, batchSize, leaseSeconds });
  if (!batch) {
    if (job && typeof store.finishJob === 'function') await store.finishJob(job.id, null);
    return { status: 'idle', jobId: job?.id || null };
  }

  try {
    const changes = await store.readChanges({
      firstChangeId: batch.first_change_id,
      lastChangeId: batch.last_change_id,
    });
    assertOrderedRange(changes, batch);

    const [checkpointBefore, trackedTables] = await Promise.all([
      store.getCheckpoint ? store.getCheckpoint() : Promise.resolve(null),
      store.listTrackedTables ? store.listTrackedTables() : Promise.resolve([]),
    ]);
    const payload = buildIncrementalPayload({
      batch, changes, checkpointBefore, trackedTables,
      createdAt: changes[0].occurred_at || batch.created_at || new Date().toISOString(),
    });
    const { body, sha256, size, envelope } = seal(payload);

    // A randomized GCM IV means identical plaintext produces a different
    // envelope on every attempt, so content-addressing by ciphertext hash
    // would NOT make retries idempotent. Name the object by a deterministic
    // range digest instead; the existing object's own ciphertext hash is used
    // when verifying a reused download.
    const rangeDigest = sha256Hex(JSON.stringify({
      kind: 'incremental',
      range: batch.range_key,
      first: batch.first_change_id,
      last: batch.last_change_id,
      key_ref: envelope.key_ref,
    }));
    const name = backupObjectName('incremental', batch.first_change_id, batch.last_change_id, rangeDigest);
    const appProperties = {
      kind: 'incremental',
      sha256,
      payload_sha256: rangeDigest,
      first: String(batch.first_change_id),
      last: String(batch.last_change_id),
      range: batch.range_key,
      key_ref: envelope.key_ref,
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
        logger?.warn?.(`[backup] existing Drive object ${candidate.id} failed verification: ${reused.reason}`);
      }
    }

    if (!fileId) {
      const uploaded = await drive.upload({ name, folderId, body, appProperties });
      if (!uploaded?.id) throw new Error('Drive upload returned no file id');
      fileId = uploaded.id;
    }

    // The gate: no checkpoint advance until a fresh download matches SHA-256.
    const verification = await drive.verifyFile({
      fileId, folderId, expectedSha256: uploadedSha256, expectedSize: uploadedSize,
    });
    if (!verification.ok) {
      throw new Error(`Drive upload verification failed (${verification.reason || 'unknown'})`);
    }

    const manifest = {
      ...payload.manifest,
      object_name: name,
      drive_file_ref: fileId,
      envelope_sha256: uploadedSha256,
      byte_size: uploadedSize,
      key_ref: envelope.key_ref,
      verified_sha256: verification.sha256,
    };
    await store.completeBatch({
      workerId,
      batchId: batch.id,
      fileId,
      sha256: uploadedSha256,
      byteSize: uploadedSize,
      manifest,
    });

    // Post-verification bookkeeping must never turn an already-verified,
    // already-checkpointed batch into a reported failure: retention is only
    // cleanup, and finishing the admin job is only a status update. If the job
    // row cannot be closed, migration 028 requeues it after the lease expires.
    let note = null;
    if (retention && typeof store.pruneChangeLog === 'function') {
      try {
        await runRetention({ store, drive, keepSnapshots, minAgeDays, logger });
      } catch (failure) {
        note = 'retention skipped';
        logger?.warn?.('[backup] retention failed after a verified upload:', failure?.message || failure);
      }
    }

    if (job && typeof store.finishJob === 'function') {
      try {
        await store.finishJob(job.id, null);
      } catch (failure) {
        note = 'job completion deferred';
        logger?.warn?.('[backup] could not close the admin job after a verified upload:', failure?.message || failure);
      }
    }
    return {
      status: 'verified',
      batchId: batch.id,
      rangeKey: batch.range_key,
      fileId,
      sha256: uploadedSha256,
      eventCount: changes.length,
      reused: Boolean(candidate?.id) && fileId === candidate.id,
      note,
    };
  } catch (error) {
    const message = errorMessage(error);
    const retryDelaySeconds = computeBackoffSeconds(batch.attempt_count, { jitter });
    try {
      await store.failBatch({ workerId, batchId: batch.id, error: message, retryDelaySeconds });
    } catch (failure) {
      logger?.error?.('[backup] could not record batch failure:', failure?.message || failure);
    }
    if (job && typeof store.finishJob === 'function') {
      try {
        await store.finishJob(job.id, message);
      } catch (failure) {
        logger?.error?.('[backup] could not finish job:', failure?.message || failure);
      }
    }
    logger?.warn?.(`[backup] batch ${batch.range_key} failed (retry in ${retryDelaySeconds}s): ${message}`);
    return { status: 'failed', batchId: batch.id, rangeKey: batch.range_key, error: message, retryDelaySeconds };
  }
}

/** Delete expired Drive objects, then let SQL prune only covered change rows. */
export async function runRetention({ store, drive, keepSnapshots, minAgeDays, logger }) {
  const [snapshots, batches, checkpoint] = await Promise.all([
    typeof store.listSnapshots === 'function' ? store.listSnapshots() : Promise.resolve([]),
    typeof store.listBatches === 'function' ? store.listBatches() : Promise.resolve([]),
    store.getCheckpoint ? store.getCheckpoint() : Promise.resolve(null),
  ]);
  const plan = assertRetentionPlan(
    planRetention({ snapshots, batches, checkpoint, keepSnapshots, minAgeDays }),
    checkpoint,
  );
  for (const fileRef of plan.deleteFileRefs) {
    try {
      await drive.deleteFile(fileRef);
    } catch (error) {
      // A failed deletion leaves an extra object in a private folder; it must
      // never block the next verified export.
      logger?.warn?.(`[backup] could not delete expired Drive object ${fileRef}: ${error?.message || error}`);
    }
  }
  const cutoffId = await store.pruneChangeLog({ keepSnapshots, minAgeDays });
  return { ...plan, prunedUpTo: cutoffId };
}
