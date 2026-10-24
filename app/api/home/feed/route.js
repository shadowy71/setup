import { NextResponse } from 'next/server';
import { BLOCKED_STATUSES, getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { getCampusFeed } from '@/lib/data/feed';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
};

/**
 * GET /api/home/feed
 *
 * The Home shell renders without waiting for feed queries. This route loads a
 * small, RLS-scoped payload after first paint. It is intentionally not HTTP-
 * cached: post visibility and `reacted_by_me` / poll vote state are viewer-specific.
 */
export async function GET() {
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
      getCampusFeed(supabase, { limit: 10, currentProfileId: user.profile.id }),
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
