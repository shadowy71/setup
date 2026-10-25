import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  BACKUP_FORMAT,
  PURPOSE_BACKUP,
  PURPOSE_CREDENTIAL,
} from '../lib/backup/constants.js';
import {
  BackupCryptoError,
  createSealer,
  decryptEnvelope,
  encryptEnvelope,
  openJson,
  openSecret,
  parseKeyRing,
  sealJson,
  sealSecret,
  sha256Hex,
} from '../lib/backup/crypto.js';

const keyRing = () => new Map([['primary', randomBytes(32)], ['previous', randomBytes(32)]]);

describe('backup envelope encryption', () => {
  it('compresses and encrypts: no plaintext survives in the envelope', () => {
    const keys = keyRing();
    const { body, envelope } = sealJson({ message: 'private student message', rows: [1, 2, 3] }, {
      key: keys.get('primary'), keyRef: 'primary',
    });
    expect(body.includes(Buffer.from('private student message'))).toBe(false);
    expect(body.includes(Buffer.from('student'))).toBe(false);
    expect(envelope.format).toBe(BACKUP_FORMAT);
    expect(envelope.algorithm).toBe('AES-256-GCM');
    expect(envelope.compression).toBe('gzip');
    // The envelope is smaller than the raw JSON for a repetitive payload.
    const { body: repeated } = sealJson({ rows: Array.from({ length: 200 }, () => 'same value') }, {
      key: keys.get('primary'), keyRef: 'primary',
    });
    expect(repeated.length).toBeLessThan(JSON.stringify({ rows: Array.from({ length: 200 }, () => 'same value') }).length);
  });

  it('round-trips with the right key and rejects the wrong key', () => {
    const keys = keyRing();
    const { body } = sealJson({ hello: 'world' }, { key: keys.get('primary'), keyRef: 'primary' });
    expect(openJson(body, { keyRing: keys }).value).toEqual({ hello: 'world' });
    const wrong = new Map([['primary', keys.get('previous')]]);
    expect(() => openJson(body, { keyRing: wrong })).toThrow(BackupCryptoError);
    expect(() => openJson(body, { keyRing: new Map() })).toThrow(/no decryption key|no valid/);
  });

  it('detects tampering with ciphertext, tag, metadata or plaintext hash', () => {
    const keys = keyRing();
    const { envelope, body } = encryptEnvelope(Buffer.from('integrity'), { key: keys.get('primary'), keyRef: 'primary' });
    const mutate = (patch) => Buffer.from(JSON.stringify({ ...envelope, ...patch }), 'utf8');

    const badCipher = Buffer.from(envelope.ciphertext, 'base64');
    badCipher[0] ^= 0xff;
    expect(() => decryptEnvelope(mutate({ ciphertext: badCipher.toString('base64') }), { keyRing: keys })).toThrow();
    expect(() => decryptEnvelope(mutate({ plaintext_sha256: sha256Hex('other') }), { keyRing: keys })).toThrow();
    expect(() => decryptEnvelope(mutate({ format: 'other' }), { keyRing: keys })).toThrow(/unsupported/);
    expect(() => decryptEnvelope(body, { keyRing: keys, purpose: PURPOSE_CREDENTIAL })).toThrow(/tag|AAD/i);
  });

  it('binds a stored credential to its purpose (cannot be opened as a backup)', () => {
    const keys = keyRing();
    const secret = sealSecret('{"refresh_token":"abc"}', {
      key: keys.get('primary'), keyRef: 'primary', purpose: PURPOSE_CREDENTIAL,
    });
    expect(openSecret(secret, { keyRing: keys, purpose: PURPOSE_CREDENTIAL })).toBe('{"refresh_token":"abc"}');
    expect(() => openSecret(secret, { keyRing: keys, purpose: PURPOSE_BACKUP })).toThrow(BackupCryptoError);
    expect(JSON.stringify(secret)).not.toContain('refresh_token');
  });

  it('requires a real 32-byte key and supports key rotation by id', () => {
    expect(() => parseKeyRing('c2hvcnQ=')).toThrow(/32 bytes/);
    expect(parseKeyRing('')).toEqual(new Map());
    const a = randomBytes(32).toString('base64');
    const b = randomBytes(32).toString('base64');
    const ring = parseKeyRing(`primary:${a},previous:${b}`);
    expect(ring.size).toBe(2);
    const sealer = createSealer({ keyRing: ring, keyRef: 'previous' });
    const sealed = sealer.seal({ ok: true });
    expect(openJson(sealed.body, { keyRing: ring }).value).toEqual({ ok: true });
    expect(sealed.sha256).toBe(sha256Hex(sealed.body));
  });
});
