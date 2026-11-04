/**
 * Cache tags and the revalidation window for the public discovery layer.
 *
 * Kept in a dependency-free module so server ACTIONS can invalidate a tag
 * without importing `lib/data/public-cache.js` (which pulls in `next/cache`,
 * the Supabase clients and the readers). That separation keeps action unit
 * tests small and, more importantly, makes it impossible for an invalidation
 * helper to accidentally perform a data read.
 */

/** Seconds a cached public row set may be served before it is re-read. */
export const PUBLIC_REVALIDATE_SECONDS = 60;

/** One tag per public table, so invalidation stays narrow. */
export const PUBLIC_TAGS = Object.freeze({
  notices: 'public:notices',
  events: 'public:events',
  clubs: 'public:clubs',
});
