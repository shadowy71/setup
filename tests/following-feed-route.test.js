import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/session', () => ({ BLOCKED_STATUSES: ['banned'], getCurrentUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: vi.fn() }));
vi.mock('@/lib/data/feed', () => ({ getCampusFeed: vi.fn(), getTrendingPosts: vi.fn(), hydratePosts: vi.fn() }));

const { GET, POST } = await import('../app/api/home/feed/route.js');
const { getCurrentUser } = await import('@/lib/auth/session');
const { getServerClient } = await import('@/lib/supabase/server');
const { hydratePosts, getCampusFeed } = await import('@/lib/data/feed');

beforeEach(() => vi.resetAllMocks());

describe('Following feed API', () => {
  it('requires an active completed account', async () => {
    getCurrentUser.mockResolvedValue(null);
    const result = await GET(new Request('https://pccoe.in/api/home/feed?mode=following'));
    expect(result.status).toBe(401);
    expect(getServerClient).not.toHaveBeenCalled();
  });

  it('reads the dedicated RLS-scoped function, hydrates posts and paginates', async () => {
    getCurrentUser.mockResolvedValue({ profile: { id: 'viewer' }, accountStatus: 'active' });
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    const db = { rpc };
    getServerClient.mockResolvedValue(db);
    hydratePosts.mockResolvedValue(rows);
    const response = await GET(new Request('https://pccoe.in/api/home/feed?mode=following&offset=10'));
    const body = await response.json();
    expect(rpc).toHaveBeenCalledWith('following_feed', { p_limit: 10, p_offset: 10 });
    expect(hydratePosts).toHaveBeenCalledWith(db, rows, { currentProfileId: 'viewer' });
    expect(body).toMatchObject({ ok: true, posts: rows, page: { offset: 10, hasMore: true } });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(getCampusFeed).not.toHaveBeenCalled();
  });

  it('reports database failure rather than filling the feed with unrelated posts', async () => {
    getCurrentUser.mockResolvedValue({ profile: { id: 'viewer' }, accountStatus: 'active' });
    getServerClient.mockResolvedValue({ rpc: vi.fn().mockResolvedValue({ error: { message: 'not available' } }) });
    const response = await GET(new Request('https://pccoe.in/api/home/feed?mode=following'));
    expect(response.status).toBe(503);
    expect(getCampusFeed).not.toHaveBeenCalled();
  });

  it('does not accept following reconciliation POSTs', async () => {
    getCurrentUser.mockResolvedValue({ profile: { id: 'viewer' }, accountStatus: 'active' });
    getServerClient.mockResolvedValue({});
    const response = await POST(new Request('https://pccoe.in/api/home/feed?mode=following', { method: 'POST' }));
    expect(response.status).toBe(405);
  });
});
