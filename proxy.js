/**
 * Campus+ — Next.js proxy (formerly `middleware.ts`).
 *
 * Next 16 renamed middleware to `proxy`: the file must export `proxy`, runs on
 * the Node.js runtime, and keeping both `middleware.ts` and `proxy.ts` is a
 * build error. This file does exactly two things:
 *
 *   1. refresh the Supabase session so the auth cookie never expires mid-visit,
 *   2. send signed-out visitors to /login and signed-in visitors away from it.
 *
 * It is deliberately *not* the authorization layer: every page, server action
 * and RLS policy checks permissions again (spec §106, §107). A path the matcher
 * misses is still safe — it just skips the cookie refresh.
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { originFromHeaders } from '@/lib/auth/oauth';

/** Routes that must be reachable without a session. `/legal` and `/rules` are
 * linked from the sign-in screen itself (the independence disclosure and the
 * rules a student agrees to by continuing), so both must render signed out.
 * `/timetable` (and every `/timetable/[division]` under it, via the prefix
 * match below) is a public read-only mirror of the department master
 * timetable — it must work from a shared link before a student has an
 * account, and it changes nothing about any other route's protection. */
const PUBLIC_PATHS = ['/login', '/login/verify', '/auth', '/setup', '/legal', '/rules', '/timetable'];

/**
 * The one-time-code step (and its route) was replaced by Google sign-in.
 *
 * Old links — emails, bookmarks, cached redirects — must land on the sign-in
 * screen, so this answers them with a real HTTP redirect before any session
 * work happens. (`app/login/verify/page.js` keeps a redirect of its own as a
 * fallback, but a Server Component redirect is delivered to the browser as a
 * streaming instruction, not as a status code; the proxy can send the 307.)
 */
function legacyCodeStep(request) {
  if (request.nextUrl.pathname !== '/login/verify') return null;
  const origin = originFromHeaders(request.headers, request.nextUrl.origin);
  const target = new URL('/login', origin);
  target.searchParams.set('notice', 'google');
  return NextResponse.redirect(target);
}

function isPublic(pathname) {
  if (pathname === '/') return true;
  return PUBLIC_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Old explore-era URLs, kept alive as real HTTP redirects.
 *
 * The Explore page used to link to `/explore/team-finder` and the like; those
 * links were the root cause of "team finder opens the wrong page" (they 404'd
 * or fell through to another screen). The links themselves now point at the
 * canonical routes — `/campus/teams`, `/campus/lost-found` — and these
 * redirects rescue bookmarks and shares made along the way. Both spellings of
 * team finder are accepted because both circulated.
 */
const LEGACY_PATHS = {
  '/explore/team-finder': '/campus/teams',
  '/explore/teamfinder': '/campus/teams',
  '/explore/teams': '/campus/teams',
  '/explore/lost-found': '/campus/lost-found',
};

function legacyPathRedirect(request) {
  const { pathname, search } = request.nextUrl;
  const target = LEGACY_PATHS[pathname];
  if (!target) return null;
  const origin = originFromHeaders(request.headers, request.nextUrl.origin);
  const url = new URL(target, origin);
  url.search = search;
  return NextResponse.redirect(url);
}

/**
 * @param {import('next/server').NextRequest} request
 */
export async function proxy(request) {
  const legacy = legacyCodeStep(request) || legacyPathRedirect(request);
  if (legacy) return legacy;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Without configuration the app must still boot and explain what is missing
  // (spec §92) — never 500 the whole site because an env var is absent.
  if (!url || !key || /^YOUR_/.test(key)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims() verifies the JWT locally when possible and falls back to the
  // auth server only when the token must be refreshed. A failure here means the
  // session is gone, not that the request should fail.
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  } catch {
    signedIn = false;
  }

  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isPublic(pathname)) {
    const target = new URL('/login', request.url);
    if (pathname !== '/') target.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(target);
  }

  if (signedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/home', request.url));
  }

  return response;
}

export const config = {
  // Everything except static assets, image optimisation, the favicon and API
  // route handlers (which authenticate themselves and return JSON, not HTML).
  matcher: ['/((?!_next/static|_next/image|api/|favicon.ico|robots.txt|manifest.webmanifest).*)'],
};
