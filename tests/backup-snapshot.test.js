import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { SNAPSHOT_FORMAT } from '../lib/backup/constants.js';
import { createSealer, openJson, sha256Hex } from '../lib/backup/crypto.js';
import { createSnapshot } from '../lib/backup/snapshot.js';

const keyRing = () => new Map([['primary', randomBytes(32)]]);
const seal = () => {
  const sealer = createSealer({ keyRing: keyRing(), keyRef: 'primary' });
  return Object.assign((value) => sealer.seal(value), { keyRef: sealer.keyRef });
};

const TABLES = [
  { table_name: 'profiles', key_columns: ['id'], columns: ['id', 'username'], column_types: { id: 'text', username: 'text' } },
  { table_name: 'posts', key_columns: ['id'], columns: ['id', 'body'], column_types: { id: 'text', body: 'text' } },
];
const ROWS = {
  profiles: [{ id: 'a', username: 'asha' }, { id: 'b', username: 'bharat' }],
  posts: [{ id: 'p1', body: 'hello' }, { id: 'p2', body: 'campus' }],
};

function fixture({ uploadFails = false } = {}) {
  const state = {
    calls: [], objects: new Map(), uploadCount: 0,
    checkpoint: { last_change_id: 100, last_snapshot_watermark: 0 },
    uploadFails,
  };
  const store = {
    claimJob: async () => null,
    finishJob: async () => {},
    snapshotWatermark: async () => 100,
    getCheckpoint: async () => state.checkpoint,
    listTrackedTables: async () => TABLES,
    startSnapshot: async (args) => { state.calls.push('startSnapshot'); state.startArgs = args; return 'snap-1'; },
    readAllTables: async () => ({ ...ROWS }),
    completeSnapshot: async (args) => { state.calls.push('completeSnapshot'); state.completeArgs = args; },
    failSnapshot: async (id, error) => { state.calls.push('failSnapshot'); state.failArgs = { id, error }; },
    listSnapshots: async () => [],
    listBatches: async () => [],
    pruneChangeLog: async () => 0,
  };
  const drive = {
    findByName: async (name) => {
      const file = state.objects.get(name);
      return file ? [{ ...file, size: file.bytes.length }] : [];
    },
    upload: async ({ name, body, appProperties }) => {
      if (state.uploadFails) throw new Error('Drive HTTP 503: unavailable');
      state.uploadCount += 1;
      const id = `snap-file-${state.uploadCount}`;
      state.objects.set(name, { id, name, appProperties, bytes: Buffer.from(body) });
      return { id, name };
    },
    verifyFile: async ({ fileId, expectedSha256, expectedSize }) => {
      const file = [...state.objects.values()].find((candidate) => candidate.id === fileId);
      if (!file) return { ok: false, reason: 'not found' };
      if (sha256Hex(file.bytes) !== expectedSha256) return { ok: false, reason: 'sha256 mismatch' };
      if (expectedSize !== undefined && file.bytes.length !== expectedSize) return { ok: false, reason: 'size mismatch' };
      return { ok: true, sha256: expectedSha256, size: file.bytes.length };
    },
    deleteFile: async () => true,
  };
  return { store, drive, state };
}

describe('scheduled full snapshots', () => {
  it('reads a consistent watermark, encrypts every table and verifies the upload', async () => {
    const { store, drive, state } = fixture();
    const keys = keyRing();
    const sealer = createSealer({ keyRing: keys, keyRef: 'primary' });
    const sealFn = Object.assign((value) => sealer.seal(value), { keyRef: 'primary' });
    const result = await createSnapshot({ store, drive, seal: sealFn, folderId: 'folder-1' });

    expect(result.status).toBe('verified');
    expect(result.watermark).toBe(100);
    expect(result.tableCount).toBe(2);
    expect(result.rowCount).toBe(4);
    expect(state.calls).toContain('completeSnapshot');
    expect(state.startArgs.watermark).toBe(100);
    const manifest = state.completeArgs.manifest;
    expect(manifest.schemas).toEqual(['public']);
    expect(manifest.complete_disaster_recovery).toBe(false);
    expect(manifest.tables.map((table) => table.name)).toEqual(['profiles', 'posts']);
    expect(manifest.drive_file_ref).toBe(result.fileId);
    expect(manifest.excluded_schemas).toContain('auth');

    // The Drive object is a real encrypted snapshot envelope.
    const [object] = [...state.objects.values()];
    const decoded = openJson(object.bytes, { keyRing: keys }).value;
    expect(decoded.format).toBe(SNAPSHOT_FORMAT);
    expect(decoded.tables.profiles).toEqual(ROWS.profiles);
    expect(object.bytes.includes(Buffer.from('asha'))).toBe(false);
  });

  it('records a failed snapshot without advancing any checkpoint when Drive is down', async () => {
    const { store, drive, state } = fixture({ uploadFails: true });
    const result = await createSnapshot({ store, drive, seal: seal(), folderId: 'folder-1' });
    expect(result.status).toBe('failed');
    expect(state.calls).toContain('failSnapshot');
    expect(state.calls).not.toContain('completeSnapshot');
    expect(state.failArgs.id).toBe('snap-1');
  });


  it('does not flip a verified snapshot to failure when post-processing fails', async () => {
    const { store, drive, state } = fixture();
    store.pruneChangeLog = async () => { throw new Error('retention rpc unavailable'); };
    store.finishJob = async () => { throw new Error('job rpc unavailable'); };

    const result = await createSnapshot({ store, drive, seal: seal(), folderId: 'folder-1' });
    expect(result.status).toBe('verified');
    expect(state.calls).toContain('completeSnapshot');
    expect(state.calls).not.toContain('failSnapshot');
    expect(result.note).toMatch(/retention|job completion/);
  });

  it('closes the claimed admin job with the error when the snapshot fails', async () => {
    const { store, drive, state } = fixture({ uploadFails: true });
    store.claimJob = async (kind) => ({ id: 'snap-job', kind });
    store.finishJob = async (jobId, error) => {
      state.calls.push(`finishJob:${jobId}:${error ? 'error' : 'ok'}`);
    };

    const result = await createSnapshot({ store, drive, seal: seal(), folderId: 'folder-1' });
    expect(result.status).toBe('failed');
    expect(state.calls).toContain('finishJob:snap-job:error');
    expect(state.calls).toContain('failSnapshot');
  });
  it('reuses the deterministic snapshot object on a duplicate attempt', async () => {
    const { store, drive, state } = fixture();
    const keys = keyRing();
    const sealer = createSealer({ keyRing: keys, keyRef: 'primary' });
    const sealFn = Object.assign((value) => sealer.seal(value), { keyRef: 'primary' });
    const first = await createSnapshot({ store, drive, seal: sealFn, folderId: 'folder-1' });
    const second = await createSnapshot({ store, drive, seal: sealFn, folderId: 'folder-1' });
    expect(first.status).toBe('verified');
    expect(second.status).toBe('verified');
    expect(second.reused).toBe(true);
    expect(state.uploadCount).toBe(1);
  });
});
