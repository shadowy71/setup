/**
 * Google OAuth callback (spec §7, §8).
 *
 * This is the only place a Campus+ session is created. The flow is:
 *
 *   1. Google returns `?code=…` (PKCE authorization code) to this route,
 *   2. the code is exchanged **server-side** for a session with the code
 *      verifier cookie that `startGoogleSignIn` wrote,
 *   3. the database has already classified the account (`handle_new_user()`),
 *      and this route re-reads that classification from `profile_private`,
 *   4. an external visitor is sent onward with a one-shot notice cookie; an
 *      institutional student is sent onward with none,
 *   5. the browser lands in the app (or back at /login with a reason).
 *
 * The session cookie never depends on anything the browser claims: the address
 * is read from Supabase (Google-verified) and the account type is read from the
 * database. `?visitor=1` and friends are never consulted — a query parameter
 * must not be able to decide what the UI says about an account.
 */

import { NextResponse } from 'next/server';
import { getServerClient } from '@/lib/supabase/server';
import { resolveAccountType } from '@/lib/auth/domains';
import { loginErrorPath, OAUTH_CALLBACK_PATH, originFromHeaders, safeNextPath } from '@/lib/auth/oauth';
import { VISITOR_NOTICE_COOKIE, VISITOR_NOTICE_WINDOW_SECONDS, visitorNoticeValue } from '@/lib/auth/visitor-notice';
import { logError } from '@/lib/errors';
import { ACCOUNT_TYPES, ROUTES } from '@/lib/constants';

// Reads the PKCE code and session cookies: never cached, never prerendered.
export const dynamic = 'force-dynamic';

/** Send the browser back to /login with a reason the screen can explain. */
function fail(origin, reason) {
  return NextResponse.redirect(new URL(loginErrorPath(reason), origin));
}

export async function GET(request) {
  const url = new URL(request.url);
  // Behind a proxy (Vercel, preview tunnels) the forwarded host is the address
  // the student actually used; fall back to the one Next reconstructed.
  const origin = originFromHeaders(request.headers, url.origin);

  const code = url.searchParams.get('code');
  const providerError = url.searchParams.get('error');
  const next = safeNextPath(url.searchParams.get('next'));

  // The student cancelled at Google, or the provider refused the request.
  if (providerError) {
    if (providerError !== 'access_denied') {
      logError(new Error(`Google OAuth error: ${providerError}`), { route: OAUTH_CALLBACK_PATH });
    }
    return fail(origin, providerError === 'access_denied' ? 'cancelled' : 'provider');
  }

  if (!code) return fail(origin, 'missing_code');

  const supabase = await getServerClient();
  if (!supabase) return fail(origin, 'not_configured');

  // PKCE exchange: the code is single-use, short-lived and bound to the
  // verifier cookie written when the round trip started.
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data?.user) {
    logError(error || new Error('OAuth callback returned no user'), { route: OAUTH_CALLBACK_PATH });
    return fail(origin, 'exchange');
  }

  // The account must have a verified address. An address-less identity is the
  // only thing the database refuses to provision (see migration 080), so a
  // session without one has nothing to be classified from.
  const email = String(data.user.email || '').trim();
  if (!email || !email.includes('@')) {
    await supabase.auth.signOut();
    return fail(origin, 'domain');
  }

  // Defence in depth: the signup trigger classified this account inside the
  // exchange above. If it somehow has not provisioned yet, the app's own
  // onboarding gate handles it — we do not invent a classification here.
  const accountType = await resolveAccountType(supabase, data.user.id);
  const destination = new URL(next || ROUTES.home, origin);

  const response = NextResponse.redirect(destination);

  // Trusted, one-shot flow indicator for the Visitor notice. It is a *cookie*
  // set by this server route, not a query parameter, so:
  //   * it cannot be forged by editing the URL,
  //   * it exists only once per successful sign-in (the reader clears it),
  //   * it disappears on refresh because the reader consumed it.
  // The value is deliberately trivial (`1`): the cookie says "show the notice",
  // it never says "this account is a visitor". The client re-reads that from
  // the authenticated profile if it ever needs to.
  if (accountType === ACCOUNT_TYPES.visitor) {
    response.cookies.set(VISITOR_NOTICE_COOKIE, visitorNoticeValue(), {
      httpOnly: false, // the notice component reads it to decide to render
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      // Two minutes: long enough to land, short enough to expire. Kept in step
      // with the constant the client reader and its tests share.
      maxAge: VISITOR_NOTICE_WINDOW_SECONDS,
    });
  } else {
    // An institutional account must never inherit a stale notice cookie.
    response.cookies.set(VISITOR_NOTICE_COOKIE, '', { path: '/', maxAge: 0 });
  }

  return response;
}
