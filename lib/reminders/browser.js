/** Cross-tab reminder coordination. No profile preference or session is stored. */
export const REMINDER_SIGNAL = 'campusplus:class-reminders:signal';
const DB_NAME = 'campusplus-class-reminder-dedup';
const STORE = 'shown';
const TTL = 2 * 24 * 60 * 60 * 1000;

export function reminderKey(profileId, reminder) {
  return JSON.stringify([profileId, reminder.division, reminder.event_date, reminder.event_key]);
}

/** Announce an invalidation, never an authoritative profile or division. */
export function signalReminders(type, profileId = null) {
  if (typeof window === 'undefined') return;
  const message = { type, profileId, nonce: `${Date.now()}-${Math.random()}` };
  window.dispatchEvent(new CustomEvent(REMINDER_SIGNAL, { detail: message }));
  try {
    const channel = new BroadcastChannel(REMINDER_SIGNAL);
    channel.postMessage(message);
    channel.close();
  } catch { /* storage event is the fallback */ }
  try {
    localStorage.setItem(REMINDER_SIGNAL, JSON.stringify(message));
    localStorage.removeItem(REMINDER_SIGNAL);
  } catch { /* best effort */ }
}

export function listenReminderSignals(handler) {
  const local = (event) => handler(event.detail);
  const storage = (event) => {
    if (event.key !== REMINDER_SIGNAL || !event.newValue) return;
    try { handler(JSON.parse(event.newValue)); } catch { /* ignore corrupt data */ }
  };
  window.addEventListener(REMINDER_SIGNAL, local);
  window.addEventListener('storage', storage);
  let channel;
  try {
    channel = new BroadcastChannel(REMINDER_SIGNAL);
    channel.onmessage = (event) => handler(event.data);
  } catch { /* storage events still work */ }
  return () => {
    window.removeEventListener(REMINDER_SIGNAL, local);
    window.removeEventListener('storage', storage);
    channel?.close();
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('unavailable'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
}

/**
 * Atomic insert across tabs. Records contain only a scoped event key and expiry.
 * If IndexedDB is unavailable, Web Locks + localStorage give the same atomic
 * claim. Without either combination we fail closed rather than duplicate.
 */
export async function claimReminder(key, now = Date.now()) {
  try {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        let claimed = false;
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (item) {
            if (item.value.expires <= now) item.delete();
            item.continue();
          }
        };
        const get = store.get(key);
        get.onsuccess = () => {
          if (!get.result || get.result.expires <= now) {
            store.put({ key, expires: now + TTL });
            claimed = true;
          }
        };
        tx.oncomplete = () => resolve(claimed);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  } catch {
    if (!globalThis.navigator?.locks?.request) return false;
    try {
      return await navigator.locks.request('campusplus:class-reminder-claims', async () => {
        const prefix = 'campusplus:reminder:shown:';
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
          const item = localStorage.key(i);
          if (item?.startsWith(prefix) && Number(localStorage.getItem(item)) <= now) localStorage.removeItem(item);
        }
        const storageKey = prefix + key;
        if (Number(localStorage.getItem(storageKey)) > now) return false;
        localStorage.setItem(storageKey, String(now + TTL));
        return true;
      });
    } catch { return false; }
  }
}
