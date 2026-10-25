/**
 * Where a saved timetable lives in the browser.
 *
 * IndexedDB, one record per batch, keyed by the division letter. A structured
 * store (rather than a `localStorage` blob or a CacheStorage response) is the
 * right shape here: the payload is a few dozen kilobytes of nested records that
 * the interface reads one batch at a time, and each batch has to survive being
 * updated while another batch is untouched — which is exactly what an
 * `IDBObjectStore` keyed on the division gives us, and exactly what a single
 * shared JSON blob does not.
 *
 * Deliberate choices:
 *   - one key per batch, so saving Division J can never rewrite Division O;
 *   - a record is validated by `lib/timetable/offline.js` on the way *in* and
 *     again on the way *out*, so a partial write or an old format is dropped
 *     rather than rendered;
 *   - `localStorage` is the only fallback, and only for browsers where
 *     IndexedDB is unavailable (private mode, some in-app webviews). No
 *     fallback exists for a browser with neither: the caller gets a real error
 *     code and the UI says so.
 *   - nothing but timetable data is ever written here — no session, no token,
 *     no key. `settings` accepts an explicit allow-list for the same reason.
 */

import { MAX_SNAPSHOT_BATCHES, SNAPSHOT_SCHEMA_VERSION, validateSnapshot } from '@/lib/timetable/offline';

export const DB_NAME = 'campusplus-timetable-offline';
export const DB_VERSION = 1;
export const BATCH_STORE = 'batches';
export const SETTING_STORE = 'settings';

/** The fallback namespace. Bumped with the schema so an old blob is ignored. */
export const FALLBACK_PREFIX = `cptt:v${SNAPSHOT_SCHEMA_VERSION}:`;

/** The only settings the store will accept. A junk drawer is not a feature. */
export const SETTING_KEYS = ['installDismissedAt', 'lastPrepareAt', 'lastShellWarmAt', 'wideScope', 'swScope'];

const MAX_RECORD_BYTES = 400 * 1024;

/* --------------------------------------------------------------------------
   Environment
   -------------------------------------------------------------------------- */

function hasIndexedDB() {
  return typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null;
}

function hasLocalStorage() {
  try {
    if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) return false;
    const probe = '__cp_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** `idb` | `local-storage` | `none` — surfaced in the UI as the storage state. */
export function storageBackend() {
  if (hasIndexedDB()) return 'idb';
  if (hasLocalStorage()) return 'local-storage';
  return 'none';
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error('indexeddb-unavailable'));
      return;
    }
    let request;
    try {
      request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BATCH_STORE)) db.createObjectStore(BATCH_STORE, { keyPath: 'division' });
      if (!db.objectStoreNames.contains(SETTING_STORE)) db.createObjectStore(SETTING_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexeddb-open-failed'));
    request.onblocked = () => reject(new Error('indexeddb-blocked'));
  });
}

async function withStore(mode, run) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      let transaction;
      try {
        transaction = db.transaction([BATCH_STORE, SETTING_STORE], mode);
      } catch (error) {
        reject(error);
        return;
      }
      const stores = {
        [BATCH_STORE]: transaction.objectStore(BATCH_STORE),
        [SETTING_STORE]: transaction.objectStore(SETTING_STORE),
      };
      let outcome;
      let failure = null;
      Promise.resolve(run(stores))
        .then((value) => {
          outcome = value;
        })
        .catch(reject);
      transaction.oncomplete = () => resolve(outcome);
      transaction.onerror = () => reject(failure || transaction.error || new Error('indexeddb-transaction-failed'));
      transaction.onabort = () => reject(failure || transaction.error || new Error('indexeddb-aborted'));
      // Quota errors arrive on the request, not the transaction, in most engines.
      transaction.addEventListener('error', (event) => {
        failure = event.target?.error || event.error || null;
      });
    });
  } finally {
    db.close?.();
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexeddb-request-failed'));
  });
}

/* --------------------------------------------------------------------------
   localStorage fallback
   -------------------------------------------------------------------------- */

function fallbackWrite(key, value) {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (error) {
    const name = error?.name || '';
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return { ok: false, error: 'quota' };
    return { ok: false, error: 'storage-unavailable' };
  }
}

function fallbackRead(key) {
  try {
    const raw = globalThis.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function fallbackKeys() {
  const keys = [];
  for (let index = 0; index < (globalThis.localStorage?.length ?? 0); index += 1) {
    const key = globalThis.localStorage.key(index);
    if (key?.startsWith(FALLBACK_PREFIX)) keys.push(key);
  }
  return keys;
}

/* --------------------------------------------------------------------------
   Records
   -------------------------------------------------------------------------- */

/** What a stored record holds: the snapshot, plus the bookkeeping the UI reads. */
function toRecord(snapshot, previous) {
  return {
    division: snapshot.division,
    savedAt: snapshot.savedAt || new Date().toISOString(),
    generatedAt: snapshot.generatedAt,
    checksum: snapshot.checksum,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    bytes: measure(snapshot),
    label: snapshot.label,
    friendly: snapshot.friendly,
    eventCount: snapshot.eventCount,
    snapshot,
    // Written once and preserved across saves so "first saved" stays honest.
    firstSavedAt: previous?.firstSavedAt || snapshot.savedAt || new Date().toISOString(),
  };
}

function measure(snapshot) {
  try {
    return JSON.stringify(snapshot).length;
  } catch {
    return 0;
  }
}

function summaryOf(record) {
  if (!record) return null;
  return {
    division: record.division,
    label: record.label,
    friendly: record.friendly,
    savedAt: record.savedAt,
    generatedAt: record.generatedAt,
    firstSavedAt: record.firstSavedAt,
    checksum: record.checksum,
    schemaVersion: record.schemaVersion,
    bytes: record.bytes,
    eventCount: record.eventCount,
  };
}

/**
 * Save (or re-save) one batch. Idempotent: writing the same checksum twice is
 * reported as `unchanged` and rewrites nothing, so a double click, a retry, or
 * a re-fetch that returned the same printed week never churns the store or
 * moves "last saved" forward.
 */
export async function saveBatch(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return { ok: false, error: 'invalid-snapshot' };
  const validated = validateSnapshot(snapshot);
  if (!validated.ok) return { ok: false, error: `invalid-snapshot:${validated.error}` };

  const record = validated.snapshot;
  if (measure(record) > MAX_RECORD_BYTES) return { ok: false, error: 'too-large' };

  const backend = storageBackend();
  if (backend === 'none') return { ok: false, error: 'storage-unavailable' };

  try {
    if (backend === 'local-storage') {
      const key = `${FALLBACK_PREFIX}${record.division}`;
      const previous = fallbackRead(key);
      if (previous?.checksum === record.checksum) {
        return { ok: true, unchanged: true, backend, record: summaryOf(previous) };
      }
      const written = fallbackWrite(key, toRecord(record, previous));
      if (!written.ok) return { ok: false, error: written.error, backend };
      return { ok: true, unchanged: false, backend, record: summaryOf(fallbackRead(key)) };
    }

    return await withStore('readwrite', async (stores) => {
      const store = stores[BATCH_STORE];
      const previous = await requestToPromise(store.get(record.division)).catch(() => null);
      if (previous?.checksum === record.checksum && previous?.schemaVersion === SNAPSHOT_SCHEMA_VERSION) {
        return { ok: true, unchanged: true, backend, record: summaryOf(previous) };
      }
      const next = toRecord(record, previous);
      await requestToPromise(store.put(next));
      const evicted = await evictOldest(store, MAX_SNAPSHOT_BATCHES);
      const total = await requestToPromise(store.getAllKeys()).catch(() => []);
      return {
        ok: true,
        unchanged: false,
        backend,
        batches: total.length,
        evicted,
        record: summaryOf(next),
      };
    });
  } catch (error) {
    const name = error?.name || '';
    if (name === 'QuotaExceededError' || /quota/i.test(String(error?.message))) {
      return { ok: false, error: 'quota', backend };
    }
    return { ok: false, error: 'storage-error', backend, detail: String(error?.message || error).slice(0, 120) };
  }
}

/**
 * Read one batch's snapshot, or `null`. A record that fails validation is
 * removed on the way out (best effort) so the next open starts clean, and the
 * caller is told the truth: `null`, not a half-read week.
 */
export async function loadBatch(division) {
  const wanted = String(division ?? '').trim().toUpperCase();
  if (!wanted) return { ok: false, snapshot: null, error: 'no-division' };

  const backend = storageBackend();
  if (backend === 'none') return { ok: true, snapshot: null, backend, error: 'storage-unavailable' };

  try {
    if (backend === 'local-storage') {
      const raw = fallbackRead(`${FALLBACK_PREFIX}${wanted}`);
      return finishLoad(raw, wanted, backend);
    }
    return await withStore('readonly', async (stores) => {
      const record = await requestToPromise(stores[BATCH_STORE].get(wanted)).catch(() => null);
      return finishLoad(record, wanted, backend);
    });
  } catch (error) {
    return { ok: false, snapshot: null, backend, error: String(error?.name || error?.message || 'storage-error') };
  }
}

function finishLoad(record, wanted, backend) {
  if (!record?.snapshot) return { ok: true, snapshot: null, backend };
  const validated = validateSnapshot(record.snapshot, { expectDivision: wanted });
  if (!validated.ok) return { ok: true, snapshot: null, backend, dropped: validated.error };
  return { ok: true, snapshot: validated.snapshot, backend, stale: validated.stale, record: summaryOf(record) };
}

/** Every batch this device has saved, newest first. Powers the batch switcher. */
export async function listSavedBatches() {
  const backend = storageBackend();
  if (backend === 'none') return { ok: true, backend, batches: [] };

  try {
    if (backend === 'local-storage') {
      const batches = fallbackKeys()
        .map((key) => fallbackRead(key))
        .filter(Boolean)
        .map((record) => summaryOf(record))
        .filter(Boolean);
      return { ok: true, backend, batches: sortNewest(batches) };
    }
    return await withStore('readonly', async (stores) => {
      const records = await requestToPromise(stores[BATCH_STORE].getAll()).catch(() => []);
      return { ok: true, backend, batches: sortNewest(records.map((record) => summaryOf(record)).filter(Boolean)) };
    });
  } catch {
    return { ok: true, backend, batches: [] };
  }
}

/**
 * Only this schema's records are listed: a record written by an older (or newer)
 * build cannot be rendered safely, and it is dropped rather than shown.
 */
function sortNewest(batches) {
  return [...batches]
    .filter((batch) => batch.schemaVersion === SNAPSHOT_SCHEMA_VERSION)
    .sort((a, b) => Date.parse(b.savedAt || 0) - Date.parse(a.savedAt || 0))
    .slice(0, MAX_SNAPSHOT_BATCHES);
}

/**
 * Keep the store bounded: the newest `limit` batches only, oldest first out.
 * A student who has saved every division A–R is at the cap already; saving one
 * more evicts the one they least recently refreshed instead of failing.
 */
async function evictOldest(store, limit) {
  const records = await requestToPromise(store.getAll()).catch(() => []);
  const keep = [...records]
    .sort((a, b) => Date.parse(b.savedAt || 0) - Date.parse(a.savedAt || 0))
    .slice(0, limit)
    .map((record) => record.division);
  const evicted = records.map((record) => record.division).filter((division) => !keep.includes(division));
  for (const division of evicted) await requestToPromise(store.delete(division)).catch(() => {});
  return evicted;
}

export async function removeBatch(division) {
  const wanted = String(division ?? '').trim().toUpperCase();
  if (!wanted) return { ok: false, error: 'no-division' };
  const backend = storageBackend();
  if (backend === 'none') return { ok: true, backend, removed: false };

  try {
    if (backend === 'local-storage') {
      globalThis.localStorage.removeItem(`${FALLBACK_PREFIX}${wanted}`);
      return { ok: true, backend, removed: true };
    }
    return await withStore('readwrite', async (stores) => {
      await requestToPromise(stores[BATCH_STORE].delete(wanted));
      return { ok: true, backend, removed: true };
    });
  } catch {
    return { ok: false, error: 'storage-error', backend };
  }
}

/**
 * Delete only this feature's saved timetables. It never calls
 * `caches.delete` for another cache, never clears site data, and never
 * unregisters a worker it does not own.
 */
export async function clearSavedBatches() {
  const backend = storageBackend();
  if (backend === 'none') return { ok: true, backend, cleared: 0 };
  try {
    if (backend === 'local-storage') {
      const keys = fallbackKeys();
      for (const key of keys) globalThis.localStorage.removeItem(key);
      return { ok: true, backend, cleared: keys.length };
    }
    return await withStore('readwrite', async (stores) => {
      const keys = await requestToPromise(stores[BATCH_STORE].getAllKeys()).catch(() => []);
      for (const key of keys) await requestToPromise(stores[BATCH_STORE].delete(key));
      return { ok: true, backend, cleared: keys.length };
    });
  } catch {
    return { ok: false, error: 'storage-error', backend };
  }
}

/** Settings are a tiny allow-list store: install dismissal, last prepare. */
export async function readSetting(key) {
  if (!SETTING_KEYS.includes(key)) return null;
  const backend = storageBackend();
  if (backend === 'none') return null;
  try {
    if (backend === 'local-storage') return fallbackRead(`${FALLBACK_PREFIX}setting:${key}`)?.value ?? null;
    return await withStore('readonly', async (stores) => {
      const record = await requestToPromise(stores[SETTING_STORE].get(key)).catch(() => null);
      return record?.value ?? null;
    });
  } catch {
    return null;
  }
}

export async function writeSetting(key, value) {
  if (!SETTING_KEYS.includes(key)) return { ok: false, error: 'setting-not-allowed' };
  const backend = storageBackend();
  if (backend === 'none') return { ok: false, error: 'storage-unavailable' };
  try {
    if (backend === 'local-storage') {
      return fallbackWrite(`${FALLBACK_PREFIX}setting:${key}`, { key, value });
    }
    return await withStore('readwrite', async (stores) => {
      await requestToPromise(stores[SETTING_STORE].put({ key, value }));
      return { ok: true, backend };
    });
  } catch {
    return { ok: false, error: 'storage-error', backend };
  }
}

/**
 * Storage pressure, honestly reported. `persisted` is the durable-storage
 * grant: without it, a device under pressure is allowed to evict the offline
 * copy, and the UI should say "saved for offline use" rather than promise it.
 *
 * `navigator?.storage` is the browser's own StorageManager, optional-chained
 * all the way down because a webview without it must not throw here. It is not
 * an app file store and nothing in this feature ever uploads: the campus rule
 * (tests/spec.test.js) is that the product has no bucket, and it stays that way.
 */
export async function storageStatus() {
  const out = { backend: storageBackend(), persisted: false, usage: null, quota: null, estimateError: null };
  try {
    if (navigator?.storage?.persisted) out.persisted = Boolean(await navigator?.storage?.persisted?.());
    const estimate = await navigator?.storage?.estimate?.();
    if (estimate) {
      out.usage = estimate.usage ?? null;
      out.quota = estimate.quota ?? null;
    }
  } catch (error) {
    out.estimateError = String(error?.name || error?.message || 'estimate-failed');
  }
  return out;
}

/** Ask for the durable grant once, before a save, and never nag after a no. */
export async function requestPersistence() {
  try {
    if (!navigator?.storage?.persist) return { granted: false, reason: 'unsupported' };
    if (await navigator?.storage?.persisted?.()) return { granted: true, reason: 'already' };
    return { granted: Boolean(await navigator?.storage?.persist?.()), reason: 'prompt' };
  } catch {
    return { granted: false, reason: 'failed' };
  }
}
