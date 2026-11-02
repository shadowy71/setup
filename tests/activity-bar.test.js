import { describe, expect, it } from 'vitest';

import {
  activityBarPercentage,
  activityBarPercentages,
  activityScore,
  normalizeActivityCount,
} from '@/lib/social/activity-scale';

/**
 * The "Busiest right now" like/activity bars must be proportional to the like
 * counts of the items in the same comparison set — never a flat 100% each.
 * These pin the one shared calculation the rail renders from.
 */

describe('normalizeActivityCount', () => {
  it('accepts numbers and numeric strings, rejects junk as zero', () => {
    expect(normalizeActivityCount(5)).toBe(5);
    expect(normalizeActivityCount('7')).toBe(7);
    expect(normalizeActivityCount(0)).toBe(0);
    expect(normalizeActivityCount(-3)).toBe(0);
    expect(normalizeActivityCount('nope')).toBe(0);
    expect(normalizeActivityCount(null)).toBe(0);
    expect(normalizeActivityCount(undefined)).toBe(0);
  });
});

describe('activityScore', () => {
  it('combines likes and comments, treating missing counters as zero', () => {
    expect(activityScore({ reaction_count: 2, comment_count: 1 })).toBe(3);
    expect(activityScore({ reaction_count: '4' })).toBe(4);
    expect(activityScore({})).toBe(0);
    expect(activityScore(null)).toBe(0);
  });
});

describe('activityBarPercentages', () => {
  it('gives different like counts different bar widths, with the max at 100%', () => {
    // 2, 5, 10, 20 likes → 10%, 25%, 50%, 100%.
    expect(activityBarPercentages([2, 5, 10, 20])).toEqual([10, 25, 50, 100]);
  });

  it('never assigns 100% to a non-maximum item', () => {
    const widths = activityBarPercentages([2, 20]);
    expect(widths[1]).toBe(100);
    expect(widths[0]).toBe(10);
    expect(widths[0]).not.toBe(100);
  });

  it('handles zero likes without errors and keeps bars within bounds', () => {
    expect(activityBarPercentages([0, 0, 0])).toEqual([0, 0, 0]);
    expect(activityBarPercentages([0, 8])).toEqual([0, 100]);
    for (const width of activityBarPercentages([0, 1, 3, 99, 1000])) {
      expect(width).toBeGreaterThanOrEqual(0);
      expect(width).toBeLessThanOrEqual(100);
    }
  });

  it('handles an empty set', () => {
    expect(activityBarPercentages([])).toEqual([]);
    expect(activityBarPercentages(undefined)).toEqual([]);
  });

  it('stays consistent when more feed items are appended to the set', () => {
    const first = activityBarPercentages([10, 20]);
    expect(first).toEqual([50, 100]);
    // A new top score re-scales the whole set against the new upper bound;
    // relative order and proportions are preserved.
    const grown = activityBarPercentages([10, 20, 40]);
    expect(grown).toEqual([25, 50, 100]);
    expect(grown[2]).toBe(100);
    expect(grown[0]).toBeLessThan(grown[1]);
  });

  it('updates the width when a like count changes', () => {
    const before = activityBarPercentages([4, 8]);
    const after = activityBarPercentages([8, 8]);
    expect(before).toEqual([50, 100]);
    expect(after).toEqual([100, 100]);
    expect(after[0]).not.toBe(before[0]);
  });
});

describe('activityBarPercentage', () => {
  it('clamps to [0, 100] and treats a zero ceiling as all-zero', () => {
    expect(activityBarPercentage(5, 0)).toBe(0);
    expect(activityBarPercentage(0, 10)).toBe(0);
    expect(activityBarPercentage(10, 10)).toBe(100);
    expect(activityBarPercentage(15, 10)).toBe(100);
  });
});
