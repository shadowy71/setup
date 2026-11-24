import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { claimReminder, reminderKey } from '@/lib/reminders/browser';

afterEach(() => vi.unstubAllGlobals());

describe('cross-tab reminder claims', () => {
  it('atomically awards one claim, survives a new controller, and expires', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const item = { division: 'O', event_date: '2026-11-23', event_key: '2026-11-23|Monday|class' };
    const key = reminderKey('student-a', item);
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimReminder(key, 1000)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimReminder(key, 1001)).toBe(false);
    expect(await claimReminder(reminderKey('student-b', item), 1001)).toBe(true);
    expect(await claimReminder(reminderKey('student-a', { ...item, division: 'P' }), 1001)).toBe(true);
    expect(await claimReminder(key, 1000 + 2 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  it('fails closed if no atomic storage or lock is available', async () => {
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('navigator', {});
    expect(await claimReminder('key')).toBe(false);
  });

  it('uses Web Locks and localStorage when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    let queue = Promise.resolve();
    vi.stubGlobal('navigator', { locks: { request: (_name, callback) => {
      const next = queue.then(callback); queue = next.catch(() => {}); return next;
    } } });
    const store = new Map();
    vi.stubGlobal('localStorage', {
      get length() { return store.size; }, key: (n) => [...store.keys()][n],
      getItem: (key) => store.get(key) || null, setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    });
    const results = await Promise.all([claimReminder('same', 1000), claimReminder('same', 1000)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
