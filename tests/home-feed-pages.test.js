import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/**
 * Home loads ten at a time and can be told to show more.
 *
 * Home used to *stop* at ten posts, enforced twice: `/api/home/feed` asked the database
 * for ten and `homeFeedCache` re-truncated whatever came back. Ten is still the page size
 * — it is a screenful, and it is what a request costs — but it is no longer a ceiling: the
 * surface keeps every page it has loaded and "Show more" fetches the next one. What has to
 * agree is the seam between three parts, so that is what is pinned here: the merge rule,
 * the page size the database will actually answer, and what the route says about whether
 * anything older exists.
 */

const { HOME_FEED_PAGE_SIZE, HOME_FEED_MAX_OFFSET } = await import('@/lib/constants');
const { mergeFeedPages } = await import('@/lib/social/feed-state');

const entry = (id, day, extra = {}) => ({
  id,
  type: 'post',
  sortAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
  ...extra,
});

describe('mergeFeedPages', () => {
  it('keeps every entry of both pages, newest first', () => {
    const page = [entry('new-1', 20), entry('new-2', 19)];
    const loaded = [entry('old-1', 12), entry('old-2', 11)];
    expect(mergeFeedPages(page, loaded).map((item) => item.id)).toEqual(['new-1', 'new-2', 'old-1', 'old-2']);
  });

  it('lets the page that goes first win for a duplicate, so a re-read cannot be overwritten by a stale tail', () => {
    const fresh = entry('a', 20, { post: { id: 'a', reaction_count: 9 } });
    const stale = entry('a', 20, { post: { id: 'a', reaction_count: 2 } });
    const [only] = mergeFeedPages([fresh], [stale]);
    expect(only.post.reaction_count).toBe(9);
    // …and the other way round is the other answer, which is why the caller's order is
    // the whole contract: newest server page first, whatever the surface holds second.
    const [swapped] = mergeFeedPages([stale], [fresh]);
    expect(swapped.post.reaction_count).toBe(2);
  });

  it('collapses one post arriving under two type labels across a page boundary', () => {
    // `post` from this read, `discussion` from the older page: same database row, one slot.
    const merged = mergeFeedPages([entry('a', 20, { type: 'post' })], [entry('a', 20, { type: 'discussion' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe('post');
  });

  it('does not truncate at all by default, and truncates only when asked', () => {
    const many = Array.from({ length: 40 }, (_, index) => entry(`p${index}`, 100 - index));
    const few = Array.from({ length: 20 }, (_, index) => entry(`q${index}`, 50 - index));
    expect(mergeFeedPages(many, few)).toHaveLength(60);
    expect(mergeFeedPages(many, few, { limit: 0 })).toHaveLength(60);
    expect(mergeFeedPages(many, few, { limit: 30 })).toHaveLength(30);
  });

  it('accumulates every tap of "Show more", and an overlap at a page boundary stays one entry', () => {
    // Three successive pages of ten, the third starting one row early because a post
    // landed while the reader was scrolling: the seam must not become a duplicate.
    const page = (start) => Array.from({ length: 10 }, (_, index) => entry(`p${start + index}`, 200 - (start + index)));
    const first = page(0);
    const second = mergeFeedPages(page(10), first);
    const third = mergeFeedPages(page(19), second);
    expect(second).toHaveLength(20);
    expect(third).toHaveLength(29);
    expect(new Set(third.map((item) => item.id)).size).toBe(third.length);
    const times = third.map((item) => Date.parse(item.sortAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('survives the shapes a failure can hand it', () => {
    expect(mergeFeedPages(undefined, undefined)).toEqual([]);
    expect(mergeFeedPages([entry('a', 3)], null).map((item) => item.id)).toEqual(['a']);
  });
});

describe('the page size Home asks for', () => {
  it('is ten — a screenful per request, not a limit on the list', () => {
    expect(HOME_FEED_PAGE_SIZE).toBe(10);
    // Ten is small on purpose: the first paint costs what it always did and depth is one
    // tap each. What must not happen is asking for a page the database would round down —
    // `campus_feed()` clamps `p_limit` to at most 50, and a full page is the only signal
    // that an older one exists, so a silently-shrunken page would read as "end of feed".
    const sql = fs.readFileSync('supabase/migrations/20261005000011_011_platform.sql', 'utf8');
    const clamp = new RegExp(`limit least\\(greatest\\(coalesce\\(p_limit, \\d+\\), 1\\), (\\d+)\\)`).exec(sql);
    expect(clamp).not.toBeNull();
    expect(HOME_FEED_PAGE_SIZE).toBeLessThanOrEqual(Number(clamp[1]));
    expect(HOME_FEED_MAX_OFFSET % HOME_FEED_PAGE_SIZE).toBe(0);
    expect(HOME_FEED_MAX_OFFSET / HOME_FEED_PAGE_SIZE).toBe(50);
  });
});

/* ------------------------------------------------------------------ the route */

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

/** The rail chains the route awaits; both resolve to "nothing to show". */
function railChain() {
  const chain = {};
  for (const method of ['select', 'eq', 'gte', 'order', 'limit']) chain[method] = () => chain;
  chain.then = (resolve) => Promise.resolve({ data: [], error: null }).then(resolve);
  return chain;
}

async function fetchFeed(query = '') {
  getCurrentUser.mockResolvedValue({
    profile: { id: 'profile-1' },
    needsProfileSetup: false,
    accountStatus: 'active',
  });
  getServerClient.mockResolvedValue({ from: () => railChain() });
  const response = await GET(new Request(`https://pccoe.in/api/home/feed${query}`));
  return { status: response.status, body: await response.json(), args: getCampusFeed.mock.calls.at(-1)?.[1] };
}

const items = (count, start = 0) =>
  Array.from({ length: count }, (_, index) => entry(`p${start + index}`, 100 - (start + index)));

describe('GET /api/home/feed paging', () => {
  it('asks for one page of ten from the newest end when no offset is given', async () => {
    getCampusFeed.mockResolvedValue({ items: items(HOME_FEED_PAGE_SIZE), unavailable: false });
    const { status, body, args } = await fetchFeed();
    expect(status).toBe(200);
    expect(args).toEqual({ limit: HOME_FEED_PAGE_SIZE, offset: 0, currentProfileId: 'profile-1' });
    expect(body.page).toEqual({ limit: HOME_FEED_PAGE_SIZE, offset: 0, hasMore: true });
    expect(body.feed).toHaveLength(HOME_FEED_PAGE_SIZE);
  });

  it('stops offering a next page the moment a page comes back short', async () => {
    getCampusFeed.mockResolvedValue({ items: items(HOME_FEED_PAGE_SIZE - 3), unavailable: false });
    const { body } = await fetchFeed();
    // Seven is the feed saying it ran out, which is the only honest way to hide the control.
    expect(body.feed).toHaveLength(HOME_FEED_PAGE_SIZE - 3);
    expect(body.page.hasMore).toBe(false);
  });

  it('passes a valid offset straight through, so the reader can page back past one page', async () => {
    getCampusFeed.mockResolvedValue({ items: items(HOME_FEED_PAGE_SIZE, HOME_FEED_PAGE_SIZE), unavailable: false });
    const { body, args } = await fetchFeed(`?offset=${HOME_FEED_PAGE_SIZE}`);
    expect(args.offset).toBe(HOME_FEED_PAGE_SIZE);
    expect(body.page.offset).toBe(HOME_FEED_PAGE_SIZE);
    // A full page is the only signal that there is an older one to fetch.
    expect(body.page.hasMore).toBe(true);
  });

  it('treats a junk or negative offset as the newest page rather than an error', async () => {
    getCampusFeed.mockResolvedValue({ items: [], unavailable: false });
    for (const query of ['?offset=abc', '?offset=-30', '?offset=', '?offset=999999999999999999999']) {
      await fetchFeed(query);
      expect(getCampusFeed.mock.calls.at(-1)[1].offset).toBe(0);
    }
  });

  it('stops at the deepest offset it will serve and says so instead of lying about the end', async () => {
    getCampusFeed.mockResolvedValue({ items: items(HOME_FEED_PAGE_SIZE), unavailable: false });
    const { body, args } = await fetchFeed(`?offset=${HOME_FEED_MAX_OFFSET + 500}`);
    expect(args.offset).toBe(HOME_FEED_MAX_OFFSET);
    expect(body.page.hasMore).toBe(false);
  });

  it('keeps a database failure answering as an unavailable feed, not a 500', async () => {
    getCampusFeed.mockResolvedValue({ items: [], unavailable: true });
    const { status, body } = await fetchFeed(`?offset=${HOME_FEED_PAGE_SIZE}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, feed: [], unavailable: true });
  });
});

/* ----------------------------------------------------------------- the wiring */

describe('the Home surface around those pages', () => {
  const read = (file) => fs.readFileSync(file, 'utf8');
  const home = read('components/home/HomeFeedClient.js');

  it('merges a re-read with what is loaded instead of replacing the list', () => {
    // The refresh is the dangerous one: a live change landing while the reader is three
    // pages deep used to reset the stream to the newest ten.
    expect(home).toMatch(
      /const feedWindow = mergeFeedPages\(\s*reconcileFeed\(payload\.feed, heldEntries\(held, payload\.feed\)\),\s*readHomeFeedCache\(userId\)\?\.payload\?\.feed \|\| \[\],?\s*\);/,
    );
    expect(home).not.toMatch(/HOME_FEED_LIMIT/);
  });

  it('appends the next page and remembers it under the same rules', () => {
    const start = home.indexOf('const loadMore');
    expect(start).toBeGreaterThan(-1);
    const loadMore = home.slice(start, home.indexOf('  return (', start));
    expect(loadMore).toContain('/api/home/feed?offset=${loaded.length}');
    expect(loadMore).toContain('mergeFeedPages(loaded, payload.feed)');
    // The page boundary is the list length, not a page counter: whatever is on screen is
    // exactly how far back the reader has already read.
    expect(loadMore).toContain('const loaded = snapshot?.feed || [];');
    expect(loadMore).toContain('writeHomeFeedCache(userId, next, feedRevision())');
    // A failed page leaves the loaded entries alone — it must not fall back to page one.
    expect(loadMore).toMatch(/catch \{\s*setLoadMoreError\(true\);/);
  });

  it('offers the next page only when the server said one exists', () => {
    expect(home).toContain('const canPageBack = Boolean(snapshot?.page?.hasMore) && feed.length > 0 && !unavailable;');
    expect(home).toContain('{canPageBack ? (');
    expect(home).toContain("{loadingMore ? 'Loading more…' : 'Show more'}");
    expect(home).toContain('aria-label={`Show ${HOME_FEED_PAGE_SIZE} more entries`}');
  });

  it('never re-truncates the cached payload on the way in', () => {
    const cache = read('components/home/homeFeedCache.js');
    expect(cache).toContain('sortFeed(dedupeFeed(');
    expect(cache).not.toMatch(/slice\(|limitFeed\(|HOME_FEED_LIMIT/);
  });
});
