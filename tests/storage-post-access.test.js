import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth/session', () => ({ getActiveUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: vi.fn() }));
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { visiblePost } from '@/lib/storage/post-access';
const id = 'd6c50c2c-c061-497e-ae3a-0289944cd024';
beforeEach(() => { vi.resetAllMocks(); });
it('denies signed out, unavailable, blocked or community-inaccessible posts before service lookup', async () => {
  getActiveUser.mockResolvedValueOnce(null).mockResolvedValue({ profile: { id: 'owner' } });
  expect((await visiblePost(id)).status).toBe(401);
  const rpc = vi.fn().mockResolvedValueOnce({ data: false }).mockResolvedValueOnce({ error: {} }).mockResolvedValue({ data: true });
  getServerClient.mockResolvedValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id, author_id: 'owner', status: 'published' } }) }) }) }), rpc });
  expect((await visiblePost(id)).status).toBe(404);
  expect((await visiblePost(id)).status).toBe(404);
  expect((await visiblePost(id)).post.id).toBe(id);
  expect(rpc).toHaveBeenCalledWith('can_view_post_attachment', { p_post: id });
});
