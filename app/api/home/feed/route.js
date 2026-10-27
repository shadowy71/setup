import { NextResponse } from 'next/server';
import { BLOCKED_STATUSES, getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { getCampusFeed } from '@/lib/data/feed';
import { HOME_FEED_MAX_OFFSET, HOME_FEED_PAGE_SIZE } from '@/lib/constants';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
};

/**
 * GET /api/home/feed
 *
 * The Home shell renders without waiting for feed queries. This route loads a
 * RLS-scoped page after first paint. It is intentionally not HTTP-
 * cached: post visibility and `reacted_by_me` / poll vote state are viewer-specific.
 *
 * `?offset=` is the only pagination argument. `campus_feed()` already does the ordering,
 * so a page is "the next N entries of the same deterministic list" and the client simply
 * keeps the pages it has asked for — Home is not capped at one page. The offset is a page
 * boundary rather than a cap on how far back a reader can go, up to `HOME_FEED_MAX_OFFSET`,
 * past which `hasMore` turns off instead of pretending the feed ended. The events and
 * notices rails are Home's own fixed three-row sets and ignore the offset: paging the
 * stream must not swap the rail under a reader for a different page's data.
 */
export async function GET(request) {
  // A missing, negative or non-numeric `?offset=` is not an error worth a 400: it is a
  // stale or hand-typed URL, and the newest page is the right answer for it.
  const requested = Number.parseInt(new URL(request.url).searchParams.get('offset') ?? '0', 10);
  const offset = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, HOME_FEED_MAX_OFFSET) : 0;

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

  try {
    const today = new Date().toISOString().slice(0, 10);
    const [
      { items: feed, unavailable },
      { data: events, error: eventsError },
      { data: notices, error: noticesError },
    ] = await Promise.all([
      getCampusFeed(supabase, { limit: HOME_FEED_PAGE_SIZE, offset, currentProfileId: user.profile.id }),
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

    return NextResponse.json(
      {
        ok: true,
        feed,
        unavailable,
        events: events || [],
        notices: notices || [],
        eventsUnavailable: Boolean(eventsError),
        noticesUnavailable: Boolean(noticesError),
        // The client renders "load older" off this, rather than guessing from the
        // length it happened to receive: a short page is the feed saying it is over.
        page: {
          limit: HOME_FEED_PAGE_SIZE,
          offset,
          hasMore: feed.length === HOME_FEED_PAGE_SIZE && offset + feed.length < HOME_FEED_MAX_OFFSET,
        },
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Home data is temporarily unavailable.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
