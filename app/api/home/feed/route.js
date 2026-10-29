import { NextResponse } from 'next/server';
import { BLOCKED_STATUSES, getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { getCampusFeed } from '@/lib/data/feed';
import { HOME_FEED_MAX_OFFSET, HOME_FEED_PAGE_SIZE, HOME_FEED_RECONCILE_LIMIT } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function feedOffset(request) {
  // A missing, negative or non-numeric `?offset=` is not an error worth a 400: a
  // stale or hand-typed URL gets the newest page. Reconciliation POSTs always
  // read that newest page; older pages still use the ordinary GET below.
  if (request.method !== 'GET') return 0;
  const requested = Number.parseInt(new URL(request.url).searchParams.get('offset') ?? '0', 10);
  return Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, HOME_FEED_MAX_OFFSET) : 0;
}

function boundedPostIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === 'string' && UUID.test(id)))].slice(0, HOME_FEED_RECONCILE_LIMIT);
}

/**
 * GET /api/home/feed?page-offset — one RLS-scoped feed page.
 * POST /api/home/feed { postIds } — the same newest page plus an IDs-only
 * visibility result for the posts already loaded in this viewer's browser.
 *
 * The route is intentionally not HTTP-cached: post visibility and
 * `reacted_by_me` / poll vote state are viewer-specific. A page is ten rows and
 * `campus_feed()` owns ordering. The optional reconciliation never treats
 * absence from that page as deletion: only the explicit checked/visible sets
 * from `campus_feed_post_visibility()` can remove an already-loaded row.
 */
async function serveFeed(request, { reconcile = false } = {}) {
  const offset = feedOffset(request);
  const user = await getCurrentUser();
  if (!user?.profile) {
    return NextResponse.json({ ok: false, error: 'Sign in to view the campus feed.' }, { status: 401, headers: PRIVATE_HEADERS });
  }
  if (user.needsProfileSetup || BLOCKED_STATUSES.includes(user.accountStatus)) {
    return NextResponse.json({ ok: false, error: 'This account cannot access the campus feed yet.' }, { status: 403, headers: PRIVATE_HEADERS });
  }

  const supabase = await getServerClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Campus+ data is not configured.' }, { status: 503, headers: PRIVATE_HEADERS });
  }

  let postIds = [];
  if (reconcile) {
    try {
      const body = await request.json();
      if (!Array.isArray(body?.postIds)) throw new Error('postIds must be an array');
      postIds = boundedPostIds(body.postIds);
    } catch {
      return NextResponse.json(
        { ok: false, error: 'A bounded postIds array is required for feed reconciliation.' },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const visibility = postIds.length
      ? supabase.rpc('campus_feed_post_visibility', { p_post_ids: postIds })
      : Promise.resolve({ data: [], error: null });
    const [
      { items: feed, unavailable },
      { data: visibleRows, error: visibilityError },
      { data: events, error: eventsError },
      { data: notices, error: noticesError },
    ] = await Promise.all([
      getCampusFeed(supabase, { limit: HOME_FEED_PAGE_SIZE, offset, currentProfileId: user.profile.id }),
      visibility,
      supabase
        .from('events')
        .select('id, title, starts_on, start_time, location, is_official, organizer')
        .eq('status', 'published')
        .gte('starts_on', today)
        .order('starts_on', { ascending: true })
        .limit(3),
      supabase
        .from('notices')
        .select('id, title, category, importance, published_at')
        .eq('status', 'published')
        .order('pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .limit(3),
    ]);

    const visible = new Set((visibleRows || []).map((row) => row.id));
    const payload = {
      ok: true,
      feed,
      unavailable,
      events: events || [],
      notices: notices || [],
      eventsUnavailable: Boolean(eventsError),
      noticesUnavailable: Boolean(noticesError),
      // The client renders its "Show more" control off this, rather than guessing
      // from the length it happened to receive: a short page is the feed saying it is over.
      page: {
        limit: HOME_FEED_PAGE_SIZE,
        offset,
        hasMore: feed.length === HOME_FEED_PAGE_SIZE && offset + feed.length < HOME_FEED_MAX_OFFSET,
      },
    };
    if (reconcile) {
      payload.reconciliation = {
        // A failed lookup checks nothing. Returning an empty visible set without
        // this guard would make a transient error look like "delete every card".
        checkedPostIds: visibilityError ? [] : postIds,
        visiblePostIds: visibilityError ? [] : postIds.filter((id) => visible.has(id)),
        unavailable: Boolean(visibilityError),
      };
    }

    return NextResponse.json(payload, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Home data is temporarily unavailable.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function GET(request) {
  return serveFeed(request);
}

export async function POST(request) {
  return serveFeed(request, { reconcile: true });
}
