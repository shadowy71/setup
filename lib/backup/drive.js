/**
 * Minimal Google Drive v3 client used ONLY by the backup worker, the snapshot
 * runner and the admin OAuth callback. It is never imported by a student
 * request path.
 *
 * Design constraints:
 *   - `drive.file` scope only: the app can see the folder it created and files
 *     it uploaded, not the rest of the admin's Drive.
 *   - No `permissions.create` call exists anywhere. `assertRestrictedFolder()`
 *     refuses to use a folder with an `anyone` permission or `shared = true`.
 *   - Upload verification is a real `alt=media` download + SHA-256 comparison,
 *     not just trusting the POST response.
 *   - `fetchImpl` is injectable so all tests run offline with a fake Drive.
 */

import { randomBytes } from 'node:crypto';

import {
  DRIVE_API,
  DRIVE_UPLOAD_API,
  DRIVE_FOLDER_MIME,
  DRIVE_APP_PROPERTY,
  GOOGLE_TOKEN_URL,
  GOOGLE_REVOKE_URL,
} from './constants.js';
import { sha256Hex, safeHexEqual } from './crypto.js';

export class DriveError extends Error {
  constructor(message, { status = 0, retryable = true, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DriveError';
    this.status = status;
    this.retryable = retryable;
  }
}

function retryableStatus(status) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

async function responseText(response) {
  if (typeof response?.text !== 'function') return '';
  return response.text();
}

async function responseJson(response) {
  const text = await responseText(response);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Build the multipart/related body Drive's `uploadType=multipart` expects. */
export function buildMultipartBody(metadata, payload, boundary = `cp-${randomBytes(12).toString('hex')}`) {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    body: Buffer.concat([head, Buffer.from(payload), tail]),
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

/**
 * A folder is acceptable only when it is a folder, is not trashed, is not
 * marked shared, and has no `anyone` permission. Backup data is never written
 * into a public/link-shared folder.
 */
export function assertRestrictedFolder(file) {
  if (!file?.id) throw new DriveError('Drive did not return a folder id', { retryable: false });
  if (file.mimeType && file.mimeType !== DRIVE_FOLDER_MIME) {
    throw new DriveError('Drive object is not a folder', { retryable: false });
  }
  if (file.trashed) throw new DriveError('Drive folder is in the trash', { retryable: false });
  if (file.shared === true) throw new DriveError('Drive folder is shared', { retryable: false });
  const anyone = (file.permissions || []).find(
    (permission) => permission?.type === 'anyone' || permission?.allowFileDiscovery === true,
  );
  if (anyone) throw new DriveError('Drive folder has a public/link-sharing permission', { retryable: false });
  return file;
}

export class DriveClient {
  constructor({
    fetchImpl = globalThis.fetch,
    clientId,
    clientSecret,
    redirectUri,
    credential = null,
    onRotate = null,
    now = () => Date.now(),
    logger = null,
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.credential = credential; // parsed JSON string or object: { refresh_token, ... }
    this.onRotate = onRotate;
    this.now = now;
    this.logger = logger;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.refreshPromise = null;
  }

  /** Parse the decrypted credential stored in backup_private. */
  get refreshToken() {
    if (!this.credential) return null;
    if (typeof this.credential === 'string') {
      try {
        return JSON.parse(this.credential).refresh_token || null;
      } catch {
        return null;
      }
    }
    return this.credential.refresh_token || null;
  }

  async postForm(url, params) {
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      });
    } catch (error) {
      throw new DriveError(`Google request failed: ${error.message}`, { status: 0, retryable: true, cause: error });
    }
    if (!response.ok) {
      const detail = await responseText(response);
      throw new DriveError(`Google returned HTTP ${response.status}: ${String(detail).slice(0, 300)}`, {
        status: response.status,
        retryable: retryableStatus(response.status),
      });
    }
    return responseJson(response);
  }

  /** Exchange an authorization code (PKCE) during the admin connection flow. */
  async exchangeCode(code, codeVerifier, redirectUri = this.redirectUri) {
    if (!this.clientId || !this.clientSecret) throw new DriveError('Drive OAuth client is not configured', { retryable: false });
    const data = await this.postForm(GOOGLE_TOKEN_URL, {
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    });
    if (!data?.refresh_token) {
      throw new DriveError('Google did not return an offline refresh token; reconnect with prompt=consent', {
        retryable: false,
      });
    }
    this.credential = { refresh_token: data.refresh_token, scope: data.scope || null };
    this.accessToken = data.access_token || null;
    this.accessTokenExpiresAt = this.now() + Math.max(0, Number(data.expires_in || 0) - 60) * 1000;
    return { ...data, credential: this.credential };
  }

  /** Refresh the access token; concurrent callers share one in-flight refresh. */
  async getAccessToken({ force = false } = {}) {
    if (!force && this.accessToken && this.now() < this.accessTokenExpiresAt) return this.accessToken;
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const refreshToken = this.refreshToken;
      if (!refreshToken) throw new DriveError('no Drive refresh credential is connected', { retryable: false });
      if (!this.clientId || !this.clientSecret) throw new DriveError('Drive OAuth client is not configured', { retryable: false });
      const data = await this.postForm(GOOGLE_TOKEN_URL, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });
      if (!data?.access_token) throw new DriveError('Google token refresh returned no access token');
      if (data.refresh_token && data.refresh_token !== refreshToken) {
        this.credential = { refresh_token: data.refresh_token, scope: data.scope || null };
        if (this.onRotate) await this.onRotate(JSON.stringify(this.credential));
      }
      this.accessToken = data.access_token;
      this.accessTokenExpiresAt = this.now() + Math.max(0, Number(data.expires_in || 3600) - 60) * 1000;
      return this.accessToken;
    })();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /** Authorized Drive request (one transparent re-refresh on 401). */
  async request(url, { method = 'GET', headers = {}, body = null, expect = 'json', retried = false } = {}) {
    const token = await this.getAccessToken();
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...headers },
        body,
      });
    } catch (error) {
      throw new DriveError(`Drive request failed: ${error.message}`, { status: 0, retryable: true, cause: error });
    }
    if (response.status === 401 && !retried) {
      await this.getAccessToken({ force: true });
      return this.request(url, { method, headers, body, expect, retried: true });
    }
    if (!response.ok) {
      const detail = await responseText(response);
      throw new DriveError(`Drive HTTP ${response.status}: ${String(detail).slice(0, 300)}`, {
        status: response.status,
        retryable: retryableStatus(response.status),
      });
    }
    if (expect === 'buffer') {
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    if (expect === 'none') return null;
    return responseJson(response);
  }

  async getFileMetadata(fileId) {
    const fields = 'id,name,mimeType,size,md5Checksum,sha256Checksum,parents,trashed,shared,permissions(id,type,role,allowFileDiscovery),appProperties';
    return this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=false`);
  }

  /** Create a folder owned by the connecting admin, with NO sharing. */
  async createRestrictedFolder(name, appProperties = {}) {
    const file = await this.request(`${DRIVE_API}/files?fields=id,name,mimeType,trashed,shared,permissions(id,type,role,allowFileDiscovery)&supportsAllDrives=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: DRIVE_FOLDER_MIME,
        appProperties: { [DRIVE_APP_PROPERTY]: '1', kind: 'root', ...appProperties },
      }),
    });
    // Re-read and assert: never trust the create response alone.
    const metadata = await this.getFileMetadata(file.id);
    return assertRestrictedFolder({ ...file, ...metadata });
  }

  /** Find non-trashed objects with an exact name inside the restricted folder. */
  async findByName(name, folderId) {
    const q = `name = '${escapeDriveQuery(name)}' and '${escapeDriveQuery(folderId)}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,size,md5Checksum,sha256Checksum,parents,trashed,appProperties)',
      pageSize: '20',
      supportsAllDrives: 'false',
    });
    const data = await this.request(`${DRIVE_API}/files?${params.toString()}`);
    return data?.files || [];
  }

  /** Upload one encrypted envelope into the restricted folder. */
  async upload({ name, folderId, body, appProperties = {} }) {
    if (!folderId) throw new DriveError('a restricted Drive folder is required', { retryable: false });
    const metadata = {
      name,
      parents: [folderId],
      appProperties: {
        [DRIVE_APP_PROPERTY]: '1',
        sha256: appProperties.sha256 || sha256Hex(body),
        ...appProperties,
      },
    };
    const multipart = buildMultipartBody(metadata, body);
    const params = new URLSearchParams({
      uploadType: 'multipart',
      fields: 'id,name,size,md5Checksum,sha256Checksum,parents,trashed,appProperties',
      supportsAllDrives: 'false',
    });
    return this.request(`${DRIVE_UPLOAD_API}/files?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': multipart.contentType },
      body: multipart.body,
    });
  }

  /**
   * Verify an uploaded object by downloading it again. Returns `{ ok: false }`
   * for a checksum/size/folder mismatch (a failed attempt, not a crash).
   */
  async verifyFile({ fileId, folderId, expectedSha256, expectedSize }) {
    const metadata = await this.getFileMetadata(fileId);
    if (metadata?.trashed) return { ok: false, reason: 'trashed' };
    if (folderId && Array.isArray(metadata?.parents) && !metadata.parents.includes(folderId)) {
      return { ok: false, reason: 'outside restricted folder' };
    }
    const bytes = await this.request(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=false`,
      { expect: 'buffer' },
    );
    const actual = sha256Hex(bytes);
    if (!safeHexEqual(actual, expectedSha256)) return { ok: false, reason: 'sha256 mismatch', sha256: actual };
    if (typeof expectedSize === 'number' && bytes.length !== expectedSize) {
      return { ok: false, reason: 'size mismatch', sha256: actual, size: bytes.length };
    }
    return { ok: true, sha256: actual, size: bytes.length, metadata };
  }

  /** Retention deletes only objects this app created, after a newer snapshot is verified. */
  async deleteFile(fileId) {
    await this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=false`, {
      method: 'DELETE',
      expect: 'none',
    });
    return true;
  }

  async download(fileId) {
    return this.request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=false`, {
      expect: 'buffer',
    });
  }

  /** Revoke the refresh credential on disconnect (best effort, server-side). */
  async revoke(refreshToken = this.refreshToken) {
    if (!refreshToken) return false;
    try {
      const response = await this.fetchImpl(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
      return Boolean(response?.ok);
    } catch (error) {
      this.logger?.warn?.('[backup] Drive token revocation failed:', error?.message || error);
      return false;
    }
  }
}
