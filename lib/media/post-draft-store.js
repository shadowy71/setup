/** Private to this browser profile, not a substitute for server authorization.
 * Records contain the submitted text and original files; clear on publish/discard. */
const DB = 'campus-post-upload-drafts';
function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Browser storage unavailable')); return; }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onerror = () => reject(request.error || new Error('Browser storage unavailable'));
    request.onblocked = () => reject(new Error('Browser storage blocked'));
    request.onsuccess = () => resolve(request.result);
  });
}
async function transaction(mode, action) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode); const request = action(tx.objectStore('drafts'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error || new Error('Browser storage failed'));
      tx.onabort = () => reject(tx.error || new Error('Browser storage failed'));
    });
  } finally { db.close(); }
}
export const getPostDraft = (key) => transaction('readonly', (store) => store.get(key));
export const putPostDraft = (key, value) => transaction('readwrite', (store) => store.put(value, key));
export const deletePostDraft = (key) => transaction('readwrite', (store) => store.delete(key));
