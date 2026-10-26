import { limitFeed } from '@/lib/social/feed-state';

/**
 * Small, browser-memory-only cache for the signed-in student's Home feed.
 *
 * The API response is already ordered newest-first. Keeping its first ten
 * distinct entries gives the cache FIFO eviction behaviour: when a new entry
 * appears at the front, the oldest entry falls off the end. This is deliberately
 * not localStorage/sessionStorage and must only be imported by client modules.
 */
export const HOME_FEED_LIMIT = 10;
/**
 * How long a stored page may be served before a surface must re-read.
 *
 * It is a first-paint optimisation, not a staleness budget: every path that can
 * change the feed — a publish, a delete, a moderation change, a Realtime event, a
 * reconnect — clears or patches this cache and forces a re-read, so nothing has to
 * wait for the window to expire to see the truth.
 */
export const HOME_FEED_CACHE_TTL_MS = 15_000;
const MAX_CACHED_USERS = 3;
const cache = new Map();

/**
 * Deduplicate and window a feed payload.
 *
 * The rules live in `lib/social/feed-state.js`, shared with the live provider, the
 * Home stream and the write path, so a cached page, an optimistic insert and a
 * Realtime reconcile can never disagree about which two entries are the same post.
 * `limitFeed` dedupes on the canonical database post id and then applies this
 * surface's ten-entry window — which is what keeps "the newest ten" a list rather
 * than a snapshot that grew a second copy of a post under itself.
 */
export function limitHomeFeed(items) {
  return limitFeed(items, HOME_FEED_LIMIT);
}

export function readHomeFeedCache(userId) {
  if (!userId) return null;
  const entry = cache.get(String(userId));
  if (!entry) return null;

  return {
    payload: entry.payload,
    fresh: Date.now() - entry.storedAt < HOME_FEED_CACHE_TTL_MS,
    // The shell-wide revision the live feed was at when this page was stored. A
    // surface must only reuse a page whose revision still matches (see
    // `components/layout/LiveFeedProvider`): that is what makes a page stale the
    // instant a post lands, including while no feed surface is mounted to notice.
    revision: entry.revision,
  };
}

/**
 * Store the authoritative newest-first response and evict everything past 10.
 *
 * `revision` is the live-feed revision this page reflects, so a later change
 * anywhere in the app can mark it stale without deleting it (a stale page is still
 * a first paint; it just has to be re-read).
 */
export function writeHomeFeedCache(userId, payload, revision = 0) {
  if (!userId || !payload || !Array.isArray(payload.feed)) return payload;

  const key = String(userId);
  const next = { ...payload, feed: limitHomeFeed(payload.feed) };
  cache.delete(key);
  cache.set(key, { payload: next, storedAt: Date.now(), revision });

  // A few accounts at most can be remembered in a long-lived browser tab.
  while (cache.size > MAX_CACHED_USERS) {
    cache.delete(cache.keys().next().value);
  }

  return next;
}

/**
 * Apply a local change to the stored payload without waiting for the network.
 *
 * This is what keeps an author's own post on screen across a client navigation
 * inside the TTL window: the entry is patched in place under the same dedup and
 * ordering rules a server response goes through, so a remount hydrates from a cache
 * that already knows about the row instead of rolling the feed back to whatever was
 * fetched a quarter-minute ago. The forced refetch that follows reconciles it with
 * the authoritative page.
 *
 * A patch for a user with nothing stored is a no-op — this must never create an
 * entry for somebody else's feed, and it never invents a payload.
 */
export function patchHomeFeedCache(userId, update, revision = null) {
  if (!userId || typeof update !== 'function') return null;
  const entry = cache.get(String(userId));
  if (!entry) return null;
  const next = update(entry.payload);
  return writeHomeFeedCache(userId, next, revision == null ? entry.revision : revision);
}

export function clearHomeFeedCache(userId) {
  if (userId) cache.delete(String(userId));
}
