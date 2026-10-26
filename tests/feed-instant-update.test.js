import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
  HOME_FEED_LIMIT,
  clearHomeFeedCache,
  patchHomeFeedCache,
  readHomeFeedCache,
  writeHomeFeedCache,
} from '@/components/home/homeFeedCache';
import { postToFeedItem, reconcileFeed } from '@/lib/social/feed-state';

/**
 * The wiring between "the server said ok" and "the feed on screen says so".
 *
 * The original bug was a prop that was passed but never declared: `HomeFeedClient`
 * handed the composer an `onCreated` callback, `PostComposer` did not accept one, so
 * the only mechanism that could update a client-held feed never ran. Everything a
 * reader can verify from a diff is asserted here — that both ends of that seam agree,
 * that the remembered page is patched rather than waited out, that a failure leaves
 * the draft alone, and that no surface reaches for a reload as the fix.
 */

const read = (file) => fs.readFileSync(file, 'utf8');

const USER = '15fe0000-0000-4000-a000-000000000001';
const T0 = Date.parse('2026-10-25T06:00:00.000Z');
const at = (hoursAgo) => new Date(T0 - hoursAgo * 3_600_000).toISOString();

const entry = (id, hoursAgo) => ({
  id,
  type: 'post',
  body: `Post ${id}`,
  createdAt: at(hoursAgo),
  sortAt: at(hoursAgo),
  post: { id, status: 'published', created_at: at(hoursAgo) },
});

const createdPost = (overrides = {}) => ({
  id: '15fe0000-0000-4000-b000-000000000001',
  author_id: USER,
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
});

afterEach(() => {
  clearHomeFeedCache(USER);
});

describe('the composer hands the confirmed post to the surface', () => {
  it('accepts onCreated and calls it with the action result', () => {
    const composer = read('components/posts/PostComposer.js');

    expect(composer).toMatch(/onCreated = null,/);
    expect(composer).toMatch(/onCreated\?\.\(result\);/);
    // …and it is called with the whole result, so the surface can read `post`,
    // `pending` and `status` off the same server response.
    expect(composer).toMatch(/useFormAction\(createPost, \{\s*\n\s*onSuccess: \(result\) => \{/);
  });

  it('is actually passed that prop by every surface that composes into a feed', () => {
    const home = read('components/home/HomeFeedClient.js');

    expect(home).toMatch(/onCreated=\{applyCreatedPost\}/);
    // Home used to hand over `() => void refresh(true)`, which the composer ignored:
    // a refresh alone could not put a row into state Home owns.
    expect(home).not.toMatch(/onCreated=\{\(\) => void refresh/);
  });

  it('places the canonical row, patches the remembered page, then re-reads once', () => {
    const home = read('components/home/HomeFeedClient.js');
    const apply = home.slice(home.indexOf('const applyCreatedPost'), home.indexOf('// Live changes:'));

    expect(apply).toMatch(/if \(!isCampusFeedEligible\(post\)\) return;/);
    expect(apply).toMatch(/postToFeedItem\(post\)/);
    expect(apply).toMatch(/placePostInFeed\(payload\?\.feed \|\| \[\], post, \{ limit: HOME_FEED_LIMIT \}\)/);
    expect(apply).toMatch(/patchHomeFeedCache\(userId, patch, feedRevision\(\)\)/);
    expect(apply).toMatch(/held\.set\(String\(post\.id\), \{ item, at: Date\.now\(\) \}\)/);
    // Exactly one follow-up read, through the invalidation path the other surfaces
    // hear too — not a second fetch per placed post.
    expect(apply).toMatch(/invalidateFeed\('local', \[post\.id\]\);/);
    expect(apply).not.toMatch(/fetch\(/);
    expect(apply.match(/setSnapshot/g)).toHaveLength(2);
  });

  it('never reloads the page or asks the student for a refresh button', () => {
    const files = [
      'components/home/HomeFeedClient.js',
      'components/posts/PostComposer.js',
      'components/social/LiveFeedSync.js',
      'components/layout/LiveFeedProvider.js',
      'lib/forms.js',
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/location\.reload|location\.href = location\.href|window\.location\.assign/);
      expect(source).not.toMatch(/<Button[^>]*>\s*(Refresh|Reload)/);
      expect(source).not.toMatch(/aria-label="[^"]*(refresh|reload)/i);
    }
  });

  it('keeps the current tab and scroll position instead of remounting the stream', () => {
    const home = read('components/home/HomeFeedClient.js');

    // A created post is merged into the existing snapshot; nothing resets it to a
    // skeleton, which is what made a reload feel necessary before.
    expect(home).toMatch(/if \(stored\) setSnapshot\(stored\);/);
    expect(home.slice(home.indexOf('const applyCreatedPost'), home.indexOf('// Live changes:')))
      .not.toMatch(/setLoading\(true\)/);
  });
});

describe('the remembered page follows the write', () => {
  it('shows a patched page inside the cache window, and marks it with the live revision', () => {
    writeHomeFeedCache(USER, { feed: [entry('a', 1), entry('b', 2)], events: [], notices: [] }, 4);

    const post = createdPost();
    const patched = patchHomeFeedCache(
      USER,
      (payload) => ({ ...payload, feed: [postToFeedItem(post), ...payload.feed] }),
      5,
    );

    expect(patched.feed.map((item) => item.id)).toEqual([post.id, 'a', 'b']);
    const stored = readHomeFeedCache(USER);
    expect(stored.fresh).toBe(true);
    // The revision moved with the patch, so a page stored by this write is the one a
    // remount is allowed to serve — and any page stored before it is not.
    expect(stored.revision).toBe(5);
  });

  it('does not invent a page for a user with nothing stored', () => {
    expect(patchHomeFeedCache(USER, (payload) => payload, 1)).toBeNull();
    expect(readHomeFeedCache(USER)).toBeNull();
  });

  it('collapses the placed row and the server page into one entry at the window size', () => {
    const post = createdPost();
    const server = [entry('a', 1), entry('b', 2)];
    writeHomeFeedCache(USER, { feed: server, events: [], notices: [] }, 1);

    const placed = patchHomeFeedCache(USER, (payload) => ({
      ...payload,
      feed: [postToFeedItem(post), ...payload.feed, postToFeedItem(post)],
    }));

    expect(placed.feed.filter((item) => item.id === post.id)).toHaveLength(1);
    expect(placed.feed).toHaveLength(3);

    // And when the authoritative page finally contains the row, the cache holds one
    // copy of it — the server's — in newest-first order, inside the window.
    const fromServer = { ...postToFeedItem(post), post: { ...post, reaction_count: 7 } };
    const caught = patchHomeFeedCache(USER, (payload) => ({
      ...payload,
      feed: reconcileFeed([fromServer, ...server], [postToFeedItem(post)], { limit: HOME_FEED_LIMIT }),
    }));

    expect(caught.feed.filter((item) => item.id === post.id)).toHaveLength(1);
    expect(caught.feed[0].post.reaction_count).toBe(7);
    expect(caught.feed.length).toBeLessThanOrEqual(HOME_FEED_LIMIT);
    const times = caught.feed.map((item) => Date.parse(item.sortAt || item.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe('success and failure mean different things to the composer', () => {
  it('clears the draft only after the action confirmed a real row', () => {
    const composer = read('components/posts/PostComposer.js');
    const success = composer.slice(composer.indexOf('onSuccess: (result) => {'), composer.indexOf('const isPoll'));

    expect(success).toContain("setBody('')");
    expect(success).toContain('setGif(null)');
    expect(success).toContain("setOptions(['', ''])");
    expect(success).toContain('formRef.current?.reset()');
    // Nothing outside that callback clears the draft, so a failed write keeps it.
    const outside = composer.replace(success, '');
    expect(outside).not.toMatch(/setBody\(''\)/);
    expect(outside).not.toMatch(/formRef\.current\?\.reset\(\)/);
  });

  it('relies on the shared action runner returning before success on a failed write', () => {
    const forms = read('lib/forms.js');

    expect(forms).toMatch(/if \(!result \|\| result\.ok === false\) \{\s*\n\s*setError\([\s\S]*?\n\s*return;\s*\n\s*\}/);
    // So `onSuccess`, the draft reset and `router.refresh()` are all unreachable on a
    // failure: no optimistic "Posted", no lost text, no silent reload.
    expect(forms.indexOf('if (!result || result.ok === false)')).toBeLessThan(forms.indexOf('if (onSuccess) onSuccess(result);'));
    expect(forms.indexOf('if (!result || result.ok === false)')).toBeLessThan(forms.indexOf('router.refresh();'));
  });

  it('says what moderation did instead of claiming publication', () => {
    const composer = read('components/posts/PostComposer.js');

    expect(composer).toMatch(/if \(result\?\.pending\) \{/);
    expect(composer).toMatch(/setHeld\(/);
    // The notice is bounded, and it is the only UI for a held row: the feed is not
    // told about a post that the feed cannot show.
    expect(composer).toMatch(/HELD_NOTICE_MS = 9_000/);
    expect(composer).toMatch(/timerRef\.current = setTimeout/);
    expect(composer).toMatch(/useEffect\(\(\) => \(\) => \{\s*\n\s*if \(timerRef\.current\) clearTimeout\(timerRef\.current\);/);
  });

  it('cannot be submitted twice while the first write is in flight', () => {
    const composer = read('components/posts/PostComposer.js');

    expect(composer).toMatch(/const canSubmit = !pending &&/);
    expect(composer).toMatch(/loading=\{pending\} disabled=\{!canSubmit\}/);
    expect(composer).toMatch(/\{pending \? 'Posting…'/);
  });
});

describe('every other surface that lists posts is told to re-read', () => {
  it('invalidates the feed once per flushed change, not once per card', () => {
    const sync = read('components/social/LiveFeedSync.js');

    expect(sync).toMatch(/router\.refresh\(\)/);
    expect(sync).toMatch(/export const FEED_SYNC_THROTTLE_MS = 4_000;/);
    // A change this tab caused, or a gap that has to be closed, is applied at once —
    // the throttle only exists to absorb Realtime bursts.
    expect(sync).toMatch(/const IMMEDIATE_REASONS = \['local', 'reconcile', 'reconnect'\];/);
    expect(sync).toMatch(/IMMEDIATE_REASONS\.includes\(event\?\.reason\)/);
    // Subscribed on mount, unsubscribed on unmount — a board left open in a
    // background tab must not keep a listener alive after it is gone.
    expect(sync).toMatch(/const unsubscribe = feed\.subscribe\(/);
    expect(sync).toMatch(/return \(\) => \{\s*\n\s*unsubscribe\(\);/);
    // It renders nothing, so a board cannot show a partially hydrated row.
    expect(sync).toMatch(/return null;/);
  });

  it('is mounted on each server-rendered board that lists posts', () => {
    const pages = [
      'app/(app)/explore/page.js',
      'app/(app)/profile/page.js',
      'app/(app)/communities/[slug]/page.js',
      'app/(app)/clubs/[id]/page.js',
      'app/(app)/user/[username]/page.js',
    ];

    for (const page of pages) {
      expect(read(page)).toMatch(/<LiveFeedSync \/>/);
    }
  });

  it('owns one channel per signed-in profile in the shell', () => {
    const shell = read('components/layout/AppShell.js');
    const layout = read('app/(app)/layout.js');

    // The profile id, from the session the layout already resolves — never a uid,
    // because the channel topic is authorized against `current_profile_id()`.
    expect(layout).toMatch(/feedUserId=\{user\.profile\.id\}/);
    // `key` is what makes it impossible for a channel to follow a student from one
    // account to the next on a shared device.
    expect(shell).toMatch(/<LiveFeedProvider key=\{feedUserId \|\| 'signed-out'\}/);
    expect(shell).toMatch(/MessagingProvider/);
  });

  it('announces a delete through the provider instead of threading a callback down', () => {
    const actions = read('components/posts/PostActions.js');

    expect(actions).toMatch(/useLiveFeed\(\)/);
    expect(actions).toMatch(/announce\('removed'/);
    expect(actions).toMatch(/announce\('local'/);
    const home = read('components/home/HomeFeedClient.js');
    expect(home).toMatch(/if \(event\?\.reason === 'removed' && ids\.length\) \{/);
    expect(home).toMatch(/removePostFromFeed/);
    // …and the held copy is released, so a deleted row cannot be resurrected by the
    // next reconcile.
    expect(home).toMatch(/for \(const id of ids\) held\.delete\(id\);/);
  });
});

describe('the Home request stays honest about what it is serving', () => {
  it('re-reads when focus returns or the shell moved on', () => {
    const home = read('components/home/HomeFeedClient.js');

    expect(home).toMatch(/document\.addEventListener\('visibilitychange'/);
    expect(home).toMatch(/window\.addEventListener\('focus'/);
    expect(home).toMatch(/cacheIsUsable\(readHomeFeedCache\(userId\), feedRevision\(\)\)/);
    // Both ways a page can be out of date: the TTL window, or a revision change.
    expect(home).toMatch(/function cacheIsUsable\(cached, revision\) \{\s*\n\s*return Boolean\(cached\?\.payload\) && cached\.fresh && cached\.revision === revision;/);
  });

  it('keeps the in-flight request coalesced so signals cannot stack fetches', () => {
    const home = read('components/home/HomeFeedClient.js');

    expect(home).toMatch(
      /if \(requestRef\.current\) \{\s*\n\s*if \(!force\) return requestRef\.current;\s*\n\s*await requestRef\.current\.catch\(\(\) => \{\}\);/,
    );
    expect(home).toMatch(/requestRef\.current = task;/);
    expect(home).toMatch(/const previous = readHomeFeedCache\(userId\);/);
  });

  it('serves the API route dynamically so a cached page is the only cache in the path', () => {
    const route = read('app/api/home/feed/route.js');

    expect(route).toMatch(/export const dynamic = 'force-dynamic'/);
    expect(route).toMatch(/no-store/);
    expect(route).toMatch(/Vary.*Cookie|'Cache-Control': 'no-store', 'Vary': 'Cookie'|Vary: 'Cookie'/);
  });
});
