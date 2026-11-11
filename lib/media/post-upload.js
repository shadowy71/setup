/** Upload sequentially so the server-assigned order matches the draft order.
 * Callers retain failed and unattempted items and their idempotency keys. */
export async function uploadPostFiles(postId, items, { onProgress = () => {}, onUploaded = () => {}, makeRequest = () => new XMLHttpRequest(), endpoint = null, requireId = false } = {}) {
  for (const item of items) {
    const result = await new Promise((resolve) => {
      try {
        const xhr = makeRequest(); xhr.open('POST', endpoint || `/api/storage/posts/${postId}`);
        xhr.setRequestHeader('Content-Type', item.file.type);
        xhr.setRequestHeader('X-File-Name', encodeURIComponent(item.file.name));
        xhr.setRequestHeader('X-Upload-Id', item.id);
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(item.id, Math.round(100 * event.loaded / event.total)); };
        xhr.onload = () => { let body = {}; try { body = JSON.parse(xhr.responseText); } catch {} resolve({ ok: xhr.status >= 200 && xhr.status < 300 && (!requireId || typeof body.id === 'string'), error: body.error, id: body.id }); };
        xhr.onerror = () => resolve({ ok: false }); xhr.onabort = () => resolve({ ok: false }); xhr.send(item.file);
      } catch { resolve({ ok: false }); }
    });
    if (!result.ok) return { ok: false, error: result.error || 'Upload failed. Retry remaining files.' };
    await onUploaded(item.id, result.id);
  }
  return { ok: true };
}
