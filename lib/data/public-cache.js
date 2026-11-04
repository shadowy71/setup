import 'server-only';

/**
 * Short-lived cache for the genuinely public slices of the campus.
 *
 * ── Why these readers may be shared ────────────────────────────────────────
 * Every function here returns a *viewer-independent* projection: no membership
 * state, no RSVP state, no `reacted_by_me`, no staff-only rows, no profile
 * identity. The queries pin `status = 'published'` in addition to RLS.
 *
 * `listPublishedEvents` now reads through `getPublicClient()` — a client with
 * no cookies and therefore always the `anon` role. That matters for two reasons:
 *
 *   1. an anonymous visitor opening `/campus/events` gets exactly the same rows
 *      as a signed-in student, because the query never consults a session;
 *   2. an `unstable_cache` entry can never be populated with a response that
 *      belonged to an authenticated reader. The cache key is the argument list,
 *      not the session, so a session inside the cached function would have been
 *      a cross-user leak waiting to happen.
 *
 * `listPublishedNotices` keeps the session-aware client deliberately: the
 * noticeboard is an authenticated surface (no anon policy exists on `notices`),
 * but its published rows are identical for every signed-in student. Its RLS
 * policy consults neither membership nor the current profile.
 *
 * Viewer-specific reads — RSVPs, memberships, moderation queues, attendee
 * lists — are performed in the page with `getServerClient()` and never enter
 * these shared entries.
 *
 * ── Mechanics ──────────────────────────────────────────────────────────────
 * `unstable_cache` (still the supported data-cache API in Next 16 — `'use
 * cache'` would require enabling `cacheComponents` for the whole app) stores
 * the returned rows in the framework's incremental cache, keyed on the exact
 * arguments of each call. The entry expires after 60 seconds and is invalidated
 * the moment staff publish, edit or delete a notice or event (see
 * `revalidatePublicNotices` / `revalidatePublicEvents`, called from
 * `lib/actions/campus.js`), or when a club record changes (`PUBLIC_TAGS.clubs`).
 *
 * Failures are never cached: an unavailable read throws out of the cache so the
 * next request tries again, and the caller still gets the usual
 * `{ items: [], unavailable: true }` shape it renders as a warning.
 *
 * ── Where these may be called ──────────────────────────────────────────────
 * From a page, a layout, or `app/sitemap.js`. The event reader no longer calls
 * `cookies()`, so it is safe in a Route Handler too; the notice reader still
 * resolves a session-aware client and should stay on page renders.
 */

import { unstable_cache } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getPublicClient } from '@/lib/supabase/public';
import { listEvents, listNotices } from '@/lib/data/campus';
import { PUBLIC_EVENT_COLUMNS } from '@/lib/data/public-columns';
import { PUBLIC_REVALIDATE_SECONDS, PUBLIC_TAGS } from '@/lib/data/public-tags';

// Re-exported for the existing callers (actions and tests) that import the
// constants from this module. The values live in a dependency-free module so
// action files never have to import the readers.
export { PUBLIC_REVALIDATE_SECONDS, PUBLIC_TAGS };

const UNAVAILABLE = Object.freeze({ items: [], unavailable: true });

async function publicClient() {
  const supabase = getPublicClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function sessionClient() {
  const supabase = await getServerClient();
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

const cachedNotices = unstable_cache(
  async (limit, offset, category) => {
    const supabase = await sessionClient();
    const result = await listNotices(supabase, { limit, offset, category });
    if (result.unavailable) throw new Error('Published notices are unavailable.');
    return result;
  },
  ['public:notices'],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_TAGS.notices] },
);

const cachedEvents = unstable_cache(
  async (limit, offset, upcoming, clubId, from, to, category, source, withCount, allDates) => {
    const supabase = await publicClient();
    // Explicit public projection: `anon` only holds column-level SELECT on
    // these fields (migration 041), so internal provenance cannot be cached.
    const result = await listEvents(supabase, {
      limit, offset, upcoming, clubId, from, to, category, source, withCount,
      allDates, columns: PUBLIC_EVENT_COLUMNS,
    });
    if (result.unavailable) throw new Error('Published events are unavailable.');
    return result;
  },
  ['public:events'],
  { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [PUBLIC_TAGS.events] },
);

/**
 * Published, unexpired notices. Same contract as `listNotices`, but shared
 * between signed-in students for at most {@link PUBLIC_REVALIDATE_SECONDS}.
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
 * Published events — safe for anonymous visitors and signed-in students alike.
 * Same parameters and contract as `listEvents`, minus the status filter (always
 * pinned to published) and any flag that could widen visibility beyond what
 * every reader may see.
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
  allDates = false,
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
      allDates,
    );
  } catch {
    return UNAVAILABLE;
  }
}
