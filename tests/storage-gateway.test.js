import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createAppsScriptProvider, signEnvelope } from '@/lib/storage/google-apps-script';
import { MAX_FILE_BYTES, validateFile } from '@/lib/storage/validation';

const secret = 'a-secure-test-secret-value-32-bytes';
const bytes = Buffer.from('89504e470d0a1a0a0000', 'hex');
const checksum = createHash('sha256').update(bytes).digest('hex');
const key = 'f4b5c514-200e-4cae-912f-6b8d03f71589';

function mockGateway() {
  const files = [];
  const props = { CAMPUS_STORAGE_SHARED_SECRET: secret, CAMPUS_STORAGE_ROOT_FOLDER_ID: 'root' };
  const iter = (items) => { let i = 0; return { hasNext: () => i < items.length, next: () => items[i++] }; };
  const root = { getId: () => 'root', isTrashed: () => false, getFilesByName: (name) => iter(files.filter((f) => !f.trashed && f.name === name)), createFile(blob) {
    const f = { id: `file_${String(files.length + 1).padStart(12, '0')}`, ...blob, description: '', trashed: false,
      getId() { return this.id; }, getName() { return this.name; }, getSize() { return this.bytes.length; }, getMimeType() { return this.mime; }, getDescription() { return this.description; },
      setDescription(v) { this.description = v; }, isTrashed() { return this.trashed; }, setTrashed(v) { this.trashed = v; },
      getParents() { return iter([root]); }, getBlob() { return { getBytes: () => this.bytes }; } };
    files.push(f); return f;
  } };
  const context = {
    console: { error: vi.fn(), log: vi.fn() },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => props[key], getProperties: () => ({ ...props }), deleteProperty: (key) => { delete props[key]; }, setProperty: (key, value) => { props[key] = value; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, hasLock: () => true, releaseLock() {} }) },
    DriveApp: { getFolderById: () => root, getFileById: (id) => { const f = files.find((entry) => entry.id === id); if (!f) throw Error(); return f; } },
    Utilities: { Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { SHA_256: 'sha256' },
      computeHmacSha256Signature: (message, k) => [...createHmac('sha256', k).update(message).digest()],
      computeDigest: (_algorithm, data) => [...createHash('sha256').update(Buffer.from(data)).digest()],
      base64Decode: (data) => [...Buffer.from(data, 'base64')], base64Encode: (data) => Buffer.from(data).toString('base64'),
      newBlob: (data, mime, name) => ({ bytes: Buffer.from(data), mime, name }) },
  };
  runInNewContext(readFileSync('integrations/google-apps-script/Code.gs', 'utf8'), context);
  const request = (envelope) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(envelope) } }).text);
  return { request, files, props };
}

describe('file validation', () => {
  it('checks extension, media type, signature, name and size', () => {
    expect(validateFile({ name: 'photo.png', mime: 'image/png', bytes })).toEqual({ ok: true });
    expect(validateFile({ name: 'photo.jpg', mime: 'image/png', bytes }).ok).toBe(false);
    expect(validateFile({ name: 'photo.png', mime: 'image/png', bytes: Buffer.from('not a png') }).ok).toBe(false);
    expect(validateFile({ name: '../photo.png', mime: 'image/png', bytes }).ok).toBe(false);
    expect(validateFile({ name: 'photo.png', mime: 'image/png', bytes: Buffer.alloc(MAX_FILE_BYTES + 1) }).code).toBe('size');
    expect(validateFile({ name: 'file.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.7\nfixture') }).ok).toBe(true);
    expect(validateFile({ name: 'file.exe', mime: 'application/octet-stream', bytes }).ok).toBe(false);
  });
});

describe('signed gateway', () => {
  it('rejects bad signatures, timestamps and replayed nonces', () => {
    const gateway = mockGateway();
    const valid = signEnvelope({ operation: 'health' }, secret);
    expect(gateway.request({ ...valid, signature: '0'.repeat(64) }).code).toBe('unauthorized');
    expect(gateway.request(signEnvelope({ operation: 'health' }, secret, { timestamp: Date.now() - 301000, nonce: 'a'.repeat(32) })).code).toBe('unauthorized');
    expect(gateway.request(valid).ok).toBe(true);
    expect(gateway.request(valid).code).toBe('replay');
  });
  it('keeps a retry with a fresh nonce idempotent and restricts operations to the root', () => {
    const gateway = mockGateway();
    const payload = { operation: 'upload', key, name: 'image.png', mime: 'image/png', checksum, base64: bytes.toString('base64') };
    const first = gateway.request(signEnvelope(payload, secret));
    const second = gateway.request(signEnvelope(payload, secret));
    expect(first.ok).toBe(true); expect(second.id).toBe(first.id); expect(gateway.files).toHaveLength(1);
    expect(gateway.request(signEnvelope({ operation: 'download', id: first.id }, secret))).toMatchObject({ ok: true, checksum, base64: payload.base64 });
    gateway.files[0].getParents = () => ({ hasNext: () => false });
    expect(gateway.request(signEnvelope({ operation: 'delete', id: first.id }, secret)).ok).toBe(false);
    expect(gateway.files[0].trashed).toBe(false);
  });
  it('fails closed if a stored request nonce was already consumed after a fresh script invocation', () => {
    const gateway = mockGateway();
    const signed = signEnvelope({ operation: 'health' }, secret);
    expect(gateway.request(signed).ok).toBe(true);
    expect(gateway.props[`campus-nonce-v1-${signed.nonce}`]).toBeTruthy();
    expect(gateway.request(signed).code).toBe('replay');
    expect(gateway.request({ ...signed, requestId: '00000000-0000-4000-8000-000000000000' }).code).toBe('unauthorized');
  });
  it('recovers from a lost upload response and detects changed content or corrupt Drive files', () => {
    const gateway = mockGateway();
    const upload = { operation: 'upload', key, name: 'picture.png', mime: 'image/png', checksum, base64: bytes.toString('base64') };
    const original = gateway.request(signEnvelope(upload, secret));
    expect(gateway.request(signEnvelope(upload, secret)).id).toBe(original.id);
    expect(gateway.files[0].name).toBe(`campus-upload-v2-${key}`);
    gateway.files[0].bytes = Buffer.alloc(bytes.length, 9);
    expect(gateway.request(signEnvelope(upload, secret)).code).toBe('idempotency_conflict');
    expect(gateway.files).toHaveLength(1);
  });
  it('handles the Apps Script output redirect without reposting the signed body', async () => {
    const gateway = mockGateway();
    let pending;
    const fetchImpl = vi.fn(async (url, options) => {
      if (options.method === 'POST') {
        pending = gateway.request(JSON.parse(options.body));
        return new Response(null, { status: 302, headers: { location: 'https://script.googleusercontent.com/macros/echo?token=opaque' } });
      }
      expect(url).toMatch(/^https:\/\/script\.googleusercontent\.com/);
      expect(options.method).toBe('GET');
      expect(options.body).toBeUndefined();
      return new Response(JSON.stringify(pending));
    });
    const provider = createAppsScriptProvider({ url: 'https://script.google.com/macros/s/example/exec', secret, fetchImpl });
    expect(await provider.health()).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('rejects an untrusted redirect without sending the signed request to it', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/path' } }));
    const provider = createAppsScriptProvider({ url: 'https://script.google.com/macros/s/example/exec', secret, fetchImpl });
    await expect(provider.health()).rejects.toThrow('storage_unavailable');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('round-trips all byte values with an image signature through the simulated binary gateway', async () => {
    const binary = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(Array.from({ length: 256 }, (_, i) => i))]);
    const gateway = mockGateway();
    const fetchImpl = async (_url, options) => new Response(JSON.stringify(gateway.request(JSON.parse(options.body))));
    const provider = createAppsScriptProvider({ url: 'https://script.google.com/macros/s/example/exec', secret, fetchImpl });
    const result = await provider.upload({ key, name: 'image.png', mime: 'image/png', bytes: binary });
    expect(await provider.download(result.id, result)).toEqual(binary);
  });
  it('durably tombstones deleted upload keys, including before a delayed upload', async () => {
    const gateway = mockGateway();
    const fetchImpl = async (_url, options) => new Response(JSON.stringify(gateway.request(JSON.parse(options.body))));
    const provider = createAppsScriptProvider({ url: 'https://script.google.com/macros/s/example/exec', secret, fetchImpl });
    await provider.deleteByKey(key);
    await provider.deleteByKey(key);
    await expect(provider.upload({ key, name: 'image.png', mime: 'image/png', bytes })).rejects.toThrow('storage_unavailable');
    expect(gateway.files).toHaveLength(0);
    expect(gateway.props[`campus-deleted-v1-${key}`]).toBe('1');
  });
  it('deletes a stored upload by key and does not allow it to be recreated', async () => {
    const gateway = mockGateway();
    const fetchImpl = async (_url, options) => new Response(JSON.stringify(gateway.request(JSON.parse(options.body))));
    const provider = createAppsScriptProvider({ url: 'https://script.google.com/macros/s/example/exec', secret, fetchImpl });
    await provider.upload({ key, name: 'image.png', mime: 'image/png', bytes });
    await provider.deleteByKey(key);
    await provider.deleteByKey(key);
    expect(gateway.files[0].trashed).toBe(true);
    await expect(provider.upload({ key, name: 'image.png', mime: 'image/png', bytes })).rejects.toThrow('storage_unavailable');
  });
  it('recovers an upload by its key after the response was lost, without creating another file', async () => {
    const gateway = mockGateway();
    const fetchImpl = async (_url, options) => new Response(JSON.stringify(gateway.request(JSON.parse(options.body))));
    const provider = createAppsScriptProvider({ url: 'https://script.google.com/macros/s/example/exec', secret, fetchImpl });
    expect(await provider.lookup(key)).toBeNull();
    const upload = await provider.upload({ key, name: 'image.png', mime: 'image/png', bytes });
    expect(await provider.lookup(key)).toEqual(upload);
    expect(gateway.files).toHaveLength(1);
    await provider.delete(upload.id);
    expect(await provider.lookup(key)).toBeNull();
  });
  it('signs precisely the serialized payload and verifies gateway responses', async () => {
    const gateway = mockGateway();
    const fetchImpl = vi.fn(async (_url, options) => {
      const data = gateway.request(JSON.parse(options.body));
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const provider = createAppsScriptProvider({ url: 'https://script.google.com/macros/s/example/exec', secret, fetchImpl });
    const uploaded = await provider.upload({ key, name: 'image.png', mime: 'image/png', bytes });
    expect(uploaded).toMatchObject({ mime: 'image/png', checksum, size: bytes.length });
    expect(await provider.metadata(uploaded.id)).toEqual({ mime: 'image/png', checksum, size: bytes.length });
    expect(await provider.download(uploaded.id, uploaded)).toEqual(bytes);
    await provider.delete(uploaded.id);
    expect(gateway.files[0].trashed).toBe(true);
  });
  it('times out a stalled request without exposing internal errors', async () => {
    const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('private network details')));
    });
    const provider = createAppsScriptProvider({ url: 'https://script.google.com/macros/s/example/exec', secret, fetchImpl, timeoutMs: 10 });
    await expect(provider.health()).rejects.toThrow('storage_unavailable');
  });
  it('rejects failures without surfacing remote details', async () => {
    const provider = createAppsScriptProvider({ url: 'https://script.google.com/macros/s/example/exec', secret, fetchImpl: async () => new Response('secret internal error', { status: 500 }) });
    await expect(provider.health()).rejects.toThrow('storage_unavailable');
    expect(() => createAppsScriptProvider({ url: 'https://example.com/exec', secret })).toThrow('storage_not_configured');
  });
});
