'use server';

/**
 * Authentication server actions (spec §7, §8).
 *
 * Sign-in is Google OAuth only:
 *
 *   /login → Supabase `signInWithOAuth({ provider: 'google' })` → Google →
 *   `/auth/callback` (PKCE code exchange, server-side) → session cookie → profile.
 *
 * `startGoogleSignIn` deliberately does **not** create a session: it asks
 * Supabase for the Google authorization URL and returns it, and the browser
 * navigates. The session is created exactly once, on the server, in
 * `app/auth/callback/route.js`, and only for an `@pccoepune.org` account.
 *
 * Why the URL is returned instead of calling `redirect()` here: `redirect()`
 * reports success by *throwing* a control-flow error (`NEXT_REDIRECT`), which is
 * indistinguishable from a real failure inside a `try/catch`. The old
 * one-time-code action had exactly that bug — its `catch` swallowed the redirect
 * and showed "something went wrong" after a successful sign-in. Returning the
 * URL removes the class of bug entirely: no `redirect()` runs inside this
 * action, so there is nothing for the error handling to swallow.
 */

import { headers, cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/session';
import { buildCallbackUrl, GOOGLE_PROVIDER, originFromHeaders, safeNextPath } from '@/lib/auth/oauth';
import { isSupabaseAuthCookie } from '@/lib/auth/cookies';
import { validate, onboardingSchema, visitorOnboardingSchema } from '@/lib/validation/schemas';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';

/**
 * Where the browser must go to start the Google round trip.
 *
 * No session and no cookie are created here — `signInWithOAuth` only writes the
 * PKCE code verifier (as a cookie, through `@supabase/ssr`) that
 * `/auth/callback` needs to complete the exchange.
 */
export async function startGoogleSignIn(formData) {
  try {
    const supabase = await getServerClient();
    if (!supabase) throw errors.configuration('Campus+ is not connected to a Supabase project yet.');

    // The public origin comes from the request headers rather than from the
    // form: a client-supplied value must never decide where OAuth returns to.
    const origin = originFromHeaders(await headers());
    if (!origin) {
      throw errors.configuration(
        'Sign-in needs the public HTTPS address of this deployment. Check the Supabase redirect URL settings and try again.',
      );
    }

    const next = safeNextPath(formData?.get?.('next'));
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: GOOGLE_PROVIDER,
      options: {
        redirectTo: buildCallbackUrl(origin, next),
        // The server has no browser to redirect; the caller navigates to `url`.
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      throw errors.validation('We could not reach Google. Please try again in a moment.');
    }

    return { ok: true, url: data.url };
  } catch (error) {
    return toActionError(error, 'We could not start Google sign-in. Please try again.');
  }
}

/**
 * End the session from the server — the fallback half of sign-out.
 *
 * Signing out normally happens in the browser, with the browser client
 * (`lib/auth/client-actions.js`). That is the path that revokes the refresh
 * token server-side and lets `@supabase/ssr` delete the exact cookies it wrote.
 *
 * This action exists for the cases the browser cannot cover: a browser client
 * that is unavailable or failed mid-way, or a cookie the browser could not
 * remove. A Server Action is the one place a cookie can *always* be deleted,
 * because it answers with `Set-Cookie` headers of its own — so when the client
 * half reports that the session survived, this makes it true that it does not.
 *
 * It is deliberately not the primary path, and it never navigates: the caller
 * decides where the student goes next, after verifying the device is signed out.
 * Signing out is idempotent, so running it after a successful client-side
 * sign-out would be harmless — which is exactly why it is only used when
 * verification failed.
 *
 * Authorization is unchanged: this action can only ever end the session of the
 * caller (it signs out *this* request's Supabase client) and deletes only
 * Supabase's own auth cookies.
 */
export async function endSession() {
  try {
    const supabase = await getServerClient();
    if (supabase) {
      // Clears the session through the library first, so the refresh token is
      // revoked as well as the cookie dropped. A failure here is not fatal: the
      // explicit deletion below still removes the session from this device.
      const { error } = await supabase.auth.signOut();
      if (error) console.warn('[Campus+] Server sign-out reported an error:', error.message || error);
    }

    const jar = await cookies();
    for (const cookie of jar.getAll()) {
      if (!isSupabaseAuthCookie(cookie.name)) continue;
      // Same scope `@supabase/ssr` writes with (path=/), maxAge 0 = delete now.
      jar.set(cookie.name, '', { path: '/', maxAge: 0, sameSite: 'lax' });
    }

    // The frame (sidebar, account menu, unread badge) is session-derived, so the
    // whole tree is revalidated rather than one segment.
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    console.warn('[Campus+] endSession failed:', error?.message || error);
    return { ok: false, error: 'We could not end the session on the server. Please try again.' };
  }
}

/**
 * Finish onboarding: claim the username and fill in the public profile.
 * `complete_profile()` is the only supported path — it owns uniqueness,
 * reserved names, the cooldown rule and the audit entry.
 *
 * Unchanged by the move to Google OAuth: the profile is still created once, by
 * the signup trigger, and this action only completes it.
 *
 * External accounts get the shorter contract: username, display name, bio and
 * the rules — no branch, year or division, because they belong to an
 * institution the visitor is not part of.
 */
export async function completeOnboarding(formData) {
  try {
    const user = await getCurrentUser();
    if (!user) throw errors.unauthenticated();

    // An external account has no institutional details. The account type comes
    // from the authenticated session (written by the signup trigger from the
    // verified Google address), never from the form — so a visitor cannot send
    // a branch/year/division and have it validated, and cannot send a
    // "account_type" field to change its own classification.
    const isVisitor = user.accountType === 'visitor';

    const payload = isVisitor
      ? {
          username: formData.get('username'),
          display_name: formData.get('display_name'),
          bio: formData.get('bio'),
          accept_rules: formData.get('accept_rules'),
        }
      : {
          username: formData.get('username'),
          display_name: formData.get('display_name'),
          bio: formData.get('bio'),
          branch: formData.get('branch'),
          year: formData.get('year'),
          division: formData.get('division'),
          show_branch_year: formData.get('show_branch_year') !== null ? formData.get('show_branch_year') : true,
          accept_rules: formData.get('accept_rules'),
        };

    const checked = validate(payload, isVisitor ? visitorOnboardingSchema : onboardingSchema);
    if (!checked.ok) throw errors.validation('Please check the highlighted fields.', checked.errors);
    const values = checked.data;

    const supabase = await getServerClient();
    // Institutional fields are sent as null for a visitor. The RPC forces them
    // to NULL regardless (migration 080), so this is belt-and-braces on the way
    // in rather than the boundary itself.
    const { data, error } = await supabase.rpc('complete_profile', {
      p_username: values.username,
      p_display_name: values.display_name,
      p_bio: values.bio || null,
      p_branch: isVisitor ? null : values.branch || null,
      p_year: isVisitor ? null : values.year || null,
      p_division: isVisitor ? null : values.division || null,
      p_show_branch_year: isVisitor ? false : values.show_branch_year !== false,
    });
    if (error) throw fromPostgresError(error);

    revalidatePath('/', 'layout');
    return { ok: true, profile: data };
  } catch (error) {
    return toActionError(error, 'We could not save your profile. Please try again.');
  }
}
