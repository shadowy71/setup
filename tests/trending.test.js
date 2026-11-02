import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  TRENDING_BAR_FORMULA,
  TRENDING_COMMENT_WEIGHT,
  TRENDING_FORMULA,
  TRENDING_FULL_SCALE,
  TRENDING_HALF_LIFE_HOURS,
  TRENDING_POST_AGE_FLOOR,
  TRENDING_POST_AGE_HALF_LIFE_HOURS,
  TRENDING_WINDOW_HOURS,
  trendingDecay,
  trendingScore,
} from '@/lib/constants';
import { activityBarPercentages } from '@/lib/social/activity-scale';

/**
 * The mechanism behind "Busiest right now", end to end. The SQL in migration
 * 040 is the production implementation; `trendingScore` here is the published
 * mirror the guide and these tests read, so the two are pinned together. The
 * scenarios below are the ones from the brief, exercised against real rows of
 * engagement timestamps and the exact bar formula HomeRail uses.
 */

const read = (file) => fs.readFileSync(file, 'utf8');
const NOW = Date.parse('2026-11-02T12:00:00.000Z');
const at = (hoursAgo) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

/** One row per reaction/comment, exactly as `reactions` / `comments` store them. */
const discussion = (id, { likes = 0, comments = 0, likeAge = 0.05, commentAge = 0.05, age = 1 } = {}) => ({
  id,
  created_at: at(age),
  likes: Array.from({ length: likes }, () => at(likeAge)),
  comments: Array.from({ length: comments }, () => at(commentAge)),
});

const scoreOf = (post) => trendingScore({
  likes: post.likes,
  comments: post.comments,
  createdAt: post.created_at,
  now: NOW,
});
/** Mirrors SQL: score desc, created_at desc, id asc (deterministic ties). */
const ranked = (posts) => posts
  .map((post) => ({ ...post, score: scoreOf(post) }))
  .sort((a, b) => b.score - a.score
    || Date.parse(b.created_at) - Date.parse(a.created_at)
    || String(a.id).localeCompare(String(b.id)));
const barsFor = (posts) => activityBarPercentages(posts.map((post) => post.score), TRENDING_FULL_SCALE);

describe('published configuration', () => {
  it('uses a 24–48 h window and a substantial, configurable benchmark', () => {
    expect(TRENDING_WINDOW_HOURS).toBeGreaterThanOrEqual(24);
    expect(TRENDING_WINDOW_HOURS).toBeLessThanOrEqual(48);
    expect(TRENDING_FULL_SCALE).toBeGreaterThanOrEqual(20);
    expect(TRENDING_FULL_SCALE).toBeLessThanOrEqual(25);
    expect(TRENDING_HALF_LIFE_HOURS).toBe(12);
    expect(TRENDING_COMMENT_WEIGHT).toBe(2);
    expect(TRENDING_POST_AGE_HALF_LIFE_HOURS).toBe(72);
    expect(TRENDING_POST_AGE_FLOOR).toBe(0.5);
    expect(TRENDING_FORMULA).toContain('score');
    expect(TRENDING_BAR_FORMULA).toContain('ln(1 + score)');
  });

  it('keeps the SQL defaults and the published constants in step', () => {
    const sql = read('supabase/migrations/20261102000002_040_busiest_trending.sql');
    expect(sql).toContain("setting_int('trending_half_life_hours', 12)");
    expect(sql).toContain("setting_int('trending_post_age_half_life_hours', 72)");
    expect(sql).toContain("setting_int('trending_comment_weight', 2)");
    expect(sql).toContain('0.5::numeric as post_floor');
    expect(sql).toContain('p_hours integer default 48');
    expect(sql).toContain('order by score desc, p.created_at desc, p.id asc');
    expect(sql).toContain('security invoker');
    expect(sql).toContain("r.target_type = 'post'");
    expect(sql).toContain("c.status = 'published'");
    expect(sql).toContain('p.deleted_at is null');
    // The old lifetime-counter, unbounded-participation score is gone.
    expect(sql).not.toContain('pow(age_hours + 2');
    expect(sql).not.toMatch(/count\(distinct cm\.author_id\)/);
    // Partial indexes keep both windowed aggregations bounded.
    expect(sql).toContain('reactions_recent_post_idx');
    expect(sql).toContain('comments_recent_published_idx');
  });

  it('ranks and normalizes in one place each, never relatively', () => {
    const scale = read('lib/social/activity-scale.js');
    const rail = read('components/home/HomeRail.js');
    const client = read('components/home/HomeFeedClient.js');
    expect(scale).toContain('Math.log1p');
    expect(scale).not.toMatch(/Math\.max\(\.\.\.values\)/);
    expect(scale).not.toContain('ceiling');
    expect(rail).toContain('activityBarPercentages(');
    expect(rail).toContain('TRENDING_FULL_SCALE');
    // The rail no longer derives a "busiest" list from the loaded feed page.
    expect(client).toContain('const trending = snapshot?.trending || [];');
    expect(client).not.toMatch(/b\.reaction_count \|\| 0\) \+ \(b\.comment_count/);
    expect(read('app/api/home/feed/route.js')).toContain('getTrendingPosts(supabase');
    expect(read('lib/data/feed.js')).toContain("supabase.rpc('trending_posts'");
  });
});

describe('time decay', () => {
  it('weights a fresh event at 1, halves around the half-life, and reaches 0 at the window edge', () => {
    expect(trendingDecay(0)).toBeCloseTo(1, 6);
    expect(trendingDecay(TRENDING_HALF_LIFE_HOURS)).toBeCloseTo(0.4667, 3);
    expect(trendingDecay(24)).toBeCloseTo(0.2, 3);
    expect(trendingDecay(TRENDING_WINDOW_HOURS)).toBe(0);
    expect(trendingDecay(TRENDING_WINDOW_HOURS + 1)).toBe(0);
    expect(trendingDecay(-5)).toBeCloseTo(1, 6);
    expect(trendingDecay(Infinity)).toBe(0);
    expect(trendingDecay(NaN)).toBe(0);
  });

  it('ignores engagement outside the window and never generates engagement', () => {
    const fresh = discussion('fresh', { likes: 2 });
    const stale = discussion('stale', { likes: 2, likeAge: TRENDING_WINDOW_HOURS + 1 });
    expect(scoreOf(fresh)).toBeGreaterThan(1.9);
    expect(scoreOf(stale)).toBe(0);
    expect(scoreOf(discussion('empty'))).toBe(0);
    expect(trendingScore({ likes: [NaN, null, 'not-a-date'], createdAt: at(1), now: NOW })).toBe(0);
  });

  it('cools an old post without erasing genuinely new activity', () => {
    const freshPost = scoreOf(discussion('new', { likes: 10, age: 1 }));
    const oldPost = scoreOf(discussion('old', { likes: 10, age: 30 * 24 }));
    expect(freshPost).toBeGreaterThan(oldPost);
    expect(oldPost).toBeGreaterThan(4); // never below the 0.5 post-age floor
  });

  it('weights comments as engagement too, with likes still primary', () => {
    const liked = scoreOf(discussion('liked', { likes: 4 }));
    const twoLikes = scoreOf(discussion('two', { likes: 2 }));
    const commented = scoreOf(discussion('commented', { comments: 4 }));
    const mixed = scoreOf(discussion('mixed', { likes: 2, comments: 1 }));
    expect(commented).toBeCloseTo(2 * liked, 5);
    expect(mixed).toBeGreaterThan(twoLikes);
    expect(mixed).toBeCloseTo(liked, 5); // 2 likes + 1 comment (weight 2) = 4 points
  });
});

describe('scenario A — very low engagement (2 / 1 / 0 likes)', () => {
  it('keeps every bar small and never fills one', () => {
    const posts = ranked([
      discussion('a', { likes: 2 }),
      discussion('b', { likes: 1 }),
      discussion('c', { likes: 0 }),
    ]);
    const bars = barsFor(posts);
    expect(posts.map((post) => post.id)).toEqual(['a', 'b', 'c']);
    expect(bars.every((bar) => bar < 40)).toBe(true);
    expect(bars).toEqual([34, 21, 0]);
    expect(bars).not.toContain(100);
  });
});

describe('scenario B — moderate engagement (5 / 10 / 3 likes)', () => {
  it('shows progressively increasing intensity in score order', () => {
    const posts = ranked([
      discussion('a', { likes: 5 }),
      discussion('b', { likes: 10 }),
      discussion('c', { likes: 3 }),
    ]);
    const bars = barsFor(posts);
    expect(posts.map((post) => post.id)).toEqual(['b', 'a', 'c']);
    expect(bars[0]).toBeGreaterThan(bars[1]);
    expect(bars[1]).toBeGreaterThan(bars[2]);
    expect(bars).toEqual([73, 55, 42]);
  });
});

describe('scenario C — high engagement (25 / 15 / 8 likes)', () => {
  it('approaches the full-scale benchmark without faking a full bar', () => {
    const posts = ranked([
      discussion('a', { likes: 25 }),
      discussion('b', { likes: 15 }),
      discussion('c', { likes: 8 }),
    ]);
    const bars = barsFor(posts);
    expect(posts.map((post) => post.id)).toEqual(['a', 'b', 'c']);
    expect(bars[0]).toBeGreaterThanOrEqual(95);
    expect(bars[1]).toBeGreaterThan(bars[2]);
    // 30 fresh points clear the benchmark and clamp at 100, never above.
    expect(activityBarPercentages([scoreOf(discussion('peak', { likes: 30 }))])[0]).toBe(100);
  });
});

describe('scenario D — old accumulated popularity vs recent activity', () => {
  it('lets 12 recent likes outrank 100 historical likes', () => {
    const posts = ranked([
      discussion('historic', { likes: 100, likeAge: 30 * 24, age: 30 * 24 }),
      discussion('active', { likes: 12, age: 1 }),
    ]);
    expect(posts[0].id).toBe('active');
    expect(posts[0].score).toBeGreaterThan(11);
    expect(posts[1].score).toBe(0);
    expect(barsFor(posts)).toEqual([79, 0]);
  });
});

describe('scenario E — zero engagement everywhere', () => {
  it('produces no full bars, no errors, and a deterministic order', () => {
    const posts = ranked([
      discussion('older', { age: 10 }),
      discussion('newest', { age: 1 }),
      discussion('middle', { age: 5 }),
    ]);
    expect(posts.every((post) => post.score === 0)).toBe(true);
    expect(barsFor(posts)).toEqual([0, 0, 0]);
    expect(posts.map((post) => post.id)).toEqual(['newest', 'middle', 'older']);
    expect(ranked(posts).map((post) => post.id)).toEqual(posts.map((post) => post.id));
    for (const bad of [undefined, null, NaN, -100, Infinity, 'oops']) {
      expect(activityBarPercentages([bad])[0]).toBe(0);
    }
  });
});

describe('scenario F — like, then remove the like', () => {
  it('moves the score, the ranking and the bar on both writes', () => {
    let target = discussion('target', { likes: 0 });
    const other = discussion('other', { likes: 1 });
    const before = ranked([target, other]);
    expect(before[0].id).toBe('other');
    expect(barsFor(before)).toEqual([21, 0]);

    // The confirmed like adds exactly one real reaction row with its own time.
    target = { ...target, likes: [at(0.02)] };
    const liked = ranked([target, other]);
    expect(liked[0].id).toBe('target');
    expect(barsFor(liked)).toEqual([21, 21]);

    // Removing the like deletes that row; nothing is double-counted or cached.
    target = { ...target, likes: [] };
    const unliked = ranked([target, other]);
    expect(unliked[0].id).toBe('other');
    expect(unliked.find((post) => post.id === 'target').score).toBe(0);
    expect(barsFor(unliked)).toEqual([21, 0]);
  });

  it('announces confirmed engagement through the existing live-feed queue', () => {
    expect(read('components/posts/ReactionBar.js')).toContain("feed.invalidate('engagement', [targetId])");
    expect(read('components/posts/CommentComposer.js')).toContain("feed.invalidate('engagement', [postId])");
    expect(read('components/posts/CommentActions.js')).toContain("feed.invalidate('engagement', [postId])");
    expect(read('components/layout/LiveFeedProvider.js')).toContain('EVENT_BATCH_MS');
    const home = read('components/home/HomeFeedClient.js');
    expect(home).toContain('void refresh(true);');
    expect(home).toContain('TRENDING_REFRESH_MS = 60_000');
    expect(home).toContain('document.visibilityState !== \'visible\'');
    expect(home).not.toMatch(/Math\.random|setInterval\(tick, 100\)/);
  });
});
