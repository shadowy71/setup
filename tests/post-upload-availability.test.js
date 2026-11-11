import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), db: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getActiveUser: mocks.user }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: mocks.db }));
import { GET } from '@/app/api/storage/post-upload-availability/route';
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('CAMPUS_POST_ATTACHMENTS_ENABLED', '1'); vi.stubEnv('CAMPUS_STORAGE_V3_ENABLED', '1'); mocks.user.mockResolvedValue({profile:{id:'owner'}}); });
afterEach(() => vi.unstubAllEnvs());
describe('attachment availability', () => {
  it('distinguishes disabled deployments without calling the database', async () => {
    vi.stubEnv('CAMPUS_POST_ATTACHMENTS_ENABLED', '0');
    expect(await (await GET()).json()).toEqual({ enabled:false, reason:'disabled' }); expect(mocks.db).not.toHaveBeenCalled();
  });
  it('reports missing permissions and permits only entitled accounts', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({data:[{upload_enabled:false}],error:null}).mockResolvedValueOnce({data:[{upload_enabled:true}],error:null});
    mocks.db.mockResolvedValue({rpc});
    expect(await (await GET()).json()).toEqual({enabled:false,reason:'permission'});
    expect(await (await GET()).json()).toEqual({enabled:true,reason:null});
    expect(rpc).toHaveBeenCalledWith('storage_account_usage',{p_user:'owner'});
  });
  it('fails closed on database errors', async () => {
    mocks.db.mockResolvedValue({rpc:vi.fn().mockResolvedValue({error:{message:'failed'}})});
    const response = await GET(); expect(response.status).toBe(503); expect((await response.json()).reason).toBe('unavailable');
  });
});
