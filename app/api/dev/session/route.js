import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabasePublicConfig } from '@/lib/config';

/**
 * Development-only sign-in for the local fixture backend.
 *
 * Production signs in with Google OAuth only, which cannot complete inside a
 * sandbox or a remote preview: there is no Google round trip, no institutional
 * mailbox and no operator to click through the consent screen. Without a
 * session every route correctly redirects to `/login`, so a preview can only
 * ever show the sign-in screen — which is exactly the "it only runs a preview
 * home page" symptom this route exists to remove.
 *
 * This is deliberately NOT a second authentication mechanism:
 *
 *   * it is a no-op (404) unless `NODE_ENV === 'development'`;
 *   * it is a no-op unless `NEXT_PUBLIC_LOCAL_PREVIEW === '1'`, which is set
 *     only for the disposable local harness — a dev server pointed at the real
 *     Supabase project refuses to mint anything;
 *   * it never creates an account and never elevates a role: it signs in as an
 *     account that `scripts/dev/perf/seed.mjs` already created, using the same
 *     password sign-in the `@supabase/ssr` library would perform, so the
 *     session cookie is written by the library itself;
 *   * every downstream page, action, RPC and RLS policy still runs exactly the
 *     same checks — the harness stub enforces real row-level security against
 *     a real PostgreSQL, so this grants nothing the database does not already
 *     return for that user.
 */

/** Accounts seeded by `scripts/dev/perf/seed.mjs`. */
const DEV_ACCOUNTS = {
  student: 'perf.student1@pccoepune.org',
  moderator: 'perf.mod@pccoepune.org',
  admin: 'perf.admin@pccoepune.org',
  visitor: 'perf.visitor@gmail.com',
};
const DEV_PASSWORD = 'perf-password';

/** Where each fixture role lands after signing in. */
const AFTER_SIGN_IN = {
  student: '/home',
  moderator: '/moderator',
  admin: '/admin',
  visitor: '/home',
};

function isEnabled() {
  return process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_LOCAL_PREVIEW === '1';
}

/**
 * The origin the *browser* used, not the one the server is bound to.
 *
 * The dev server listens on `0.0.0.0`, so `request.url` reports
 * `http://0.0.0.0:3000` — a redirect there would be unreachable. The preview
 * proxy adds `x-forwarded-host`, so preferring it keeps the redirect on the
 * same origin the visitor is actually on.
 */
function browserOrigin(request, url) {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host');
  if (!host) return url.origin;
  const proto = request.headers.get('x-forwarded-proto') || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : url.protocol.replace(':', ''));
  return `${proto}://${host}`;
}

/**
 * GET /api/dev/session?as=student|moderator|admin|visitor
 *   → signs in as that fixture account and redirects into the app.
 *
 * The `visitor` fixture is an external account (a Gmail address outside every
 * college domain). It exists so the visitor experience — reduced navigation,
 * no Create menu, the settings account card, and the admin External Users
 * tab — can be inspected against real RLS rather than a mocked session.
 *
 * The cookie jar is the response's own cookie store, so `setAll` writes the
 * real `@supabase/ssr` chunked session cookies with their correct options.
 */
export async function GET(request) {
  if (!isEnabled()) return new NextResponse('Not found', { status: 404 });

  const url = new URL(request.url);
  const role = url.searchParams.get('as') || 'student';
  const email = DEV_ACCOUNTS[role];
  if (!email) {
    return NextResponse.json(
      { ok: false, error: `Unknown fixture account "${role}".`, available: Object.keys(DEV_ACCOUNTS) },
      { status: 400 },
    );
  }

  const response = NextResponse.redirect(new URL(AFTER_SIGN_IN[role], browserOrigin(request, url)));
  const supabase = createServerClient(supabasePublicConfig.url, supabasePublicConfig.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password: DEV_PASSWORD });
  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: `Fixture sign-in failed: ${error.message}`,
        hint: 'Start the local backend first: npm run perf:serve -- --rtt 0',
      },
      { status: 500 },
    );
  }

  return response;
}
