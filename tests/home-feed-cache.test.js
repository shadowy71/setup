import { afterEach, describe, expect, it } from 'vitest';
import {
  HOME_FEED_CACHE_TTL_MS,
  HOME_FEED_LIMIT,
  clearHomeFeedCache,
  limitHomeFeed,
  readHomeFeedCache,
  writeHomeFeedCache,
} from '@/components/home/homeFeedCache';

const items = (count) => Array.from({ length: count }, (_, index) => ({
  id: `post-${index + 1}`,
  type: 'post',
  sortAt: new Date(Date.UTC(2026, 0, count - index)).toISOString(),
}));

afterEach(() => {
  clearHomeFeedCache('cache-test-a');
  clearHomeFeedCache('cache-test-b');
});

describe('Home feed cache', () => {
  it('keeps only the ten newest feed entries (oldest entries fall off the end)', () => {
    expect(HOME_FEED_LIMIT).toBe(10);
    expect(limitHomeFeed(items(12)).map((item) => item.id)).toEqual(items(10).map((item) => item.id));
  });

  it('deduplicates the same feed entry before applying the limit', () => {
    const source = items(10);
    const result = limitHomeFeed([source[0], ...source]);
    expect(result).toHaveLength(10);
    expect(result.filter((item) => item.id === source[0].id)).toHaveLength(1);
  });

  it('adds newly acquired entries at the head and drops the oldest entry (FIFO tail eviction)', () => {
    const original = items(10);
    writeHomeFeedCache('cache-test-a', { feed: original, events: [], notices: [] });
    const refreshed = [{ id: 'post-new', type: 'post', sortAt: new Date().toISOString() }, ...original];
    writeHomeFeedCache('cache-test-a', { feed: refreshed, events: [], notices: [] });

    const result = readHomeFeedCache('cache-test-a').payload.feed.map((item) => item.id);
    expect(result).toHaveLength(10);
    expect(result[0]).toBe('post-new');
    expect(result).toEqual(['post-new', ...original.slice(0, 9).map((item) => item.id)]);
    expect(result).not.toContain(original[9].id);
  });

  it('scopes cached data by user and marks entries stale after the short TTL', () => {
    writeHomeFeedCache('cache-test-a', { feed: items(12), events: [], notices: [] });
    writeHomeFeedCache('cache-test-b', { feed: items(3), events: [], notices: [] });

    expect(readHomeFeedCache('cache-test-a').payload.feed).toHaveLength(10);
    expect(readHomeFeedCache('cache-test-b').payload.feed).toHaveLength(3);
    expect(readHomeFeedCache('cache-test-a').fresh).toBe(true);
    expect(HOME_FEED_CACHE_TTL_MS).toBe(15_000);
  });
});
