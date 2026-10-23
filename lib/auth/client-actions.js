'use client';

/**
 * Session helpers that run in the browser.
 *
 * They exist so the UI can react quickly (sign-out, realtime auth hand-off),
 * but every one of them is duplicated by a server-side check. Nothing here is
 * a security boundary.
 *
 * Sign-out is the interesting one. The click must do exactly one thing, once:
 * ask the configured browser client to end the session, verify that the device
 * really is signed out, and only then navigate. The mechanics live in
 * `lib/auth/sign-out.js` (no React, directly testable); this module only wires
 * them to React state, the browser client and the server fallback.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { completeSignOut, SIGN_OUT_FAILED } from '@/lib/auth/sign-out';
import { ROUTES } from '@/lib/constants';
import { endSession } from '@/lib/actions/auth';

/**
 * The browser Supabase client is loaded on demand.
 *
 * `@supabase/supabase-js` (auth + PostgREST + Realtime, ~66 kB gzipped) used
 * to sit in the shared shell bundle because the account menu's sign-out button
 * imported it statically — so every authenticated page downloaded it to offer a
 * control that most page views never use. Both call sites here are already
 * asynchronous (a click handler and a mount effect), so the import moves to
 * them: the shell now ships without it, chat and sign-out fetch it when they
 * actually need it, and nothing else changes.
 */
async function loadBrowserClient() {
  const { getBrowserClient } = await import('@/lib/supabase/client');
  return getBrowserClient();
}

/**
 * Sign out through the browser client, verify the device, then return to
 * `/login` with fresh server state.
 *
 * Exported separately from the hook so it can be called (and asserted on) from
 * outside React — the hook is a thin wrapper around it.
 *
 * @returns {Promise<{ revokedByServer: boolean, clearedByBrowser: boolean }>}
 */
export async function performSignOut() {
  return completeSignOut({
    client: await loadBrowserClient(),
    readCookies: () => (typeof document === 'undefined' ? '' : document.cookie),
    clearOnServer: endSession,
  });
}

export function useSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  // A ref, not the state flag: two clicks in the same tick both read the old
  // state, and the second one would fire a second sign-out request.
  const inFlight = useRef(false);

  const signOut = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);

    try {
      await performSignOut();
    } catch (thrown) {
      // The device is still signed in and the session was NOT ended. Say so;
      // never redirect as though it had worked.
      setError(thrown?.message || SIGN_OUT_FAILED);
      inFlight.current = false;
      setPending(false);
      return;
    }

    // Signed out and verified. `replace` keeps the authenticated page out of
    // history, and `refresh` drops the cached server-rendered tree so no
    // protected screen can be replayed from the client router cache — the
    // session-derived chrome is re-rendered from `/login` instead.
    router.replace(ROUTES.login);
    router.refresh();
    inFlight.current = false;
    setPending(false);
  }, [router]);

  return { signOut, pending, error };
}

/**
 * Auth state for realtime subscriptions. `getSession()` is used here only to
 * pass the token to Realtime — authorization itself is enforced by RLS and by
 * private-channel policies server-side.
 */
export function useRealtimeAuth() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = await loadBrowserClient();
      if (!supabase || cancelled) return;
      const { data } = await supabase.auth.getSession();
      if (data?.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
