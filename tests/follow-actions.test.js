import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getActiveUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: vi.fn() }));

import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { setFollowing } from '@/lib/actions/follows';

const me = 'aa000000-0000-4000-8000-000000000001';
const target = 'aa000000-0000-4000-8000-000000000002';

describe('follow actions', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('rejects signed-out, incomplete and self-follow before querying', async () => {
    getActiveUser.mockResolvedValueOnce(null).mockResolvedValueOnce({ profile: { id: me }, needsProfileSetup: true }).mockResolvedValueOnce({ profile: { id: me } });
    expect((await setFollowing(target, true)).ok).toBe(false);
    expect((await setFollowing(target, true)).ok).toBe(false);
    expect((await setFollowing(me, true)).ok).toBe(false);
    expect(getServerClient).not.toHaveBeenCalled();
  });

  it('persists only the current user and treats a duplicate insert as idempotent', async () => {
    getActiveUser.mockResolvedValue({ profile: { id: me } });
    const insert = vi.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { code: '23505' } });
    const from = vi.fn(() => ({ insert }));
    getServerClient.mockResolvedValue({ from });
    expect((await setFollowing(target, true)).ok).toBe(true);
    expect((await setFollowing(target, true)).ok).toBe(true);
    expect(from).toHaveBeenCalledWith('user_follows');
    expect(insert).toHaveBeenCalledWith({ follower_id: me, followed_id: target });
  });

  it('scopes unfollow to both current user and target', async () => {
    getActiveUser.mockResolvedValue({ profile: { id: me } });
    const eq = vi.fn().mockReturnThis();
    eq.mockReturnValueOnce({ eq });
    eq.mockResolvedValueOnce({ error: null });
    const remove = vi.fn(() => ({ eq }));
    getServerClient.mockResolvedValue({ from: () => ({ delete: remove }) });
    expect((await setFollowing(target, false)).ok).toBe(true);
    expect(eq).toHaveBeenNthCalledWith(1, 'follower_id', me);
    expect(eq).toHaveBeenNthCalledWith(2, 'followed_id', target);
  });
});
