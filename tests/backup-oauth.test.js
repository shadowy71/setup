import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  DRIVE_SCOPE,
  PRODUCTION_DRIVE_REDIRECT_URI,
} from '../lib/backup/constants.js';
import {
  backupEnv,
  buildAuthorizationUrl,
  generatePkce,
  generateState,
  resolveRedirectUri,
  safeBackPath,
  stateHash,
} from '../lib/backup/oauth.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

describe('admin Drive OAuth', () => {
  it('pins the exact production callback URL chosen for this deployment', () => {
    expect(PRODUCTION_DRIVE_REDIRECT_URI).toBe('https://pccoe.in/api/backup/drive/callback');
    expect(resolveRedirectUri({ NODE_ENV: 'production' })).toBe(PRODUCTION_DRIVE_REDIRECT_URI);
    expect(resolveRedirectUri({ VERCEL_ENV: 'production' })).toBe(PRODUCTION_DRIVE_REDIRECT_URI);
    expect(resolveRedirectUri({
      NODE_ENV: 'production', BACKUP_DRIVE_REDIRECT_URI: PRODUCTION_DRIVE_REDIRECT_URI,
    })).toBe(PRODUCTION_DRIVE_REDIRECT_URI);
    expect(() => resolveRedirectUri({
      NODE_ENV: 'production', BACKUP_DRIVE_REDIRECT_URI: 'https://evil.example/callback',
    })).toThrow(/must be exactly/);
  });

  it('allows a localhost override only in development', () => {
    expect(resolveRedirectUri({ NODE_ENV: 'development', BACKUP_DRIVE_REDIRECT_URI: 'http://localhost:3000/api/backup/drive/callback' }))
      .toBe('http://localhost:3000/api/backup/drive/callback');
    expect(resolveRedirectUri({ NODE_ENV: 'development', BACKUP_PUBLIC_ORIGIN: 'http://localhost:4000' }))
      .toBe('http://localhost:4000/api/backup/drive/callback');
  });

  it('uses PKCE, drive.file, offline access and never leaks the client secret in the consent URL', () => {
    const { verifier, challenge } = generatePkce();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    const state = generateState();
    expect(state.length).toBeGreaterThan(20);
    expect(stateHash(state)).not.toContain(state);
    const url = buildAuthorizationUrl({ clientId: 'client-id', redirectUri: PRODUCTION_DRIVE_REDIRECT_URI, state, codeChallenge: challenge });
    const params = new URL(url).searchParams;
    expect(params.get('scope')).toBe(DRIVE_SCOPE);
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('redirect_uri')).toBe(PRODUCTION_DRIVE_REDIRECT_URI);
    expect(url).not.toContain('client_secret');
    expect(url).not.toContain(verifier);
  });

  it('reads server-only env vars and never invents a NEXT_PUBLIC_ credential', () => {
    const config = backupEnv({
      GOOGLE_DRIVE_CLIENT_ID: 'id',
      GOOGLE_DRIVE_CLIENT_SECRET: 'secret',
      BACKUP_ENCRYPTION_KEYS: 'primary:abc',
      BACKUP_ENCRYPTION_KEY_ID: 'primary',
      BACKUP_CRON_SECRET: 'cron',
      BACKUP_DATABASE_URL: 'postgresql://example',
      NODE_ENV: 'production',
    });
    expect(config.clientId).toBe('id');
    expect(config.clientSecret).toBe('secret');
    expect(config.redirectUri).toBe(PRODUCTION_DRIVE_REDIRECT_URI);
    expect(config.keyRef).toBe('primary');
    // CRON_SECRET is what Vercel Cron can actually send, so it must win when
    // both names exist; BACKUP_CRON_SECRET stays a usable alias.
    expect(config.cronSecrets).toEqual(['cron']);
    expect(config.cronSecret).toBe('cron');

    const both = backupEnv({ CRON_SECRET: 'from-vercel', BACKUP_CRON_SECRET: 'legacy' });
    expect(both.cronSecrets).toEqual(['from-vercel', 'legacy']);
    expect(both.cronSecret).toBe('from-vercel');

    const empty = backupEnv({ CRON_SECRET: '   ', BACKUP_CRON_SECRET: '' });
    expect(empty.cronSecrets).toEqual([]);
    expect(empty.cronSecret).toBeNull();
  });

  it('does not redirect to arbitrary external URLs after OAuth', () => {
    expect(safeBackPath('/admin?tab=backups')).toBe('/admin?tab=backups');
    expect(safeBackPath('https://evil.example')).toBe('/admin?tab=backups');
    expect(safeBackPath('//evil.example')).toBe('/admin?tab=backups');
    expect(safeBackPath('/admin\\evil')).toBe('/admin?tab=backups');
  });

  it('leaves the student authentication callback untouched', async () => {
    const studentCallback = await readFile(path.join(root, 'app/auth/callback/route.js'), 'utf8');
    expect(studentCallback).not.toMatch(/backup|GOOGLE_DRIVE|drive\.file/i);
  });
});
