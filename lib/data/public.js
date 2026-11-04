import 'server-only';

/**
 * The anonymous discovery read layer.
 *
 * Every query in this module runs through `getPublicClient()` — the publishable
 * key with NO session — so it is always evaluated as PostgreSQL's `anon` role.
 * Migration 041 is the other half of the contract: anon holds column-level
 * SELECT on a short allow-list, plus three narrowly scoped SELECT policies.
 * A query that asks for a column outside that list fails closed at the database.
 *
 * Nothing here is viewer-specific. Membership, RSVP, attendee and moderation
 * reads live in `lib/data/campus.js` / `lib/data/clubs.js` and are called with
 * the session-aware client from pages, never from a shared cache entry.
 *
 * All list responses use the same `{ items, unavailable }` contract as the rest
 * of the data layer; single-record reads use `{ item, unavailable }` so a
 * transient database error is not mistaken for a 404.
 */

import { unstable_cache } from 'next/cache';
import { getPublicClient } from '@/lib/supabase/public';
import { UUID_REGEX } from '@/lib/constants';
import { PUBLIC_REVALIDATE_SECONDS, PUBLIC_TAGS } from '@/lib/data/public-tags';
import {
  PUBLIC_CLUB_COLUMNS,
  PUBLIC_CLUB_IDENTITY_COLUMNS,
  PUBLIC_CLUB_POST_COLUMNS,
  PUBLIC_EVENT_DETAIL_COLUMNS,
} from '@/lib/data/public-columns';

const LIST_UNAVAILABLE = Object.freeze({ items: [], unavailable: true });
const ITEM_UNAVAILABLE = Object.freeze({ item: null, unavailable: true });

/**
 * The single, explicit definition of "publicly listed club".
 *
 * `visibility = 'public'` is the deliberate opt-in for open-web listing (see
 * migration 041 and docs/PUBLIC-DISCOVERY.md). `campus`, `community` and
 * `private` communities keep their existing boundary: anon has no policy that
 * can return them, even if a page accidentally asks.
 */
export function isPubliclyListedClub(club) {
  return Boolean(
    club &&
    club.kind === 'club' &&
    club.status === 'published' &&
    club.visibility === 'public',
  );
}

function client() {
  const supabase = getPublicClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

/** Every public club query is pinned to these three predicates. */
function clubScope(query) {
  return query
    .eq('kind', 'club')
    .eq('status', 'published')
    .eq('visibility', 'public');
}

const cachedClubs = unstable_cache(
  async (q, category, organizationType, order, limit, offset, hasRecruitment) => {
    const supabase = client();
    let query = clubScope(
      supabase.from('communities').select(PUBLIC_CLUB_COLUMNS),
    );
    if (category) query = query.eq('club_category', category);
    if (organizationType) query = query.eq('organization_type', organizationType);
    if (hasRecruitment) query = query.not('recruitment_info', 'is', null).neq('recruitment_info', '');
    if (q) {
      // PostgREST's `or=` splits on commas; strip the syntax characters from
      // the term so user input can never alter the filter expression.
      const term = String(q).replace(/[,()*%]/g, ' ').trim().slice(0, 60);
      if (term) {
        const pattern = `%${term}%`;
        query = query.or(`name.ilike.${pattern},description.ilike.${pattern},club_category.ilike.${pattern},directory_aliases.ilike.${pattern}`);
      }
    }
    if (order === 'newest') query = query.order('created_at', { ascending: false });
    else if (order === 'name') query = query.order('name', { ascending: true }).order('id', { ascending: true });
    else if (order === 'attention') query = query.order('admin_assigned', { ascending: true }).order('name', { ascending: true });
    else query = query.order('member_count', { ascending: false }).order('name', { ascending: true });
    const { data, error } = await query.range(offset, offset + Math.max(0, limit - 1));
    if (error) throw new Error('The public club directory is unavailable.');
    return { items: data || [], unavailable: false };
  },
  ['public:clubs:list'],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_TAGS.clubs] },
);

/**
 * The public club catalogue. Search covers names, descriptions, discovery
 * categories and the reconciled `directory_aliases` (so "GDSC" finds GDG).
 */
export async function listPublicClubs({
  q = null,
  category = null,
  organizationType = null,
  order = 'members',
  limit = 500,
  offset = 0,
  hasRecruitment = false,
} = {}) {
  try {
    return await cachedClubs(q || null, category || null, organizationType || null, order, limit, offset, Boolean(hasRecruitment));
  } catch {
    return LIST_UNAVAILABLE;
  }
}

const cachedClubCounts = unstable_cache(
  async () => {
    const supabase = client();
    const { data, error } = await clubScope(
      supabase.from('communities').select('club_category'),
    ).limit(500);
    if (error) throw new Error('The public club directory is unavailable.');
    const counts = {};
    for (const row of data || []) {
      const key = row.club_category || 'Uncategorised';
      counts[key] = (counts[key] || 0) + 1;
    }
    return { counts, total: (data || []).length, unavailable: false };
  },
  ['public:clubs:counts'],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_TAGS.clubs] },
);

export async function countPublicClubsByCategory() {
  try {
    return await cachedClubCounts();
  } catch {
    return { counts: {}, total: 0, unavailable: true };
  }
}

const cachedClubOptions = unstable_cache(
  async () => {
    const supabase = client();
    const { data, error } = await clubScope(
      supabase.from('communities').select('id, name'),
    ).order('name', { ascending: true }).limit(100);
    if (error) throw new Error('The public club directory is unavailable.');
    return { items: data || [], unavailable: false };
  },
  ['public:clubs:options'],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_TAGS.clubs] },
);

/** Club filter options for the public event directory (id + name only). */
export async function listPublicClubOptions() {
  try {
    return await cachedClubOptions();
  } catch {
    return LIST_UNAVAILABLE;
  }
}

const cachedClubBySlug = unstable_cache(
  async (slug) => {
    const supabase = client();
    // Exact slug: no UUID lookup, no lowercasing, no fuzzy match. `slug` is
    // validated against the database's own lowercase constraint by the caller.
    const { data, error } = await clubScope(
      supabase.from('communities').select(PUBLIC_CLUB_COLUMNS).eq('slug', slug),
    ).maybeSingle();
    if (error) throw new Error('That club could not be read.');
    return { item: data || null, unavailable: false };
  },
  ['public:clubs:by-slug'],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_TAGS.clubs] },
);

export async function getPublicClubBySlug(slug) {
  try {
    return await cachedClubBySlug(slug);
  } catch {
    return ITEM_UNAVAILABLE;
  }
}

/**
 * id → public club record for the published event list. Built from the same
 * cached catalogue read as the directory, so event cards can link to
 * `/c/<slug>` without an N+1 of UUID lookups.
 */
export async function mapPublicClubSlugs() {
  const { items } = await listPublicClubs({ limit: 500 });
  return new Map(items.map((club) => [club.id, club]));
}

// One bounded anonymous query for event hosts, never a per-card lookup.
const cachedClubIdentities = unstable_cache(
  async (ids) => {
    const { data, error } = await clubScope(
      client().from('communities').select(PUBLIC_CLUB_IDENTITY_COLUMNS),
    ).in('id', ids);
    if (error) throw new Error('Public club identities are unavailable.');
    return { items: data || [], unavailable: false };
  },
  ['public:clubs:identities'],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_TAGS.clubs] },
);

export async function getPublicClubIdentities(ids) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && UUID_REGEX.test(id)))].sort().slice(0, 30);
  if (!unique.length) return { items: [], unavailable: false };
  try {
    return await cachedClubIdentities(unique);
  } catch {
    return LIST_UNAVAILABLE;
  }
}

const cachedClubIdentityById = unstable_cache(
  async (id) => {
    const supabase = client();
    const { data, error } = await clubScope(
      supabase.from('communities').select(PUBLIC_CLUB_IDENTITY_COLUMNS).eq('id', id),
    ).maybeSingle();
    if (error) throw new Error('That club could not be read.');
    return { item: data || null, unavailable: false };
  },
  ['public:clubs:by-id'],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_TAGS.clubs] },
);

/** UUID → stored slug, for the permanent legacy-link redirect and club links. */
export async function getPublicClubIdentityById(id) {
  try {
    return await cachedClubIdentityById(id);
  } catch {
    return ITEM_UNAVAILABLE;
  }
}

const cachedEventById = unstable_cache(
  async (id) => {
    const supabase = client();
    const { data, error } = await supabase
      .from('events')
      .select(PUBLIC_EVENT_DETAIL_COLUMNS)
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle();
    if (error) throw new Error('That event could not be read.');
    return { item: data || null, unavailable: false };
  },
  ['public:events:by-id'],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_TAGS.events] },
);

/** One published event, using the anonymous public projection. */
export async function getPublicEventById(id) {
  try {
    return await cachedEventById(id);
  } catch {
    return ITEM_UNAVAILABLE;
  }
}

const cachedClubPosts = unstable_cache(
  async (clubId, limit) => {
    const supabase = client();
    // Only posts explicitly marked `visibility = 'public'` inside a published,
    // publicly listed club. The anon policy (migration 041) is the authority;
    // the explicit predicate here is defence in depth, not a second rule.
    const { data, error } = await supabase
      .from('posts')
      .select(PUBLIC_CLUB_POST_COLUMNS)
      .eq('community_id', clubId)
      .eq('visibility', 'public')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error('Public announcements are unavailable.');
    return { items: data || [], unavailable: false };
  },
  ['public:clubs:announcements'],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_TAGS.clubs] },
);

/**
 * Announcements eligible for public display. Posts are never published merely
 * because their parent club is public: the anon SELECT policy requires the
 * post's own `visibility = 'public'`, `status = 'published'`, `deleted_at is
 * null` and a published, publicly listed parent club. No author identity is
 * projected, so a public reader cannot learn who wrote a post.
 */
export async function listPublicClubAnnouncements(clubId, { limit = 4 } = {}) {
  try {
    return await cachedClubPosts(clubId, limit);
  } catch {
    return LIST_UNAVAILABLE;
  }
}
