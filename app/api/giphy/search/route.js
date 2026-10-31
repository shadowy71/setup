/**
 * GET /api/giphy/search?q=...&limit=&offset=
 *
 * Server-side proxy so the GIPHY key never reaches the browser (spec §62).
 * Requires an authenticated Campus+ session and is rate limited (spec §61).
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { enforceRateLimit } from '@/lib/ratelimit';
import { AppError, errors, fromPostgresError, toHttpResponse } from '@/lib/errors';
import { searchGifs, trendingGifs, isGiphyConfigured, GIPHY_ATTRIBUTION } from '@/lib/giphy';
import { can, toActor } from '@/lib/permissions/authorization';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw errors.unauthenticated();
    const actor = toActor(user);
    if (!can(actor, 'use_gifs')) throw errors.forbidden('GIFs are not enabled for your account.');
    if (user.profile && ['suspended', 'banned', 'deactivated', 'deleted'].includes(user.profile.account_status)) {
      throw errors.forbidden('Your account cannot use GIFs right now.');
    }

    if (!isGiphyConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          code: 'configuration',
          error: 'GIF search is not configured. Add GIPHY_API_KEY to the server environment to enable it.',
          attribution: GIPHY_ATTRIBUTION,
        },
        { status: 503 },
      );
    }

    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'gif_search', user.profile?.id);

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get('q') || '').slice(0, 60);
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 24, 1), 50);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

    const payload = query
      ? await searchGifs({ query, limit, offset })
      : await trendingGifs({ limit, offset });

    return NextResponse.json(
      { ok: true, query, ...payload },
      { headers: { 'Cache-Control': 'private, max-age=30' } },
    );
  } catch (error) {
    if (error?.code === 'configuration') {
      return NextResponse.json({ ok: false, code: 'configuration', error: error.message }, { status: 503 });
    }
    if (error?.code === 'internal' && /GIF provider/i.test(error.message)) {
      return NextResponse.json({ ok: false, code: 'unavailable', error: error.message }, { status: 502 });
    }
    // An `AppError` already carries the status the client should see (401, 403,
    // 429, …). `fromPostgresError()` never returns a falsy value — its fallback
    // is `errors.internal()` — so chaining it with `|| error` here replaced
    // every AppError with a 500: anonymous callers got "Something went wrong"
    // instead of 401, and a rate-limited student got 500 instead of 429.
    return toHttpResponse(error instanceof AppError ? error : fromPostgresError(error));
  }
}
