/**
 * Service-worker request policy — pure, dependency-free and shared.
 *
 * This module is the *only* place that decides what the Campus+ timetable
 * worker is allowed to touch. It is written as pure functions over plain
 * strings (never a `Request`) for two reasons:
 *
 *   1. it is bundled into `public/timetable/sw.js` by `scripts/build-sw.mjs`,
 *      where there is no DOM, no Next.js runtime and nothing server-only;
 *   2. the same decisions can then be unit-tested directly — including the
 *      ones that matter for privacy: an authenticated response, an admin page
 *      or a DM must never enter a cache, and "never cached" has to be the
 *      default rather than the result of remembering to exclude one more path.
 *
 * What it caches, deliberately: the `/timetable/**` HTML documents (so the
 * page you saved opens with no network) and the immutable hashed assets that a
 * *timetable document* actually loaded (so it can hydrate with no network).
 * Everything else — `/api/**` other than the timetable feed, every signed-in
 * route, every third-party origin — is answered by a plain pass-through fetch.
 */

/**
 * The cache namespace. Every cache the worker owns starts with this prefix and
 * nothing else ever does, which is what makes "delete obsolete caches" safe:
 * the worker cannot reach into another feature's (or another origin's) storage.
 */
export const CACHE_PREFIX = 'campusplus-timetable';

/**
 * Bump when the *shape* of what is cached changes (a new precache list, a
 * different document strategy, a snapshot format the shell can no longer
 * render). Old caches are deleted on activation and refilled, so one bump
 * retires every stale entry in the field.
 */
export const SW_CACHE_VERSION = 'v1';

/**
 * The offline app shell: always precached, always the last-resort document.
 *
 * `SW_CACHE_VERSION` is deliberately *not* bumped by the `install/` entries below,
 * even though the note on that constant asks for a bump when the precache list
 * changes. The reason is a real one: a bump deletes the caches of everybody who is
 * offline at the moment the new worker activates, and this change has no stale state
 * to clear — a new worker precaches the new URLs into the existing cache on
 * `install`, and the four `/brand/timetable-*.png` entries this replaced are simply
 * never read again (≤ 70 kB, evicted with the rest when the version next has to
 * move for a reason that matters).
 */
export const OFFLINE_SHELL_URL = '/timetable/offline';

/**
 * A sentinel written next to the shell only when the shell and every asset its
 * markup names were stored without a single failure. Serving the shell without
 * it would show a blank page (a React document whose chunk 404s renders
 * nothing at all), and a blank page offline is worse than the honest notice.
 */
export const OFFLINE_SHELL_READY_URL = '/timetable/offline.ready';

/** The pieces of chrome the shell needs that are not part of a page document. */
export const PRECACHE_URLS = [
  OFFLINE_SHELL_URL,
  '/timetable/install/icon-192.png',
  '/timetable/install/icon-512.png',
  '/timetable/install/maskable-192.png',
  '/timetable/install/maskable-512.png',
];

/** Hard ceilings so a long-lived cache can never grow into a liability. */
export const ASSET_LIMIT = 220;
export const DOCUMENT_LIMIT = 24;
/** 256 kB: a timetable page is far below this; a runaway response is not. */
export const MAX_CACHED_BYTES = 256 * 1024;

const TIMETABLE_PATH = '/timetable';
const IMMUTABLE_PREFIXES = ['/_next/static/'];
/**
 * Public brand/font files the shell paints with (no user data, hashed or tiny),
 * plus the timetable's own install art. The `/timetable/install/` and
 * `/timetable/*icon.png` entries exist because an installed app reads its icons
 * from that prefix — see the note in app/timetable/manifest/[division]/route.js.
 */
const STATIC_PREFIXES = [
  '/brand/',
  '/fonts/',
  '/icon.png',
  '/apple-icon.png',
  '/timetable/install/',
  '/timetable/icon.png',
  '/timetable/apple-icon.png',
];
/** Paths that must never be read from or written to a cache, whatever else matches. */
const NEVER_PREFIXES = ['/api/', '/auth/', '/login', '/logout', '/setup', '/onboarding', '/admin', '/moderator', '/settings', '/account-status'];

export function cacheNames(version = SW_CACHE_VERSION) {
  return {
    documents: `${CACHE_PREFIX}-documents-${version}`,
    assets: `${CACHE_PREFIX}-assets-${version}`,
    core: `${CACHE_PREFIX}-core-${version}`,
  };
}

export function isOwnedCache(name) {
  return typeof name === 'string' && name.startsWith(`${CACHE_PREFIX}-`);
}

/** Whether a *page* may ask the worker to keep its own document. */
export function isCacheableDocumentPath(pathname) {
  if (typeof pathname !== 'string') return false;
  if (!isTimetablePath(pathname)) return false;
  if (pathname === OFFLINE_SHELL_READY_URL) return false;
  // A request for the worker script or the shell's own marker is never stored
  // as a document: the cache would start feeding itself.
  return !pathname.endsWith('/sw.js');
}

export function isTimetablePath(pathname) {
  return pathname === TIMETABLE_PATH || pathname.startsWith(`${TIMETABLE_PATH}/`);
}

/**
 * A request is a *navigation* only when the browser says so. Next's App Router
 * fetches route payloads for soft navigation with the same pathname as the
 * page; serving cached HTML for one of those would feed the router a document
 * where it expects a flight payload, so this is strict on purpose.
 */
export function isDocumentRequest({ mode, destination, accept = '' } = {}) {
  if (mode !== 'navigate') return false;
  if (destination && destination !== 'document') return false;
  // An accept header is present on every real navigation; tests and odd
  // embedders may omit it, so its absence is treated as "a navigation".
  if (accept && !accept.includes('text/html')) return false;
  return true;
}

function isImmutableAsset(pathname) {
  return IMMUTABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isStaticBrandAsset(pathname) {
  return STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || /^\/timetable\/[^/]+\.(?:png|svg|webp|css|woff2?)$/.test(pathname);
}

export function isNeverCached(pathname) {
  return NEVER_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * The whole decision.
 *
 * @param {object} request  `{ url, method, mode, destination, accept, referrer }`
 *                          — `url`/`referrer` may be absolute or relative.
 * @returns {{action: 'bypass'} | {action: 'network-first', cache: string}
 *          | {action: 'cache-first', cache: string}}
 */
export function classifyRequest(request = {}) {
  if (request.method && request.method !== 'GET') return { action: 'bypass' };

  const origin = request.origin || '';
  const self = request.selfOrigin || origin;
  if (origin && self && origin !== self) return { action: 'bypass' };

  const pathname = pathOf(request.url);
  if (!pathname) return { action: 'bypass' };
  if (isNeverCached(pathname)) return { action: 'bypass' };

  // The worker's own script: never cache it, or an update can be pinned.
  if (pathname === '/timetable/sw.js') return { action: 'bypass' };

  const names = cacheNames();

  if (isDocumentRequest(request)) {
    // Only timetable documents are cached. A navigation anywhere else in
    // Campus+ is passed through untouched: signed-in pages, admin tables and
    // DMs must not exist in a CacheStorage entry under any circumstances.
    if (!isTimetablePath(pathname)) return { action: 'bypass' };
    return { action: 'network-first', cache: names.documents };
  }

  // Subresources are cached only for a document that is itself a timetable
  // page. That is the difference between "the timetable shell, plus what it
  // needs" and "an accidental copy of the whole site".
  const fromTimetable = isTimetablePath(pathOf(request.referrer));
  if (!fromTimetable) return { action: 'bypass' };
  if (isImmutableAsset(pathname)) return { action: 'cache-first', cache: names.assets };
  if (isStaticBrandAsset(pathname)) return { action: 'cache-first', cache: names.assets };
  return { action: 'bypass' };
}

/** The cache key for a resource: path only, so `?day=` variants never fork. */
export function cacheKeyFor(url) {
  const pathname = pathOf(url);
  if (!pathname) return null;
  return pathname;
}

/**
 * Which cached documents to drop when the store is over its limit: oldest
 * first, and never the offline shell (it is the last-resort document).
 */
export function pickDocumentsToPrune(entries, limit = DOCUMENT_LIMIT) {
  const keep = entries.filter((entry) => entry.url !== OFFLINE_SHELL_URL);
  if (keep.length <= limit) return [];
  return keep.slice(0, keep.length - limit).map((entry) => entry.url);
}

/** Same rule for assets; the shell's own chunks are ordinary entries. */
export function pickAssetsToPrune(entries, limit = ASSET_LIMIT) {
  if (entries.length <= limit) return [];
  return entries.slice(0, entries.length - limit).map((entry) => entry.url);
}

/**
 * Asset URLs a timetable page may ask the worker to keep for offline use.
 * Anything that is not a same-origin, immutable, timetable-needed URL is
 * refused here as well as in `classifyRequest` — the worker never trusts its
 * client to have filtered already.
 */
export function acceptablePrecacheUrls(urls, origin) {
  return (Array.isArray(urls) ? urls : [])
    .map((url) => {
      try {
        const parsed = new URL(url, origin);
        if (parsed.origin !== origin) return null;
        if (!isImmutableAsset(parsed.pathname)) return null;
        return parsed.pathname;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, ASSET_LIMIT);
}

/**
 * The immutable asset URLs a document references, in the order they appear.
 *
 * Why parse HTML at all: Next's App Router loads most of a page's chunks
 * lazily, and a page visited *before* the worker controlled it leaves no
 * trace in the worker's cache. The document markup, though, always names the
 * entry scripts and the stylesheets — which is precisely the set that has to
 * be present for an offline open to hydrate instead of dying with a
 * ChunkLoadError. Extracting them here (rather than trusting a hand-written
 * list of hashed names, which a rebuild invalidates every time) is what keeps
 * the offline copy correct across deploys.
 */
export function extractAssetUrls(html, limit = ASSET_LIMIT) {
  const text = String(html ?? '');
  const found = [];
  const seen = new Set();
  // Every same-origin build asset the markup names: the runtime and page
  // scripts, the shared chunks pulled in by `modulepreload`, the stylesheets,
  // the self-hosted fonts and the brand artwork the chrome renders. All of it
  // lives under a content-hashed or static path, so caching it is safe.
  const pattern = /(?:src|href|content)="(\/(?:_next\/static|brand|fonts)\/[^"]+)"/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const url = match[1];
    if (!seen.has(url)) {
      seen.add(url);
      found.push(url);
      if (found.length >= limit) break;
    }
    match = pattern.exec(text);
  }
  return found;
}

function pathOf(url) {
  if (!url) return null;
  const text = String(url);
  if (text.startsWith('http')) {
    try {
      return new URL(text).pathname;
    } catch {
      return null;
    }
  }
  if (text.startsWith('/')) return text.split('?')[0].split('#')[0];
  return null;
}
