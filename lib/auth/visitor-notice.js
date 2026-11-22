/**
 * The one-shot Visitor sign-in notice.
 *
 * An external account should be told *once*, immediately after signing in, that
 * it has Visitor access. It must not reappear on navigation or refresh, and it
 * must never be something a visitor can trigger for itself or hide from an
 * administrator by editing a URL.
 *
 * The mechanism is a cookie set by the OAuth callback (`app/auth/callback/route.js`)
 * after it has read the authoritative account type from the database:
 *
 *   * value is the literal `1` — the cookie means "show the notice", not
 *     "this account is a visitor". Nothing authorizes from it.
 *   * the reader deletes it the first time it reads it, so it is consumed
 *     exactly once and cannot survive a refresh.
 *   * `maxAge` is short (two minutes). A tab that never finishes loading the
 *     app lets the indicator expire instead of surprising the visitor later.
 *   * the callback clears it for an institutional sign-in, so a previous
 *     visitor session on the same browser cannot leak a notice to a student.
 *
 * Why not a query parameter: `?visitor=1` is user-controlled. It could be added
 * to any link, and it would make the UI claim something about an account that
 * the server never said. The cookie is only written by the server route that
 * performed the PKCE exchange.
 */

/** Cookie name. Not `sb-`-prefixed: Campus+ owns it, Supabase does not. */
export const VISITOR_NOTICE_COOKIE = 'campus_visitor_notice';

/** How long the indicator may wait to be consumed. */
export const VISITOR_NOTICE_WINDOW_SECONDS = 120;

/** The only value the callback writes. */
export function visitorNoticeValue() {
  return '1';
}

/**
 * Should the current cookie value show the notice?
 *
 * Fails closed: anything other than the exact sentinel is treated as absent, so
 * a forged or corrupted value renders nothing rather than something.
 */
export function showsVisitorNotice(cookieValue) {
  return cookieValue === visitorNoticeValue();
}

/**
 * Client-side read for the notice component.
 *
 * Reads (and then clears) the cookie so a refresh cannot re-show the notice.
 * Returns false during server rendering and whenever `document` is unavailable.
 */
export function consumeVisitorNoticeCookie() {
  if (typeof document === 'undefined') return false;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${VISITOR_NOTICE_COOKIE}=`));
  if (!match) return false;

  const value = decodeURIComponent(match.slice(VISITOR_NOTICE_COOKIE.length + 1));
  // Consume it regardless of validity: a malformed indicator is not worth
  // keeping around, and leaving it would let it fire later.
  document.cookie = `${VISITOR_NOTICE_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
  return showsVisitorNotice(value);
}
