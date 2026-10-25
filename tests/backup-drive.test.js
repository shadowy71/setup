import { describe, expect, it, vi } from 'vitest';

import { DRIVE_FOLDER_MIME, GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL } from '../lib/backup/constants.js';
import { sha256Hex } from '../lib/backup/crypto.js';
import {
  DriveClient,
  assertRestrictedFolder,
  buildMultipartBody,
} from '../lib/backup/drive.js';

function jsonResponse(data, status = 200) {
  const text = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => data,
    arrayBuffer: async () => Uint8Array.from(Buffer.from(text)).buffer,
  };
}

function bufferResponse(bytes, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => bytes.toString('utf8'),
    json: async () => JSON.parse(bytes.toString('utf8')),
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}

/** Drive stores only the media part of a multipart/related upload. */
function multipartPayload(buffer, contentType) {
  const boundary = String(contentType).match(/boundary=([^;]+)/)?.[1];
  if (!boundary) throw new Error('missing multipart boundary');
  const parts = buffer.toString('latin1').split(`--${boundary}`);
  const media = parts[2];
  const start = media.indexOf('\r\n\r\n');
  return Buffer.from(media.slice(start + 4).replace(/\r\n$/, ''), 'latin1');
}

/** Fake, in-memory Drive v3. */
function fakeDrive({ folderShared = false, failUploadStatus = 0, corruptUpload = false } = {}) {
  const files = new Map();
  const calls = [];
  let nextId = 1;
  files.set('folder-1', {
    id: 'folder-1', name: 'Campus+ Backups (private)', mimeType: DRIVE_FOLDER_MIME,
    trashed: false, shared: folderShared,
    permissions: folderShared ? [{ id: 'anyoneWithLink', type: 'anyone', role: 'reader', allowFileDiscovery: false }] : [],
  });

  async function fetchImpl(url, init = {}) {
    const href = String(url);
    const method = init.method || 'GET';
    calls.push({ url: href, method, headers: init.headers || {} });

    if (href.startsWith(GOOGLE_TOKEN_URL)) {
      const params = new URLSearchParams(init.body);
      if (params.get('grant_type') === 'authorization_code') {
        if (!params.get('code_verifier')) return jsonResponse({ error: 'missing verifier' }, 400);
        return jsonResponse({ access_token: 'at-auth', refresh_token: 'rt-1', expires_in: 3600, scope: 'drive.file' });
      }
      return jsonResponse({ access_token: 'at-refresh', expires_in: 3600 });
    }
    if (href.startsWith(GOOGLE_REVOKE_URL)) return jsonResponse({ ok: true });

    if (href.includes('upload/drive') && method === 'POST') {
      if (failUploadStatus) return jsonResponse({ error: 'unavailable' }, failUploadStatus);
      const id = `file-${nextId++}`;
      const payload = multipartPayload(Buffer.from(init.body), init.headers['Content-Type']);
      const bytes = corruptUpload ? Buffer.from('corrupted') : payload;
      const match = Buffer.from(init.body).toString('latin1').match(/"name":"([^"]+)"/);
      files.set(id, {
        id, name: match?.[1] || 'object.cpbe', mimeType: 'application/octet-stream', trashed: false,
        parents: ['folder-1'], bytes,
      });
      return jsonResponse({ id, name: match?.[1] || 'object.cpbe', size: bytes.length });
    }
    if (href.includes('/files/') && href.includes('alt=media')) {
      const id = decodeURIComponent(href.split('/files/')[1].split('?')[0]);
      const file = files.get(id);
      if (!file) return jsonResponse({ error: 'not found' }, 404);
      return bufferResponse(file.bytes || Buffer.alloc(0));
    }
    if (href.includes('/files/') && method === 'GET') {
      const id = decodeURIComponent(href.split('/files/')[1].split('?')[0]);
      const file = files.get(id);
      if (!file) return jsonResponse({ error: 'not found' }, 404);
      return jsonResponse(file);
    }
    if (href.includes('/files?') && method === 'POST') {
      const id = `folder-${nextId++}`;
      const file = {
        id, name: JSON.parse(init.body).name, mimeType: DRIVE_FOLDER_MIME,
        trashed: false, shared: folderShared,
        permissions: folderShared ? [{ type: 'anyone', role: 'reader', allowFileDiscovery: false }] : [],
      };
      files.set(id, file);
      return jsonResponse(file);
    }
    if (href.includes('/files?') && method === 'GET') {
      const q = new URL(href).searchParams.get('q') || '';
      const match = q.match(/^name = '([^']+)'/);
      const found = [...files.values()].filter((file) => !file.trashed && (!match || file.name === match[1]));
      return jsonResponse({
        files: found.map((file) => ({
          id: file.id, name: file.name, mimeType: file.mimeType,
          trashed: file.trashed, parents: file.parents, appProperties: file.appProperties,
        })),
      });
    }
    if (href.includes('/files/') && method === 'DELETE') {
      const id = decodeURIComponent(href.split('/files/')[1].split('?')[0]);
      files.delete(id);
      return jsonResponse({});
    }
    throw new Error(`unexpected Drive request: ${href}`);
  }

  return { fetchImpl, files, calls };
}

const clientConfig = (fake) => ({
  clientId: 'drive-client-id',
  clientSecret: 'drive-client-secret',
  redirectUri: 'https://pccoe.in/api/backup/drive/callback',
  credential: { refresh_token: 'rt-1' },
  fetchImpl: fake.fetchImpl,
});

describe('restricted Drive folder', () => {
  it('refuses shared folders, anyone permissions, trashed folders and non-folders', () => {
    expect(() => assertRestrictedFolder({ id: 'f', shared: true })).toThrow(/shared/);
    expect(() => assertRestrictedFolder({ id: 'f', permissions: [{ type: 'anyone' }] })).toThrow(/public/);
    expect(() => assertRestrictedFolder({ id: 'f', trashed: true })).toThrow(/trash/);
    expect(() => assertRestrictedFolder({ id: 'f', mimeType: 'text/plain' })).toThrow(/not a folder/);
    expect(assertRestrictedFolder({ id: 'f', mimeType: DRIVE_FOLDER_MIME, shared: false, permissions: [] }).id).toBe('f');
  });

  it('creates a private folder and NEVER calls permissions.create', async () => {
    const fake = fakeDrive();
    const drive = new DriveClient(clientConfig(fake));
    const folder = await drive.createRestrictedFolder('Campus+ Backups (private)');
    expect(folder.shared).toBe(false);
    expect(fake.calls.filter((call) => call.url.includes('/permissions')).length).toBe(0);
  });

  it('refuses a folder that Google reports as public/link-shared', async () => {
    const fake = fakeDrive({ folderShared: true });
    const drive = new DriveClient(clientConfig(fake));
    await expect(drive.createRestrictedFolder('Campus+ Backups (private)')).rejects.toThrow(/public|shared/);
  });
});

describe('Drive upload verification', () => {
  it('uploads encrypted bytes and verifies them by downloading again', async () => {
    const fake = fakeDrive();
    const drive = new DriveClient(clientConfig(fake));
    const body = Buffer.from('{"format":"campus-plus-backup/v1","encrypted":"yes"}');
    const uploaded = await drive.upload({ name: 'obj.cpbe', folderId: 'folder-1', body });
    const result = await drive.verifyFile({
      fileId: uploaded.id, folderId: 'folder-1', expectedSha256: sha256Hex(body), expectedSize: body.length,
    });
    expect(result.ok).toBe(true);
    expect(result.sha256).toBe(sha256Hex(body));
    await expect(drive.download(uploaded.id)).resolves.toEqual(body);
  });

  it('fails verification when the downloaded bytes differ', async () => {
    const fake = fakeDrive({ corruptUpload: true });
    const drive = new DriveClient(clientConfig(fake));
    const body = Buffer.from('real encrypted envelope');
    const uploaded = await drive.upload({ name: 'obj.cpbe', folderId: 'folder-1', body });
    const result = await drive.verifyFile({
      fileId: uploaded.id, folderId: 'folder-1', expectedSha256: sha256Hex(body), expectedSize: body.length,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/mismatch/);
  });

  it('reports Drive unavailability as a retryable error', async () => {
    const fake = fakeDrive({ failUploadStatus: 503 });
    const drive = new DriveClient(clientConfig(fake));
    await expect(drive.upload({ name: 'obj.cpbe', folderId: 'folder-1', body: Buffer.from('x') }))
      .rejects.toMatchObject({ name: 'DriveError', retryable: true, status: 503 });
  });

  it('builds a valid multipart/related body containing the encrypted payload', () => {
    const { body, contentType } = buildMultipartBody({ name: 'a.cpbe' }, Buffer.from('encrypted-payload'));
    expect(contentType).toMatch(/multipart\/related; boundary=/);
    expect(multipartPayload(body, contentType).toString('utf8')).toBe('encrypted-payload');
  });
});

describe('Drive OAuth (admin only)', () => {
  it('exchanges a PKCE code for an offline refresh token and never puts the secret in a URL', async () => {
    const fake = fakeDrive();
    const drive = new DriveClient(clientConfig(fake));
    const tokens = await drive.exchangeCode('code-1', 'verifier-1');
    expect(tokens.refresh_token).toBe('rt-1');
    const tokenCall = fake.calls.find((call) => call.url.startsWith(GOOGLE_TOKEN_URL));
    expect(tokenCall.method).toBe('POST');
    expect(tokenCall.url).not.toContain('drive-client-secret');
  });

  it('persists a rotated refresh token through the server-side callback', async () => {
    const fake = fakeDrive();
    const rawFetch = fake.fetchImpl;
    const onRotate = vi.fn();
    const drive = new DriveClient({
      ...clientConfig(fake),
      onRotate,
      now: () => 0,
      fetchImpl: (url, init) => (String(url).startsWith(GOOGLE_TOKEN_URL)
        ? jsonResponse({ access_token: 'at', refresh_token: 'rt-rotated', expires_in: 3600 })
        : rawFetch(url, init)),
    });
    await drive.getAccessToken();
    expect(onRotate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onRotate.mock.calls[0][0]).refresh_token).toBe('rt-rotated');
  });
});
