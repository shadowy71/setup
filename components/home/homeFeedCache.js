/**
 * Small, browser-memory-only cache for the signed-in student's Home feed.
 *
 * The API response is already ordered newest-first. Keeping its first ten
 * distinct entries gives the cache FIFO eviction behaviour: when a new entry
 * appears at the front, the oldest entry falls off the end. This is deliberately
 * not localStorage/sessionStorage and must only be imported by client modules.
 */
export const HOME_FEED_LIMIT = 10;
export const HOME_FEED_CACHE_TTL_MS = 15_000;
const MAX_CACHED_USERS = 3;
const cache = new Map();

export function limitHomeFeed(items) {
  const output = [];
  const seen = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.id == null) continue;
    const key = `${item.type || 'item'}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
    if (output.length === HOME_FEED_LIMIT) break;
  }

  return output;
}

export function readHomeFeedCache(userId) {
  if (!userId) return null;
  const entry = cache.get(String(userId));
  if (!entry) return null;

  return {
    payload: entry.payload,
    fresh: Date.now() - entry.storedAt < HOME_FEED_CACHE_TTL_MS,
  };
}

/** Store the authoritative newest-first response and evict everything past 10. */
export function writeHomeFeedCache(userId, payload) {
  if (!userId || !payload || !Array.isArray(payload.feed)) return payload;

  const key = String(userId);
  const next = { ...payload, feed: limitHomeFeed(payload.feed) };
  cache.delete(key);
  cache.set(key, { payload: next, storedAt: Date.now() });

  // A few accounts at most can be remembered in a long-lived browser tab.
  while (cache.size > MAX_CACHED_USERS) {
    cache.delete(cache.keys().next().value);
  }

  return next;
}

export function clearHomeFeedCache(userId) {
  if (userId) cache.delete(String(userId));
}
