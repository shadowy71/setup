import { describe, expect, it, vi } from 'vitest';

/**
 * The admin-authorized processing action: `processBackupNow()` in
 * `lib/actions/backup.js`, with the Drive/runtime wiring stubbed out.
 *
 * What these tests pin down:
 *   * authorization happens BEFORE anything that could read a credential;
 *   * an authorized click PROCESSES the queue and returns only safe fields;
 *   * the run record is written with the ADMIN's own RLS-scoped client;
 *   * no service-role key, OAuth secret or raw exception text crosses to the
 *     browser, whatever happened server-side.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin',
}));

const mocks = vi.hoisted(() => ({
  getActiveUser: vi.fn(),
  can: vi.fn(() => true),
  getServerClient: vi.fn(),
  runAdminBackup: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getActiveUser: mocks.getActiveUser }));
vi.mock('@/lib/permissions/authorization', () => ({
  can: mocks.can,
  toActor: (user) => ({ userId: user?.profile?.id, roles: user?.roles || [] }),
}));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: mocks.getServerClient }));
vi.mock('@/lib/backup/admin-run.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runAdminBackup: mocks.runAdminBackup };
});

const { processBackupNow, requestManualBackup, retryBackupBatch, disconnectDriveBackup } = await import('@/lib/actions/backup.js');
const { recordBackupRun, getBackupStatus, getBackupConfiguration } = await import('@/lib/data/backup.js');

const admin = { profile: { id: 'admin-1' }, roles: ['super_admin'] };
const form = (kind) => {
  const formData = new FormData();
  formData.set('kind', kind);
  return formData;
};

function reset({ authorized = true } = {}) {
  vi.clearAllMocks();
  const rpc = vi.fn(async () => ({ error: null }));
  mocks.can.mockReturnValue(authorized);
  mocks.getActiveUser.mockResolvedValue(authorized ? admin : null);
  mocks.getServerClient.mockResolvedValue({ rpc });
  return { rpc };
}

describe('processBackupNow (admin-authorized processing)', () => {
  it('refuses a signed-out caller before any backup runtime exists', async () => {
    reset({ authorized: false });
    const result = await processBackupNow(form('incremental'));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unauthenticated');
    expect(mocks.runAdminBackup).not.toHaveBeenCalled();
  });

  it('refuses a signed-in non-admin, still without touching the runtime', async () => {
    reset({ authorized: false });
    mocks.getActiveUser.mockResolvedValue({ profile: { id: 'student-9' }, roles: ['student'] });
    mocks.can.mockReturnValue(false);

    const result = await processBackupNow(form('incremental'));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('forbidden');
    expect(mocks.can).toHaveBeenCalledWith(expect.anything(), 'manage_backups');
    expect(mocks.runAdminBackup).not.toHaveBeenCalled();
  });

  it('rejects an unknown kind instead of defaulting to a real run', async () => {
    reset();
    const result = await processBackupNow(form('nuke'));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('validation');
    expect(mocks.runAdminBackup).not.toHaveBeenCalled();
  });

  it('processes the queue for an authorized admin and returns only safe fields', async () => {
    const { rpc } = reset();
    mocks.runAdminBackup.mockResolvedValue({
      status: 'verified', ok: true, kind: 'incremental', processed: 3, verified: 2,
      failed: 0, drainedJobs: 1, retryDelaySeconds: 0, diagnostics: [],
      objects: [{ fileId: 'drive-1', sha256: 'a'.repeat(64), rangeKey: 'r', watermark: 0, eventCount: 5, rowCount: 0 }],
      message: '2 objects uploaded and verified.',
    });

    const result = await processBackupNow(form('incremental'));
    expect(result.ok).toBe(true);
    expect(result.status).toBe('verified');
    expect(result.verified).toBe(2);
    expect(result.message).toMatch(/uploaded and verified/);
    expect(mocks.runAdminBackup).toHaveBeenCalledWith({ kind: 'incremental' });

    // Logged through the ADMIN's RLS-scoped client, never the service role.
    expect(rpc).toHaveBeenCalledWith('backup_record_run', expect.objectContaining({ p_kind: 'incremental', p_status: 'verified' }));
    const record = rpc.mock.calls.find(([name]) => name === 'backup_record_run')[1].p_record;
    expect(record).not.toHaveProperty('message');
    expect(JSON.stringify(record)).not.toMatch(/SUPABASE_SECRET_KEY|client_secret|refresh_token|credential_ciphertext/);
  });

  it('reports a failed run as a status + code, not as a successful action', async () => {
    const { rpc } = reset();
    mocks.runAdminBackup.mockResolvedValue({
      status: 'failed', ok: false, code: 'drive_not_connected',
      message: 'Backup run stopped: Google Drive is not connected.',
      diagnostics: [{ code: 'drive_not_connected', message: 'Google Drive is not connected. Connect it from Admin → Backups first.' }],
      objects: [], processed: 0, verified: 0, failed: 1, drainedJobs: 0, retryDelaySeconds: 90,
    });

    const result = await processBackupNow(form('incremental'));
    expect(result.status).toBe('failed');
    expect(result.diagnostics[0].code).toBe('drive_not_connected');
    expect(result.retryDelaySeconds).toBe(90);
    expect(rpc).toHaveBeenCalledWith('backup_record_run', expect.objectContaining({ p_status: 'failed' }));
  });

  it('never leaks a thrown error to the browser', async () => {
    reset();
    mocks.runAdminBackup.mockRejectedValue(new Error('EXPLODE sb_secret_SUPER_SECRET_VALUE postgresql://user:pass@host/db'));
    const result = await processBackupNow(form('incremental'));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('internal');
    expect(JSON.stringify(result)).not.toContain('sb_secret_');
    expect(JSON.stringify(result)).not.toContain('postgresql://');
    expect(JSON.stringify(result)).not.toContain('EXPLODE');
  });

  it('keeps the enqueue-only action as a separate, still-authorized primitive', async () => {
    const { rpc } = reset();
    const result = await requestManualBackup(form('snapshot'));
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('backup_request_job', { p_kind: 'snapshot', p_note: 'manual' });
  });

  it('still authorizes retry and disconnect through the same permission gate', async () => {
    const { rpc } = reset();
    const formData = new FormData();
    formData.set('batch_id', '11111111-1111-4111-8111-111111111111');
    expect((await retryBackupBatch(formData)).ok).toBe(true);
    expect((await disconnectDriveBackup(new FormData())).ok).toBe(true);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['backup_retry_failed', 'backup_disconnect']);

    reset({ authorized: false });
    expect((await retryBackupBatch(formData)).ok).toBe(false);
  });
});

describe('admin reads and configuration presence', () => {
  it('recordBackupRun is best-effort: a logging failure never crashes the page', async () => {
    const throwing = vi.fn(async () => { throw new Error('rpc unavailable'); });
    await expect(recordBackupRun({ rpc: throwing }, { kind: 'incremental', status: 'verified', record: {} })).resolves.toBe(false);
    await expect(recordBackupRun(null, { kind: 'incremental', status: 'verified', record: {} })).resolves.toBe(null);
    await expect(recordBackupRun({ rpc: vi.fn(async () => ({ error: null })) }, { kind: 'x' })).resolves.toBe(null);
  });

  it('degrades gracefully when migration 028 is not applied yet', async () => {
    const status = await getBackupStatus({
      rpc: vi.fn(async (name) => (name === 'backup_admin_state'
        ? { data: null, error: { message: 'function backup_admin_state does not exist' } }
        : { data: { queue_depth: 4 }, error: null })),
    });
    expect(status.queue_depth).toBe(4);
    expect(status.admin.unavailable).toBe(true);
  });

  it('parses a jsonb status returned as a string (PostgREST variant)', async () => {
    const status = await getBackupStatus({
      rpc: vi.fn(async (name) => (name === 'backup_admin_state'
        ? { data: JSON.stringify({ jobs: { queued: 12, processing: 0, verified: 3, failed: 1 } }), error: null }
        : { data: JSON.stringify({ queue_depth: 40 }), error: null })),
    });
    expect(status.queue_depth).toBe(40);
    expect(status.admin.jobs.queued).toBe(12);
    expect(status.admin.unavailable).toBe(false);
  });

  it('reports the cron token as one presence check and never a value', () => {
    const rows = getBackupConfiguration({ CRON_SECRET: 'a-very-long-cron-token-value', BACKUP_ENCRYPTION_KEYS: 'primary:k' });
    const cron = rows.find((row) => row.key === 'CRON_SECRET');
    expect(cron.configured).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('a-very-long-cron-token-value');
    expect(JSON.stringify(rows)).not.toContain('YOUR_');

    expect(getBackupConfiguration({}).find((row) => row.key === 'CRON_SECRET').configured).toBe(false);
    expect(getBackupConfiguration({ BACKUP_CRON_SECRET: 'legacy-token-value-here' })
      .find((row) => row.key === 'CRON_SECRET').configured).toBe(true);
    expect(getBackupConfiguration({ CRON_SECRET: 'YOUR_LONG_RANDOM_CRON_TOKEN' })
      .find((row) => row.key === 'CRON_SECRET').configured).toBe(false);
  });
});
