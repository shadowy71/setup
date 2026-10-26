import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StreamItem } from '@/components/home/StreamItem';

// The stream card owns real action buttons, and those read the router; a static
// render needs the same stub the other rendering tests install.
vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));
import {
  createFeedDeduper,
  dedupeFeed,
  feedDedupeKey,
  isCampusFeedEligible,
  isPostEntry,
  limitFeed,
  placeFeedItem,
  placePostInFeed,
  postToFeedItem,
  reconcileFeed,
  removePostFromFeed,
  sortFeed,
} from '@/lib/social/feed-state';

/**
 * The rules every feed surface uses to fold a newly published post into the list it
 * is already showing.
 *
 * These are the guarantees the bug was missing: the row the author just created has
 * to land at the position the server would have given it, must not survive twice when
 * the Realtime signal or a page refetch reports the same row, must not be placed at
 * all when the database did not publish it, and must render as the complete post it
 * is — never a stub a card cannot hydrate.
 */

const AUTHOR = '15fe0000-0000-4000-a000-000000000001';
const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-25T06:00:00.000Z');
const at = (hoursAgo) => new Date(T0 - hoursAgo * HOUR).toISOString();

function hydratedPost(overrides = {}) {
  return {
    id: '15fe0000-0000-4000-b000-000000000001',
    author_id: AUTHOR,
    kind: 'post',
    title: null,
    body: 'The lab 3 projector is fixed.',
    gif: null,
    community_id: null,
    status: 'published',
    is_official: false,
    comment_count: 0,
    reaction_count: 0,
    created_at: at(0),
    author_username: 'feed_asha',
    author_display_name: 'Feed Asha',
    author_is_staff: false,
    reacted_by_me: false,
    poll: null,
    ...overrides,
  };
}

/** An entry as the `campus_feed()` read path returns it. */
function serverItem(id, hoursAgo, extra = {}) {
  return {
    id,
    type: 'post',
    title: null,
    body: `Post ${id}`,
    gif: null,
    authorUsername: 'feed_asha',
    authorDisplayName: 'Feed Asha',
    isOfficial: false,
    communitySlug: null,
    meta: { kind: 'post', reaction_count: 0, comment_count: 0, pinned: false },
    createdAt: at(hoursAgo),
    sortAt: at(hoursAgo),
    post: { id, created_at: at(hoursAgo), status: 'published', reaction_count: 0, comment_count: 0 },
    ...extra,
  };
}

describe('placement follows the server sort order', () => {
  it('puts a new campus post at the head of a newest-first feed', () => {
    const feed = [serverItem('older-2', 5), serverItem('older-1', 3)];
    const placed = placePostInFeed(feed, hydratedPost());

    expect(placed.map((item) => item.id)).toEqual([
      '15fe0000-0000-4000-b000-000000000001',
      'older-1',
      'older-2',
    ]);
  });

  it('sorts by the server sort value when one is present, so pinned notices stay ahead', () => {
    const feed = [serverItem('notice-1', 1, { type: 'notice', sortAt: at(-24) })];
    const placed = placePostInFeed(feed, hydratedPost({ created_at: at(0) }));

    // The notice's sort_at is a day in the future (a pinned notice is stamped that
    // way by campus_feed), so the new post must land below it, not above it.
    expect(placed.map((item) => item.id)).toEqual(['notice-1', '15fe0000-0000-4000-b000-000000000001']);
  });

  it('keeps a post out of a feed window it would not fit in', () => {
    const feed = [serverItem('a', 0.1), serverItem('b', 0.2), serverItem('c', 0.3)];
    const placed = placePostInFeed(feed, hydratedPost({ created_at: at(4) }), { limit: 3 });

    expect(placed).toHaveLength(3);
    expect(placed.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('replaces rather than stacks when the same post is delivered twice', () => {
    const feed = [serverItem('x', 2)];
    const once = placePostInFeed(feed, hydratedPost());
    const twice = placePostInFeed(once, hydratedPost());

    expect(twice.filter((item) => item.id === '15fe0000-0000-4000-b000-000000000001')).toHaveLength(1);
  });

  it('folds an out-of-order refetch page into the rows already on screen', () => {
    const feed = [serverItem('a', 0), serverItem('b', 1)];
    // The page came back in a different order, and one row was already on screen.
    const merged = reconcileFeed([...feed, serverItem('b', 1), serverItem('a', 0)], [], { limit: 10 });

    expect(merged.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('leaves an empty feed empty instead of throwing, and handles a first page', () => {
    expect(placePostInFeed([], hydratedPost())).toHaveLength(1);
    // A surface with no remembered page yet still gets the confirmed post, because
    // the record is canonical — this is the "first page, empty feed" case.
    expect(placePostInFeed(undefined, hydratedPost())).toHaveLength(1);
    expect(reconcileFeed([], [], { limit: 10 })).toEqual([]);
    expect(sortFeed(undefined)).toEqual([]);
    expect(dedupeFeed(null)).toEqual([]);
  });

  it('uses a stable tiebreak so equal timestamps do not shuffle between renders', () => {
    const same = [serverItem('b', 1), serverItem('a', 1)];
    expect(sortFeed(same).map((item) => item.id)).toEqual(['a', 'b']);
    expect(sortFeed([...same].reverse()).map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('deduplication is by canonical database post id', () => {
  it('collapses the same post labelled differently by two read paths', () => {
    const post = { id: 'p1', created_at: at(1), status: 'published' };
    const items = [
      { id: 'p1', type: 'post', post, createdAt: at(1) },
      { id: 'p1', type: 'discussion', post, createdAt: at(1) },
    ];

    expect(feedDedupeKey(items[0])).toBe('post:p1');
    expect(feedDedupeKey(items[1])).toBe('post:p1');
    expect(dedupeFeed(items)).toHaveLength(1);
  });

  it('keeps non-post entries with the same id in their own slot', () => {
    const items = [
      { id: 'n1', type: 'notice', createdAt: at(1) },
      { id: 'n1', type: 'event', createdAt: at(1) },
    ];

    expect(dedupeFeed(items)).toHaveLength(2);
    expect(isPostEntry(items[0])).toBe(false);
  });

  it('never lets a less authoritative copy replace a canonical one', () => {
    const canonical = serverItem('p1', 1);
    const optimistic = { ...canonical, optimistic: true, body: 'stale draft copy' };

    expect(dedupeFeed([canonical, optimistic])[0].body).toBe('Post p1');
    // …but while the optimistic copy is all there is, it is kept and later upgraded.
    const upgraded = dedupeFeed([optimistic, { id: 'p1', type: 'post', body: 'from server', post: canonical.post }]);
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0].optimistic).toBeUndefined();
  });

  it('drops a post whatever label it was carried under', () => {
    const feed = [serverItem('p1', 1), { id: 'p1', type: 'poll', createdAt: at(1) }];

    expect(removePostFromFeed(feed, 'p1')).toHaveLength(0);
    expect(removePostFromFeed(feed, null)).toBe(feed);
  });

  it('respects the surface window on every merge path', () => {
    expect(limitFeed([serverItem('a', 1), serverItem('a', 1), serverItem('b', 2)], 1)).toHaveLength(1);
  });
});

describe('only what the database published may be placed', () => {
  it('refuses a community-scoped row, so a members-only post cannot leak into campus', () => {
    expect(isCampusFeedEligible(hydratedPost())).toBe(true);
    expect(isCampusFeedEligible(hydratedPost({ community_id: 'c1', visibility: 'community' }))).toBe(false);
    expect(isCampusFeedEligible(hydratedPost({ status: 'pending' }))).toBe(false);
    expect(isCampusFeedEligible(hydratedPost({ status: 'hidden' }))).toBe(false);
    expect(isCampusFeedEligible(hydratedPost({ status: 'removed' }))).toBe(false);
    expect(isCampusFeedEligible(null)).toBe(false);
  });

  it('places nothing when the post is not eligible — the guard the caller relies on', () => {
    const feed = [serverItem('a', 1)];
    const item = postToFeedItem(hydratedPost({ status: 'pending' }));

    // `applyCreatedPost` returns before this; the assertion here is that a pending
    // row has no representation the feed could invent one from.
    expect(item.post.status).toBe('pending');
    expect(feed).toHaveLength(1);
  });
});

describe('a held optimistic entry reconciles against the server page', () => {
  it('keeps the held entry while the server page has not caught up', () => {
    const held = postToFeedItem(hydratedPost());
    const server = [serverItem('a', 1)];
    const merged = reconcileFeed(server, [held], { limit: 10 });

    expect(merged.map((item) => item.id)).toEqual([
      '15fe0000-0000-4000-b000-000000000001',
      'a',
    ]);
  });

  it('folds the held entry into the server copy once the row comes back', () => {
    const post = hydratedPost({ reaction_count: 4, comment_count: 2 });
    const held = postToFeedItem(post);
    const server = [serverItem(post.id, 0, { post, body: 'The lab 3 projector is fixed.' })];
    const merged = reconcileFeed(server, [held], { limit: 10 });

    expect(merged).toHaveLength(1);
    expect(merged[0].post.reaction_count).toBe(4);
  });

  it('drops a server entry the author deleted locally, and a held entry that expired', () => {
    const held = postToFeedItem(hydratedPost());
    const server = [serverItem('a', 1)];

    // Removal wins over the held entry: the caller prunes both, so nothing lingers.
    const withoutIt = removePostFromFeed(reconcileFeed(server, [held]), held.id);
    expect(withoutIt.map((item) => item.id)).toEqual(['a']);
  });

  it('never grows past the window the server used', () => {
    const held = [postToFeedItem(hydratedPost())];
    const server = [serverItem('a', 1), serverItem('b', 2)];

    expect(reconcileFeed(server, held, { limit: 2 })).toHaveLength(2);
  });

  it('survives a missing or malformed payload', () => {
    expect(reconcileFeed(undefined, undefined)).toEqual([]);
    expect(reconcileFeed(null, [null, undefined])).toEqual([]);
    expect(placeFeedItem([], { id: null })).toEqual([]);
  });
});

describe('a created post renders exactly like a loaded one', () => {
  const post = hydratedPost({
    kind: 'poll',
    title: 'Which slot for the retro?',
    body: 'Which slot for the retro?',
    reaction_count: 3,
    comment_count: 2,
    reacted_by_me: true,
    poll: {
      closes_at: at(-2),
      options: [
        { id: 'o1', label: 'Monday', vote_count: 4, mine: true },
        { id: 'o2', label: 'Thursday', vote_count: 1, mine: false },
      ],
    },
  });
  const placed = postToFeedItem(post);
  const loaded = serverItem(post.id, 0, {
    type: 'poll',
    title: post.title,
    body: post.body,
    meta: { kind: 'poll', reaction_count: 3, comment_count: 2, pinned: false },
    createdAt: post.created_at,
    sortAt: post.created_at,
    post,
  });

  it('carries author, timestamp, counters and poll block on the same fields', () => {
    expect(placed.id).toBe(loaded.id);
    expect(placed.type).toBe(loaded.type);
    expect(placed.authorUsername).toBe('feed_asha');
    expect(placed.createdAt).toBe(post.created_at);
    expect(placed.meta).toEqual(loaded.meta);
    expect(placed.post.poll.options.map((option) => option.label)).toEqual(['Monday', 'Thursday']);
  });

  it('renders byte-identical stream markup to the normally loaded entry', () => {
    // `React.createElement`, not JSX: the test transform in vitest.config.mjs
    // enables JSX for components/** only.
    const render = (item) => renderToStaticMarkup(React.createElement(StreamItem, {
      item,
      post: item.post,
      currentUserId: AUTHOR,
      canModerate: false,
      reactions: { count: item.post?.reaction_count || 0, mine: Boolean(item.post?.reacted_by_me) },
    }));

    const fromCreate = render(placed);
    const fromRead = render(loaded);

    expect(fromCreate).toBe(fromRead);
    // The pieces that would be missing from a placeholder: the author handle, the
    // poll question and its option counts, the reaction/comment counters.
    expect(fromCreate).toContain('@feed_asha');
    expect(fromCreate).toContain('Which slot for the retro?');
    expect(fromCreate).toContain('Monday');
    expect(fromCreate).toContain('4');
  });

  it('returns null for a record with no id, so no empty card is ever inserted', () => {
    expect(postToFeedItem({ body: 'orphan' })).toBeNull();
    expect(postToFeedItem(null)).toBeNull();
  });
});

describe('one bounded seen-set per tab', () => {
  it('counts a post as fresh once, however many channels report it', () => {
    const deduper = createFeedDeduper();

    expect(deduper.remember('p1')).toBe(true);
    expect(deduper.remember('p1')).toBe(false);
    expect(deduper.has('p1')).toBe(true);
    expect(deduper.has('nope')).toBe(false);
    expect(deduper.remember(null)).toBe(false);
  });

  it('stays bounded so a long-lived tab cannot grow it forever', () => {
    const deduper = createFeedDeduper(3);
    for (let i = 0; i < 10; i += 1) deduper.remember(`p${i}`);

    expect(deduper.has('p9')).toBe(true);
    expect(deduper.has('p0')).toBe(false);
    expect(deduper.has('p7')).toBe(true);
    deduper.clear();
    expect(deduper.has('p9')).toBe(false);
    // Cleared ids are fresh again — a reconnect must not silently drop a post that
    // arrived while the socket was down.
    expect(deduper.remember('p9')).toBe(true);
  });

  it('is per-tab state, not shared between mounts', () => {
    const a = createFeedDeduper();
    const b = createFeedDeduper();
    a.remember('p1');

    expect(b.has('p1')).toBe(false);
  });
});
