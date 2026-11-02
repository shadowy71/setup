import { describe, expect, it } from 'vitest';

import {
  activityBarPercentage,
  activityBarPercentages,
  normalizeActivityScore,
} from '@/lib/social/activity-scale';
import { TRENDING_FULL_SCALE } from '@/lib/constants';

/**
 * The "Busiest right now" bars used to be normalized against the highest score
 * in the visible set, so 2 likes filled the track. These tests pin the absolute
 * logarithmic scale: 100% only at the substantial-engagement benchmark, small
 * real engagement stays small, and no input can produce a broken width.
 */

describe('normalizeActivityScore', () => {
  it('accepts numbers and numeric strings, rejects junk as zero', () => {
    expect(normalizeActivityScore(5)).toBe(5);
    expect(normalizeActivityScore('7')).toBe(7);
    expect(normalizeActivityScore('2.5')).toBe(2.5);
    expect(normalizeActivityScore(0)).toBe(0);
    expect(normalizeActivityScore(-3)).toBe(0);
    expect(normalizeActivityScore(Infinity)).toBe(0);
    expect(normalizeActivityScore(-Infinity)).toBe(0);
    expect(normalizeActivityScore(NaN)).toBe(0);
    expect(normalizeActivityScore('nope')).toBe(0);
    expect(normalizeActivityScore(null)).toBe(0);
    expect(normalizeActivityScore(undefined)).toBe(0);
  });
});

describe('activityBarPercentage (logarithmic absolute scale)', () => {
  it('follows 100 × ln(1 + score) / ln(1 + benchmark), rounded', () => {
    expect(activityBarPercentage(0, 25)).toBe(0);
    expect(activityBarPercentage(0.5, 25)).toBe(12);
    expect(activityBarPercentage(1, 25)).toBe(21);
    expect(activityBarPercentage(2, 25)).toBe(34);
    expect(activityBarPercentage(5, 25)).toBe(55);
    expect(activityBarPercentage(10, 25)).toBe(74);
    expect(activityBarPercentage(20, 25)).toBe(93);
    expect(activityBarPercentage(25, 25)).toBe(100);
    expect(activityBarPercentage(50, 25)).toBe(100);
  });

  it('never lets two likes fill the bar, whatever the rest of the set looks like', () => {
    expect(activityBarPercentage(2, 25)).toBeLessThan(40);
    expect(activityBarPercentage(2, 25)).not.toBe(100);
    expect(activityBarPercentages([2, 1, 0], 25)).toEqual([34, 21, 0]);
  });

  it('reaches 100% only at or above the benchmark, never by rounding below it', () => {
    expect(activityBarPercentage(24.9, 25)).toBe(99);
    expect(activityBarPercentage(25, 25)).toBe(100);
    expect(activityBarPercentage(26, 25)).toBe(100);
  });

  it('clamps to [0, 100] and never produces NaN, Infinity or a negative width', () => {
    for (const score of [-100, -1, 0, NaN, Infinity, -Infinity, 1e12, 'junk', null]) {
      const width = activityBarPercentage(score, 25);
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeGreaterThanOrEqual(0);
      expect(width).toBeLessThanOrEqual(100);
    }
    for (const benchmark of [0, 1, -5, NaN, Infinity, 'bad', null]) {
      const width = activityBarPercentage(10, benchmark);
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeGreaterThanOrEqual(0);
      expect(width).toBeLessThanOrEqual(100);
    }
  });

  it('keeps the benchmark configurable without changing the formula', () => {
    expect(activityBarPercentage(10, 20)).toBe(79);
    expect(activityBarPercentage(10, 25)).toBe(74);
    expect(activityBarPercentage(10, 50)).toBe(61);
    expect(activityBarPercentage(10, 20)).toBeGreaterThan(activityBarPercentage(10, 25));
    expect(activityBarPercentage(10, 25)).toBeGreaterThan(activityBarPercentage(10, 50));
    expect(TRENDING_FULL_SCALE).toBeGreaterThan(1);
  });
});

describe('activityBarPercentages', () => {
  it('is absolute: adding a bigger row does not rescale the smaller ones', () => {
    expect(activityBarPercentages([2, 5], TRENDING_FULL_SCALE)).toEqual(
      activityBarPercentages([2, 5, 100], TRENDING_FULL_SCALE).slice(0, 2),
    );
    expect(activityBarPercentages([2, 5], 25)).toEqual([34, 55]);
  });

  it('handles an all-zero campus and an empty set', () => {
    expect(activityBarPercentages([0, 0, 0], 25)).toEqual([0, 0, 0]);
    expect(activityBarPercentages([], 25)).toEqual([]);
    expect(activityBarPercentages(undefined, 25)).toEqual([]);
  });

  it('grows and shrinks monotonically with the score', () => {
    const widths = activityBarPercentages([0, 1, 2, 5, 10, 20, 25, 50], 25);
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
    }
    expect(widths.at(-1)).toBe(100);
  });
});
