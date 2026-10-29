import { describe, expect, it } from 'vitest';
import {
  feedPostIds,
  findRemovedFeedPostIds,
  mergeFeedPages,
  postToFeedItem,
  reconcileFeed,
} from '@/lib/social/feed-state';

const NEW = '15fe0000-0000-4000-b000-000000000010';
const HIDDEN = '15fe0000-0000-4000-b000-000000000011';
const VALID_OLD = '15fe0000-0000-4000-b000-000000000012';
const UNCHECKED = '15fe0000-0000-4000-b000-000000000013';
const FRESH = '15fe0000-0000-4000-b000-000000000014';

const entry = (id, day, extra = {}) => ({
  id,
  type: 'post',
  body: `Post ${id}`,
  sortAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
  post: { id, status: 'published', created_at: new Date(Date.UTC(2026, 0, day)).toISOString() },
  ...extra,
});

describe('loaded-feed visibility reconciliation', () => {
  it('sends only bounded canonical post IDs, never non-post entries or duplicate cache rows', () => {
    const loaded = [
      entry(NEW, 20),
      { ...entry(NEW, 20), type: 'discussion' },
      { id: 'notice-1', type: 'notice', body: 'private rail content' },
      entry(HIDDEN, 18),
      entry(VALID_OLD, 17),
    ];
    expect(feedPostIds(loaded, 2)).toEqual([NEW, HIDDEN]);
    expect(feedPostIds(loaded)).toEqual([NEW, HIDDEN, VALID_OLD]);
  });

  it('removes only checked IDs absent from the visible set — never merely requested or unchecked IDs', () => {
    const requested = [NEW, HIDDEN, VALID_OLD, UNCHECKED];
    expect(findRemovedFeedPostIds(requested, [NEW, HIDDEN, VALID_OLD], [NEW, VALID_OLD])).toEqual([HIDDEN]);
    expect(findRemovedFeedPostIds(requested, [], [])).toEqual([]);
    expect(findRemovedFeedPostIds(requested, ['not-requested'], [])).toEqual([]);
  });

  it('drops a hidden post from an older loaded page while retaining valid older entries and accepted writes', () => {
    const held = postToFeedItem({
      id: NEW,
      kind: 'post',
      body: 'Accepted just now',
      status: 'published',
      community_id: null,
      created_at: new Date(Date.UTC(2026, 0, 25)).toISOString(),
    });
    const requested = [NEW, HIDDEN, VALID_OLD, UNCHECKED];
    const removed = findRemovedFeedPostIds(requested, [NEW, HIDDEN, VALID_OLD], [NEW, VALID_OLD]);
    const merged = mergeFeedPages(
      reconcileFeed([entry(FRESH, 24)], [held]),
      [entry(HIDDEN, 19), entry(VALID_OLD, 18), entry(UNCHECKED, 17)],
      { removedPostIds: removed },
    );

    expect(removed).toEqual([HIDDEN]);
    expect(merged.map((item) => item.id)).toEqual([NEW, FRESH, VALID_OLD, UNCHECKED]);
    expect(merged.filter((item) => item.id === NEW)).toHaveLength(1);

    // Repeating the same authoritative result is idempotent and adds no copies.
    const repeated = mergeFeedPages(merged, [entry(HIDDEN, 19), entry(VALID_OLD, 18)], { removedPostIds: removed });
    expect(repeated.map((item) => item.id)).toEqual([NEW, FRESH, VALID_OLD, UNCHECKED]);
  });

  it('keeps every loaded row when the visibility lookup fails or checks nothing', () => {
    const loaded = [entry(HIDDEN, 19), entry(VALID_OLD, 18)];
    const removed = findRemovedFeedPostIds([HIDDEN, VALID_OLD], [], []);
    const merged = mergeFeedPages([entry(FRESH, 24)], loaded, { removedPostIds: removed });
    expect(removed).toEqual([]);
    expect(merged.map((item) => item.id)).toEqual([FRESH, HIDDEN, VALID_OLD]);
  });

  it('does not infer deletion from a newest page that simply pushed a valid post older', () => {
    const loaded = [entry(VALID_OLD, 18), entry(UNCHECKED, 17)];
    const merged = mergeFeedPages([entry(FRESH, 24)], loaded, { removedPostIds: [] });
    expect(merged.map((item) => item.id)).toEqual([FRESH, VALID_OLD, UNCHECKED]);
  });
});
