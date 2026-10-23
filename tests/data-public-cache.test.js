import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The public cache boundary.
 *
 * These tests pin the two properties that make `lib/data/public-cache.js` safe:
 *
 *   1. every read is pinned to `status = 'published'`, so a draft or a
 *      staff-only row can never enter a shared entry;
 *   2. a failed read is surfaced as `unavailable` and is never stored as a
 *      successful empty result for the next student.
 *
 * The cache itself is replaced with a pass-through: the framework's storage is
 * not what is under test here, the query that feeds it is.
 */

const queries = [];
let tableRows = {};
let failNext = false;

function builder(table) {
  const state = { table, columns: null, options: {}, filters: [], ranges: null };
  const finish = () => {
    queries.push(state);
    if (failNext) return { data: null, error: { message: 'boom' }, count: null };
    const rows = tableRows[table] || [];
    const items = rows.filter((row) =>
      state.filters.every(([column, value]) => {
        if (column === 'status') return row.status === value;
        if (column === 'kind') return row.kind === value;
        return true;
      }),
    );
    return { data: items, error: null, count: items.length };
  };
  const api = {
    select(columns, options = {}) {
      state.columns = columns;
      state.options = options || {};
      return api;
    },
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
    maybeSingle() { return Promise.resolve(finish()); },
    single() { return Promise.resolve(finish()); },
    then(resolve, reject) { return Promise.resolve(finish()).then(resolve, reject); },
  };
  return api;
}

const supabase = {
  from(table) { return builder(table); },
  rpc() { return Promise.resolve({ data: null, error: null }); },
};

vi.mock('next/cache', () => ({
  // Run the cached function directly; storage/expiry is the framework's job.
  unstable_cache: (fn) => fn,
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => supabase,
}));

const { PUBLIC_REVALIDATE_SECONDS, PUBLIC_TAGS, listPublishedEvents, listPublishedNotices } =
  await import('@/lib/data/public-cache');

beforeEach(() => {
  queries.length = 0;
  failNext = false;
  tableRows = {
    notices: [
      { id: 'n1', status: 'published', title: 'Fee deadline' },
      { id: 'n2', status: 'draft', title: 'Unreviewed draft' },
    ],
    events: [
      { id: 'e1', status: 'published', title: 'Hackathon' },
      { id: 'e2', status: 'draft', title: 'Submitted for review' },
    ],
  };
});

describe('public cache boundary', () => {
  it('uses a short revalidation window and one tag per table', () => {
    expect(PUBLIC_REVALIDATE_SECONDS).toBeGreaterThanOrEqual(30);
    expect(PUBLIC_REVALIDATE_SECONDS).toBeLessThanOrEqual(120);
    expect(PUBLIC_TAGS).toEqual({ notices: 'public:notices', events: 'public:events' });
  });

  it('only ever asks for published notices', async () => {
    const result = await listPublishedNotices({ limit: 5 });
    expect(result.unavailable).toBe(false);
    expect(result.items.map((row) => row.id)).toEqual(['n1']);
    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe('notices');
    expect(queries[0].filters).toContainEqual(['status', 'published']);
    // No viewer-specific column can enter a shared entry.
    expect(queries[0].columns).not.toMatch(/reacted_by_me|mine|viewer/);
  });

  it('only ever asks for published events, and forwards withCount', async () => {
    const result = await listPublishedEvents({ limit: 5, withCount: true });
    expect(result.items.map((row) => row.id)).toEqual(['e1']);
    expect(result.count).toBe(1);
    expect(queries).toHaveLength(1);
    expect(queries[0].filters).toContainEqual(['status', 'published']);
    expect(queries[0].options).toEqual({ count: 'exact' });
  });

  it('reports an unreadable list as unavailable instead of caching an empty one', async () => {
    failNext = true;
    await expect(listPublishedNotices()).resolves.toEqual({ items: [], unavailable: true });
    await expect(listPublishedEvents()).resolves.toEqual({ items: [], unavailable: true });
    // The failure was raised, not stored, so the next call reaches the database.
    queries.length = 0;
    failNext = false;
    const recovered = await listPublishedNotices();
    expect(recovered.items).toHaveLength(1);
    expect(queries).toHaveLength(1);
  });
});

describe('cache invalidation', () => {
  /**
   * Source-level guard: a write that changes a cached public table must drop
   * that table's tag in the same action, or students keep seeing the old list
   * for up to a revalidation window. Parsing the action bodies keeps this
   * honest without standing up a server action runner.
   */
  it('every notice and event write revalidates its own tag', async () => {
    const source = await readFile(new URL('../lib/actions/campus.js', import.meta.url), 'utf8');
    const actions = {
      saveEvent: 'events',
      publishEventSubmission: 'events',
      rejectEventSubmission: 'events',
      withdrawEventSubmission: 'events',
      saveNotice: 'notices',
    };

    for (const [name, tag] of Object.entries(actions)) {
      const start = source.indexOf(`export async function ${name}(`);
      expect(start, `${name} is missing`).toBeGreaterThan(-1);
      const next = source.indexOf('export async function ', start + 1);
      const body = source.slice(start, next === -1 ? undefined : next);
      expect(body, `${name} must revalidate PUBLIC_TAGS.${tag}`).toContain(`revalidateTag(PUBLIC_TAGS.${tag})`);
    }
  });
});
