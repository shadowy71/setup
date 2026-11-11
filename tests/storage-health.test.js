import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth/session', () => ({ getActiveUser: vi.fn() }));
vi.mock('@/lib/storage', () => ({ getStorageHealth: vi.fn() }));
import { getActiveUser } from '@/lib/auth/session';
import { getStorageHealth } from '@/lib/storage';
import { GET } from '@/app/api/storage/health/route';

const user = { id: 'user', profile: { id: 'profile', account_status: 'active' }, roles: ['admin'], permissions: ['manage_backups'] };
beforeEach(() => { vi.resetAllMocks(); });
describe('storage health', () => {
  it('rejects signed-out and incomplete users before contacting the gateway', async () => {
    getActiveUser.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...user, needsProfileSetup: true });
    expect((await GET()).status).toBe(401);
    expect((await GET()).status).toBe(401);
    expect(getStorageHealth).not.toHaveBeenCalled();
  });
  it('rejects non-admins and admins lacking the diagnostic permission', async () => {
    getActiveUser.mockResolvedValueOnce({ ...user, roles: ['student'] }).mockResolvedValueOnce({ ...user, permissions: [] });
    expect((await GET()).status).toBe(403);
    expect((await GET()).status).toBe(403);
    expect(getStorageHealth).not.toHaveBeenCalled();
  });
  it('allows authorized admins and hides provider error details', async () => {
    getActiveUser.mockResolvedValue(user);
    getStorageHealth.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(Error('sensitive details'));
    const success = await GET();
    expect(success.status).toBe(200);
    expect(success.headers.get('cache-control')).toContain('no-store');
    const failure = await GET();
    expect(failure.status).toBe(503);
    expect(JSON.stringify(await failure.json())).not.toContain('sensitive');
  });
});
