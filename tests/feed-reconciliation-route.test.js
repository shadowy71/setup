import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_FEED_RECONCILE_LIMIT } from '@/lib/constants';

vi.mock('@/lib/auth/session', () => ({
  BLOCKED_STATUSES: ['suspended', 'banned'],
  getCurrentUser: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: vi.fn() }));
vi.mock('@/lib/data/feed', () => ({ getCampusFeed: vi.fn() }));

const { POST } = await import('../app/api/home/feed/route.js');
const { getCurrentUser } = await import('@/lib/auth/session');
const { getServerClient } = await import('@/lib/supabase/server');
const { getCampusFeed } = await import('@/lib/data/feed');

const ONE = '15fe0000-0000-4000-b000-000000000001';
const TWO = '15fe0000-0000-4000-b000-000000000002';

function railChain() {
  const chain = {};
  for (const method of ['select', 'eq', 'gte', 'order', 'limit']) chain[method] = () => chain;
  chain.then = (resolve) => Promise.resolve({ data: [], error: null }).then(resolve);
  return chain;
}

function request(body) {
  return new Request('https://pccoe.in/api/home/feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function reconcile(body, { visible = [], error = null, user = { profile: { id: 'profile-1' }, accountStatus: 'active' } } = {}) {
  const rpc = vi.fn(async () => ({ data: visible.map((id) => ({ id })), error }));
  getCurrentUser.mockResolvedValue(user);
  getServerClient.mockResolvedValue({ from: () => railChain(), rpc });
  getCampusFeed.mockResolvedValue({ items: [], unavailable: false });
  const response = await POST(request(body));
  return { status: response.status, body: await response.json(), rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/home/feed visibility reconciliation', () => {
  it('batches and deduplicates valid IDs and returns only checked/visible IDs', async () => {
    const { status, body, rpc } = await reconcile({ postIds: [ONE, ONE, 'not-a-uuid', TWO] }, { visible: [TWO] });
    expect(status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('campus_feed_post_visibility', { p_post_ids: [ONE, TWO] });
    expect(body.reconciliation).toEqual({ checkedPostIds: [ONE, TWO], visiblePostIds: [TWO], unavailable: false });
    expect(body.reconciliation).not.toHaveProperty('body');
    expect(body.reconciliation).not.toHaveProperty('status');
    expect(body.headers).toBeUndefined();
  });

  it('checks nothing on a visibility error so valid cached rows are not mistaken for deletions', async () => {
    const { status, body } = await reconcile({ postIds: [ONE, TWO] }, { error: { message: 'temporary' } });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.reconciliation).toEqual({ checkedPostIds: [], visiblePostIds: [], unavailable: true });
  });

  it('bounds one request to the supported paging depth plus one page of writes', async () => {
    const ids = Array.from(
      { length: HOME_FEED_RECONCILE_LIMIT + 1 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    const { body, rpc } = await reconcile({ postIds: ids });
    expect(rpc.mock.calls[0][1].p_post_ids).toHaveLength(HOME_FEED_RECONCILE_LIMIT);
    expect(body.reconciliation.checkedPostIds).toHaveLength(HOME_FEED_RECONCILE_LIMIT);
    expect(body.reconciliation.checkedPostIds).not.toContain(ids.at(-1));
  });

  it('rejects malformed input without calling the visibility RPC', async () => {
    const { status, body, rpc } = await reconcile('{bad json');
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires the same authenticated profile as the ordinary feed read', async () => {
    const { status, rpc } = await reconcile({ postIds: [ONE] }, { user: null });
    expect(status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(getCampusFeed).not.toHaveBeenCalled();
  });
});
