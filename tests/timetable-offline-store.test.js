import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DIVISIONS } from '@/lib/constants';
import { getDivisionTimetable } from '@/lib/timetable';
import {
  MAX_SNAPSHOT_BATCHES,
  SNAPSHOT_SCHEMA_VERSION,
  buildSnapshot,
  formatSavedAgo,
  minutesOf,
  snapshotChecksum,
  snapshotFreshness,
  validateSnapshot,
} from '@/lib/timetable/offline';
import {
  clearSavedBatches,
  listSavedBatches,
  loadBatch,
  readSetting,
  removeBatch,
  saveBatch,
  storageBackend,
  storageStatus,
  writeSetting,
} from '@/lib/timetable/offline-store';

/**
 * The offline snapshot contract and the device store.
 *
 * These are the two files that decide whether "saved for offline use" means
 * anything, so the tests are about *content* rather than plumbing:
 *   * every batch is its own week, and the payload is the page's own view model;
 *   * a snapshot that cannot be understood is refused, whole, before it is
 *     written — never repaired and never half-rendered;
 *   * one batch's save can neither overwrite nor be confused with another's;
 *   * storage failures (quota, unavailable, corrupted) come back as a code the
 *     UI can explain, and never as a thrown error inside a React render.
 *
 * IndexedDB is replaced by the small fake below — a real object-store semantic
 * (keyPath records, transaction completion, getAll/get/put/delete), not a
 * no-op mock, because the bug worth catching here is "the transaction resolved
 * before the write landed".
 */

/* --------------------------------------------------------------------------
   Fake IndexedDB
   -------------------------------------------------------------------------- */

const stores = new Map();
let failNextWrite = null;
let openShouldFail = false;
let lastOpen = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeRequest {
  constructor(executor, { write = false } = {}) {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    Promise.resolve()
      .then(executor)
      .then((result) => {
        if (write && failNextWrite) {
          const error = failNextWrite;
          failNextWrite = null;
          this.error = error;
          this.onerror?.({ target: this });
          return;
        }
        this.result = result;
        this.onsuccess?.({ target: this });
      });
  }
}

class FakeStore {
  constructor(name, keyPath) {
    this.name = name;
    this.keyPath = keyPath;
    if (!stores.has(name)) stores.set(name, new Map());
  }

  get data() {
    return stores.get(this.name);
  }

  put(value) {
    return new FakeRequest(
      () => {
        this.data.set(value[this.keyPath], clone(value));
        return undefined;
      },
      { write: true },
    );
  }

  get(key) {
    return new FakeRequest(() => {
      const value = this.data.get(key);
      return value === undefined ? undefined : clone(value);
    });
  }

  getAll() {
    return new FakeRequest(() => [...this.data.values()].map(clone));
  }

  getAllKeys() {
    return new FakeRequest(() => [...this.data.keys()]);
  }

  delete(key) {
    return new FakeRequest(
      () => {
        this.data.delete(key);
      },
      { write: true },
    );
  }
}

class FakeTransaction {
  constructor(names, mode) {
    this.mode = mode;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this._stores = new Map(names.map((name) => [name, new FakeStore(name, name === 'batches' ? 'division' : 'key')]));
    this._listeners = { error: [] };
    // Completion is a macrotask on purpose: the code under test awaits several
    // requests inside one transaction, and `oncomplete` must not fire before
    // all of them have landed.
    setTimeout(() => this.oncomplete?.({ target: this }), 0);
  }

  objectStore(name) {
    return this._stores.get(name);
  }

  addEventListener(type, handler) {
    this._listeners[type]?.push(handler);
  }
}

class FakeDatabase {
  objectStoreNames = { contains: (name) => stores.has(name) };

  createObjectStore(name, { keyPath }) {
    stores.set(name, new Map());
    return new FakeStore(name, keyPath);
  }

  transaction(names) {
    return new FakeTransaction(names);
  }

  close() {}
}

function installFakeIndexedDB() {
  globalThis.indexedDB = {
    open(name, version) {
      lastOpen = { name, version };
      const request = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };
      setTimeout(() => {
        if (openShouldFail) {
          request.error = new Error('blocked');
          request.onerror?.({ target: request });
          return;
        }
        const db = new FakeDatabase();
        request.result = db;
        // Every open in this fake is a fresh install: create the stores.
        request.onupgradeneeded?.({ target: request });
        request.onsuccess?.({ target: request });
      }, 0);
      return request;
    },
  };
}

function snapshotFor(division, extra = {}) {
  return buildSnapshot({ ...getDivisionTimetable(division), generatedAt: '2026-10-23T06:00:00.000Z', ...extra });
}

beforeEach(() => {
  stores.clear();
  failNextWrite = null;
  openShouldFail = false;
  installFakeIndexedDB();
  vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist: async () => false, estimate: async () => ({ usage: 1, quota: 2 }) } });
});

/* -------------------------------------------------------------------------- */

describe('snapshot building', () => {
  it('carries the real week for each batch, with the times the UI needs', () => {
    const snapshot = snapshotFor('O');
    expect(snapshot.division).toBe('O');
    expect(snapshot.label).toBe('IT');
    expect(snapshot.friendly).toBe('Information Technology');
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.days.map((day) => day.day)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);

    const live = getDivisionTimetable('O');
    expect(snapshot.eventCount).toBe(live.days.reduce((total, day) => total + day.events.length, 0));
    expect(snapshot.days[0].events[0].lines).toEqual(live.days[0].events[0].lines);
    // Verbatim source strings: batch practicals keep their slash form.
    expect(snapshot.days[0].events[0].lines[0]).toContain('/');
    // Every event carries what an offline render needs — no live lookup.
    for (const day of snapshot.days) {
      for (const event of day.events) {
        expect(event.time.fromLabel).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
        expect(event.endMinutes).toBeGreaterThanOrEqual(event.startMinutes);
        expect(['standard', 'batch', 'lunch', 'special']).toContain(event.kind);
      }
    }
  });

  it('is idempotent: the same week always produces the same checksum', () => {
    const a = snapshotFor('O');
    const b = snapshotFor('O');
    expect(a.checksum).toBe(b.checksum);
    // …and a different day's data is a different checksum.
    expect(snapshotFor('J').checksum).not.toBe(a.checksum);
    // key order does not matter
    const reordered = { friendly: a.friendly, division: a.division, label: a.label, days: a.days, subjects: a.subjects, flagged: a.flagged, source: a.source };
    expect(snapshotChecksum(reordered)).toBe(a.checksum);
  });

  it('refuses to build for a batch that does not exist', () => {
    expect(buildSnapshot({ division: 'S', days: [] })).toBeNull();
    expect(buildSnapshot(null)).toBeNull();
  });

  it('survives a malformed server timestamp instead of throwing inside the save', () => {
    const before = Date.now();
    const snapshot = buildSnapshot({ ...getDivisionTimetable('O'), generatedAt: 'yesterday-ish' });
    expect(Number.isFinite(Date.parse(snapshot.generatedAt))).toBe(true);
    expect(Date.parse(snapshot.generatedAt)).toBeGreaterThanOrEqual(before);
    expect(snapshot.checksum).toBe(snapshotFor('O').checksum);
  });

  it('records the server timestamp and leaves the save timestamp to the device', () => {
    const snapshot = snapshotFor('O');
    expect(snapshot.generatedAt).toBe('2026-10-23T06:00:00.000Z');
    expect(snapshot.savedAt).toBeNull();
    expect(buildSnapshot({ ...getDivisionTimetable('O'), generatedAt: 'x' }, { savedAt: '2026-10-24T01:00:00Z' }).savedAt).toBe(
      '2026-10-24T01:00:00.000Z',
    );
  });
});

describe('snapshot validation', () => {
  it('accepts only a complete, self-consistent week', () => {
    const good = snapshotFor('O');
    expect(validateSnapshot(good, { expectDivision: 'O' }).ok).toBe(true);
  });

  it('rejects the shapes that would render a wrong timetable', () => {
    const good = snapshotFor('O');
    const cases = [
      ['empty', null],
      ['not an object', 'snapshot'],
      ['unknown schema', { ...good, schemaVersion: 99 }],
      ['no division', { ...good, division: null }],
      ['division invented', { ...good, division: 'S' }],
      ['wrong batch', { ...good }],
      ['a day missing', { ...good, days: good.days.slice(0, 4) }],
      ['a day duplicated', { ...good, days: [...good.days, good.days[0]] }],
      ['a weekend day', { ...good, days: [{ day: 'Saturday', events: [] }, ...good.days.slice(0, 4)] }],
      ['events missing', { ...good, days: good.days.map((day, i) => (i === 0 ? { ...day, events: null } : day)) }],
      ['an event with no lines', { ...good, days: [{ ...good.days[0], events: [{ lines: [] }] }, ...good.days.slice(1)] }],
      ['an event without times', { ...good, days: [{ ...good.days[0], events: [{ lines: ['X'], startMinutes: NaN }] }, ...good.days.slice(1)] }],
      ['an event ending before it starts', { ...good, days: [{ ...good.days[0], events: [{ lines: ['X'], startMinutes: 600, endMinutes: 300, time: { fromLabel: 'x' } }] }, ...good.days.slice(1)] }],
      ['too many events in a day', { ...good, days: [{ ...good.days[0], events: Array.from({ length: 60 }, (_, i) => ({ lines: [`X${i}`], startMinutes: 0, endMinutes: 1, time: { fromLabel: 'x' } })) }, ...good.days.slice(1)] }],
    ];

    for (const [name, value] of cases) {
      const options = name === 'wrong batch' ? { expectDivision: 'J' } : { expectDivision: 'O' };
      const result = validateSnapshot(value, options);
      expect(result.ok, name).toBe(false);
      expect(result.error, name).toBeTruthy();
    }
  });

  it('flags a payload whose own checksum does not match as stale, and never throws', () => {
    const good = snapshotFor('O');
    const tampered = { ...good, days: good.days.map((day, index) => (index === 0 ? { ...day, events: day.events.slice(1) } : day)) };
    const result = validateSnapshot(tampered, { expectDivision: 'O' });
    expect(result.ok).toBe(true); // structurally sound…
    expect(result.stale).toBe(true); // …but not what the build said it was
    expect(validateSnapshot({ ...good, checksum: 'deadbeef' }).stale).toBe(true);
  });

  it('normalises a valid snapshot instead of trusting the input object', () => {
    const good = snapshotFor('O');
    const { snapshot } = validateSnapshot({ ...good, days: good.days.map((day) => ({ ...day, branch: undefined })) });
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.days[0].branch).toBe('IT');
    expect(snapshot.checksum).toBe(good.checksum);
  });
});

describe('freshness and labels', () => {
  const now = Date.parse('2026-10-23T10:00:00Z');

  it('says fresh, then aging, then stale — and never invents a time', () => {
    expect(snapshotFreshness({ savedAt: new Date(now - 60_000).toISOString() }, now).state).toBe('fresh');
    expect(snapshotFreshness({ savedAt: new Date(now - 2 * 24 * 3600_000).toISOString() }, now).state).toBe('aging');
    expect(snapshotFreshness({ savedAt: new Date(now - 30 * 24 * 3600_000).toISOString() }, now).state).toBe('stale');
    expect(snapshotFreshness(null, now).state).toBe('unknown');
    expect(snapshotFreshness({ savedAt: 'nonsense' }, now).state).toBe('unknown');
    expect(snapshotFreshness({ savedAt: 'nonsense' }, now).label).toBe('Saved copy');
  });

  it('reads the clock in the institute timezone, in 12-hour form', () => {
    // 21:07 IST on a Friday.
    const at = '2026-10-23T15:37:00.000Z';
    const friday = new Date('2026-10-23T15:40:00.000Z');
    expect(formatSavedAgo(at, friday, 'Asia/Kolkata')).toBe('today 9:07 PM');
    expect(formatSavedAgo('2026-10-22T02:05:00.000Z', friday, 'Asia/Kolkata')).toBe('yesterday 7:35 AM');
    expect(formatSavedAgo('2026-10-19T02:00:00.000Z', friday, 'Asia/Kolkata')).toBe('4 days ago');
    // Beyond a week the label falls back to a date; Node's en-IN ICU spells the
    // month `Sept`, other builds `Sep`, so only the day number is pinned here.
    expect(formatSavedAgo('2026-09-01T02:00:00.000Z', friday, 'Asia/Kolkata')).toMatch(/^1 Sep/);
    expect(formatSavedAgo(null, friday)).toBe('not saved yet');
  });

  it('parses printed times defensively', () => {
    expect(minutesOf('09:10')).toBe(550);
    expect(minutesOf('24:00')).toBe(0);
    expect(minutesOf(null)).toBe(0);
    expect(minutesOf('half past nine')).toBe(0);
  });
});

describe('the device store', () => {
  it('opens one named, versioned database for this feature alone', async () => {
    await saveBatch(snapshotFor('O'));
    // A shared or unnamed store is how one feature ends up wiping another's
    // data; the name and version are also what makes an upgrade path possible.
    expect(lastOpen).toEqual({ name: 'campusplus-timetable-offline', version: 1 });
    expect(stores.has('batches')).toBe(true);
    expect(storageBackend()).toBe('idb');
    delete globalThis.indexedDB;
    expect(storageBackend()).toBe('none');
  });

  it('saves, reads back and reports the batch it stored', async () => {
    const result = await saveBatch(snapshotFor('O'));
    expect(result.ok).toBe(true);
    expect(result.unchanged).toBe(false);
    expect(result.record.division).toBe('O');
    expect(result.record.eventCount).toBeGreaterThan(0);

    const loaded = await loadBatch('O');
    expect(loaded.ok).toBe(true);
    expect(loaded.snapshot.division).toBe('O');
    expect(loaded.snapshot.checksum).toBe(snapshotFor('O').checksum);
    expect(loaded.stale).toBe(false);
  });

  it('never re-writes an identical week, so "last saved" cannot drift', async () => {
    await saveBatch(snapshotFor('O'));
    const again = await saveBatch(snapshotFor('O'));
    expect(again.ok).toBe(true);
    expect(again.unchanged).toBe(true);
  });

  it('keeps one batch per record: saving J leaves O untouched and separate', async () => {
    await saveBatch(snapshotFor('O'));
    const before = (await loadBatch('O')).snapshot;

    await saveBatch(snapshotFor('J'));
    const [o, j] = await Promise.all([loadBatch('O'), loadBatch('J')]);

    expect(o.snapshot.checksum).toBe(before.checksum);
    expect(j.snapshot.checksum).not.toBe(o.snapshot.checksum);
    expect(j.snapshot.division).toBe('J');
    expect(o.snapshot.days[0].events[0].lines).not.toEqual(j.snapshot.days[0].events[0].lines);

    const list = await listSavedBatches();
    expect(list.batches.map((entry) => entry.division).sort()).toEqual(['J', 'O']);
  });

  it('refuses to store another batch under the key it was asked for', async () => {
    const result = await saveBatch({ ...snapshotFor('O'), division: 'Z' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid-snapshot');
  });

  it('refuses a corrupted snapshot instead of half-storing it', async () => {
    const broken = { ...snapshotFor('O'), days: [] };
    const result = await saveBatch(broken);
    expect(result.ok).toBe(false);
    expect(await loadBatch('O')).toMatchObject({ snapshot: null });
  });

  it('drops a stored record that no longer validates, and reports null', async () => {
    await saveBatch(snapshotFor('O'));
    // Corrupt the record behind the module's back, the way an interrupted
    // write or a hand-edited database would.
    stores.get('batches').set('O', { division: 'O', snapshot: { ...snapshotFor('O'), schemaVersion: 0 } });
    const loaded = await loadBatch('O');
    expect(loaded.snapshot).toBeNull();
    expect(loaded.dropped).toBe('schema');
  });

  it('surfaces quota and unavailable storage as codes the UI can explain', async () => {
    failNextWrite = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    const quota = await saveBatch(snapshotFor('O'));
    expect(quota.ok).toBe(false);
    expect(quota.error).toBe('quota');

    openShouldFail = true;
    const unavailable = await saveBatch(snapshotFor('J'));
    expect(unavailable.ok).toBe(false);
    expect(unavailable.error).toMatch(/storage/);
  });

  it('removes one batch and clears only this feature’s records', async () => {
    await saveBatch(snapshotFor('O'));
    await saveBatch(snapshotFor('J'));
    await removeBatch('O');
    expect((await listSavedBatches()).batches.map((entry) => entry.division)).toEqual(['J']);
    expect(stores.get('batches').has('J')).toBe(true);

    await clearSavedBatches();
    expect(stores.get('batches').size).toBe(0);
  });

  it('keeps only the newest batches when the cap is reached', async () => {
    for (const division of DIVISIONS.slice(0, MAX_SNAPSHOT_BATCHES)) {
      await saveBatch(snapshotFor(division));
    }
    expect((await listSavedBatches()).batches).toHaveLength(MAX_SNAPSHOT_BATCHES);
    await saveBatch(snapshotFor('O'));
    const list = await listSavedBatches();
    expect(list.batches.length).toBeLessThanOrEqual(MAX_SNAPSHOT_BATCHES);
  });

  it('stores only settings on the allow-list, and reports durable-storage state', async () => {
    expect((await writeSetting('lastPrepareAt', '2026-10-23T10:00:00Z')).ok).toBe(true);
    expect(await readSetting('lastPrepareAt')).toBe('2026-10-23T10:00:00Z');
    expect((await writeSetting('accessToken', 'nope')).ok).toBe(false);
    expect(await readSetting('accessToken')).toBeNull();

    const status = await storageStatus();
    expect(status.backend).toBe('idb');
    expect(status.persisted).toBe(false);
    expect(status.quota).toBe(2);
  });

  it('writes nothing that looks like a credential', async () => {
    await saveBatch(snapshotFor('O'));
    const dumped = JSON.stringify([...stores.get('batches').values()]);
    expect(dumped).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // no JWTs
    expect(dumped).not.toMatch(/service_role|anon|secret|password|token/i);
    expect(dumped).not.toContain('SUPABASE');
  });
});
