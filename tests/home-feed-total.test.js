import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_FEED_PAGE_SIZE } from '@/lib/constants';

/**
 * The feed page reports the real server-side total (e.g. 14 eligible posts)
 * alongside the page it just served (10), so the UI can show "10 of 14" while
 * the remaining 4 load through normal offset pagination — and hasMore must
 * stay true on a full first page and false on the short last page.
 */

vi.mock('@/lib/auth/session', () => ({
  BLOCKED_STATUSES: ['suspended', 'banned'],
  getCurrentUser: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: vi.fn() }));
vi.mock('@/lib/data/feed', () => ({ getCampusFeed: vi.fn() }));

const { GET } = await import('../app/api/home/feed/route.js');
const { getCurrentUser } = await import('@/lib/auth/session');
const { getServerClient } = await import('@/lib/supabase/server');
const { getCampusFeed } = await import('@/lib/data/feed');

const USER = { profile: { id: 'profile-1' }, accountStatus: 'active' };

function railChain() {
  const chain = {};
  for (const method of ['select', 'eq', 'is', 'gte', 'order', 'limit']) chain[method] = () => chain;
  chain.then = (resolve) => Promise.resolve({ data: [], error: null }).then(resolve);
  return chain;
}

function countChain(count, error = null) {
  const chain = {};
  for (const method of ['select', 'is', 'eq']) chain[method] = () => chain;
  chain.then = (resolve) => Promise.resolve({ data: null, count, error }).then(resolve);
  return chain;
}

const entry = (id) => ({ id, type: 'post', sortAt: new Date().toISOString() });

function mockServer({ feedLength, total, totalError = null }) {
  getCurrentUser.mockResolvedValue(USER);
  getServerClient.mockResolvedValue({
    from: (table) => (table === 'posts' ? countChain(total, totalError) : railChain()),
    rpc: vi.fn(async () => ({ data: [], error: null })),
  });
  getCampusFeed.mockResolvedValue({
    items: Array.from({ length: feedLength }, (_, index) => entry(`p${index}`)),
    unavailable: false,
  });
}

async function getPage(offset) {
  const response = await GET(new Request(`https://pccoe.in/api/home/feed${offset ? `?offset=${offset}` : ''}`));
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/home/feed total and pagination', () => {
  it('reports the server-side total (14) while serving only the first page (10)', async () => {
    mockServer({ feedLength: HOME_FEED_PAGE_SIZE, total: 14 });
    const { status, body } = await getPage(0);
    expect(status).toBe(200);
    expect(body.page).toMatchObject({ limit: 10, offset: 0, hasMore: true, total: 14 });
    expect(body.feed).toHaveLength(10);
  });

  it('keeps hasMore true on a full page and false on the short last page (4 remaining)', async () => {
    mockServer({ feedLength: 4, total: 14 });
    const { body } = await getPage(10);
    expect(body.page).toMatchObject({ offset: 10, hasMore: false, total: 14 });
    expect(body.feed).toHaveLength(4);
  });

  it('reports a null total (never a fabricated one) when the count lookup fails', async () => {
    mockServer({ feedLength: 10, total: null, totalError: { message: 'boom' } });
    const { body } = await getPage(0);
    expect(body.page.total).toBeNull();
    expect(body.page.hasMore).toBe(true);
  });
});
