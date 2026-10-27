import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The write path behind "my post is on the feed".
 *
 * These pin the four things the stale-feed bug actually came from:
 *
 *   1. a successful insert hands back the **canonical record**, read with the very
 *      columns and hydration a list uses — `{ ok: true, id }` gave a surface
 *      nothing it could show, which is why nothing appeared until a reload;
 *   2. invalidation runs **after** the write and covers every surface that lists
 *      posts, not only Home and Explore;
 *   3. a write that the database did not *publish* is reported as what it is, with
 *      no record handed to any feed;
 *   4. a failed write returns no record, invalidates nothing, and does not pretend
 *      otherwise.
 *
 * `getCampusFeed` is in here too, because that is where Home used to drop the
 * viewer id — the reason a home card could never show "you reacted" or "your vote".
 */

const mocks = vi.hoisted(() => ({
  getActiveUser: vi.fn(),
  getServerClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  notify: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/auth/session', () => ({ getActiveUser: mocks.getActiveUser }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: mocks.getServerClient }));
vi.mock('@/lib/ratelimit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));
vi.mock('@/lib/notifications', () => ({ notify: mocks.notify }));

const { createPost, deletePost } = await import('@/lib/actions/social');
const { getCampusFeed, POST_COLUMNS } = await import('@/lib/data/feed');
const { HOME_FEED_PAGE_SIZE, PAGE_SIZE } = await import('@/lib/constants');

const AUTHOR = '15fe0000-0000-4000-a000-000000000001';
const POST_ID = '15fe0000-0000-4000-b000-000000000001';
const COMMUNITY_ID = '15fe0000-0000-4000-c000-000000000001';

/** The row a real insert returns: `created_at` and counters come from the database. */
function postRow(overrides = {}) {
  return {
    id: POST_ID,
    author_id: AUTHOR,
    kind: 'post',
    title: null,
    body: 'The lab 3 projector is fixed.',
    gif: null,
    community_id: null,
    status: 'published',
    is_official: false,
    comment_count: 0,
    reaction_count: 0,
    created_at: '2026-10-25T06:30:00.000Z',
    ...overrides,
  };
}

/**
 * A Supabase-shaped fake that records every query it is asked to run, so a test can
 * assert on the *shape* of the reads (columns, filters) rather than on internals.
 */
function fakeSupabase({
  post = postRow(),
  insertError = null,
  written = post,
  optionError = null,
  authors = [{ id: AUTHOR, username: 'feed_asha', display_name: 'Feed Asha', is_staff: false }],
  reactions = [],
  polls = [],
  options = [],
  votes = [],
} = {}) {
  const state = { sequence: [], queries: [], rpcs: [] };
  const tableState = {
    public_profiles: authors,
    reactions,
    posts: polls,
    poll_options: options,
    poll_votes: votes,
  };

  function builder(table) {
    const query = { table, method: null, columns: null, filters: [], orders: [], payload: null };
    state.queries.push(query);

    const finish = ({ single = false } = {}) => {
      state.sequence.push(`${query.method || 'select'}:${table}`);
      if (table === 'posts' && query.method === 'insert') {
        if (insertError) return { data: null, error: insertError };
        // `written: null` models a write endpoint that answers 201 with no body:
        // the row landed, the representation is just not coming back.
        if (written === null) return single ? { data: null, error: null } : { data: [], error: null };
        return single ? { data: post, error: null } : { data: [post], error: null };
      }
      // The read-back-by-id lookup (a string `eq`), as opposed to a poll read
      // (`.in('id', ids)`) or any other select.
      if (table === 'posts' && query.method === 'select'
        && query.filters.some(([column, value]) => column === 'id' && typeof value === 'string')) {
        return { data: single ? post : [post], error: null };
      }
      if (table === 'poll_options' && query.method === 'insert') {
        return { data: null, error: optionError };
      }
      const rows = tableState[table] || [];
      return single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
    };

    const api = {
      select(columns) {
        // `.insert(row).select(cols).single()` is one builder in supabase-js: the
        // write is still the method, the select only asks for it to come back.
        query.method = query.method || 'select';
        query.columns = columns;
        return api;
      },
      insert(payload) {
        query.method = 'insert';
        query.payload = payload;
        return api;
      },
      eq(column, value) {
        query.filters.push([column, value]);
        return api;
      },
      in(column, values) {
        query.filters.push([column, values]);
        return api;
      },
      order(column, options2) {
        query.orders.push([column, options2?.ascending]);
        return api;
      },
      single() {
        return finish({ single: true });
      },
      maybeSingle() {
        return finish({ single: true });
      },
      then(resolve, reject) {
        return Promise.resolve(finish()).then(resolve, reject);
      },
    };
    return api;
  }

  return {
    state,
    from: (table) => builder(table),
    rpc: async (name, args) => {
      state.rpcs.push([name, args]);
      state.sequence.push(`rpc:${name}`);
      if (name === 'record_mentions') return { data: [], error: null };
      return { data: { ok: true }, error: null };
    },
  };
}

function form(values = {}) {
  const data = new FormData();
  data.set('kind', values.kind || 'post');
  if (values.title) data.set('title', values.title);
  data.set('body', values.body ?? 'The lab 3 projector is fixed.');
  if (values.communityId) data.set('community_id', values.communityId);
  for (const option of values.options || []) data.append('poll_options', option);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveUser.mockResolvedValue({
    profile: { id: AUTHOR, username: 'feed_asha', display_name: 'Feed Asha' },
  });
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  mocks.notify.mockResolvedValue({ ok: true });
  mocks.revalidatePath.mockImplementation(() => {});
});

  it('reads the row back by id when the write endpoint returns no representation', async () => {
    // A fronted PostgREST can answer 201 with an empty body. The post *landed*, so
    // reporting failure would be a lie of the opposite kind — and a client-built
    // placeholder would be a worse one. The action re-reads the canonical row.
    const supabase = fakeSupabase({ written: null });
    mocks.getServerClient.mockResolvedValue(supabase);

    const result = await createPost(form());

    expect(result.ok).toBe(true);
    expect(result.published).toBe(true);
    expect(result.post.id).toBe(POST_ID);
    expect(result.post.created_at).toBe('2026-10-25T06:30:00.000Z');
    expect(result.post.author_username).toBe('feed_asha');
    const readBack = supabase.state.queries.find(
      (query) => query.table === 'posts' && query.method === 'select',
    );
    expect(readBack.columns).toBe(POST_COLUMNS);
    expect(readBack.filters).toContainEqual(['id', expect.any(String)]);
    // The id the write was handed is the id the read asked for: one row, one source.
    const writeQuery = supabase.state.queries.find((query) => query.method === 'insert');
    expect(writeQuery.payload.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(readBack.filters.find(([column]) => column === 'id')[1]).toBe(writeQuery.payload.id);
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

describe('createPost returns the canonical record a feed can render', () => {
  it('reads the row back with the list columns and hydrates it for this viewer', async () => {
    const supabase = fakeSupabase();
    mocks.getServerClient.mockResolvedValue(supabase);

    const result = await createPost(form());

    expect(result.ok).toBe(true);
    expect(result.published).toBe(true);
    expect(result.post).toBeTruthy();
    // The same column set `getPostsByIds`/`getCommunityPosts` list with, so the
    // card a surface builds from this record is not a thinner version of the ones
    // already on screen.
    expect(supabase.state.queries.find((q) => q.table === 'posts' && q.method === 'insert').columns)
      .toBe(POST_COLUMNS);
    expect(result.post).toMatchObject({
      id: POST_ID,
      author_id: AUTHOR,
      kind: 'post',
      status: 'published',
      body: 'The lab 3 projector is fixed.',
      comment_count: 0,
      reaction_count: 0,
      // Timestamp from the database, not the client clock.
      created_at: '2026-10-25T06:30:00.000Z',
      // Hydrated author block, exactly as a list read would produce it.
      author_username: 'feed_asha',
      author_display_name: 'Feed Asha',
      author_is_staff: false,
      reacted_by_me: false,
      poll: null,
    });
  });

  it('carries a poll through with its options, in position order, like the feed reads them', async () => {
    const supabase = fakeSupabase({
      post: postRow({ kind: 'poll', title: 'Which slot?', body: 'Which slot?' }),
      polls: [{ id: POST_ID, poll_closes_at: '2026-10-26T06:30:00.000Z' }],
      options: [
        { id: 'o1', post_id: POST_ID, label: 'Monday', position: 0, vote_count: 0 },
        { id: 'o2', post_id: POST_ID, label: 'Thursday', position: 1, vote_count: 0 },
      ],
    });
    mocks.getServerClient.mockResolvedValue(supabase);

    const result = await createPost(form({
      kind: 'poll',
      title: 'Which slot?',
      body: '',
      options: ['Monday', 'Thursday'],
    }));

    expect(result.ok).toBe(true);
    expect(result.post.poll).toMatchObject({ closes_at: '2026-10-26T06:30:00.000Z' });
    expect(result.post.poll.options.map((option) => option.label)).toEqual(['Monday', 'Thursday']);
    expect(result.post.poll.options.every((option) => option.mine === false)).toBe(true);
  });

  it('invalidates every post surface after the write, never before it', async () => {
    const supabase = fakeSupabase();
    mocks.getServerClient.mockResolvedValue(supabase);
    // Every invalidation is stamped onto the same tape as the writes, so "after" is
    // an observed order rather than a reading of the source.
    mocks.revalidatePath.mockImplementation((path) => {
      supabase.state.sequence.push(`revalidate:${path}`);
    });

    await createPost(form());

    const paths = [...new Set(mocks.revalidatePath.mock.calls.map(([path]) => path))];
    // Home and Explore are exact paths; the boards that list posts under a dynamic
    // segment are invalidated as pages, and the author's own profile too.
    expect(paths).toEqual([
      '/home',
      '/explore',
      '/profile',
      '/communities/[slug]',
      '/clubs/[id]',
      '/user/[username]',
      // and the author's own permalink, for the exact post that changed
      `/post/${POST_ID}`,
    ]);

    const tape = supabase.state.sequence;
    const insertAt = tape.indexOf('insert:posts');
    const firstRevalidation = tape.findIndex((entry) => entry.startsWith('revalidate:'));
    expect(insertAt).toBeGreaterThanOrEqual(0);
    // Invalidating before the insert would let a re-read capture a snapshot that
    // cannot possibly contain the new post, and that is exactly the stale feed.
    expect(firstRevalidation).toBeGreaterThan(insertAt);
    // Mentions are resolved first too, so the page a revalidation produces already
    // accounts for the rows the write queued.
    expect(tape.indexOf('rpc:record_mentions')).toBeLessThan(firstRevalidation);
  });

  it('reports a row the database did not publish as pending, and hands no record to any feed', async () => {
    const supabase = fakeSupabase({ post: postRow({ status: 'pending' }) });
    mocks.getServerClient.mockResolvedValue(supabase);

    const result = await createPost(form());

    // Success, but *not* publication: the author is told the truth, and the shape a
    // surface would insert into a public feed is absent by construction.
    expect(result.ok).toBe(true);
    expect(result.published).toBe(false);
    expect(result.pending).toBe(true);
    expect(result.status).toBe('pending');
    expect(result.post).toBeNull();
    // A row that is not in any public feed must not invalidate the permalink either.
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).not.toContain(`/post/${POST_ID}`);
  });

  it('does not report success, and invalidates nothing, when the insert is refused', async () => {
    const supabase = fakeSupabase({ insertError: { code: '42501', message: 'rls' } });
    mocks.getServerClient.mockResolvedValue(supabase);

    const result = await createPost(form({ communityId: COMMUNITY_ID }));

    expect(result.ok).toBe(false);
    expect(result.post).toBeUndefined();
    expect(result.id).toBeUndefined();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('rolls a poll back and reports failure when its options cannot be saved', async () => {
    const supabase = fakeSupabase({ optionError: { code: '23505', message: 'dup' } });
    mocks.getServerClient.mockResolvedValue(supabase);

    const result = await createPost(form({ kind: 'poll', title: 'Which slot?', body: '', options: ['Monday', 'Thursday'] }));

    expect(result.ok).toBe(false);
    expect(result.post).toBeUndefined();
    // The half-written poll is removed through the audited path, not left published
    // with no options — and no feed is told about it.
    expect(supabase.state.rpcs.map(([name]) => name)).toContain('delete_own_content');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects an empty post before touching the database', async () => {
    const supabase = fakeSupabase();
    mocks.getServerClient.mockResolvedValue(supabase);

    const result = await createPost(form({ body: '   ' }));

    expect(result.ok).toBe(false);
    // Nothing was written, so nothing was asked for and nothing was invalidated.
    expect(supabase.state.sequence).toEqual([]);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('deletePost invalidates the surfaces that were showing the row', () => {
  it('revalidates the feed and the permalink after the audited soft delete', async () => {
    const supabase = fakeSupabase();
    mocks.getServerClient.mockResolvedValue(supabase);
    const data = new FormData();
    data.set('id', POST_ID);

    const result = await deletePost(data);

    expect(result).toEqual({ ok: true });
    const paths = mocks.revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toContain('/home');
    expect(paths).toContain(`/post/${POST_ID}`);
    expect(supabase.state.rpcs.map(([name]) => name)).toContain('delete_own_content');
  });
});

describe('getCampusFeed hydrates for the viewer it was given', () => {
  const FEED_ROW = {
    item_type: 'post',
    id: POST_ID,
    title: null,
    body: 'The lab 3 projector is fixed.',
    gif: null,
    author_username: 'feed_asha',
    author_display_name: 'Feed Asha',
    is_official: false,
    community_slug: null,
    meta: { kind: 'post', reaction_count: 1, comment_count: 0, pinned: false },
    created_at: '2026-10-25T06:30:00.000Z',
    sort_at: '2026-10-25T06:30:00.000Z',
  };

  /** The rows `campus_feed()` would return, plus whatever the hydration reads ask for. */
  function feedClient({ reactions = [] } = {}) {
    const queries = [];
    const tables = {
      posts: [{
        id: POST_ID,
        author_id: AUTHOR,
        kind: 'post',
        title: null,
        body: FEED_ROW.body,
        gif: null,
        community_id: null,
        status: 'published',
        is_official: false,
        comment_count: 0,
        reaction_count: 1,
        created_at: FEED_ROW.created_at,
      }],
      public_profiles: [{ id: AUTHOR, username: 'feed_asha', display_name: 'Feed Asha', is_staff: false }],
      reactions,
      poll_options: [],
      poll_votes: [],
    };
    return {
      queries,
      from(table) {
        const query = { table, filters: [], columns: null };
        queries.push(query);
        const api = {
          select(columns) {
            query.columns = columns;
            return api;
          },
          eq(column, value) {
            query.filters.push([column, value]);
            return api;
          },
          in(column, values) {
            query.filters.push([column, values]);
            return api;
          },
          order() { return api; },
          then(resolve) {
            // A poll-specific read (`id, poll_closes_at`) matches nothing here: this
            // entry is a plain post, and the reaction read is the point.
            const rows = query.columns?.includes('poll_closes_at') ? [] : tables[table] || [];
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          },
        };
        return api;
      },
      rpc: async () => ({ data: [FEED_ROW], error: null }),
    };
  }

  it("asks for the viewer's own reactions instead of assuming none", async () => {
    const client = feedClient({ reactions: [{ target_id: POST_ID }] });
    const { items } = await getCampusFeed(client, { limit: 10, currentProfileId: AUTHOR });

    const reactionQuery = client.queries.find((query) => query.table === 'reactions');
    expect(reactionQuery).toBeTruthy();
    expect(reactionQuery.filters).toContainEqual(['user_id', AUTHOR]);
    // Without this the home stream can never show "you reacted", which is part of why
    // a freshly rendered post looked different from the same post loaded normally.
    expect(items[0].post.reacted_by_me).toBe(true);
  });

  it('hydrates the post it returns through the shared list path', async () => {
    const client = feedClient();
    const { items } = await getCampusFeed(client, { limit: 10, currentProfileId: AUTHOR });

    expect(items[0].post).toMatchObject({
      id: POST_ID,
      author_username: 'feed_asha',
      reacted_by_me: false,
    });
    expect(items[0].post).toBeTruthy();
  });
});

/**
 * Home asks `campus_feed()` for a page, not for a fixed window, so the argument that
 * reaches the database is the whole of Home's depth per request. Pinned here because the
 * number is agreed in three places at once: `HOME_FEED_PAGE_SIZE`, the SQL clamp inside
 * `campus_feed()`, and the "there is an older page" rule the route reports off it.
 */
describe('the page Home asks the database for', () => {
  it('passes the page size and offset through as p_limit and p_offset', async () => {
    const calls = [];
    const client = {
      rpc: async (name, args) => {
        calls.push([name, args]);
        return { data: [], error: null };
      },
    };

    await getCampusFeed(client, { limit: HOME_FEED_PAGE_SIZE, offset: HOME_FEED_PAGE_SIZE, currentProfileId: AUTHOR });

    expect(calls[0][0]).toBe('campus_feed');
    expect(calls[0][1]).toEqual({ p_limit: HOME_FEED_PAGE_SIZE, p_offset: HOME_FEED_PAGE_SIZE, p_sort: 'newest' });
    // Nothing to hydrate, so nothing else was read: one page of ids is also the bound on
    // the follow-up `in (...)` list, which keeps the request URL bounded as pages grow.
    expect(calls).toHaveLength(1);
  });

  it('keeps the default at one page of the feed for callers that ask for nothing', async () => {
    const calls = [];
    const client = { rpc: async (name, args) => { calls.push(args); return { data: [], error: null }; } };
    await getCampusFeed(client);
    // `PAGE_SIZE.feed` (20) is Explore's default; Home overrides it. The distinction is the
    // reason the cap could not be removed by simply dropping the argument.
    expect(calls[0].p_limit).toBe(PAGE_SIZE.feed);
    expect(calls[0].p_offset).toBe(0);
  });
});
