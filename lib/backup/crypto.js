/**
 * Envelope encryption for backup objects and OAuth secrets.
 *
 *   plaintext (JSON) → gzip → AES-256-GCM → base64 fields in a JSON envelope
 *
 * The 32-byte key comes from `BACKUP_ENCRYPTION_KEYS` (base64) on the server; it
 * is never written to Supabase, Drive or the browser. `key_ref` supports key
 * rotation: an old object can be decrypted as long as its key is still present.
 * The AAD binds every ciphertext to its format, key id and purpose, so a stored
 * refresh credential can never be substituted for a backup object.
 *
 * Pure Node crypto/zlib only — no framework imports, so the same code is used
 * by Next.js routes, the CLI runner and the unit tests.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

import {
  BACKUP_FORMAT,
  ENVELOPE_ALGORITHM,
  ENVELOPE_COMPRESSION,
  PURPOSE_BACKUP,
} from './constants.js';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class BackupCryptoError extends Error {
  constructor(message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BackupCryptoError';
  }
}

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

/** Constant-time comparison for hex digests / ids. */
export function safeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Domains the AAD covers. Changing any of these invalidates old ciphertexts. */
export function aadFor({ format = BACKUP_FORMAT, keyRef, purpose }) {
  if (!keyRef || !purpose) throw new BackupCryptoError('a key id and purpose are required for AAD');
  return `${format}|${keyRef}|${purpose}`;
}

/** Parse a base64 (or base64url) 32-byte key. */
export function parseBackupKey(value, keyRef = 'primary') {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY is missing — refusing to encrypt with a derived or empty key');
  }
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  let key;
  try {
    key = Buffer.from(normalized, 'base64');
  } catch (error) {
    throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY is not valid base64', error);
  }
  if (key.length !== KEY_BYTES) {
    throw new BackupCryptoError(`BACKUP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`);
  }
  return { key, keyRef: String(keyRef) };
}

/**
 * Keys are supplied as `primary:<base64>,previous:<base64>` (or a single bare
 * base64 value, which becomes `primary`). Only key IDs and ciphertext travel to
 * Drive — never key material.
 */
export function parseKeyRing(value) {
  const entries = new Map();
  const raw = String(value || '').trim();
  if (!raw) return entries;
  for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [maybeId, maybeKey] = part.includes(':') ? part.split(/:(.*)/s) : ['primary', part];
    const parsed = parseBackupKey(maybeKey, maybeId);
    entries.set(parsed.keyRef, parsed.key);
  }
  return entries;
}

export function defaultKeyRing(env = process.env) {
  const ring = parseKeyRing(env.BACKUP_ENCRYPTION_KEYS || env.BACKUP_ENCRYPTION_KEY);
  if (!ring.size) throw new BackupCryptoError('no backup encryption key is configured');
  return ring;
}

/** Resolve a key by the id recorded in an envelope. */
export function resolveKey(keyRing, keyRef) {
  const key = keyRing instanceof Map ? keyRing.get(keyRef) : keyRing?.[keyRef];
  if (!key) throw new BackupCryptoError(`no decryption key is configured for key_ref=${keyRef}`);
  return key;
}

/** Low-level GCM decryption shared by backup envelopes and stored secrets. */
function decryptComponents({ ciphertextB64, ivB64, tagB64, keyRef, purpose, keyRing, key, format = BACKUP_FORMAT }) {
  const keyMaterial = key || resolveKey(keyRing, keyRef);
  if (!keyMaterial || keyMaterial.length !== KEY_BYTES) {
    throw new BackupCryptoError(`no valid 32-byte key for key_ref=${keyRef}`);
  }
  const aad = Buffer.from(aadFor({ format, keyRef, purpose }), 'utf8');
  const decipher = createDecipheriv('aes-256-gcm', keyMaterial, Buffer.from(ivB64, 'base64'), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  let compressed;
  try {
    compressed = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64')),
      decipher.final(),
    ]);
  } catch (error) {
    throw new BackupCryptoError('authentication tag failed — wrong key or tampered ciphertext', error);
  }
  try {
    return gunzipSync(compressed);
  } catch (error) {
    throw new BackupCryptoError('payload is not valid gzip data', error);
  }
}

/**
 * Compress + encrypt a Buffer. Returns the envelope object AND the serialized
 * envelope Buffer that is uploaded to Drive.
 */
export function encryptEnvelope(plaintext, { key, keyRef, purpose = PURPOSE_BACKUP, random = randomBytes } = {}) {
  if (!Buffer.isBuffer(plaintext) && !(plaintext instanceof Uint8Array)) {
    throw new BackupCryptoError('plaintext must be a Buffer');
  }
  if (!key || key.length !== KEY_BYTES || !keyRef) {
    throw new BackupCryptoError('a 32-byte key and key id are required');
  }
  const source = Buffer.from(plaintext);
  const compressed = gzipSync(source, { level: 9 });
  const iv = Buffer.from(random(IV_BYTES));
  const aad = Buffer.from(aadFor({ keyRef, purpose }), 'utf8');

  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope = {
    format: BACKUP_FORMAT,
    algorithm: ENVELOPE_ALGORITHM,
    compression: ENVELOPE_COMPRESSION,
    purpose,
    key_ref: keyRef,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    plaintext_sha256: sha256Hex(source),
    ciphertext_sha256: sha256Hex(ciphertext),
    size: ciphertext.length,
    aad: aad.toString('base64'),
  };
  return { envelope, body: Buffer.from(JSON.stringify(envelope), 'utf8') };
}

/** Parse and validate an envelope without decrypting it. */
export function parseEnvelope(input) {
  let envelope = input;
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    envelope = JSON.parse(Buffer.from(input).toString('utf8'));
  } else if (typeof input === 'string') {
    envelope = JSON.parse(input);
  }
  if (!envelope || envelope.format !== BACKUP_FORMAT) {
    throw new BackupCryptoError(`unsupported backup envelope format: ${envelope?.format ?? 'unknown'}`);
  }
  if (envelope.algorithm !== ENVELOPE_ALGORITHM || envelope.compression !== ENVELOPE_COMPRESSION) {
    throw new BackupCryptoError('unsupported backup encryption or compression');
  }
  for (const field of ['key_ref', 'iv', 'tag', 'ciphertext', 'plaintext_sha256']) {
    if (typeof envelope[field] !== 'string' || !envelope[field]) {
      throw new BackupCryptoError(`backup envelope is missing ${field}`);
    }
  }
  return envelope;
}

/** Decrypt + gunzip + verify both hashes. Never returns partially trusted data. */
export function decryptEnvelope(input, { keyRing, key = null, purpose = null } = {}) {
  const envelope = parseEnvelope(input);
  const effectivePurpose = purpose || envelope.purpose || PURPOSE_BACKUP;
  if (envelope.aad) {
    const expectedAad = Buffer.from(aadFor({ format: envelope.format, keyRef: envelope.key_ref, purpose: effectivePurpose }), 'utf8');
    if (!safeHexEqual(sha256Hex(expectedAad), sha256Hex(Buffer.from(envelope.aad, 'base64')))) {
      throw new BackupCryptoError('backup envelope AAD does not match its metadata');
    }
  }
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  if (envelope.ciphertext_sha256 && !safeHexEqual(sha256Hex(ciphertext), envelope.ciphertext_sha256)) {
    throw new BackupCryptoError('backup ciphertext failed its SHA-256 check');
  }
  if (typeof envelope.size === 'number' && envelope.size !== ciphertext.length) {
    throw new BackupCryptoError('backup ciphertext length does not match its manifest');
  }
  const plaintext = decryptComponents({
    ciphertextB64: envelope.ciphertext,
    ivB64: envelope.iv,
    tagB64: envelope.tag,
    keyRef: envelope.key_ref,
    purpose: effectivePurpose,
    keyRing,
    key,
    format: envelope.format,
  });
  if (!safeHexEqual(sha256Hex(plaintext), envelope.plaintext_sha256)) {
    throw new BackupCryptoError('backup plaintext failed its SHA-256 check');
  }
  return { plaintext, envelope };
}

/** Convenience JSON helpers. */
export function sealJson(value, options) {
  return encryptEnvelope(Buffer.from(JSON.stringify(value), 'utf8'), options);
}

export function openJson(input, options) {
  const { plaintext, envelope } = decryptEnvelope(input, options);
  return { value: JSON.parse(plaintext.toString('utf8')), envelope };
}

/**
 * OAuth secrets are stored as four narrow columns in `backup_private`: no
 * plaintext hash column is needed because the GCM tag authenticates the value.
 */
export function sealSecret(secret, { key, keyRef, purpose }) {
  const { envelope } = encryptEnvelope(Buffer.from(secret, 'utf8'), { key, keyRef, purpose });
  return {
    credential_ciphertext: envelope.ciphertext,
    iv_b64: envelope.iv,
    tag_b64: envelope.tag,
    key_ref: envelope.key_ref,
  };
}

export function openSecret(row, { keyRing, key = null, purpose }) {
  if (!row?.credential_ciphertext || !row?.iv_b64 || !row?.tag_b64 || !row?.key_ref) {
    throw new BackupCryptoError('encrypted credential row is incomplete');
  }
  return decryptComponents({
    ciphertextB64: row.credential_ciphertext,
    ivB64: row.iv_b64,
    tagB64: row.tag_b64,
    keyRef: row.key_ref,
    purpose,
    keyRing,
    key,
  }).toString('utf8');
}

/** A bound sealer used by the worker/snapshot runner. */
export function createSealer({ keyRing, keyRef = 'primary', purpose = PURPOSE_BACKUP }) {
  const key = resolveKey(keyRing, keyRef);
  return {
    keyRef,
    seal(value) {
      const source = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value), 'utf8');
      const { body, envelope } = encryptEnvelope(source, { key, keyRef, purpose });
      return { body, sha256: sha256Hex(body), size: body.length, envelope };
    },
  };
}
