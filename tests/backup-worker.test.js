import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { INCREMENTAL_FORMAT } from '../lib/backup/constants.js';
import { createSealer, sha256Hex } from '../lib/backup/crypto.js';
import {
  assertOrderedRange,
  buildIncrementalPayload,
  computeBackoffSeconds,
  runBackupWorker,
} from '../lib/backup/worker.js';

const keyRing = () => new Map([['primary', randomBytes(32)]]);
const seal = () => {
  const sealer = createSealer({ keyRing: keyRing(), keyRef: 'primary' });
  return Object.assign((value) => sealer.seal(value), { keyRef: sealer.keyRef });
};

function changes() {
  return [
    { id: 101, schema_name: 'public', table_name: 'profiles', operation: 'insert', row_pk: { id: 'a' }, row_data: { id: 'a', username: 'asha' } },
    { id: 102, schema_name: 'public', table_name: 'profiles', operation: 'update', row_pk: { id: 'b' }, row_data: { id: 'b', username: 'bharat' } },
    { id: 103, schema_name: 'public', table_name: 'profiles', operation: 'delete', row_pk: { id: 'c' }, row_data: null },
  ];
}

function fakeStore({ batchAttempt = 1, verifyFails = false } = {}) {
  const rows = changes();
  const state = {
    checkpoint: { last_change_id: 100 },
    calls: [],
    completeCount: 0,
    failCount: 0,
    pruneCount: 0,
    uploadCount: 0,
    objects: new Map(),
    verifyFails,
  };
  const batch = {
    id: 'batch-1', range_key: 'incremental:101:103', first_change_id: 101,
    last_change_id: 103, attempt_count: batchAttempt,
  };
  const store = {
    claimJob: async () => null,
    finishJob: async () => {},
    claimBatch: async () => batch,
    readChanges: async ({ firstChangeId, lastChangeId }) => rows.filter((row) => row.id >= firstChangeId && row.id <= lastChangeId),
    getCheckpoint: async () => state.checkpoint,
    listTrackedTables: async () => [{ table_name: 'profiles' }],
    listSnapshots: async () => [],
    listBatches: async () => [],
    completeBatch: async (args) => {
      state.calls.push('completeBatch');
      state.completeCount += 1;
      // Mirror SQL: checkpoint never rewinds on a duplicate completion.
      state.checkpoint.last_change_id = Math.max(state.checkpoint.last_change_id, batch.last_change_id);
      state.lastCompletion = args;
    },
    failBatch: async (args) => {
      state.calls.push('failBatch');
      state.failCount += 1;
      state.lastFailure = args;
    },
    pruneChangeLog: async () => {
      state.calls.push('pruneChangeLog');
      state.pruneCount += 1;
      return state.checkpoint.last_change_id;
    },
  };
  return { store, state, batch, rows };
}

function fakeDrive(state, { uploadFails = false, corrupt = false } = {}) {
  return {
    findByName: async (name) => {
      const file = state.objects.get(name);
      return file ? [{ ...file, size: file.bytes.length }] : [];
    },
    upload: async ({ name, body, appProperties }) => {
      if (uploadFails) throw Object.assign(new Error('Drive HTTP 503: unavailable'), { retryable: true });
      state.uploadCount += 1;
      const id = `file-${state.uploadCount}`;
      const bytes = corrupt ? Buffer.from('corrupted') : Buffer.from(body);
      state.objects.set(name, { id, name, appProperties, bytes });
      return { id, name };
    },
    verifyFile: async ({ fileId, expectedSha256, expectedSize }) => {
      const file = [...state.objects.values()].find((candidate) => candidate.id === fileId);
      if (!file) return { ok: false, reason: 'not found' };
      if (sha256Hex(file.bytes) !== expectedSha256) return { ok: false, reason: 'sha256 mismatch' };
      if (file.bytes.length !== expectedSize) return { ok: false, reason: 'size mismatch' };
      return { ok: true, sha256: expectedSha256, size: expectedSize };
    },
    deleteFile: async () => true,
  };
}

const run = ({ store, drive, jitter = 0, sealer = seal() }) => runBackupWorker({
  store, drive, seal: sealer, folderId: 'folder-1', workerId: 'test-worker', jitter,
});

describe('incremental worker', () => {
  it('encrypts a batch, verifies the Drive download, then advances the checkpoint', async () => {
    const { store, state } = fakeStore();
    const drive = fakeDrive(state);
    const result = await run({ store, state, drive });

    expect(result.status).toBe('verified');
    expect(result.eventCount).toBe(3);
    expect(state.completeCount).toBe(1);
    expect(state.failCount).toBe(0);
    expect(state.checkpoint.last_change_id).toBe(103);
    // Verification happened before checkpoint/retention.
    expect(state.calls).toEqual(['completeBatch', 'pruneChangeLog']);
    expect(state.lastCompletion.manifest.verified_sha256).toBe(result.sha256);
    expect(state.lastCompletion.manifest.operations).toEqual({ insert: 1, update: 1, delete: 1 });
    // The object on Drive contains no readable plaintext.
    const [object] = [...state.objects.values()];
    expect(object.bytes.includes(Buffer.from('asha'))).toBe(false);
    expect(object.bytes.includes(Buffer.from('bharat'))).toBe(false);
  });

  it('keeps pending events and the checkpoint when Drive is unavailable', async () => {
    const { store, state } = fakeStore();
    const drive = fakeDrive(state, { uploadFails: true });
    const result = await run({ store, state, drive });

    expect(result.status).toBe('failed');
    expect(result.retryDelaySeconds).toBeGreaterThan(0);
    expect(state.completeCount).toBe(0);
    expect(state.pruneCount).toBe(0);
    expect(state.failCount).toBe(1);
    expect(state.checkpoint.last_change_id).toBe(100);
    // Events were never discarded: the next attempt can still read them.
    const pending = await store.readChanges({ firstChangeId: 101, lastChangeId: 103 });
    expect(pending.map((row) => row.id)).toEqual([101, 102, 103]);
  });

  it('does not advance the checkpoint when verification fails', async () => {
    const { store, state } = fakeStore();
    const drive = fakeDrive(state, { corrupt: true });
    const result = await run({ store, state, drive });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/verification failed/);
    expect(state.completeCount).toBe(0);
    expect(state.pruneCount).toBe(0);
    expect(state.checkpoint.last_change_id).toBe(100);
  });

  it('reuses the deterministic range object on a duplicate attempt (idempotent upload)', async () => {
    const { store, state } = fakeStore();
    const drive = fakeDrive(state);
    // The deterministic range digest gives the same object name regardless of
    // the fresh GCM IV used on the second attempt.
    const sealer = seal();
    const first = await run({ store, state, drive, sealer });
    const second = await run({ store, state, drive, sealer });

    expect(first.status).toBe('verified');
    expect(second.status).toBe('verified');
    expect(second.reused).toBe(true);
    expect(state.uploadCount).toBe(1);
    expect(state.completeCount).toBe(2);
    // Duplicate completion cannot rewind the durable checkpoint.
    expect(state.checkpoint.last_change_id).toBe(103);
  });

  it('uses increasing exponential backoff on repeated failures', async () => {
    const delays = [];
    for (const attempt of [1, 2, 3, 4]) {
      const { store, state } = fakeStore({ batchAttempt: attempt });
      const result = await run({ store, state, drive: fakeDrive(state, { uploadFails: true }) });
      delays.push(result.retryDelaySeconds);
    }
    expect(delays).toEqual(delays.slice().sort((a, b) => a - b));
    expect(delays[0]).toBeGreaterThanOrEqual(5);
    expect(delays[3]).toBeGreaterThan(delays[0]);
    expect(computeBackoffSeconds(20, { jitter: 0 })).toBeLessThanOrEqual(3600);
  });
});

describe('admin job lifecycle and post-verification bookkeeping', () => {
  it('claims and closes exactly one queued job per unit', async () => {
    const { store, state } = fakeStore();
    const drive = fakeDrive(state);
    let claimed = false;
    store.claimJob = async (kind) => {
      state.calls.push(`claimJob:${kind}`);
      if (claimed) return null;
      claimed = true;
      return { id: 'job-1', kind };
    };
    store.finishJob = async (jobId, error) => {
      state.calls.push(`finishJob:${jobId}:${error === null ? 'ok' : 'error'}`);
    };

    const result = await run({ store, drive });
    expect(result.status).toBe('verified');
    expect(state.calls).toContain('claimJob:incremental');
    expect(state.calls).toContain('finishJob:job-1:ok');
  });

  it('marks the job failed (with the error) when the batch fails, so nothing looks successful', async () => {
    const { store, state } = fakeStore();
    store.claimJob = async () => ({ id: 'job-2', kind: 'incremental' });
    store.finishJob = async (jobId, error) => {
      state.calls.push(`finishJob:${jobId}:${error ? 'error' : 'ok'}`);
    };

    const result = await run({ store, state, drive: fakeDrive(state, { uploadFails: true }) });
    expect(result.status).toBe('failed');
    expect(state.calls).toContain('finishJob:job-2:error');
    expect(state.calls).toContain('failBatch');
    expect(state.calls).not.toContain('completeBatch');
    expect(state.checkpoint.last_change_id).toBe(100);
  });

  it('still reports a verified batch when retention or job bookkeeping fails', async () => {
    const { store, state } = fakeStore();
    const drive = fakeDrive(state);
    store.finishJob = async () => { throw new Error('finishJob rpc unavailable'); };
    store.pruneChangeLog = async () => { throw new Error('retention rpc unavailable'); };
    const warnings = [];
    const logger = { warn: (message) => warnings.push(message) };

    const result = await runBackupWorker({
      store, drive, seal: seal(), folderId: 'folder-1', workerId: 'test-worker',
      retention: true, logger,
    });

    // The upload was verified and the checkpoint advanced: reporting a failure
    // here would be wrong and would re-upload the same range.
    expect(result.status).toBe('verified');
    expect(state.completeCount).toBe(1);
    expect(state.checkpoint.last_change_id).toBe(103);
    expect(result.note).toMatch(/retention|job completion/);
    expect(warnings.length).toBeGreaterThan(0);
    // No failure was recorded for a verified batch.
    expect(state.calls).not.toContain('failBatch');
  });

});

describe('ordering and payload', () => {
  it('rejects out-of-order, duplicate and mismatched ranges', () => {
    const batch = { id: 'b', range_key: 'incremental:1:3', first_change_id: 1, last_change_id: 3 };
    expect(() => assertOrderedRange(changes(), { ...batch, first_change_id: 101, last_change_id: 103 })).not.toThrow();
    expect(() => assertOrderedRange([], batch)).toThrow(/no change rows/);
    expect(() => assertOrderedRange([
      { id: 1 }, { id: 3 }, { id: 2 },
    ], { ...batch, last_change_id: 2 })).toThrow(/strictly increasing/);
    expect(() => assertOrderedRange([{ id: 1 }, { id: 1 }, { id: 2 }], { ...batch, last_change_id: 2 }))
      .toThrow(/strictly increasing/);
    expect(() => assertOrderedRange([{ id: 2 }, { id: 3 }], batch)).toThrow(/do not match/);
  });

  it('records ordering, tombstones and disaster-recovery limits in the manifest', () => {
    const payload = buildIncrementalPayload({
      batch: { id: 'b', range_key: 'incremental:101:103', first_change_id: 101, last_change_id: 103, attempt_count: 1 },
      changes: changes(),
      checkpointBefore: { last_change_id: 100 },
      trackedTables: [{ table_name: 'profiles' }],
      createdAt: '2026-10-25T00:00:00.000Z',
    });
    expect(payload.format).toBe(INCREMENTAL_FORMAT);
    expect(payload.changes.map((change) => change.id)).toEqual([101, 102, 103]);
    expect(payload.changes[2].row_data).toBeNull();
    expect(payload.manifest.ordering).toBe('backup_change_log.id ascending');
    expect(payload.manifest.complete_disaster_recovery).toBe(false);
    expect(payload.manifest.excluded_schemas.join(' ')).toContain('auth');
  });
});
