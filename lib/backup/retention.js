/**
 * Retention planning (pure). A Drive object or a change-log row is only ever
 * deleted when a NEWER verified snapshot covers the same change ids AND the
 * incremental checkpoint has already passed them.
 *
 *   keep  = N newest verified snapshots + every incremental batch newer than
 *           the oldest kept snapshot watermark
 *   prune = change_log.id <= min(oldest kept watermark, verified checkpoint)
 *
 * `backup_prune_change_log()` in SQL enforces the same two bounds, so a bug in
 * this planner cannot delete pending events on its own.
 */

import { BACKUP_DEFAULTS } from './constants.js';

function time(value) {
  if (!value) return 0;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function planRetention({
  snapshots = [],
  batches = [],
  checkpoint = {},
  keepSnapshots = BACKUP_DEFAULTS.keepSnapshots,
  minAgeDays = BACKUP_DEFAULTS.minRetentionAgeDays,
  now = Date.now(),
} = {}) {
  const keep = Math.max(1, Number(keepSnapshots) || BACKUP_DEFAULTS.keepSnapshots);
  const minAgeMs = Math.max(0, Number(minAgeDays) || 0) * 24 * 60 * 60 * 1000;
  const nowMs = typeof now === 'function' ? now() : Number(now);

  const verified = (snapshots || [])
    .filter((snapshot) => snapshot.status === 'verified' && snapshot.drive_file_ref)
    .sort((a, b) => time(b.created_at || b.verified_at) - time(a.created_at || a.verified_at));

  const kept = verified.slice(0, keep);
  const expired = verified.slice(keep);
  const keptSnapshotIds = new Set(kept.map((snapshot) => snapshot.id));
  const oldestKeptWatermark = kept.length
    ? Math.min(...kept.map((snapshot) => Number(snapshot.watermark) || 0))
    : 0;
  const verifiedCheckpoint = Number(checkpoint.last_change_id) || 0;
  const cutoffId = oldestKeptWatermark ? Math.min(oldestKeptWatermark, verifiedCheckpoint) : 0;

  const protectedFiles = new Set();
  for (const snapshot of kept) if (snapshot.drive_file_ref) protectedFiles.add(snapshot.drive_file_ref);
  if (checkpoint.last_file_ref) protectedFiles.add(checkpoint.last_file_ref);

  const deleteFileRefs = [];
  const expiredBatchIds = [];
  const seen = new Set();
  const addFile = (fileRef) => {
    if (!fileRef || protectedFiles.has(fileRef) || seen.has(fileRef)) return;
    seen.add(fileRef);
    deleteFileRefs.push(fileRef);
  };

  for (const snapshot of expired) addFile(snapshot.drive_file_ref);

  for (const batch of batches || []) {
    if (batch.status !== 'verified' || !batch.drive_file_ref) continue;
    if (protectedFiles.has(batch.drive_file_ref)) continue;
    const lastId = Number(batch.last_change_id) || 0;
    const isOldIncremental = batch.kind === 'incremental'
      && cutoffId > 0
      && lastId <= cutoffId
      && time(batch.verified_at || batch.created_at) <= nowMs - minAgeMs;
    const belongsToExpiredSnapshot = batch.kind === 'snapshot'
      && batch.snapshot_ref
      && !keptSnapshotIds.has(batch.snapshot_ref);
    if (isOldIncremental || belongsToExpiredSnapshot) {
      addFile(batch.drive_file_ref);
      expiredBatchIds.push(batch.id);
    }
  }

  return {
    cutoffId,
    keepSnapshotIds: [...keptSnapshotIds],
    expiredSnapshotIds: expired.map((snapshot) => snapshot.id),
    deleteFileRefs,
    expiredBatchIds,
  };
}

/** Fail closed if a plan would prune above the last verified checkpoint. */
export function assertRetentionPlan(plan, checkpoint) {
  const verifiedCheckpoint = Number(checkpoint?.last_change_id) || 0;
  if (Number(plan.cutoffId) > verifiedCheckpoint) {
    throw new Error('retention plan would prune unverified change events');
  }
  return plan;
}
