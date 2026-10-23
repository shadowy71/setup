/**
 * Which navigation destination is "current" for a given URL.
 *
 * A single rule for the rail, the dock and anything else that marks a location:
 *
 *   - a destination is current on its own path and on any child path
 *     (`/gigs` is current on `/gigs/abc`, `/clubs` on `/clubs/abc/edit`);
 *   - when two destinations both match, the *more specific* one wins, so a
 *     child route can never leave two rows lit at once;
 *   - a trailing slash is ignored.
 *
 * The rule is intentionally strict about boundaries: `/gigstore` is not a child
 * of `/gigs`, and `/home` is not a parent of `/homework`.
 */

/** Normalise a pathname: strip a trailing slash (except for the root). */
export function normalizePath(pathname) {
  if (typeof pathname !== 'string' || !pathname) return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}

/** True when `href` is the current path or an ancestor of it. */
export function isActivePath(pathname, href) {
  if (!href) return false;
  const path = normalizePath(pathname);
  const target = normalizePath(href);
  if (path === target) return true;
  if (target === '/') return false;
  return path.startsWith(`${target}/`);
}

/**
 * The href of the most specific matching destination, or null.
 *
 * @param {string} pathname
 * @param {string[]} hrefs
 * @returns {string|null}
 */
export function resolveActiveHref(pathname, hrefs = []) {
  let winner = null;
  for (const href of hrefs) {
    if (!isActivePath(pathname, href)) continue;
    if (!winner || normalizePath(href).length > normalizePath(winner).length) winner = href;
  }
  return winner;
}
