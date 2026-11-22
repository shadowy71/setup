import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Google OAuth sign-in (spec §7, §8).
 *
 * These tests pin the rules that replaced the one-time-code flow:
 *
 *   - sign-in only ever starts a Google round trip (the action returns a URL,
 *     it never redirects and never creates a session),
 *   - the session is created only in `/auth/callback`, from a server-side code
 *     exchange,
 *   - the account classification is read from the database (written by the
 *     signup trigger from the verified Google address), never from the URL,
 *   - an external account is admitted and flagged for the one-shot Visitor
 *     notice; an institutional account is admitted without a notice,
 *   - `next` can only be a path on this site (no open redirect),
 *   - every failure lands on /login with a reason the screen can explain,
 *   - the login form starts that round trip exactly once per submission and
 *     leaves for Google with a plain external navigation — no Next.js router
 *     push/refresh after it (the iPhone Safari reload/loop regression).
 */

const state = vi.hoisted(() => ({
  supabase: null,
  accountTypeRows: null,
  resolveAccountType: null,
  signOutCalls: 0,
  oauthOptions: null,
  oauthResult: null,
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => state.supabase,
}));

vi.mock('@/lib/auth/domains', () => ({
  // The callback now asks the database what kind of account this is. Tests
  // drive the answer through `state.accountTypeRows`.
  resolveAccountType: async (supabase, authUserId) => {
    if (state.resolveAccountType) return state.resolveAccountType(authUserId);
    const row = state.accountTypeRows?.[authUserId];
    return row ?? null;
  },
}));

vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: async () => null,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'campus.test', 'x-forwarded-proto': 'https' }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { startGoogleSignIn } from '@/lib/actions/auth';
import { GET } from '@/app/auth/callback/route';
import {
  buildCallbackUrl,
  describeAuthError,
  loginErrorPath,
  normalizeOrigin,
  originFromHeaders,
  originFromHost,
  safeNextPath,
} from '@/lib/auth/oauth';
import { createGoogleSignInHandler, SIGN_IN_FAILED } from '@/lib/auth/sign-in';

const ALLOWED_EMAIL = 'aditi@pccoepune.org';

function makeClient({ user = { id: 'auth-1', email: ALLOWED_EMAIL }, exchange = null } = {}) {
  return {
    auth: {
      exchangeCodeForSession: async (code) =>
        exchange ? exchange(code) : { data: { user, session: { access_token: 'token' } }, error: null },
      signInWithOAuth: async (options) => {
        state.oauthOptions = options;
        return (
          state.oauthResult ?? {
            data: { provider: 'google', url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x' },
            error: null,
          }
        );
      },
      signOut: async () => {
        state.signOutCalls += 1;
        return { error: null };
      },
    },
  };
}

const callback = (query = '') =>
  new Request(`https://campus.test/auth/callback${query}`, { headers: { host: 'campus.test' } });

const locationOf = (response) => response.headers.get('location');

/** Read a `Set-Cookie` pair written by the redirect, whichever jar mechanism exists. */
const cookieOf = (response, name) => {
  const list = typeof response.cookies?.getAll === 'function'
    ? response.cookies.getAll()
    : [];
  return list.find((cookie) => cookie.name === name) || null;
};

const formData = (values = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

beforeEach(() => {
  state.supabase = null;
  state.accountTypeRows = null;
  state.resolveAccountType = null;
  state.signOutCalls = 0;
  state.oauthOptions = null;
  state.oauthResult = null;
  // Expected failures log server-side; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('safeNextPath()', () => {
  it('accepts only paths on this site', () => {
    expect(safeNextPath('/market?tab=gigs')).toBe('/market?tab=gigs');
    expect(safeNextPath('/chat/42')).toBe('/chat/42');
    expect(safeNextPath('  /home  ')).toBe('/home');
  });

  it('refuses other origins and schemes', () => {
    for (const value of [
      'https://evil.example/login',
      '//evil.example/login',
      '/\\evil.example',
      'http://campus.test/home',
      'javascript:alert(1)',
      '/home\u0000',
      '',
      null,
      42,
    ]) {
      expect(safeNextPath(value)).toBeNull();
    }
  });
});

describe('buildCallbackUrl()', () => {
  it('points at /auth/callback on the deployment origin', () => {
    expect(buildCallbackUrl('https://campus.test')).toBe('https://campus.test/auth/callback');
    expect(buildCallbackUrl('https://campus.test/')).toBe('https://campus.test/auth/callback');
  });

  it('carries a safe next path and drops an unsafe one', () => {
    expect(buildCallbackUrl('https://campus.test', '/market')).toBe(
      'https://campus.test/auth/callback?next=%2Fmarket',
    );
    expect(buildCallbackUrl('https://campus.test', '//evil.example')).toBe(
      'https://campus.test/auth/callback',
    );
  });

  it('requires a usable HTTPS origin', () => {
    expect(() => buildCallbackUrl('http://campus.test')).toThrow(/HTTPS origin/);
    expect(() => buildCallbackUrl('not a url')).toThrow(/HTTPS origin/);
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeOrigin('https://campus.test')).toBe('https://campus.test');
    expect(normalizeOrigin('http://campus.test')).toBeNull();
  });
});

describe('originFromHost()', () => {
  it('uses the proxied host and protocol when a proxy supplies them', () => {
    expect(originFromHost('campus.test', 'https')).toBe('https://campus.test');
    expect(originFromHost('campus.test, internal:3000', 'https')).toBe('https://campus.test');
  });

  it('defaults to HTTPS in production and HTTP only for local development', () => {
    expect(originFromHost('campus.test')).toBe('https://campus.test');
    expect(originFromHost('localhost:3000')).toBe('http://localhost:3000');
    expect(originFromHost('127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(originFromHost('')).toBeNull();
  });

  it('reads a Headers-like object and keeps the fallback', () => {
    expect(originFromHeaders(new Headers({ host: 'campus.test' }))).toBe('https://campus.test');
    expect(originFromHeaders(null, 'https://fallback.test')).toBe('https://fallback.test');
  });
});

describe('describeAuthError()', () => {
  it('explains every code the callback can send', () => {
    for (const code of ['cancelled', 'domain', 'exchange', 'missing_code', 'not_configured', 'provider']) {
      expect(describeAuthError(code)).toBeTruthy();
    }
    expect(describeAuthError('domain')).toMatch(/pccoepune\.org/);
    expect(describeAuthError('something-else')).toMatch(/could not complete/i);
    expect(describeAuthError(undefined)).toBeNull();
    expect(loginErrorPath('domain')).toBe('/login?error=domain');
  });
});

describe('startGoogleSignIn()', () => {
  it('returns the Supabase Google URL and never redirects or creates a session', async () => {
    state.supabase = makeClient();

    const result = await startGoogleSignIn(formData());

    expect(result.ok).toBe(true);
    expect(result.url).toContain('accounts.google.com');
    expect(state.oauthOptions.provider).toBe('google');
    expect(state.oauthOptions.options.skipBrowserRedirect).toBe(true);
    expect(state.oauthOptions.options.redirectTo).toBe('https://campus.test/auth/callback');
  });

  it('passes a safe next destination through and drops an unsafe one', async () => {
    state.supabase = makeClient();

    await startGoogleSignIn(formData({ next: '/market?tab=gigs' }));
    expect(state.oauthOptions.options.redirectTo).toBe(
      'https://campus.test/auth/callback?next=%2Fmarket%3Ftab%3Dgigs',
    );

    await startGoogleSignIn(formData({ next: '//evil.example' }));
    expect(state.oauthOptions.options.redirectTo).toBe('https://campus.test/auth/callback');
  });

  it('reports configuration and provider failures as action errors', async () => {
    const unconfigured = await startGoogleSignIn(formData());
    expect(unconfigured.ok).toBe(false);
    expect(unconfigured.code).toBe('configuration');

    state.supabase = makeClient();
    state.oauthResult = { data: { provider: 'google', url: null }, error: { message: 'provider down' } };
    const failed = await startGoogleSignIn(formData());
    expect(failed.ok).toBe(false);
    expect(failed.url).toBeUndefined();
  });
});

describe('GET /auth/callback', () => {
  it('sends a cancelled or failed Google round trip back to /login', async () => {
    expect(locationOf(await GET(callback()))).toBe('https://campus.test/login?error=missing_code');
    expect(locationOf(await GET(callback('?error=access_denied')))).toBe(
      'https://campus.test/login?error=cancelled',
    );
    expect(locationOf(await GET(callback('?error=server_error')))).toBe(
      'https://campus.test/login?error=provider',
    );
  });

  it('does not exchange a code without a configured Supabase client', async () => {
    expect(locationOf(await GET(callback('?code=abc')))).toBe(
      'https://campus.test/login?error=not_configured',
    );
  });

  it('reports a failed exchange without signing anyone in', async () => {
    state.supabase = makeClient({
      exchange: () => ({ data: { user: null, session: null }, error: { message: 'invalid grant' } }),
    });

    expect(locationOf(await GET(callback('?code=abc')))).toBe('https://campus.test/login?error=exchange');
    expect(state.signOutCalls).toBe(0);
  });

  it('creates the session server-side and lands on the requested page', async () => {
    state.supabase = makeClient();
    state.accountTypeRows = { 'auth-1': 'student' };

    expect(locationOf(await GET(callback('?code=good')))).toBe('https://campus.test/home');
    expect(locationOf(await GET(callback('?code=good&next=%2Fmarket%2Flisting%2F7')))).toBe(
      'https://campus.test/market/listing/7',
    );
    // An off-site destination is ignored, never followed.
    expect(locationOf(await GET(callback('?code=good&next=%2F%2Fevil.example')))).toBe(
      'https://campus.test/home',
    );
  });

  it('signs an external account IN and flags the visitor notice once', async () => {
    // Migration 080: a non-institutional address is a legitimate external
    // account, not an error. It must be admitted, and the notice must be
    // signalled with a server-set cookie rather than a query parameter.
    state.supabase = makeClient({ user: { id: 'auth-2', email: 'someone@gmail.com' } });
    state.accountTypeRows = { 'auth-2': 'visitor' };

    const response = await GET(callback('?code=good'));

    expect(locationOf(response)).toBe('https://campus.test/home');
    expect(state.signOutCalls).toBe(0);
    expect(cookieOf(response, 'campus_visitor_notice')).toBeTruthy();
    expect(locationOf(response)).not.toContain('visitor');
  });

  it('does not flag the notice for an institutional account', async () => {
    state.supabase = makeClient();
    state.accountTypeRows = { 'auth-1': 'student' };

    const response = await GET(callback('?code=good'));

    expect(locationOf(response)).toBe('https://campus.test/home');
    // The cookie is explicitly cleared, so a previous visitor session on this
    // browser cannot leak a notice to the student who signs in next.
    expect(cookieOf(response, 'campus_visitor_notice')?.value ?? '').toBe('');
  });

  it('never trusts a query parameter for the account classification', async () => {
    state.supabase = makeClient();
    state.accountTypeRows = { 'auth-1': 'student' };

    // A crafted `visitor=1` must not make the server say anything visitor-ish.
    const response = await GET(callback('?code=good&visitor=1&account_type=visitor&role=admin'));

    expect(locationOf(response)).toBe('https://campus.test/home');
    expect(cookieOf(response, 'campus_visitor_notice')?.value ?? '').toBe('');
  });

  it('resolves the classification from the authenticated user, not the URL', async () => {
    state.supabase = makeClient();
    const seen = [];
    state.resolveAccountType = (authUserId) => {
      seen.push(authUserId);
      return 'student';
    };

    await GET(callback('?code=good&email=attacker@evil.example&account_type=visitor'));

    expect(seen).toEqual(['auth-1']);
  });

  it('signs out an identity with no usable email address', async () => {
    state.supabase = makeClient({ user: { id: 'auth-3', email: '' } });

    expect(locationOf(await GET(callback('?code=good')))).toBe('https://campus.test/login?error=domain');
    expect(state.signOutCalls).toBe(1);
  });

  it('admits an account whose classification has not resolved yet', async () => {
    // A provisioning race must not strand the student at /login. The app's own
    // onboarding gate handles an unfinished profile, and no notice is shown
    // because nothing said the account is external.
    state.supabase = makeClient({ user: { id: 'auth-4', email: 'late@gmail.com' } });
    state.accountTypeRows = {};

    const response = await GET(callback('?code=good'));

    expect(locationOf(response)).toBe('https://campus.test/home');
    expect(cookieOf(response, 'campus_visitor_notice')?.value ?? '').toBe('');
  });
});

/**
 * The browser half of starting sign-in (`lib/auth/sign-in.js`, wired up by
 * `LoginForm`). These pin the loop/reload fix: the generic form helper
 * refreshed `/login` through the Next.js router right after starting the
 * external navigation to Google, racing it.
 */
describe('createGoogleSignInHandler()', () => {
  const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x';

  // No form element in Node: `currentTarget` is undefined, which builds an
  // empty FormData — exactly the real form's content (`next` is the only field).
  const submitEvent = () => ({ preventDefault: vi.fn(), currentTarget: undefined });

  function makeHandler({ next = null, respond = null } = {}) {
    const calls = { starts: [], navigations: [], pending: false, error: null };
    const handler = createGoogleSignInHandler({
      next,
      startSignIn: async (data) => {
        calls.starts.push(data);
        return respond ? respond(calls.starts.length) : { ok: true, url: GOOGLE_URL };
      },
      navigate: (url) => calls.navigations.push(url),
      setPending: (value) => {
        calls.pending = value;
      },
      setError: (value) => {
        calls.error = value;
      },
    });
    return { handler, calls };
  }

  it('prevents the native submission, starts sign-in once, and navigates externally', async () => {
    const { handler, calls } = makeHandler({ next: '/market?tab=gigs' });
    const event = submitEvent();

    await handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(calls.starts).toHaveLength(1);
    // The validated destination is preserved for the server action…
    expect(calls.starts[0].get('next')).toBe('/market?tab=gigs');
    // …success is exactly one external navigation…
    expect(calls.navigations).toEqual([GOOGLE_URL]);
    // …and pending stays on: the browser is leaving, so the submit button
    // must remain disabled until it actually does.
    expect(calls.pending).toBe(true);
    expect(calls.error).toBeNull();
  });

  it('omits `next` entirely when there is no destination', async () => {
    const { handler, calls } = makeHandler();

    await handler(submitEvent());

    expect(calls.starts).toHaveLength(1);
    expect(calls.starts[0].get('next')).toBeNull();
    expect(calls.navigations).toEqual([GOOGLE_URL]);
  });

  it('ignores repeat submissions while one is in flight (and after it succeeds)', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { handler, calls } = makeHandler({ respond: () => gate });

    // A double-tap in the same tick: both calls see the same React state, so
    // only the handler's own guard can keep this to one server action call —
    // a second would overwrite the PKCE verifier cookie for the first.
    const first = handler(submitEvent());
    const second = handler(submitEvent());
    release({ ok: true, url: GOOGLE_URL });
    await Promise.all([first, second]);

    expect(calls.starts).toHaveLength(1);
    expect(calls.navigations).toEqual([GOOGLE_URL]);

    // Still navigating away: further taps remain no-ops.
    await handler(submitEvent());
    expect(calls.starts).toHaveLength(1);
    expect(calls.navigations).toEqual([GOOGLE_URL]);
  });

  it('shows the server action error, re-enables the button, and allows a retry', async () => {
    const message = 'We could not reach Google. Please try again in a moment.';
    const { handler, calls } = makeHandler({
      respond: (attempt) => (attempt === 1 ? { ok: false, error: message } : { ok: true, url: GOOGLE_URL }),
    });

    await handler(submitEvent());

    expect(calls.error).toBe(message);
    expect(calls.pending).toBe(false);
    expect(calls.navigations).toEqual([]);

    await handler(submitEvent());

    expect(calls.starts).toHaveLength(2);
    expect(calls.error).toBeNull();
    expect(calls.pending).toBe(true);
    expect(calls.navigations).toEqual([GOOGLE_URL]);
  });

  it('treats a thrown call and a missing URL as retryable failures, never navigating', async () => {
    const thrown = makeHandler({
      respond: () => {
        throw new Error('network down');
      },
    });
    await thrown.handler(submitEvent());
    expect(thrown.calls.error).toBe(SIGN_IN_FAILED);
    expect(thrown.calls.pending).toBe(false);
    expect(thrown.calls.navigations).toEqual([]);

    const noUrl = makeHandler({ respond: () => ({ ok: true }) });
    await noUrl.handler(submitEvent());
    expect(noUrl.calls.error).toBe(SIGN_IN_FAILED);
    expect(noUrl.calls.pending).toBe(false);
    expect(noUrl.calls.navigations).toEqual([]);
  });
});

describe('LoginForm wiring', () => {
  const loginForm = fs.readFileSync('components/auth/LoginForm.js', 'utf8');
  const signIn = fs.readFileSync('lib/auth/sign-in.js', 'utf8');

  it('submits through the dedicated handler, not the generic in-app form helper', () => {
    expect(loginForm).not.toContain("from '@/lib/forms'");
    expect(loginForm).toContain('createGoogleSignInHandler');
    expect(loginForm).toContain('startSignIn: startGoogleSignIn');
  });

  it('has `onSubmit` as the single submission path (no form `action`)', () => {
    expect(loginForm).toContain('onSubmit={handleSubmit}');
    expect(loginForm).not.toMatch(/<form[^>]*\saction=/);
  });

  it('navigates externally and never touches the Next.js router', () => {
    expect(loginForm).toContain('window.location.assign(url)');
    expect(loginForm).not.toContain('next/navigation');
    expect(loginForm).not.toMatch(/router\.(push|refresh|replace)/);
    expect(signIn).not.toContain('next/navigation');
    expect(signIn).not.toMatch(/router\.(push|refresh|replace)/);
  });
});
