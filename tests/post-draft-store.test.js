import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPostDraft, putPostDraft, deletePostDraft } from '@/lib/media/post-draft-store';

// In-memory IndexedDB protocol stub. This verifies storage interactions, not browser persistence.
function fakeDatabase() {
  const data = new Map(); let created = false;
  const db = { createObjectStore() { created = true; }, close() {}, transaction() {
    const tx = { objectStore() { return {
      get(key) { const request = { result: data.get(key) }; queueMicrotask(() => tx.oncomplete()); return request; },
      put(value,key) { data.set(key, structuredClone(value)); const request = { result:key }; queueMicrotask(() => tx.oncomplete()); return request; },
      delete(key) { data.delete(key); const request = {}; queueMicrotask(() => tx.oncomplete()); return request; },
    }; } }; return tx;
  } };
  return { open() { const request = { result: db }; queueMicrotask(() => { if (!created) request.onupgradeneeded(); request.onsuccess(); }); return request; } };
}
afterEach(() => vi.unstubAllGlobals());
describe('upload recovery storage', () => {
  it('retains submitted text, files and keys until explicitly deleted', async () => {
    vi.stubGlobal('indexedDB', fakeDatabase());
    const snapshot = { draft:'draft', body:'private text', items:[{id:'request',file:new Blob(['file'],{type:'image/png'})}], uploaded:[['request','file-id']] };
    await putPostDraft('alice:campus',snapshot);
    const saved = await getPostDraft('alice:campus');
    expect(saved.body).toBe('private text'); expect(await saved.items[0].file.text()).toBe('file'); expect(saved.uploaded).toEqual([['request','file-id']]);
    expect(await getPostDraft('bob:campus')).toBeUndefined();
    await deletePostDraft('alice:campus'); expect(await getPostDraft('alice:campus')).toBeUndefined();
  });
  it('fails closed if browser storage is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(putPostDraft('a',{})).rejects.toThrow('Browser storage unavailable');
  });
});
