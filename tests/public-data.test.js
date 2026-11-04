import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behavioural tests for the anonymous discovery read layer.
 *
 * The real PostgreSQL half lives in `database/tests/21_public_discovery_rls.sql`.
 * Here the `anon` client is stubbed so we can pin the exact queries a public
 * page is allowed to issue: explicit column projections, exact slugs, the three
 * public-eligibility predicates and honest failure semantics. A cached reader
 * that accidentally asked for `created_by`, used a UUID, or stored an empty
 * result on error would fail one of these tests.
 */

const mocks = vi.hoisted(() => ({ getPublicClient: vi.fn() }));

// `unstable_cache` is a pass-through: the framework's storage is not under
// test, the query that feeds it is.
vi.mock('next/cache', () => ({ unstable_cache: (fn) => fn }));
vi.mock('@/lib/supabase/public', () => ({ getPublicClient: mocks.getPublicClient }));

const {
  listPublicClubs,
  countPublicClubsByCategory,
  listPublicClubOptions,
  getPublicClubBySlug,
  getPublicClubIdentityById,
  getPublicEventById,
  listPublicClubAnnouncements,
  mapPublicClubSlugs,
  isPubliclyListedClub,
} = await import('@/lib/data/public');
const {
  PUBLIC_CLUB_COLUMNS,
  PUBLIC_EVENT_DETAIL_COLUMNS,
  PUBLIC_CLUB_POST_COLUMNS,
} = await import('@/lib/data/public-columns');

const CLUBS = [
  { id: 'club-1', kind: 'club', name: 'Coding Club', slug: 'coding-club', description: 'A public coding club.', club_category: 'Technology', organization_type: 'technical', status: 'published', visibility: 'public', member_count: 12, admin_assigned: true, directory_aliases: 'GDSC, code' },
  { id: 'club-2', kind: 'club', name: 'Campus Only Club', slug: 'campus-only', description: 'A campus-only club.', club_category: 'Cultural', organization_type: 'cultural', status: 'published', visibility: 'campus', member_count: 4, admin_assigned: false, directory_aliases: '' },
  { id: 'club-3', kind: 'club', name: 'Draft Club', slug: 'draft-club', description: 'An unpublished club.', club_category: 'Technology', organization_type: 'technical', status: 'draft', visibility: 'public', member_count: 0, admin_assigned: false, directory_aliases: '' },
  { id: 'club-4', kind: 'community', name: 'A Community', slug: 'a-community', description: 'Not a club at all.', club_category: null, organization_type: null, status: 'published', visibility: 'public', member_count: 2, admin_assigned: false, directory_aliases: '' },
];
const EVENTS = [
  { id: 'event-1', title: 'Public meetup', description: 'Everyone welcome.', status: 'published', club_id: 'club-1', registration_url: 'https://example.org/r' },
  { id: 'event-2', title: 'Draft meetup', description: 'Under review.', status: 'draft', club_id: null },
];
const POSTS = [
  { id: 'post-1', community_id: 'club-1', title: 'Public announcement', body: 'Hello', visibility: 'public', status: 'published', kind: 'post', created_at: '2026-11-01' },
  { id: 'post-2', community_id: 'club-1', title: 'Campus announcement', body: 'Hello', visibility: 'campus', status: 'published', kind: 'post', created_at: '2026-11-01' },
];

let queries = [];
let failNext = false;
let noClient = false;

const rowsFor = {
  communities: CLUBS,
  events: EVENTS,
  posts: POSTS,
};

function builder(table) {
  const state = { table, columns: null, filters: [], ors: [], orders: [], range: null, limit: null, single: false };
  const finish = () => {
    queries.push(state);
    if (failNext) return { data: null, error: { message: 'boom' }, count: null };
    let items = (rowsFor[table] || []).filter((row) =>
      state.filters.every(([column, value]) => String(row[column]) === String(value))
    );
    if (state.range) items = items.slice(state.range[0], state.range[1] + 1);
    if (state.limit) items = items.slice(0, state.limit);
    return { data: state.single ? (items[0] || null) : items, error: null };
  };
  const api = {
    select(columns) { state.columns = columns; return api; },
    eq(column, value) { state.filters.push([column, value]); return api; },
    or(expression) { state.ors.push(expression); return api; },
    order(column, options) { state.orders.push([column, options]); return api; },
    range(from, to) { state.range = [from, to]; return api; },
    limit(value) { state.limit = value; return api; },
    maybeSingle() { state.single = true; return Promise.resolve(finish()); },
    then(resolve, reject) { return Promise.resolve(finish()).then(resolve, reject); },
  };
  return api;
}

const supabase = { from: (table) => builder(table) };

beforeEach(() => {
  queries = [];
  failNext = false;
  noClient = false;
  mocks.getPublicClient.mockImplementation(() => (noClient ? null : supabase));
});

describe('public projections', () => {
  it('never asks for administrator identity, provenance or student data', () => {
    for (const projection of [PUBLIC_CLUB_COLUMNS, PUBLIC_EVENT_DETAIL_COLUMNS, PUBLIC_CLUB_POST_COLUMNS]) {
      expect(projection).not.toMatch(/created_by|approved_by|approved_at|catalogue_key|author_id|moderated_by|moderation_reason|\*|search_vector|gif|updated_by/);
    }
    expect(PUBLIC_CLUB_COLUMNS).toContain('slug');
    expect(PUBLIC_CLUB_COLUMNS).toContain('recruitment_info');
    expect(PUBLIC_CLUB_COLUMNS).toContain('contact_info');
    expect(PUBLIC_EVENT_DETAIL_COLUMNS).toContain('registration_url');
    expect(PUBLIC_EVENT_DETAIL_COLUMNS).toContain('organizer');
  });

  it('defines public eligibility from the row, not from the viewer', () => {
    expect(isPubliclyListedClub(CLUBS[0])).toBe(true);
    expect(isPubliclyListedClub(CLUBS[1])).toBe(false);
    expect(isPubliclyListedClub(CLUBS[2])).toBe(false);
    expect(isPubliclyListedClub(CLUBS[3])).toBe(false);
    expect(isPubliclyListedClub(null)).toBe(false);
  });
});

describe('listPublicClubs', () => {
  it('pins club kind, published status and public visibility in one explicit projection', async () => {
    const result = await listPublicClubs();
    expect(result.unavailable).toBe(false);
    expect(result.items.map((row) => row.slug)).toEqual(['coding-club']);
    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe('communities');
    expect(queries[0].columns).toBe(PUBLIC_CLUB_COLUMNS);
    expect(queries[0].filters).toContainEqual(['kind', 'club']);
    expect(queries[0].filters).toContainEqual(['status', 'published']);
    expect(queries[0].filters).toContainEqual(['visibility', 'public']);
  });

  it('sanitises PostgREST or= syntax out of a search term', async () => {
    await listPublicClubs({ q: 'robotics,foo)(bar*' });
    expect(queries[0].ors).toHaveLength(1);
    const expression = queries[0].ors[0];
    expect(expression).not.toMatch(/,foo|\)\(|bar\*/);
    expect(expression).toContain('directory_aliases.ilike');
    expect(expression).toContain('club_category.ilike');
  });

  it('keeps category, organization type, sort and pagination in the cache key', async () => {
    await listPublicClubs({ category: 'Technology', organizationType: 'technical', order: 'name', limit: 20, offset: 40 });
    expect(queries[0].filters).toContainEqual(['club_category', 'Technology']);
    expect(queries[0].filters).toContainEqual(['organization_type', 'technical']);
    expect(queries[0].orders[0][0]).toBe('name');
    expect(queries[0].range).toEqual([40, 59]);
  });

  it('reports a failed read as unavailable instead of caching an empty result', async () => {
    failNext = true;
    expect(await listPublicClubs()).toEqual({ items: [], unavailable: true });
    failNext = false;
    expect((await listPublicClubs()).items).toHaveLength(1);
  });

  it('reports a missing Supabase configuration as unavailable', async () => {
    noClient = true;
    expect(await listPublicClubs()).toEqual({ items: [], unavailable: true });
  });
});

describe('single-record public reads', () => {
  it('looks a club up by EXACT slug, never by UUID and never by name', async () => {
    const { item, unavailable } = await getPublicClubBySlug('coding-club');
    expect(unavailable).toBe(false);
    expect(item.slug).toBe('coding-club');
    expect(queries[0].filters).toContainEqual(['slug', 'coding-club']);
    expect(queries[0].columns).toBe(PUBLIC_CLUB_COLUMNS);
    expect(queries[0].single).toBe(true);
  });

  it('returns a real not-found signal for an unknown or non-public slug', async () => {
    expect((await getPublicClubBySlug('campus-only')).item).toBeNull();
    expect((await getPublicClubBySlug('not-a-club')).item).toBeNull();
  });

  it('resolves a UUID to the stored slug only for the legacy redirect', async () => {
    const { item } = await getPublicClubIdentityById('club-1');
    expect(item.slug).toBe('coding-club');
    expect(queries[0].columns).toContain('slug');
    expect(queries[0].filters).toContainEqual(['id', 'club-1']);
  });

  it('reads one published event with the public detail projection', async () => {
    const { item } = await getPublicEventById('event-1');
    expect(item.title).toBe('Public meetup');
    expect(queries[0].filters).toContainEqual(['status', 'published']);
    expect(queries[0].columns).toBe(PUBLIC_EVENT_DETAIL_COLUMNS);
    expect(queries[0].single).toBe(true);
    expect((await getPublicEventById('event-2')).item).toBeNull();
  });

  it('asks only for posts explicitly marked public inside a public club', async () => {
    const result = await listPublicClubAnnouncements('club-1');
    expect(result.items.map((row) => row.id)).toEqual(['post-1']);
    expect(queries[0].columns).toBe(PUBLIC_CLUB_POST_COLUMNS);
    expect(queries[0].filters).toContainEqual(['visibility', 'public']);
    expect(queries[0].filters).toContainEqual(['status', 'published']);
    expect(queries[0].filters).toContainEqual(['community_id', 'club-1']);
  });

  it('builds an id → slug map for event cards from one catalogue read', async () => {
    const map = await mapPublicClubSlugs();
    expect(map.get('club-1').slug).toBe('coding-club');
    expect(map.has('club-2')).toBe(false);
    expect(queries).toHaveLength(1);
  });
});

describe('directory counts and filter options', () => {
  it('counts public clubs per category without a second private read', async () => {
    const result = await countPublicClubsByCategory();
    expect(result.total).toBe(1);
    expect(result.counts.Technology).toBe(1);
    expect(queries[0].filters).toContainEqual(['visibility', 'public']);
  });

  it('exposes only id and name as public club filter options', async () => {
    const result = await listPublicClubOptions();
    expect(result.items).toHaveLength(1);
    expect(queries[0].columns).toBe('id, name');
  });
});
