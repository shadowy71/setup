import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { SNAPSHOT_FORMAT } from '../lib/backup/constants.js';
import { createSealer, openJson } from '../lib/backup/crypto.js';
import { buildIncrementalPayload } from '../lib/backup/worker.js';
import { buildSnapshotManifest } from '../lib/backup/snapshot.js';
import {
  buildExpectedState,
  collectReplayEvents,
  compareStates,
  createMemoryTarget,
  restoreFromBackup,
  stateFromSnapshot,
  applyChange,
  validateSnapshot,
} from '../lib/backup/restore.js';

const keyRing = () => new Map([['primary', randomBytes(32)]]);

function fixtures() {
  const keys = keyRing();
  const sealer = createSealer({ keyRing: keys, keyRef: 'primary' });
  const createdAt = '2026-10-25T00:00:00.000Z';
  const rows = {
    profiles: [
      { id: 'a', username: 'asha' },
      { id: 'b', username: 'bharat' },
      { id: 'c', username: 'chirag' },
    ],
    posts: [{ id: 'p1', author_id: 'a', body: 'hello campus' }],
  };
  const tableDefs = [
    { table_name: 'profiles', key_columns: ['id'], columns: ['id', 'username'], column_types: { id: 'text', username: 'text' } },
    { table_name: 'posts', key_columns: ['id'], columns: ['id', 'author_id', 'body'], column_types: { id: 'text', author_id: 'text', body: 'text' } },
  ];
  const manifest = buildSnapshotManifest({
    watermark: 100, previousWatermark: 0, tables: tableDefs, rowsByTable: rows, keyRef: 'primary', createdAt,
  });
  const snapshot = { format: SNAPSHOT_FORMAT, created_at: createdAt, manifest, tables: rows };
  const snapshotEnvelope = sealer.seal(snapshot).body;

  const allChanges = [
    { id: 100, schema_name: 'public', table_name: 'profiles', operation: 'delete', row_pk: { id: 'a' }, row_data: null },
    { id: 101, schema_name: 'public', table_name: 'profiles', operation: 'insert', row_pk: { id: 'd' }, row_data: { id: 'd', username: 'devi' } },
    { id: 102, schema_name: 'public', table_name: 'profiles', operation: 'update', row_pk: { id: 'b' }, row_data: { id: 'b', username: 'bharat_edited' } },
    { id: 103, schema_name: 'public', table_name: 'profiles', operation: 'delete', row_pk: { id: 'c' }, row_data: null },
    { id: 104, schema_name: 'public', table_name: 'posts', operation: 'delete', row_pk: { id: 'p1' }, row_data: null },
  ];
  const payload = buildIncrementalPayload({
    batch: { id: 'batch-1', range_key: 'incremental:100:104', first_change_id: 100, last_change_id: 104, attempt_count: 1 },
    changes: allChanges,
    checkpointBefore: { last_change_id: 99 },
    trackedTables: tableDefs,
    createdAt,
  });
  const incrementalEnvelope = sealer.seal(payload).body;
  return { keys, sealer, snapshot, payload, snapshotEnvelope, incrementalEnvelope, allChanges };
}

describe('recovery from snapshot plus incremental changes', () => {
  it('restores every table, replays insert/update/delete tombstones and verifies state', async () => {
    const { keys, snapshot, payload, snapshotEnvelope, incrementalEnvelope } = fixtures();
    const target = createMemoryTarget();
    const result = await restoreFromBackup({
      snapshotEnvelope, incrementalEnvelopes: [incrementalEnvelope], keyRing: keys, target, verify: true,
    });

    expect(result.verified).toBe(true);
    expect(result.restoredTables).toBe(2);
    expect(result.watermark).toBe(100);
    // Event 100 is at/below the snapshot horizon and must be ignored.
    expect(result.replayedEvents).toBe(4);
    const state = target.state();
    const profiles = state.tables.get('profiles');
    expect(profiles.size).toBe(3);
    expect([...profiles.values()].map((row) => row.username).sort()).toEqual(['asha', 'bharat_edited', 'devi']);
    expect(state.tables.get('posts').size).toBe(0);
    expect(compareStates(buildExpectedState(snapshot, [payload]), state).ok).toBe(true);
  });

  it('is idempotent when the same incremental object is supplied twice', async () => {
    const { keys, snapshotEnvelope, incrementalEnvelope, snapshot, payload } = fixtures();
    const target = createMemoryTarget();
    const result = await restoreFromBackup({
      snapshotEnvelope, incrementalEnvelopes: [incrementalEnvelope, incrementalEnvelope], keyRing: keys, target,
    });
    expect(result.replayedEvents).toBe(4);
    expect(compareStates(buildExpectedState(snapshot, [payload, payload]), target.state()).ok).toBe(true);
  });

  it('rejects conflicting duplicate change ids', () => {
    const { snapshot, payload } = fixtures();
    const other = {
      ...payload,
      changes: [{ id: 101, schema_name: 'public', table_name: 'profiles', operation: 'delete', row_pk: { id: 'x' }, row_data: null }],
    };
    expect(() => collectReplayEvents(snapshot, [payload, other])).toThrow(/conflicting duplicate/);
  });

  it('rejects an incremental object with the wrong format', () => {
    const { snapshot } = fixtures();
    expect(() => collectReplayEvents(snapshot, [{ format: 'other', changes: [] }])).toThrow(/unexpected format/);
  });

  it('rejects a tampered encrypted incremental object', async () => {
    const { keys, snapshotEnvelope, incrementalEnvelope } = fixtures();
    const envelope = JSON.parse(incrementalEnvelope.toString('utf8'));
    const cipher = Buffer.from(envelope.ciphertext, 'base64');
    cipher[0] ^= 0xff;
    envelope.ciphertext = cipher.toString('base64');
    await expect(restoreFromBackup({
      snapshotEnvelope,
      incrementalEnvelopes: [Buffer.from(JSON.stringify(envelope))],
      keyRing: keys,
      target: createMemoryTarget(),
    })).rejects.toThrow();
  });

  it('never claims complete disaster recovery or an unsupported schema', () => {
    const { snapshot } = fixtures();
    expect(validateSnapshot(snapshot).complete_disaster_recovery).toBe(false);
    expect(validateSnapshot(snapshot).excluded_schemas.length).toBeGreaterThan(0);
    expect(() => validateSnapshot({ ...snapshot, manifest: { ...snapshot.manifest, schemas: ['public', 'auth'] } }))
      .toThrow(/unsupported schema/);
    expect(() => validateSnapshot({ ...snapshot, manifest: { ...snapshot.manifest, complete_disaster_recovery: true } }))
      .toThrow(/disaster-recovery limits/);
  });
});

describe('restore transaction safety', () => {
  it('rolls back instead of committing when the final state does not match', async () => {
    const { keys, snapshotEnvelope, incrementalEnvelope } = fixtures();
    const memory = createMemoryTarget();
    const events = [];
    const target = {
      begin: async () => { events.push('begin'); await memory.begin(); },
      replaceTables: async (...args) => { events.push('replace'); await memory.replaceTables(...args); },
      applyChanges: async (tableChanges) => {
        events.push('apply');
        // Simulate a target that lost one replayed change.
        await memory.applyChanges(tableChanges.filter((change) => change.id !== 101));
      },
      snapshotState: async () => { events.push('snapshotState'); return memory.snapshotState(); },
      commit: async () => { events.push('commit'); await memory.commit(); },
      rollback: async () => { events.push('rollback'); await memory.rollback(); },
    };
    await expect(restoreFromBackup({
      snapshotEnvelope, incrementalEnvelopes: [incrementalEnvelope], keyRing: keys, target, verify: true,
    })).rejects.toThrow(/restore verification failed/);
    expect(events).toContain('rollback');
    expect(events).not.toContain('commit');
  });

  it('independent replay matches stateFromSnapshot + applyChange', () => {
    const { snapshot, payload } = fixtures();
    const direct = stateFromSnapshot(snapshot);
    for (const change of collectReplayEvents(snapshot, [payload])) applyChange(direct, change);
    expect(compareStates(buildExpectedState(snapshot, [payload]), direct).ok).toBe(true);
  });

  it('round-trips the snapshot through encryption without losing the manifest', () => {
    const { keys, snapshot, snapshotEnvelope } = fixtures();
    const decoded = openJson(snapshotEnvelope, { keyRing: keys }).value;
    expect(decoded.format).toBe(SNAPSHOT_FORMAT);
    expect(decoded.manifest.tables.map((table) => table.name)).toEqual(['profiles', 'posts']);
    expect(decoded.tables.profiles).toEqual(snapshot.tables.profiles);
    expect(decoded.manifest.restore.length).toBeGreaterThan(0);
  });
});
