import 'server-only';

/**
 * Short-lived cache for the genuinely public slices of the campus.
 *
 * ── Why only these two ─────────────────────────────────────────────────────
 * `notices` and `events` are the only campus tables whose published rows are
 * identical for every signed-in student. Their RLS policies prove it:
 *
 *   notices_select_published → status = 'published' and not expired
 *   events_select_published  → status in ('published', 'completed')
 *
 * Neither policy consults membership, blocks or the current profile, and these
 * readers additionally pin `status = 'published'`, so a cached payload can never
 * contain a draft, a staff-only row or an expired notice. There are no viewer
 * columns in the result either (no `reacted_by_me`, no RSVP state) — RSVP is a
 * separate read in the page.
 *
 * Everything else is deliberately left uncached because its result depends on
 * the viewer:
 *
 *   communities  → can_view_community() checks membership for member-only
 *                  visibility, so two students legitimately see different rows;
 *   posts/feed   → personalised (reactions, polls, blocks, community membership);
 *   profile_private, notifications, conversations, roles, moderation queues
 *                  → private, rapid, or both.
 *
 * See docs/performance/2026-10-23-query-cache.md for the measurements.
 *
 * ── Mechanics ──────────────────────────────────────────────────────────────
 * `unstable_cache` (still the supported data-cache API in Next 16 — `'use
 * cache'` would require enabling `cacheComponents` for the whole app) stores
 * the returned rows in the framework's incremental cache, keyed on the exact
 * arguments of each call. The entry expires after 60 seconds and is invalidated
 * the moment staff publish, edit or delete a notice or event (see
 * `revalidatePublicNotices` / `revalidatePublicEvents`, called from
 * `lib/actions/campus.js`).
 *
 * Failures are never cached: an unavailable read throws out of the cache so the
 * next request tries again, and the caller still gets the usual
 * `{ items: [], unavailable: true }` shape it renders as a warning.
 *
 * ── Where these may be called ──────────────────────────────────────────────
 * From a page (or a layout) render only. The cached function resolves the
 * session-aware client, which reads `cookies()`; Next allows that inside a
 * cached page render but not inside a Route Handler, where the same call comes
 * back empty. Every current caller is a page, and a mismatch fails soft (an
 * empty, `unavailable` list) rather than leaking anything — but do not import
 * this module from `app/api/*`.
 */

import { unstable_cache } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { listEvents, listNotices } from '@/lib/data/campus';

/** Seconds a cached public row set may be served before it is re-read. */
export const PUBLIC_REVALIDATE_SECONDS = 60;

/** Cache tags — one per table, so invalidation stays narrow. */
export const PUBLIC_TAGS = {
  notices: 'public:notices',
  events: 'public:events',
};

const UNAVAILABLE = Object.freeze({ items: [], unavailable: true });

async function publicClient() {
  const supabase = await getServerClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

const cachedNotices = unstable_cache(
  async (limit, offset, category) => {
    const supabase = await publicClient();
    const result = await listNotices(supabase, { limit, offset, category });
    if (result.unavailable) throw new Error('Published notices are unavailable.');
    return result;
  },
  ['public:notices'],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_TAGS.notices] },
);

const cachedEvents = unstable_cache(
  async (limit, offset, upcoming, clubId, from, to, category, source, withCount) => {
    const supabase = await publicClient();
    const result = await listEvents(supabase, { limit, offset, upcoming, clubId, from, to, category, source, withCount });
    if (result.unavailable) throw new Error('Published events are unavailable.');
    return result;
  },
  ['public:events'],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_TAGS.events] },
);

/**
 * Published, unexpired notices. Same contract as `listNotices`, but shared
 * between students for at most {@link PUBLIC_REVALIDATE_SECONDS}.
 *
 * @param {{ limit?: number, offset?: number, category?: string | null }} options
 * @returns {Promise<{ items: Array<object>, unavailable: boolean }>}
 */
export async function listPublishedNotices({ limit = 20, offset = 0, category = null } = {}) {
  try {
    return await cachedNotices(limit, offset, category || null);
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Published events. Same parameters and contract as `listEvents`, minus the
 * status filter (always pinned to published) and `includeExpired`-style flags
 * that could widen visibility beyond what every student may see.
 *
 * The "upcoming" boundary is evaluated when the entry is created, so it can lag
 * a day rollover by at most one revalidation window.
 *
 * @param {object} options
 * @returns {Promise<{ items: Array<object>, unavailable: boolean }>}
 */
export async function listPublishedEvents({
  limit = 20,
  offset = 0,
  upcoming = true,
  clubId = null,
  from = null,
  to = null,
  category = null,
  source = null,
  withCount = false,
} = {}) {
  try {
    return await cachedEvents(
      limit,
      offset,
      upcoming,
      clubId || null,
      from || null,
      to || null,
      category || null,
      source || null,
      withCount,
    );
  } catch {
    return UNAVAILABLE;
  }
}
