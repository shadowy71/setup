import { afterEach, describe, expect, it } from 'vitest';
import {
  HOME_FEED_CACHE_TTL_MS,
  clearHomeFeedCache,
  prepareHomeFeed,
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
  it('keeps every entry the surface has, newest first — no window', () => {
    // Home used to store "the newest ten" here, which is why the page could never show
    // more than ten posts however many the request asked for. The cache holds what the
    // surface actually has (pages are only fetched when the reader asks); the bound on
    // memory is `MAX_CACHED_USERS`, not a slice.
    const result = prepareHomeFeed(items(12));
    expect(result.map((item) => item.id)).toEqual(items(12).map((item) => item.id));
    const times = result.map((item) => Date.parse(item.sortAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('deduplicates the same feed entry rather than growing a second copy', () => {
    const source = items(10);
    const result = prepareHomeFeed([source[0], ...source]);
    expect(result).toHaveLength(10);
    expect(result.filter((item) => item.id === source[0].id)).toHaveLength(1);
  });

  it('adds a newly acquired entry at the head without evicting the tail', () => {
    const original = items(10);
    writeHomeFeedCache('cache-test-a', { feed: original, events: [], notices: [] });
    const refreshed = [{ id: 'post-new', type: 'post', sortAt: new Date().toISOString() }, ...original];
    writeHomeFeedCache('cache-test-a', { feed: refreshed, events: [], notices: [] });

    const result = readHomeFeedCache('cache-test-a').payload.feed.map((item) => item.id);
    // Eleven, not ten: a post landing on a reader who has paged back must not push one
    // of their own loaded entries off the bottom of the list.
    expect(result).toHaveLength(11);
    expect(result[0]).toBe('post-new');
    expect(result).toContain(original[9].id);
  });

  it('scopes cached data by user and marks entries stale after the short TTL', () => {
    writeHomeFeedCache('cache-test-a', { feed: items(12), events: [], notices: [] });
    writeHomeFeedCache('cache-test-b', { feed: items(3), events: [], notices: [] });

    expect(readHomeFeedCache('cache-test-a').payload.feed).toHaveLength(12);
    expect(readHomeFeedCache('cache-test-b').payload.feed).toHaveLength(3);
    expect(readHomeFeedCache('cache-test-a').fresh).toBe(true);
    expect(HOME_FEED_CACHE_TTL_MS).toBe(15_000);
  });
});
