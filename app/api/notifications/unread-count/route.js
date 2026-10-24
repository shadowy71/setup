import { NextResponse } from 'next/server';
import { BLOCKED_STATUSES, getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
};

/**
 * GET /api/notifications/unread-count
 * Authenticated and RLS-scoped; kept off the server-render critical path.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user?.profile) {
      return NextResponse.json({ ok: false }, { status: 401, headers: PRIVATE_HEADERS });
    }
    if (user.needsProfileSetup || BLOCKED_STATUSES.includes(user.accountStatus)) {
      return NextResponse.json({ ok: false }, { status: 403, headers: PRIVATE_HEADERS });
    }

    const supabase = await getServerClient();
    if (!supabase) {
      return NextResponse.json({ ok: false }, { status: 503, headers: PRIVATE_HEADERS });
    }

    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);

    if (error) {
      return NextResponse.json({ ok: false }, { status: 503, headers: PRIVATE_HEADERS });
    }

    return NextResponse.json({ ok: true, count: count || 0 }, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
