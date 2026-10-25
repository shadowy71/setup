/**
 * Restoration procedure: snapshot + replay of incremental change objects.
 *
 * The same code is used by `scripts/backup/restore.mjs` (a real Postgres target)
 * and by `npm run backup:verify-restore` / the unit tests (an in-memory target),
 * so the procedure is actually exercised end to end without needing production
 * credentials. It deliberately refuses to pretend Auth data was restored.
 */

import {
  DISASTER_RECOVERY_NOTICE,
  INCREMENTAL_FORMAT,
  SNAPSHOT_FORMAT,
} from './constants.js';
import { openJson, safeHexEqual } from './crypto.js';
import { canonicalJson } from './snapshot.js';

/** Stable primary-key identity for a row, derived from the outbox tombstone. */
export function rowKey(rowPk) {
  if (!rowPk || typeof rowPk !== 'object') throw new Error('a change row needs a primary-key object');
  return canonicalJson(rowPk);
}

export function createState() {
  return { tables: new Map() };
}

export function stateTable(state, table) {
  if (!state.tables.has(table)) state.tables.set(table, new Map());
  return state.tables.get(table);
}

export function stateFromSnapshot(snapshot) {
  const state = createState();
  const tables = snapshot?.tables || {};
  for (const [name, rows] of Object.entries(tables)) {
    const target = stateTable(state, name);
    const keyColumns = snapshot.manifest?.tables?.find((entry) => entry.name === name)?.key_columns || ['id'];
    for (const row of rows || []) {
      const pk = Object.fromEntries(keyColumns.map((column) => [column, row?.[column] ?? null]));
      target.set(rowKey(pk), { ...row });
    }
  }
  return state;
}

export function applyChange(state, change) {
  // Both snapshots and outbox rows use bare `public` table names.
  const table = stateTable(state, change.table_name);
  const key = rowKey(change.row_pk);
  if (change.operation === 'delete') {
    table.delete(key);
    return state;
  }
  if (!change.row_data) throw new Error(`change ${change.id} has no row image`);
  table.set(key, { ...change.row_data });
  return state;
}

/** Deduplicate and order every incremental event above the snapshot horizon. */
export function collectReplayEvents(snapshot, incrementalPayloads = []) {
  const watermark = Number(snapshot?.manifest?.watermark);
  if (!Number.isFinite(watermark)) throw new Error('snapshot has no numeric watermark');
  const byId = new Map();
  for (const payload of incrementalPayloads) {
    if (!payload || payload.format !== INCREMENTAL_FORMAT) {
      throw new Error('an incremental object has an unexpected format');
    }
    for (const change of payload.changes || []) {
      const id = Number(change.id);
      if (!Number.isFinite(id)) throw new Error('incremental change has no numeric id');
      if (id <= watermark) continue; // already covered by the snapshot
      if (byId.has(id) && !safeHexEqual(canonicalJson(byId.get(id)), canonicalJson(change))) {
        throw new Error(`conflicting duplicate incremental change id ${id}`);
      }
      byId.set(id, change);
    }
  }
  return [...byId.entries()].sort((a, b) => a[0] - b[0]).map(([, change]) => change);
}

/** The expected final state, computed independently of the restore target. */
export function buildExpectedState(snapshot, incrementalPayloads = []) {
  const state = stateFromSnapshot(snapshot);
  for (const change of collectReplayEvents(snapshot, incrementalPayloads)) applyChange(state, change);
  return state;
}

/** Normalise any target's state into a comparable object. */
export function normaliseState(state) {
  if (!state?.tables) return new Map();
  if (state.tables instanceof Map) return state.tables;
  const map = new Map();
  for (const [name, rows] of Object.entries(state.tables)) {
    const table = new Map();
    if (rows instanceof Map) {
      for (const [key, row] of rows) table.set(key, row);
    } else {
      for (const row of rows || []) {
        const keys = Object.keys(row).filter((key) => key === 'id' || key.endsWith('_id')).sort();
        table.set(rowKey(Object.fromEntries(keys.map((key) => [key, row[key]]))), row);
      }
    }
    map.set(name, table);
  }
  return map;
}

/** Compare two states by canonical row content, not object identity. */
export function compareStates(expected, actual) {
  const left = normaliseState(expected);
  const right = normaliseState(actual);
  const differences = [];
  const tables = new Set([...left.keys(), ...right.keys()]);
  for (const table of tables) {
    const a = left.get(table) || new Map();
    const b = right.get(table) || new Map();
    if (a.size === 0 && b.size === 0) continue;
    if (a.size !== b.size) differences.push(`${table}: expected ${a.size} rows, found ${b.size}`);
    for (const [key, row] of a) {
      const other = b.get(key);
      if (!other) differences.push(`${table}: missing row ${key}`);
      else if (canonicalJson(row) !== canonicalJson(other)) differences.push(`${table}: row ${key} differs`);
    }
    for (const key of b.keys()) {
      if (!a.has(key)) differences.push(`${table}: unexpected row ${key}`);
    }
  }
  return { ok: differences.length === 0, differences };
}

export function validateSnapshot(snapshot) {
  if (snapshot?.format !== SNAPSHOT_FORMAT) throw new Error('not a Campus+ full snapshot');
  const manifest = snapshot.manifest || {};
  if (!Array.isArray(manifest.schemas) || manifest.schemas.some((schema) => schema !== 'public')) {
    throw new Error('snapshot declares an unsupported schema (only public is restorable)');
  }
  if (!Array.isArray(manifest.tables) || !manifest.tables.length) {
    throw new Error('snapshot manifest has no tables');
  }
  if (manifest.complete_disaster_recovery !== false) {
    throw new Error('snapshot does not declare its disaster-recovery limits');
  }
  return manifest;
}

/**
 * Restore into `target` (an abstract transactional target).
 *
 * required target methods: begin(), replaceTables(tables, manifestTables),
 * applyChanges(changes), snapshotState(), commit(), rollback().
 */
export async function restoreFromBackup({
  snapshotEnvelope,
  incrementalEnvelopes = [],
  keyRing,
  target,
  verify = true,
  logger = null,
} = {}) {
  if (!target) throw new Error('a restore target is required');
  const { value: snapshot } = openJson(snapshotEnvelope, { keyRing });
  const manifest = validateSnapshot(snapshot);
  const incrementalPayloads = (incrementalEnvelopes || []).map((envelope) => openJson(envelope, { keyRing }).value);
  const changes = collectReplayEvents(snapshot, incrementalPayloads);
  const expected = buildExpectedState(snapshot, incrementalPayloads);

  await target.begin();
  try {
    await target.replaceTables(snapshot.tables || {}, manifest.tables);
    await target.applyChanges(changes);
    if (verify) {
      const comparison = compareStates(expected, await target.snapshotState());
      if (!comparison.ok) {
        throw new Error(`restore verification failed: ${comparison.differences.slice(0, 5).join('; ')}`);
      }
    }
    await target.commit();
  } catch (error) {
    await target.rollback();
    throw error;
  }

  logger?.warn?.(DISASTER_RECOVERY_NOTICE);
  return {
    restoredTables: manifest.tables.length,
    replayedEvents: changes.length,
    watermark: manifest.watermark,
    verified: verify,
    warnings: [DISASTER_RECOVERY_NOTICE],
  };
}

/** In-memory target used by the tested restoration procedure and unit tests. */
export function createMemoryTarget(initialState = null) {
  let committed = initialState ? { tables: normaliseState(initialState) } : createState();
  let working = createState();

  const clone = (state) => {
    const copy = createState();
    for (const [name, rows] of state.tables) {
      const table = new Map();
      for (const [key, row] of rows) table.set(key, { ...row });
      copy.tables.set(name, table);
    }
    return copy;
  };

  return {
    async begin() {
      working = clone(committed);
    },
    async replaceTables(tables, manifestTables) {
      working = createState();
      for (const entry of manifestTables || []) {
        const name = entry.name;
        const target = stateTable(working, name);
        const keyColumns = entry.key_columns || ['id'];
        for (const row of tables[name] || []) {
          const pk = Object.fromEntries(keyColumns.map((column) => [column, row?.[column] ?? null]));
          target.set(rowKey(pk), { ...row });
        }
      }
    },
    async applyChanges(changes) {
      for (const change of changes) {
        const table = stateTable(working, change.table_name);
        const key = rowKey(change.row_pk);
        if (change.operation === 'delete') table.delete(key);
        else table.set(key, { ...change.row_data });
      }
    },
    async snapshotState() {
      return clone(working);
    },
    async commit() {
      committed = clone(working);
    },
    async rollback() {
      working = clone(committed);
    },
    state() {
      return clone(committed);
    },
  };
}
