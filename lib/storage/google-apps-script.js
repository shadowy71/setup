import 'server-only';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { MAX_FILE_BYTES, validateFile } from './validation.js';

/** Exact canonical format: milliseconds, nonce, request ID, serialized payload, separated by LF. */
export function signEnvelope(payload, secret, { timestamp = Date.now(), nonce = randomBytes(16).toString('hex'), requestId = randomUUID() } = {}) {
  const serialized = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(`${timestamp}\n${nonce}\n${requestId}\n${serialized}`, 'utf8').digest('hex');
  return { timestamp, nonce, requestId, payload: serialized, signature };
}

function configuredUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || url.port || url.username || url.password || url.search || url.hash || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)) throw Error();
    return url.href;
  } catch { throw new Error('storage_not_configured'); }
}

/** Server-only transport. Redirects are disabled for the signed POST; Google's
 * 302/303 output redirect is fetched separately as an unsigned GET. */
export function createAppsScriptProvider({ url, secret, fetchImpl = fetch, timeoutMs = 25000 }) {
  const endpoint = configuredUrl(url);
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('storage_not_configured');
  async function call(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signEnvelope(payload, secret)), signal: controller.signal, redirect: 'manual', cache: 'no-store' });
      if (response.status === 302 || response.status === 303) {
        const redirect = new URL(response.headers.get('location'));
        if (redirect.protocol !== 'https:' || redirect.hostname !== 'script.googleusercontent.com' || redirect.port || redirect.username || redirect.password) throw new Error('storage_unavailable');
        response = await fetchImpl(redirect.href, { method: 'GET', signal: controller.signal, redirect: 'error', cache: 'no-store' });
      }
      const declared = Number(response.headers.get('content-length'));
      if (!response.ok || (declared && declared > 4 * Math.ceil(MAX_FILE_BYTES / 3) + 8192)) throw new Error('storage_unavailable');
      const text = await response.text();
      if (text.length > 4 * Math.ceil(MAX_FILE_BYTES / 3) + 8192) throw new Error('storage_unavailable');
      const result = JSON.parse(text);
      if (!result?.ok) throw new Error('storage_unavailable');
      return result;
    } catch { throw new Error('storage_unavailable'); } finally { clearTimeout(timer); }
  }
  return {
    async health() { await call({ operation: 'health' }); return { ok: true }; },
    async upload({ key, name, mime, bytes }) {
      if (!/^[a-f0-9-]{36}$/.test(key || '') || !validateFile({ name, mime, bytes }).ok) throw new Error('invalid_file');
      const checksum = createHash('sha256').update(bytes).digest('hex');
      const result = await call({ operation: 'upload', key, name, mime, checksum, base64: bytes.toString('base64') });
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(result.id || '') || result.size !== bytes.length || result.mime !== mime || result.checksum !== checksum) throw new Error('storage_unavailable');
      return { id: result.id, size: result.size, mime, checksum };
    },
    async uploadV3({ key, name, mime, bytes }) {
      if (!/^[0-9]{13}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key || '') || !validateFile({ name, mime, bytes }).ok) throw new Error('invalid_file');
      const checksum = createHash('sha256').update(bytes).digest('hex');
      const result = await call({ operation: 'upload_v3', key, name, mime, checksum, base64: bytes.toString('base64') });
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(result.id || '') || result.size !== bytes.length || result.mime !== mime || result.checksum !== checksum) throw new Error('storage_unavailable');
      return { id: result.id, size: result.size, mime, checksum };
    },
    async deleteByKeyV3(key) {
      if (!/^[0-9]{13}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key || '')) throw new Error('invalid_file');
      await call({ operation: 'delete_key_v3', key });
    },
    async lookup(key) {
      if (!/^[a-f0-9-]{36}$/.test(key || '')) throw new Error('invalid_file');
      const result = await call({ operation: 'lookup', key });
      if (result.found === false) return null;
      if (result.found !== true || !/^[A-Za-z0-9_-]{10,200}$/.test(result.id || '') || !Number.isSafeInteger(result.size) || result.size < 1 || result.size > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(result.checksum || '') || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(result.mime)) throw new Error('storage_unavailable');
      return { id: result.id, size: result.size, mime: result.mime, checksum: result.checksum };
    },
    async metadata(id) {
      const result = await call({ operation: 'metadata', id });
      if (!Number.isSafeInteger(result.size) || result.size < 1 || result.size > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(result.checksum || '') || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(result.mime)) throw new Error('storage_unavailable');
      return { size: result.size, mime: result.mime, checksum: result.checksum };
    },
    async download(id, expected) {
      const result = await call({ operation: 'download', id });
      if (typeof result.base64 !== 'string' || result.base64.length > 4 * Math.ceil(MAX_FILE_BYTES / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.base64)) throw new Error('storage_unavailable');
      const bytes = Buffer.from(result.base64, 'base64');
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== result.size || result.size > MAX_FILE_BYTES || result.mime !== expected.mime || hash !== expected.checksum || result.checksum !== hash) throw new Error('storage_unavailable');
      return bytes;
    },
    async delete(id) { await call({ operation: 'delete', id }); },
    async deleteByKey(key) {
      if (!/^[a-f0-9-]{36}$/.test(key || '')) throw new Error('invalid_file');
      await call({ operation: 'delete_key', key });
    },
  };
}
