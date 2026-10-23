import { beforeEach, describe, expect, it } from 'vitest';

import { countCommunitiesByKind, listEvents } from '@/lib/data/campus';
import { getPostDetail } from '@/lib/data/feed';

/**
 * Query-count contracts for the reads that used to ask the same question twice.
 *
 * These assert *what the data layer sends*, not how long it takes: the number of
 * round trips and the filters that decide them. Timing lives in the perf harness
 * (docs/performance/2026-10-23-query-cache.md).
 */

const queries = [];
let tables = {};

function builder(table) {
  const state = { table, columns: null, options: {}, filters: [], ranges: null };
  const rowsFor = () => tables[table] || [];
  const filter = () => {
    let rows = rowsFor();
    for (const [column, value] of state.filters) {
      if (column === 'status') rows = rows.filter((row) => row.status === value);
      if (column === 'kind' && Array.isArray(value)) rows = rows.filter((row) => value.includes(row.kind));
      else if (column === 'kind') rows = rows.filter((row) => row.kind === value);
      if (column === 'id' && Array.isArray(value)) rows = rows.filter((row) => value.includes(row.id));
      if (column === 'id' && typeof value === 'string') rows = rows.filter((row) => row.id === value);
      if (column === 'post_id') rows = rows.filter((row) => row.post_id === value);
      if (column === 'user_id') rows = rows.filter((row) => row.user_id === value);
    }
    return rows;
  };
  const finish = () => {
    queries.push(state);
    const matched = filter();
    // PostgREST's `count` is the total matching the filter, before pagination.
    const rows = state.ranges ? matched.slice(state.ranges[0], state.ranges[1] + 1) : matched;
    return { data: rows, error: null, count: matched.length };
  };
  const api = {
    select(columns, options = {}) { state.columns = columns; state.options = options || {}; return api; },
    eq(column, value) { state.filters.push([column, value]); return api; },
    in(column, values) { state.filters.push([column, values]); return api; },
    is() { return api; },
    gte() { return api; },
    lte() { return api; },
    lt() { return api; },
    or() { return api; },
    order() { return api; },
    limit(value) { state.ranges = [0, value]; return api; },
    range(from, to) { state.ranges = [from, to]; return api; },
    maybeSingle() {
      const result = finish();
      return Promise.resolve({ ...result, data: Array.isArray(result.data) ? result.data[0] ?? null : result.data });
    },
    single() { return Promise.resolve(finish()); },
    then(resolve, reject) { return Promise.resolve(finish()).then(resolve, reject); },
  };
  return api;
}

const supabase = { from: (table) => builder(table), rpc: () => Promise.resolve({ data: null, error: null }) };

beforeEach(() => {
  queries.length = 0;
  tables = {};
});

describe('countCommunitiesByKind', () => {
  it('tallies every kind from one capped read instead of three count queries', async () => {
    tables.communities = [
      { id: 'c1', kind: 'community', status: 'published' },
      { id: 'c2', kind: 'community', status: 'published' },
      { id: 'c3', kind: 'study_group', status: 'published' },
      { id: 'c4', kind: 'club', status: 'published' },
      { id: 'c5', kind: 'club', status: 'draft' },
    ];

    const counts = await countCommunitiesByKind(supabase);

    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe('communities');
    expect(queries[0].options.head).toBeUndefined();
    expect(queries[0].filters).toContainEqual(['status', 'published']);
    expect(counts).toEqual({ communities: 2, studyGroups: 1, clubs: 1, unavailable: false });
  });

  it('is capped so a large table cannot create an unbounded response', async () => {
    await countCommunitiesByKind(supabase, { limit: 250 });
    expect(queries[0].ranges).toEqual([0, 250]);
  });
});

describe('listEvents counts', () => {
  it('returns the exact count from the same request when asked', async () => {
    tables.events = [
      { id: 'e1', status: 'published' },
      { id: 'e2', status: 'published' },
      { id: 'e3', status: 'draft' },
    ];
    const result = await listEvents(supabase, { limit: 1, withCount: true });
    expect(result.count).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(queries).toHaveLength(1);
    expect(queries[0].options).toEqual({ count: 'exact' });
  });

  it('does not ask for a count when the caller does not need one', async () => {
    const result = await listEvents(supabase, { limit: 5 });
    expect(result.count).toBeUndefined();
    expect(queries[0].options).toEqual({});
  });
});

describe('getPostDetail', () => {
  it('reads authors and reactions once each, for the post and its comments together', async () => {
    tables.posts = [
      {
        id: 'p1',
        author_id: 'u1',
        kind: 'post',
        title: 'Hello',
        body: 'World',
        status: 'published',
        reaction_count: 0,
        comment_count: 2,
      },
    ];
    tables.comments = [
      { id: 'c1', post_id: 'p1', author_id: 'u2', body: 'first', status: 'published' },
      { id: 'c2', post_id: 'p1', author_id: 'u1', body: 'second', status: 'published' },
    ];
    tables.public_profiles = [
      { id: 'u1', username: 'asha', display_name: 'Asha', is_staff: false },
      { id: 'u2', username: 'ravi', display_name: 'Ravi', is_staff: false },
    ];
    tables.reactions = [
      { target_id: 'p1', target_type: 'post', user_id: 'viewer' },
      { target_id: 'c1', target_type: 'comment', user_id: 'viewer' },
      { target_id: 'c2', target_type: 'comment', user_id: 'someone-else' },
    ];

    const detail = await getPostDetail(supabase, 'p1', { currentProfileId: 'viewer' });

    const profiles = queries.filter((query) => query.table === 'public_profiles');
    const reactions = queries.filter((query) => query.table === 'reactions');
    expect(profiles).toHaveLength(1);
    expect(reactions).toHaveLength(1);
    // One `in()` list covers the post author and both comment authors.
    expect(profiles[0].filters).toContainEqual(['id', ['u1', 'u2']]);
    expect(reactions[0].columns).toContain('target_type');

    expect(detail.post.reacted_by_me).toBe(true);
    expect(detail.comments.map((comment) => [comment.id, comment.author_username, comment.reacted_by_me])).toEqual([
      ['c1', 'ravi', true],
      ['c2', 'asha', false],
    ]);
  });

  it('returns null without reading authors when the post is not visible', async () => {
    tables.posts = [];
    tables.comments = [];
    const detail = await getPostDetail(supabase, 'missing', { currentProfileId: 'viewer' });
    expect(detail).toBeNull();
    expect(queries.some((query) => query.table === 'public_profiles')).toBe(false);
  });
});
