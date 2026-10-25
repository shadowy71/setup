import { describe, expect, it, vi } from 'vitest';

import {
  PROCESS_LIMITS,
  processBackupRun,
  redactDiagnostic,
  safeDiagnostic,
  summarizeRun,
} from '../lib/backup/processor.js';

/**
 * The bounded run engine behind Admin → Backups and the cron endpoints.
 * Everything is injected: no network, no credentials, no database.
 */

function fakeStore({ lease = true, calls = [] } = {}) {
  return {
    acquireRunLease: vi.fn(async () => lease),
    releaseRunLease: vi.fn(async () => { calls.push('release'); return true; }),
  };
}

const request = (token = null) => new Request('http://localhost/api/backup/worker', {
  headers: token ? { authorization: `Bearer ${token}` } : {},
});

describe('processBackupRun — bounded, concurrency-safe processing', () => {
  it('processes MULTIPLE queued units in one run instead of one', async () => {
    const store = fakeStore();
    const runWorker = vi.fn()
      .mockResolvedValueOnce({ status: 'verified', batchId: 'b1', eventCount: 10, fileId: 'f1', sha256: 'a'.repeat(64) })
      .mockResolvedValueOnce({ status: 'verified', batchId: 'b2', eventCount: 7, fileId: 'f2', sha256: 'b'.repeat(64) })
      .mockResolvedValueOnce({ status: 'idle', jobId: 'job-3' })
      .mockResolvedValueOnce({ status: 'idle' });

    const summary = await processBackupRun({
      kind: 'incremental', store, drive: {}, seal: () => ({}), folderId: 'folder',
      limits: { maxUnits: 12, leaseSeconds: 180, deadlineMs: 60000 },
      runWorker, runSnapshot: vi.fn(),
    });

    expect(runWorker).toHaveBeenCalledTimes(4);
    expect(summary.verified).toBe(2);
    expect(summary.drainedJobs).toBe(1);
    expect(summary.status).toBe('verified');
    expect(summary.objects).toHaveLength(2);
    expect(store.releaseRunLease).toHaveBeenCalledTimes(1);
  });

  it('stops at maxUnits and tells the operator to run again (nothing is lost)', async () => {
    const store = fakeStore();
    const verified = { status: 'verified', eventCount: 1, fileId: 'f', sha256: 'c'.repeat(64) };
    const runWorker = vi.fn(async () => ({ ...verified }));

    const summary = await processBackupRun({
      kind: 'incremental', store, drive: {}, seal: () => ({}), folderId: 'folder',
      limits: { maxUnits: 3, deadlineMs: 60000 }, runWorker, runSnapshot: vi.fn(),
    });

    expect(runWorker).toHaveBeenCalledTimes(3);
    expect(summary.processed).toBe(3);
    expect(summary.message).toMatch(/Click again/i);
  });

  it('stops at the wall-clock deadline so it always fits the function budget', async () => {
    const store = fakeStore();
    let clock = 0;
    const runWorker = vi.fn(async () => { clock += 10_000; return { status: 'verified', eventCount: 1, fileId: 'f', sha256: 'd'.repeat(64) }; });

    const summary = await processBackupRun({
      kind: 'incremental', store, drive: {}, seal: () => ({}), folderId: 'folder',
      limits: { maxUnits: 24, deadlineMs: 25_000 }, runWorker, runSnapshot: vi.fn(),
      now: () => clock,
    });

    expect(runWorker).toHaveBeenCalledTimes(3); // 0s, 10s, 20s → 30s is past 25s
    expect(summary.processed).toBe(3);
  });

  it('reports busy without queueing or duplicating work when another run holds the lease', async () => {
    const store = fakeStore({ lease: false });
    const runWorker = vi.fn();

    const summary = await processBackupRun({
      kind: 'incremental', store, drive: {}, seal: () => ({}), folderId: 'folder',
      runWorker, runSnapshot: vi.fn(),
    });

    expect(summary.status).toBe('busy');
    expect(summary.ok).toBe(true);
    expect(summary.processed).toBe(0);
    expect(runWorker).not.toHaveBeenCalled();
    expect(store.releaseRunLease).not.toHaveBeenCalled();
    expect(summary.message).toMatch(/already in progress/);
  });

  it('keeps verified objects verified and untouched jobs queued when a unit fails', async () => {
    const store = fakeStore();
    const runWorker = vi.fn()
      .mockResolvedValueOnce({ status: 'verified', batchId: 'b1', eventCount: 4, fileId: 'f1', sha256: 'e'.repeat(64) })
      .mockResolvedValueOnce({ status: 'failed', batchId: 'b2', error: 'Drive 503 backendError', retryDelaySeconds: 120 })
      .mockResolvedValueOnce({ status: 'verified', batchId: 'b3', eventCount: 9 });

    const summary = await processBackupRun({
      kind: 'incremental', store, drive: {}, seal: () => ({}), folderId: 'folder',
      limits: { maxUnits: 12, deadlineMs: 60000 }, runWorker, runSnapshot: vi.fn(),
    });

    expect(runWorker).toHaveBeenCalledTimes(2); // failure stops the run
    expect(summary.status).toBe('failed');
    expect(summary.verified).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.retryDelaySeconds).toBe(120);
    expect(summary.diagnostics[0].code).toBe('batch_failed');
    expect(summary.message).toMatch(/still pending/);
    expect(summary.message).not.toMatch(/503|backendError/);
    expect(store.releaseRunLease).toHaveBeenCalledTimes(1);
  });

  it('releases the lease even when a unit throws, and reports a safe diagnostic', async () => {
    const store = fakeStore();
    const runWorker = vi.fn(async () => { throw new Error('connect ECONNREFUSED https://www.googleapis.com/x'); });

    const summary = await processBackupRun({
      kind: 'incremental', store, drive: {}, seal: () => ({}), folderId: 'folder',
      runWorker, runSnapshot: vi.fn(),
    });

    expect(store.releaseRunLease).toHaveBeenCalledTimes(1);
    expect(summary.status).toBe('failed');
    expect(summary.message).toMatch(/Verified objects are safe; unfinished jobs remain queued\./);
    expect(summary.message).not.toContain('googleapis');
    expect(summary.message).not.toMatch(/https?:\/\//);
  });

  it('treats a lease-RPC error as a clear failure, not a silent success', async () => {
    const store = { acquireRunLease: vi.fn(async () => { throw new Error('function backup_acquire_run_lease does not exist'); }), releaseRunLease: vi.fn() };
    const summary = await processBackupRun({ kind: 'incremental', store, drive: {}, seal: () => ({}), folderId: 'f', runWorker: vi.fn(), runSnapshot: vi.fn() });
    expect(summary.status).toBe('failed');
    expect(summary.message).toMatch(/Could not start a backup run/);
    expect(store.releaseRunLease).not.toHaveBeenCalled();
  });

  it('runs exactly one snapshot unit and needs BACKUP_DATABASE_URL semantics upstream', async () => {
    const store = fakeStore();
    const runWorker = vi.fn();
    const runSnapshot = vi.fn(async () => ({ status: 'verified', snapshotId: 's1', watermark: 42, rowCount: 1000, tableCount: 65, fileId: 'sf', sha256: 'f'.repeat(64) }));

    const summary = await processBackupRun({ kind: 'snapshot', store, drive: {}, seal: () => ({}), folderId: 'folder', runSnapshot, runWorker });

    expect(runSnapshot).toHaveBeenCalledTimes(1);
    expect(runWorker).not.toHaveBeenCalled();
    expect(PROCESS_LIMITS.admin.snapshot.maxUnits).toBe(1);
    expect(PROCESS_LIMITS.cron.snapshot.maxUnits).toBe(1);
    expect(summary.status).toBe('verified');
    expect(summary.objects[0].watermark).toBe(42);
    expect(summary.objects[0].rowCount).toBe(1000);
  });

  it('rejects an unknown kind without touching the store', async () => {
    const store = fakeStore();
    const summary = await processBackupRun({ kind: 'wipe', store, drive: {}, seal: () => ({}), folderId: 'f', runWorker: vi.fn(), runSnapshot: vi.fn() });
    expect(summary.code).toBe('invalid_kind');
    expect(store.acquireRunLease).not.toHaveBeenCalled();
  });

  it('clamps unbounded limits so one click cannot run forever', async () => {
    const store = fakeStore();
    const runWorker = vi.fn(async () => ({ status: 'idle', jobId: 'j' }));
    await processBackupRun({
      kind: 'incremental', store, drive: {}, seal: () => ({}), folderId: 'f',
      limits: { maxUnits: 100_000, deadlineMs: 10_000_000, leaseSeconds: 999_999 }, runWorker, runSnapshot: vi.fn(),
    });
    expect(runWorker.mock.calls[0][0].workerId).toBeTruthy();
    expect(runWorker).toHaveBeenCalledTimes(24); // clamped to the hard ceiling
  });
});

describe('cron bearer-token validation', () => {
  it('accepts EITHER CRON_SECRET or the BACKUP_CRON_SECRET alias, and no other token', async () => {
    const { cronAuthorized } = await import('../lib/backup/runtime.js');
    const candidates = ['primary-token-abcdefghij', 'alias-token-klmnopqrstuv'];

    expect(cronAuthorized(request('primary-token-abcdefghij'), candidates)).toBe(true);
    expect(cronAuthorized(request('alias-token-klmnopqrstuv'), candidates)).toBe(true);
    expect(cronAuthorized(request('wrong-token-xxxxxxxxxxxxxx'), candidates)).toBe(false);
    expect(cronAuthorized(request('primary-token-abcdefghij '), candidates)).toBe(true);
    expect(cronAuthorized(new Request('http://localhost/x'), candidates)).toBe(false);
    expect(cronAuthorized(request('primary-token-abcdefghij'), [])).toBe(false);
    expect(cronAuthorized(request('primary-token-abcdefghij'), [null, undefined, '   '])).toBe(false);
    expect(cronAuthorized({ headers: { get: () => `Basic ${'y'.repeat(24)}` } }, candidates)).toBe(false);
  });

  it('prefers CRON_SECRET (the only name Vercel can send) and de-duplicates aliases', async () => {
    const { cronSecretCandidates } = await import('../lib/backup/oauth.js');
    expect(cronSecretCandidates({ CRON_SECRET: 'from-vercel', BACKUP_CRON_SECRET: 'legacy' })).toEqual(['from-vercel', 'legacy']);
    expect(cronSecretCandidates({ CRON_SECRET: 'same', BACKUP_CRON_SECRET: 'same' })).toEqual(['same']);
    expect(cronSecretCandidates({ CRON_SECRET: '  padded  ' })).toEqual(['padded']);
    expect(cronSecretCandidates({ BACKUP_CRON_SECRET: 'only-legacy' })).toEqual(['only-legacy']);
    expect(cronSecretCandidates({})).toEqual([]);
    expect(cronSecretCandidates({ CRON_SECRET: '   ' })).toEqual([]);
  });

  it('never puts a token in the diagnostic output on failure', async () => {
    const { cronAuthorized } = await import('../lib/backup/runtime.js');
    expect(() => cronAuthorized(request('super-secret-token-abcdef'), ['different-secret-ghijkl'])).not.toThrow();
    expect(JSON.stringify({ ok: cronAuthorized(request('super-secret-token-abcdef'), ['different-secret-ghijkl']) })).not.toContain('secret');
  });

  it('rejects an unauthorized request BEFORE any runtime is constructed', async () => {
    const { scheduledBackupResponse } = await import('../lib/backup/endpoints.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await scheduledBackupResponse({
      request: request('definitely-not-the-token'),
      kind: 'incremental',
      env: { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x', CRON_SECRET: 'real-token-abcdefghijklmnop' },
    });
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: 'unauthorized' });
    expect(JSON.stringify(result)).not.toContain('real-token');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns a config code (never a value) when authorized but unconfigured', async () => {
    const { scheduledBackupResponse } = await import('../lib/backup/endpoints.js');
    const token = 'good-token-abcdefghijklmnop';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const noServiceRole = await scheduledBackupResponse({
      request: request(token), kind: 'incremental', env: { CRON_SECRET: token },
    });
    expect(noServiceRole.status).toBe(503);
    expect(noServiceRole.body.code).toBe('service_role_not_configured');

    const snapshotWithoutUrl = await scheduledBackupResponse({
      request: request(token),
      kind: 'snapshot',
      env: { CRON_SECRET: token, NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_x', BACKUP_ENCRYPTION_KEYS: 'primary:k' },
    });
    expect(snapshotWithoutUrl.status).toBe(503);
    expect(snapshotWithoutUrl.body.code).toBe('database_url_missing');

    for (const result of [noServiceRole, snapshotWithoutUrl]) {
      expect(JSON.stringify(result)).not.toContain(token);
      expect(JSON.stringify(result)).not.toContain('sb_secret_x');
    }
    warn.mockRestore();
  });

  it('accepts the legacy alias and still rejects a mismatch', async () => {
    const { cronAuthorizationCheck } = await import('../lib/backup/endpoints.js');
    expect(cronAuthorizationCheck(request('legacy-only-token-123456'), { BACKUP_CRON_SECRET: 'legacy-only-token-123456' })).toBe(true);
    expect(cronAuthorizationCheck(request('legacy-only-token-123456'), { CRON_SECRET: 'different-token-xyz', BACKUP_CRON_SECRET: 'legacy-only-token-123456' })).toBe(true);
    expect(cronAuthorizationCheck(request('nope-nope-nope-nope-nope'), { CRON_SECRET: 'different-token-xyz' })).toBe(false);
    expect(cronAuthorizationCheck(request('x'), {})).toBe(false);
  });
});

describe('safe diagnostics', () => {
  it('maps known configuration failures to actionable messages', () => {
    expect(safeDiagnostic(new Error('no active admin Google Drive connection — connect it from Admin → Backups')).code).toBe('drive_not_connected');
    expect(safeDiagnostic('BACKUP_DATABASE_URL is required for a full snapshot').code).toBe('database_url_missing');
    expect(safeDiagnostic('the Drive connection is not marked as a restricted folder').code).toBe('folder_not_private');
    expect(safeDiagnostic('GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET are required').code).toBe('oauth_not_configured');
  });

  it('redacts secrets, URLs, emails and long opaque strings from unknown errors', () => {
    const raw = 'failed Bearer abcdef1234567890 at https://www.googleapis.com/upload/drive/v3/files user@example.com with key MIIprivateKEYmaterial0987654321zzzzxxxx';
    const redacted = redactDiagnostic(raw);
    expect(redacted).not.toContain('abcdef1234567890');
    expect(redacted).not.toContain('googleapis.com');
    expect(redacted).not.toContain('user@example.com');
    expect(redacted).toContain('[redacted]');
    expect(redacted.length).toBeLessThanOrEqual(300);
  });

  it('truncates thrown Error objects to their message only', () => {
    const diagnostic = safeDiagnostic(new Error('a'.repeat(5000)));
    expect(diagnostic.message.length).toBeLessThan(400);
    expect(safeDiagnostic(null).message).toMatch(/Check the server logs/);
  });

  it('summarizeRun never reports success for an empty or failed run', () => {
    expect(summarizeRun('incremental', []).status).toBe('idle');
    expect(summarizeRun('incremental', [{ status: 'idle', jobId: 'j' }]).status).toBe('drained');
    const failed = summarizeRun('incremental', [{ status: 'failed', error: 'x', retryDelaySeconds: 30 }]);
    expect(failed.ok).toBe(false);
    expect(failed.retryDelaySeconds).toBe(30);
  });
});

describe('regression guards for this fix', () => {
  it('the admin buttons PROCESS work instead of only queueing it', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const panel = await readFile(path.join(root, 'components/admin/BackupPanels.js'), 'utf8');
    const actions = await readFile(path.join(root, 'lib/actions/backup.js'), 'utf8');

    expect(panel).toContain('processBackupNow');
    expect(panel).not.toMatch(/Request full snapshot/);
    expect(actions).toContain('runAdminBackup');
    expect(actions).toContain("can(toActor(user), 'manage_backups')");
    // No secret ever leaves the server: the action returns a summary only.
    expect(actions).not.toMatch(/credential_ciphertext|refresh_token|client_secret|service_role/);
  });

  it('the cron endpoints keep their bearer protection', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    for (const file of ['app/api/backup/worker/route.js', 'app/api/backup/snapshot/route.js']) {
      const source = await readFile(path.join(root, file), 'utf8');
      expect(source, file).toContain('scheduledBackupResponse');
    }
    const endpoints = await readFile(path.join(root, 'lib/backup/endpoints.js'), 'utf8');
    expect(endpoints).toContain('cronAuthorized');
    expect(endpoints).toContain('cronSecretCandidates');
    // Authorization happens before any runtime/credential construction.
    const body = endpoints.slice(endpoints.indexOf('export async function scheduledBackupResponse'));
    expect(body.indexOf('cronAuthorizationCheck')).toBeGreaterThan(-1);
    expect(body.indexOf('cronAuthorizationCheck')).toBeLessThan(body.indexOf('createBackupRuntime'));
    expect(body.indexOf('createDriveForWorker')).toBeGreaterThan(body.indexOf('cronAuthorizationCheck'));
  });

  it('migration 028 keeps leases worker-only, logs runs with the admin identity and never stores secrets', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const sql = await readFile(path.join(root, 'supabase/migrations/20261025000002_028_backup_admin_processing.sql'), 'utf8');

    expect(sql).toContain('backup_acquire_run_lease');
    expect(sql).toContain('backup_release_run_lease');
    expect(sql).toContain('backup_admin_state');
    expect(sql).toContain('backup_record_run');
    expect(sql).toMatch(/backup_acquire_run_lease is worker-only/);
    expect(sql).toMatch(/backup_release_run_lease is worker-only/);
    expect(sql).toMatch(/has_permission\('manage_backups'\)/);
    // A credential-looking payload is redacted before it is ever stored.
    expect(sql).toContain("client_secret|refresh_token|credential_ciphertext");
    expect(sql).toContain("'backup.process'");
    // Both new tables are RLS-enabled, admin-read-only, and never writable by a
    // browser role — grants happen through the locked-down format() loop.
    expect(sql).toMatch(/alter table public\.backup_run_leases enable row level security/);
    expect(sql).toMatch(/alter table public\.backup_run_log\s+enable row level security/);
    expect(sql).toContain("'backup_run_leases', 'backup_run_log'");
    expect(sql).toContain("revoke all on public.%I from public, anon, authenticated");
    expect(sql).toContain("grant select on public.%I to authenticated");
    expect(sql).not.toMatch(/grant (insert|update|delete|all) on public\.backup_run_(leases|log) to authenticated/);
    // Lease RPCs stay service-role only; admin RPCs are the only new surface.
    expect(sql).toMatch(/'backup_acquire_run_lease\(text, text, integer\)',\s*\n\s*'backup_release_run_lease\(text, text\)'/);
  });
});
