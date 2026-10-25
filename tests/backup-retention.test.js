import { describe, expect, it } from 'vitest';

import { assertRetentionPlan, planRetention } from '../lib/backup/retention.js';

const snapshot = (id, watermark, createdAt, fileRef = `snap-${id}`) => ({
  id, watermark, status: 'verified', drive_file_ref: fileRef, created_at: createdAt,
});
const batch = (id, last, fileRef, createdAt, kind = 'incremental', snapshotRef = null) => ({
  id, kind, status: 'verified', drive_file_ref: fileRef, last_change_id: last,
  verified_at: createdAt, created_at: createdAt, snapshot_ref: snapshotRef,
});

const NOW = Date.parse('2026-10-25T00:00:00.000Z');
const ago = (days) => new Date(NOW - days * 86400000).toISOString();

describe('retention never discards pending events', () => {
  it('does not prune anything without a verified snapshot', () => {
    const plan = planRetention({
      snapshots: [],
      batches: [batch('b1', 500, 'inc-1', ago(30))],
      checkpoint: { last_change_id: 500 },
      keepSnapshots: 14,
      minAgeDays: 7,
      now: NOW,
    });
    expect(plan.cutoffId).toBe(0);
    expect(plan.deleteFileRefs).toEqual([]);
  });

  it('never prunes above the verified checkpoint', () => {
    const plan = planRetention({
      snapshots: [snapshot('s1', 900, ago(10), 'snap-1')],
      batches: [batch('b1', 900, 'inc-1', ago(30))],
      checkpoint: { last_change_id: 400 },
      now: NOW,
    });
    // min(oldest kept watermark=900, verified checkpoint=400) = 400.
    expect(plan.cutoffId).toBe(400);
    expect(() => assertRetentionPlan({ ...plan, cutoffId: 901 }, { last_change_id: 400 })).toThrow(/unverified/);
    expect(plan.deleteFileRefs).not.toContain('inc-1');
  });

  it('keeps the N newest snapshots and only expires old covered incremental objects', () => {
    const snapshots = [
      snapshot('s1', 100, ago(40), 'snap-1'),
      snapshot('s2', 200, ago(30), 'snap-2'),
      snapshot('s3', 300, ago(10), 'snap-3'),
    ];
    const batches = [
      batch('b1', 100, 'inc-old', ago(30)),
      batch('b2', 200, 'inc-middle', ago(20)),
      batch('b3', 300, 'inc-recent', ago(1)),
      batch('b4', 310, 'inc-pending', ago(1)),
      batch('b5', 100, 'snap-1-batch', ago(40), 'snapshot', 's1'),
    ];
    const plan = planRetention({
      snapshots,
      batches,
      checkpoint: { last_change_id: 310, last_file_ref: 'inc-pending' },
      keepSnapshots: 2,
      minAgeDays: 7,
      now: NOW,
    });
    expect(plan.keepSnapshotIds).toEqual(['s3', 's2']);
    expect(plan.expiredSnapshotIds).toEqual(['s1']);
    expect(plan.cutoffId).toBe(200);
    expect(plan.deleteFileRefs).toContain('snap-1');
    expect(plan.deleteFileRefs).toContain('inc-old');
    expect(plan.deleteFileRefs).toContain('snap-1-batch');
    expect(plan.deleteFileRefs).not.toContain('snap-2');
    expect(plan.deleteFileRefs).not.toContain('snap-3');
    expect(plan.deleteFileRefs).not.toContain('inc-recent');
    expect(plan.deleteFileRefs).not.toContain('inc-pending'); // protected by checkpoint
  });

  it('respects the minimum age before deleting a covered incremental', () => {
    const plan = planRetention({
      snapshots: [snapshot('s1', 100, ago(1), 'snap-1')],
      batches: [batch('b1', 100, 'inc-fresh', ago(1))],
      checkpoint: { last_change_id: 100 },
      minAgeDays: 7,
      now: NOW,
    });
    expect(plan.cutoffId).toBe(100);
    expect(plan.deleteFileRefs).not.toContain('inc-fresh');
  });

  it('ignores failed/unverified snapshots and protects the newest snapshot file', () => {
    const plan = planRetention({
      snapshots: [
        { ...snapshot('s0', 50, ago(50), 'snap-failed'), status: 'failed' },
        snapshot('s1', 100, ago(10), 'snap-1'),
      ],
      batches: [batch('b1', 100, 'inc-1', ago(30))],
      checkpoint: { last_change_id: 100 },
      keepSnapshots: 1,
      now: NOW,
    });
    expect(plan.keepSnapshotIds).toEqual(['s1']);
    expect(plan.deleteFileRefs).not.toContain('snap-1');
    expect(plan.deleteFileRefs).not.toContain('snap-failed');
  });
});
