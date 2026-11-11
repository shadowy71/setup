import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const mocks = vi.hoisted(() => ({ user: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getActiveUser: mocks.user }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: mocks.client }));
import { setUploadPermission } from '@/lib/actions/admin';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function form(enabled = 'true') { const data = new FormData(); data.set('user_id', id); data.set('enabled', enabled); return data; }
const admin = { id: 'auth', profile: { id, account_status: 'active' }, roles: ['admin'], permissions: ['manage_users'] };
beforeEach(() => vi.resetAllMocks());
describe('upload permission administration', () => {
  it('rejects unsigned and non-admin callers without contacting the database', async () => {
    mocks.user.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...admin, roles: ['student'] });
    expect((await setUploadPermission(form())).ok).toBe(false);
    expect((await setUploadPermission(form())).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('forwards only validated input to the rank-checked database function', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mocks.user.mockResolvedValue(admin); mocks.client.mockResolvedValue({ rpc });
    expect((await setUploadPermission(form('other'))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect((await setUploadPermission(form('true'))).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('admin_set_upload_enabled', { p_user: id, p_enabled: true });
  });
});
