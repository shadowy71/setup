'use client';

import { useState } from 'react';
import { startGoogleSignIn } from '@/lib/actions/auth';
import { createGoogleSignInHandler } from '@/lib/auth/sign-in';
import { Button, Notice } from '@/components/ui';
import { Icon } from '@/components/ui/icons';

/**
 * Sign-in (spec §7): a single "Continue with Google" button.
 *
 * There is no email field and no code to type any more — the institutional
 * domain rule is enforced after Google authenticates the student, on the
 * server, in `/auth/callback`.
 *
 * The action returns the Google authorization URL and this component navigates
 * to it. That is what fixes the old NEXT_REDIRECT problem: the previous
 * one-time-code action called `redirect()` inside its own `try/catch`, so the
 * `NEXT_REDIRECT` control-flow error was caught and reported as a failure. Now
 * no server action redirects at all — success is a plain return value.
 *
 * The submission deliberately does NOT use the shared `useFormAction()`
 * helper. That helper serves in-app actions: after `onSuccess` it always
 * refreshes the current route through the Next.js router. Here `onSuccess`
 * starts an external full-page navigation to Google, and refreshing `/login`
 * straight after it races (and on iPhone Safari, visibly wins against) that
 * navigation — the screen reloaded instead of leaving for Google. So this
 * form has its own handler (`lib/auth/sign-in.js`, unit-tested): explicit
 * pending/error state, one guarded submission, `preventDefault`, the
 * validated `next` path carried in the FormData, and nothing at all after
 * the external navigation. The form likewise has no `action` prop — `onSubmit`
 * is the single submission path, so one tap can only ever start one Google
 * round trip (a second would overwrite the PKCE verifier cookie the callback
 * exchanges against).
 *
 * `children` are the page's notices (callback error, old-link notice). They sit
 * after the button so the sign-in action stays directly beneath the
 * introduction, and they are rendered exactly as before.
 */
export function LoginForm({ next = null, children = null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  // Created once and kept stable across renders: the handler's closure owns
  // the synchronous single-flight guard, which a per-render handler would
  // lose. `next` comes from the server-rendered page and does not change
  // during this form's life; the server action validates it again anyway.
  const [handleSubmit] = useState(() =>
    createGoogleSignInHandler({
      next,
      startSignIn: startGoogleSignIn,
      // A full browser hop, exactly like clicking a link to Google. The
      // Next.js router is not involved — no push, no refresh afterwards.
      navigate: (url) => window.location.assign(url),
      setPending,
      setError,
    }),
  );

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <Button
        type="submit"
        variant="glass"
        size="lg"
        loading={pending}
        className="w-full"
        icon="chevronRight"
      >
        {pending ? 'Taking you to Google…' : 'Continue with Google'}
      </Button>

      {children}

      {error ? (
        <Notice tone="danger" icon="flag">
          {error}
        </Notice>
      ) : null}

      <p className="text-2xs text-ink-soft">
        You will be sent to Google to choose your account. Campus+ never sees your Google password and
        never posts anything on your behalf.
      </p>

      <p className="flex items-center gap-1.5 text-2xs text-ink-soft">
        <Icon name="lock" size={13} className="shrink-0" />
        Sessions are created on the server, only after Google confirms your address.
      </p>
    </form>
  );
}
