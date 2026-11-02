import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_FEED_PAGE_SIZE, TRENDING_RAIL_LIMIT, TRENDING_WINDOW_HOURS } from '@/lib/constants';

/**
 * "Busiest right now" is fed by the same no-store Home request as the stream.
 * These tests pin the seam: the server returns authoritative, ranked rows with
 * their database score; a failed RPC is reported rather than invented; paging
 * back does not pay for a second trending read.
 */

vi.mock('@/lib/auth/session', () => ({
  BLOCKED_STATUSES: ['suspended', 'banned'],
  getCurrentUser: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: vi.fn() }));
vi.mock('@/lib/data/feed', () => ({
  getCampusFeed: vi.fn(),
  getTrendingPosts: vi.fn(),
}));

const { GET } = await import('../app/api/home/feed/route.js');
const { getCurrentUser } = await import('@/lib/auth/session');
const { getServerClient } = await import('@/lib/supabase/server');
const { getCampusFeed, getTrendingPosts } = await import('@/lib/data/feed');

const USER = { profile: { id: 'profile-1' }, accountStatus: 'active' };
const TRENDING = [
  { id: 'p1', title: 'Busy thread', reaction_count: 25, comment_count: 4, score: 24.7 },
  { id: 'p2', title: 'Quiet thread', reaction_count: 2, comment_count: 0, score: 1.98 },
];

function railChain() {
  const chain = {};
  for (const method of ['select', 'eq', 'is', 'gte', 'order', 'limit']) chain[method] = () => chain;
  chain.then = (resolve) => Promise.resolve({ data: [], error: null }).then(resolve);
  return chain;
}

function countChain() {
  const chain = {};
  for (const method of ['select', 'is', 'eq']) chain[method] = () => chain;
  chain.then = (resolve) => Promise.resolve({ data: null, count: 3, error: null }).then(resolve);
  return chain;
}

function mockServer(trendingResult) {
  getCurrentUser.mockResolvedValue(USER);
  getServerClient.mockResolvedValue({
    from: (table) => (table === 'posts' ? countChain() : railChain()),
    rpc: vi.fn(async () => ({ data: [], error: null })),
  });
  getCampusFeed.mockResolvedValue({
    items: Array.from({ length: HOME_FEED_PAGE_SIZE }, (_, index) => ({
      id: `p${index}`,
      type: 'post',
      sortAt: new Date().toISOString(),
    })),
    unavailable: false,
  });
  getTrendingPosts.mockResolvedValue(trendingResult);
}

async function getPage(offset = 0) {
  const response = await GET(new Request(`https://pccoe.in/api/home/feed${offset ? `?offset=${offset}` : ''}`));
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/home/feed — Busiest right now data', () => {
  it('returns the ranked rows and their database score unchanged', async () => {
    mockServer({ items: TRENDING, unavailable: false });
    const { status, body } = await getPage();
    expect(status).toBe(200);
    expect(body.trending).toEqual(TRENDING);
    expect(body.trendingUnavailable).toBe(false);
    expect(getTrendingPosts).toHaveBeenCalledWith(expect.anything(), {
      limit: TRENDING_RAIL_LIMIT,
      hours: TRENDING_WINDOW_HOURS,
    });
    expect(getTrendingPosts).toHaveBeenCalledTimes(1);
  });

  it('reports a failed read instead of fabricating engagement', async () => {
    mockServer({ items: [], unavailable: true });
    const { status, body } = await getPage();
    expect(status).toBe(200);
    expect(body.trending).toEqual([]);
    expect(body.trendingUnavailable).toBe(true);
    expect(body.feed).toHaveLength(HOME_FEED_PAGE_SIZE);
  });

  it('does not re-read trending for an older "Show more" page', async () => {
    mockServer({ items: TRENDING, unavailable: false });
    const { status, body } = await getPage(10);
    expect(status).toBe(200);
    expect(getTrendingPosts).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('trending');
    expect(body.page.offset).toBe(10);
  });

  it('leaves the feed page contract untouched', async () => {
    mockServer({ items: TRENDING, unavailable: false });
    const { body } = await getPage();
    expect(body.page).toEqual({ limit: HOME_FEED_PAGE_SIZE, offset: 0, hasMore: true, total: 3 });
  });
});
