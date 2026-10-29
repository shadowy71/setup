/**
 * Feed state transitions, shared by every surface that keeps posts in memory.
 *
 * The database stays canonical. This module only merges rows that the server has
 * already authorised and hydrated — it never invents a post, never guesses a
 * counter, and never talks to Supabase. It exists so the three ways a feed learns
 * about a post (the author's own successful write, a Realtime change, a paginated
 * or focus refetch) go through *one* set of rules for ordering, placement and
 * deduplication, instead of each caller re-implementing them and drifting.
 *
 * Deliberately client-safe: no `server-only`, no React, no I/O. `lib/messaging/state.js`
 * is the same pattern for the chat surfaces; the shape of the merge is different
 * because a feed is a *sorted window over mixed item types* rather than one
 * append-only thread.
 */

/** Feed entry types that render a post card (the rest are notices, events, …). */
export const POST_FEED_TYPES = ['post', 'discussion', 'poll'];

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The instant a feed entry sorts by.
 *
 * `campus_feed()` sorts on its own `sort_at` column (a pinned notice is stamped an
 * hour-class ahead, an event by its start date), so a client-side insert has to
 * use that same value to land in the position the server would have given it.
 * Only when an entry has no server sort value — which happens for a row the
 * client was handed directly — does it fall back to its creation time.
 */
export function feedSortAt(item) {
  return item?.sortAt || item?.createdAt || item?.post?.created_at || null;
}

/** Identity of a mixed feed entry: what makes two entries the same slot. */
export function feedItemKey(item) {
  return `${item?.type || 'item'}:${item?.id}`;
}

/** True when the entry is a post (and therefore carries a canonical post row). */
export function isPostEntry(item) {
  return POST_FEED_TYPES.includes(item?.type);
}

/**
 * The deduplication key.
 *
 * Post entries are keyed on the **canonical database post id**, on its own, not on
 * `type:id`: the same row can arrive labelled `post` from one read and
 * `discussion` from another (the label is derived from `kind` in two places), and
 * an optimistic copy must be recognised as the very row the next server page
 * returns. Notices, events and listings keep their type-qualified key, because a
 * `post` and a `notice` genuinely can share nothing else in common.
 */
export function feedDedupeKey(item) {
  const postId = isPostEntry(item) ? item?.post?.id || item?.id : null;
  return postId ? `post:${postId}` : feedItemKey(item);
}

/** Newest first, then a stable key so equal timestamps never reorder between renders. */
export function compareFeedItems(a, b) {
  const byTime = timestamp(feedSortAt(b)) - timestamp(feedSortAt(a));
  if (byTime !== 0) return byTime;
  return feedDedupeKey(a).localeCompare(feedDedupeKey(b));
}

export function sortFeed(items = []) {
  return (Array.isArray(items) ? items : []).slice().sort(compareFeedItems);
}

/**
 * Collapse every entry that represents the same row into one, keeping the order
 * the caller supplied.
 *
 * A duplicate never replaces an entry with a *less* authoritative copy: a row
 * still flagged `optimistic` (the shape a surface holds between "the server
 * accepted it" and "the feed read returned it") is ignored once a canonical copy
 * of the same id is in the list, and any other duplicate is merged field-by-field
 * into the entry already occupying the slot.
 */
export function dedupeFeed(items = []) {
  const seen = new Map();
  const output = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.id == null) continue;
    const key = feedDedupeKey(item);
    const index = seen.get(key);
    if (index == null) {
      seen.set(key, output.length);
      output.push(item);
      continue;
    }
    const current = output[index];
    if (current.optimistic !== true && item.optimistic === true) continue;
    const merged = { ...current, ...item };
    if (item.optimistic !== true) delete merged.optimistic;
    output[index] = merged;
  }
  return output;
}

/** Apply the surface's window size without re-sorting an already-ordered feed. */
export function limitFeed(items, limit = 0) {
  const unique = dedupeFeed(items);
  return limit > 0 ? unique.slice(0, limit) : unique;
}

/**
 * Turn a canonical hydrated post row into the feed entry the server would have
 * produced for it.
 *
 * The field set mirrors `campus_feed()`'s projection plus the `post` object
 * `getCampusFeed()` attaches, so `StreamItem`/`PostCard` render it exactly as they
 * render a normally loaded post: author, timestamp, body, GIF, counters, poll
 * options and the viewer's own reaction state all come from the same hydrated
 * record the read path returns.
 */
export function postToFeedItem(post) {
  if (!post?.id) return null;
  const kind = post.kind || 'post';
  return {
    id: post.id,
    type: kind === 'discussion' ? 'discussion' : kind === 'poll' ? 'poll' : 'post',
    title: post.title || null,
    body: post.body,
    gif: post.gif || null,
    authorUsername: post.author_username || null,
    authorDisplayName: post.author_display_name || null,
    isOfficial: post.is_official === true,
    communitySlug: post.community_slug || null,
    meta: {
      kind,
      reaction_count: post.reaction_count ?? 0,
      comment_count: post.comment_count ?? 0,
      pinned: post.pinned === true,
    },
    createdAt: post.created_at,
    sortAt: post.created_at,
    post,
  };
}

/**
 * Whether a canonical post belongs in the campus (Home) feed at all.
 *
 * Mirrors the two predicates `campus_feed()` applies to posts, and nothing more:
 * published, and not a community post. Checking it here is what stops a
 * community-only or moderation-held row from being inserted into a public feed
 * that the server would never render — the optimistic copy is only ever as
 * visible as the database says it is.
 */
export function isCampusFeedEligible(post) {
  return Boolean(post?.id) && post?.status === 'published' && !post?.community_id;
}

/**
 * Insert (or replace) one entry in a feed at the position its sort key demands.
 *
 * The result stays deduplicated and inside the surface's window, so an author's
 * own post cannot grow the feed past the ten entries the server returns, and a
 * second delivery of the same post (Realtime, then the refetch) replaces the
 * first instead of stacking under it.
 */
export function placeFeedItem(feed, item, { limit = 0 } = {}) {
  if (!item?.id) return Array.isArray(feed) ? feed : [];
  const current = Array.isArray(feed) ? feed : [];
  const rest = current.filter((candidate) => feedDedupeKey(candidate) !== feedDedupeKey(item));
  const merged = dedupeFeed([{ ...item }, ...rest]);
  merged.sort(compareFeedItems);
  return limit > 0 ? merged.slice(0, limit) : merged;
}

/** Convenience wrapper: place a hydrated post row into a mixed feed. */
export function placePostInFeed(feed, post, { limit = 0 } = {}) {
  const item = postToFeedItem(post);
  if (!item) return Array.isArray(feed) ? feed : [];
  return placeFeedItem(feed, item, { limit });
}

/** Remove one post everywhere it might be represented (any type label). */
export function removePostFromFeed(feed, postId) {
  if (!postId) return Array.isArray(feed) ? feed : [];
  const current = Array.isArray(feed) ? feed : [];
  const output = current.filter((item) => !(feedDedupeKey(item) === `post:${postId}`));
  return output.length === current.length ? current : output;
}

/** Canonical IDs only — no cached bodies or other record fields leave the browser. */
export function feedPostIds(items = [], limit = 0) {
  const seen = new Set();
  const output = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!isPostEntry(item)) continue;
    const value = item?.post?.id || item?.id;
    if (value == null) continue;
    const id = String(value);
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(id);
    if (limit > 0 && output.length >= limit) break;
  }
  return output;
}

/**
 * Difference between the server's *checked* and *visible* sets. Requested but
 * unchecked rows are deliberately retained: a bound, malformed ID or transient
 * lookup failure must never look like permission to delete a valid older page.
 */
export function findRemovedFeedPostIds(requestedIds = [], checkedIds = [], visibleIds = []) {
  const requested = new Set((Array.isArray(requestedIds) ? requestedIds : []).map(String));
  const visible = new Set((Array.isArray(visibleIds) ? visibleIds : []).map(String));
  const examined = new Set();
  const output = [];
  for (const value of Array.isArray(checkedIds) ? checkedIds : []) {
    const id = String(value);
    if (examined.has(id) || !requested.has(id) || visible.has(id)) continue;
    examined.add(id);
    output.push(id);
  }
  return output;
}

/**
 * Fold the locally held entries into an authoritative server payload.
 *
 * The server response replaces the window — that is the reconciliation — but an
 * entry this surface placed from its own confirmed write is kept when the payload
 * has not caught up with it yet, so a post never flashes out of view between the
 * insert and the next page. Once the server does return that row, the `post:<id>`
 * dedup collapses the two into the server's copy.
 */
export function reconcileFeed(serverItems = [], heldItems = [], { limit = 0 } = {}) {
  const server = Array.isArray(serverItems) ? serverItems : [];
  const held = (Array.isArray(heldItems) ? heldItems : []).filter(
    (item) => item?.id != null && !server.some((candidate) => feedDedupeKey(candidate) === feedDedupeKey(item)),
  );
  // `dedupeFeed` puts the server copy in the slot and leaves the locally held one
  // out, so ordering is the only thing the held entries can still influence.
  const merged = dedupeFeed([...server, ...held]);
  merged.sort(compareFeedItems);
  return limit > 0 ? merged.slice(0, limit) : merged;
}

/**
 * Merge two feed pages into one ordered window.
 *
 * Home is a window over several pages once a reader loads older entries, and every
 * re-read — a publish elsewhere, a Realtime change, a focus refetch — has to fold the
 * fresh newest page back into what is already on screen instead of replacing it. A
 * surface that replaced would scroll the reader's own loaded pages off the bottom the
 * moment anything landed.
 *
 * Whichever list goes first is the authoritative one: `dedupeFeed` keeps the copy in
 * the slot it finds first, so a page boundary can never show two copies of the same
 * post and a stale tail entry cannot overwrite a fresh head one. Ordering is then
 * re-applied, because `campus_feed()` sorts across the whole feed, not per page — a
 * pinned notice and a just-landed post belong where the sort puts them, whichever page
 * each came from.
 */
export function mergeFeedPages(primary = [], secondary = [], { limit = 0, removedPostIds = [] } = {}) {
  const removed = new Set((Array.isArray(removedPostIds) ? removedPostIds : []).map(String));
  const isRemoved = (item) => isPostEntry(item) && removed.has(String(item?.post?.id || item?.id || ''));
  const fresh = dedupeFeed(Array.isArray(primary) ? primary : []).filter((item) => !isRemoved(item));
  const loaded = fresh.map((item) => feedDedupeKey(item));
  const carried = new Set(loaded);
  // Filter first rather than letting `dedupeFeed` merge: on a slot both pages share, the
  // fresh copy must survive intact, because `dedupeFeed` merges field-by-field with the
  // *later* entry winning — right for an optimistic row meeting its server row, wrong for
  // an older page meeting a newer read of the same post. Confirmed-ineligible IDs are
  // removed from both sides, including an already-loaded older page.
  const older = (Array.isArray(secondary) ? secondary : []).filter(
    (item) => item && item.id != null && !carried.has(feedDedupeKey(item)) && !isRemoved(item),
  );
  const merged = dedupeFeed([...fresh, ...older]);
  merged.sort(compareFeedItems);
  return limit > 0 ? merged.slice(0, limit) : merged;
}

/**
 * A bounded "already handled" set, used to keep one post id from being counted as
 * a fresh change twice when Realtime, the router refresh and a page refetch all
 * report it. Mirrors the message deduper in `lib/messaging/state.js`, including
 * the FIFO bound so a long-lived tab cannot grow it without limit.
 */
export function createFeedDeduper(limit = 500) {
  const ids = new Set();
  const order = [];
  return {
    has(id) {
      return id != null && ids.has(String(id));
    },
    /** @returns {boolean} true when this id is new to the set (i.e. worth acting on). */
    remember(id) {
      if (id == null) return false;
      const key = String(id);
      if (ids.has(key)) return false;
      ids.add(key);
      order.push(key);
      if (order.length > limit) {
        for (const old of order.splice(0, order.length - limit)) ids.delete(old);
      }
      return true;
    },
    clear() {
      ids.clear();
      order.length = 0;
    },
  };
}
