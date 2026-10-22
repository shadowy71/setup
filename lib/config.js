/**
 * Configuration — the browser-safe half.
 *
 * Only values that are already public (or absent) live here, so this module can
 * be imported from client components without pulling `server-only` into the
 * browser bundle. Secrets live in `lib/config.server.js`.
 *
 * ---------------------------------------------------------------------------
 * Why every public read below is written out as a literal member expression
 * instead of a *computed* lookup into `process.env` (the bug this file shipped):
 *
 * A public value only reaches the browser because the bundler *statically
 * replaces* the exact, fully written expression with the value at build time. A
 * computed key — the variable's name held in another variable, or handed to a
 * helper as an argument — is invisible to that replacement, so the browser reads
 * `undefined` while the server (which reads the real environment at runtime)
 * reads the value.
 *
 * That asymmetry is silent and nasty: `getBrowserClient()` returned `null` in
 * real browsers, so client-side sign-out quietly did nothing — the session
 * cookie stayed, the proxy kept treating the visitor as signed in, and
 * `/login` was redirected straight back to `/home`. Realtime stayed
 * permanently "unconfigured" for the same reason.
 *
 * Rule: public configuration is read through a literal member expression and
 * passed to a normaliser. `tests/signout.test.js` fails the build if that rule
 * is broken again.
 * ---------------------------------------------------------------------------
 */

/** Trim a public value and treat the shipped placeholders as "not configured". */
function readPublic(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || /^YOUR_|^your_/.test(trimmed)) return null;
  return trimmed;
}

/** Public Supabase configuration (safe for the browser). */
export const supabasePublicConfig = {
  get url() {
    return readPublic(process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get publishableKey() {
    return readPublic(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  },
  get isConfigured() {
    return Boolean(this.url && this.publishableKey);
  },
};

/**
 * Public contact address for rights-holder / legal enquiries, shown on
 * `/legal`. Optional by design: until the project owner configures
 * `NEXT_PUBLIC_LEGAL_CONTACT_EMAIL`, this is null and the legal page says so
 * instead of inventing an address. Read through a literal member expression
 * for the same bundler-inlining reason documented at the top of this file.
 */
export const legalContact = {
  get email() {
    return readPublic(process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL);
  },
};

/** True when the two client-side Supabase values are present. */
export function isSupabaseConfigured() {
  return supabasePublicConfig.isConfigured;
}
