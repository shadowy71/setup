import { TRENDING_FULL_SCALE } from '@/lib/constants';

/**
 * Shared scaling for the "Busiest right now" activity bars (HomeRail).
 *
 * Client-safe pure helpers: no React, no I/O. The engagement score itself is
 * calculated once, in `public.trending_posts` (migration 040), from real recent
 * reaction/comment rows. This module only turns that server score into a width,
 * so the rail never recalculates engagement from stale or duplicated feed data.
 *
 * The old bug was relative normalization: the largest counter among the three
 * visible rows was the 100% bound, so two likes filled the track. The scale is
 * now absolute and logarithmic against a configurable benchmark:
 *
 *   progress = 100 × ln(1 + score) / ln(1 + benchmark)
 *
 *   - 0 score → 0%, 2 points → ~34%, 5 → ~55%, 10 → ~74%, 25 → 100%;
 *   - 100% is only possible at/above the benchmark (never below it);
 *   - invalid, negative or infinite scores become 0, never NaN or a full bar;
 *   - the result is rounded, clamped to [0, 100] and cannot exceed the track.
 */

/** Normalize a backend score: numeric strings are fine, junk becomes 0. */
export function normalizeActivityScore(value) {
  const score = Number(value);
  return Number.isFinite(score) && score > 0 ? score : 0;
}

/** A benchmark must be a finite number greater than 1 for ln(1 + b) to work. */
function normalizeBenchmark(benchmark) {
  const value = Number(benchmark);
  if (Number.isFinite(value) && value > 1) return value;
  const fallback = Number(TRENDING_FULL_SCALE);
  return Number.isFinite(fallback) && fallback > 1 ? fallback : 25;
}

/**
 * Bar width (0–100) for one trending score. A discussion only reaches a full
 * bar when it meets the substantial-engagement benchmark, never because it
 * happens to lead the currently visible rows.
 */
export function activityBarPercentage(score, benchmark = TRENDING_FULL_SCALE) {
  const value = normalizeActivityScore(score);
  if (value <= 0) return 0;
  const bound = normalizeBenchmark(benchmark);
  const denominator = Math.log1p(bound);
  if (!(denominator > 0)) return 0;
  const raw = (100 * Math.log1p(value)) / denominator;
  if (!Number.isFinite(raw)) return 0;
  const rounded = Math.round(Math.min(100, Math.max(0, raw)));
  // Rounding must not promote a sub-benchmark score to a "full" bar.
  return value >= bound ? 100 : Math.min(99, rounded);
}

/** Percentages for a whole rail, in the same order as `scores`. */
export function activityBarPercentages(scores = [], benchmark = TRENDING_FULL_SCALE) {
  return (Array.isArray(scores) ? scores : []).map((score) => activityBarPercentage(score, benchmark));
}
