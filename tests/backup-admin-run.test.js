import { describe, expect, it, vi } from 'vitest';

/**
 * Server-side wiring for an admin-triggered run: the REAL `runAdminBackup()`
 * and `publicRunRecord()` over a mocked runtime and a mocked processing
 * engine. Proves configuration is validated before any credential is loaded,
 * that the bounded admin limits are used, and that startup failures surface as
 * stable codes instead of raw exceptions or secret-bearing text.
 */

const mocks = vi.hoisted(() => ({
  createBackupRuntime: vi.fn(),
  createDriveForWorker: vi.fn(),
  processBackupRun: vi.fn(),
}));

vi.mock('@/lib/backup/runtime.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createBackupRuntime: mocks.createBackupRuntime,
    createDriveForWorker: mocks.createDriveForWorker,
  };
});
vi.mock('@/lib/backup/processor.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, processBackupRun: mocks.processBackupRun };
});

const { runAdminBackup, publicRunRecord } = await import('@/lib/backup/admin-run.js');

describe('runAdminBackup wiring', () => {
  it('refuses a snapshot without BACKUP_DATABASE_URL before touching Drive', async () => {
    mocks.createBackupRuntime.mockReturnValue({ config: { databaseUrl: null }, keyRing: {}, store: { acquireRunLease: vi.fn() } });
    const result = await runAdminBackup({ kind: 'snapshot', env: {} });
    expect(result.status).toBe('not_configured');
    expect(result.code).toBe('database_url_missing');
    expect(result.message).toMatch(/BACKUP_DATABASE_URL/);
    expect(mocks.createDriveForWorker).not.toHaveBeenCalled();
    expect(mocks.processBackupRun).not.toHaveBeenCalled();
  });

  it('builds the Drive runtime and the bounded admin limits for an incremental run', async () => {
    const store = { acquireRunLease: vi.fn(async () => true) };
    mocks.createBackupRuntime.mockReturnValue({ config: { databaseUrl: 'postgresql://x' }, keyRing: { keys: {} }, store });
    mocks.createDriveForWorker.mockResolvedValue({ drive: { name: 'drive' }, folderId: 'folder-1', seal: () => ({}) });
    mocks.processBackupRun.mockResolvedValue({ status: 'verified', verified: 1, objects: [], diagnostics: [] });

    await runAdminBackup({ kind: 'incremental', env: { ANY: 'thing' } });
    const [args] = mocks.processBackupRun.mock.calls[0];
    expect(args.kind).toBe('incremental');
    expect(args.store).toBe(store);
    expect(args.drive).toEqual({ name: 'drive' });
    expect(args.folderId).toBe('folder-1');
    expect(args.limits.maxUnits).toBe(12);
    expect(args.limits.leaseSeconds).toBe(180);
    expect(args.limits.deadlineMs).toBeLessThan(60_000); // must fit maxDuration 60
    expect(mocks.createDriveForWorker).toHaveBeenCalledWith(expect.objectContaining({ store }));
  });

  it('gives a snapshot run its own single-unit limit', async () => {
    mocks.createBackupRuntime.mockReturnValue({ config: { databaseUrl: 'postgresql://x' }, keyRing: {}, store: {} });
    mocks.createDriveForWorker.mockResolvedValue({ drive: {}, folderId: 'f', seal: () => ({}) });
    mocks.processBackupRun.mockResolvedValue({ status: 'verified' });
    await runAdminBackup({ kind: 'snapshot', env: {} });
    expect(mocks.processBackupRun.mock.calls[0][0].limits.maxUnits).toBe(1);
    expect(mocks.processBackupRun.mock.calls[0][0].kind).toBe('snapshot');
  });

  it('turns a missing service-role configuration into a code, never a value', async () => {
    mocks.createBackupRuntime.mockImplementation(() => {
      throw new Error('the backup worker needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the server environment');
    });
    const result = await runAdminBackup({ kind: 'incremental', env: {} });
    expect(result.status).toBe('failed');
    expect(result.code).toBe('service_role_not_configured');
    expect(JSON.stringify(result)).not.toMatch(/sb_secret|eyJ[A-Za-z0-9_]/);
  });

  it('reports an undecryptable stored credential without echoing it', async () => {
    mocks.createBackupRuntime.mockReturnValue({ config: { databaseUrl: null }, keyRing: {}, store: {} });
    mocks.createDriveForWorker.mockRejectedValue(new Error(
      'credential could not be decrypted (aes-gcm auth tag mismatch) for secret LONGOPAQUEMATERIALSHOULDBEREDACTED0123456789abcdef',
    ));
    const result = await runAdminBackup({ kind: 'incremental', env: {} });
    expect(result.code).toBe('credential_error');
    expect(result.message).toContain('Reconnect Google Drive');
    expect(JSON.stringify(result)).not.toContain('LONGOPAQUEMATERIALSHOULDBEREDACTED');
  });

  it('rejects an unknown kind without constructing anything', async () => {
    mocks.createBackupRuntime.mockClear();
    const result = await runAdminBackup({ kind: 'whatever', env: {} });
    expect(result.status).toBe('failed');
    expect(result.code).toBe('invalid_kind');
    expect(mocks.createBackupRuntime).not.toHaveBeenCalled();
  });

  it('does not log anything that could carry a credential', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.createBackupRuntime.mockReturnValue({ config: { databaseUrl: null }, keyRing: {}, store: {} });
    mocks.createDriveForWorker.mockRejectedValue(new Error('refresh_token=REDACT_ME_PLEASE secret client secret leaked here'));
    await runAdminBackup({ kind: 'incremental', env: {} });
    const logged = warn.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain('REDACT_ME_PLEASE');
    expect(logged).not.toContain('refresh_token');
    warn.mockRestore();
  });
});

describe('publicRunRecord', () => {
  it('keeps only the safe, compact fields the admin page needs', () => {
    const record = publicRunRecord({
      status: 'verified', processed: 2, verified: 2, failed: 0, drainedJobs: 0, retryDelaySeconds: 0,
      diagnostics: [], objects: [{ fileId: 'f1', sha256: 'a'.repeat(64), rangeKey: 'r1', watermark: 5, eventCount: 3, rowCount: 0 }],
      message: 'should not be persisted', drive_file_ref: 'f1',
    });
    expect(record).toMatchObject({ status: 'verified', verified: 2, objects: [{ fileId: 'f1' }] });
    expect(record).not.toHaveProperty('message');
    expect(record).not.toHaveProperty('drive_file_ref');
  });

  it('truncates an oversized payload instead of failing the write', () => {
    const huge = publicRunRecord({
      status: 'failed', objects: Array.from({ length: 500 }, (_, i) => ({ fileId: `file-${i}-${'x'.repeat(24)}` })),
      diagnostics: [{ code: 'batch_failed', message: 'nope' }],
    });
    expect(JSON.stringify(huge).length).toBeLessThanOrEqual(3500);
    expect(huge.truncated).toBe(true);
    expect(huge.diagnostics).toHaveLength(1);
  });
});
