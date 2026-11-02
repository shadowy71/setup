/**
 * Shared scaling for the "Busiest right now" activity bars (HomeRail).
 *
 * Client-safe pure helpers: no React, no I/O. One calculation, used by every
 * bar in the comparison set, so the visual scale can never drift between
 * items or between renders.
 *
 * Rules:
 *   - the highest score in the set is the upper bound and renders at 100%;
 *   - every other score is proportional to that bound (2 of 20 → 10%);
 *   - zero or invalid counts render at 0% without errors;
 *   - the result is always clamped to [0, 100] and stays inside the track.
 */

/** Normalize a backend counter: numeric strings are fine, junk becomes 0. */
export function normalizeActivityCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/** The score one rail entry is barred by: likes plus comments. */
export function activityScore(post) {
  return normalizeActivityCount(post?.reaction_count) + normalizeActivityCount(post?.comment_count);
}

/**
 * Bar width (0–100) for one score against the set's upper bound.
 * Never 100% unless the score actually is the maximum.
 */
export function activityBarPercentage(score, ceiling) {
  const value = normalizeActivityCount(score);
  const bound = normalizeActivityCount(ceiling);
  if (bound <= 0 || value <= 0) return 0;
  return Math.min(100, Math.max(0, (value / bound) * 100));
}

/**
 * Percentages for a whole comparison set, in the same order as `scores`.
 * The maximum score maps to 100; an empty or all-zero set maps to all zeros.
 */
export function activityBarPercentages(scores = []) {
  const values = (Array.isArray(scores) ? scores : []).map(normalizeActivityCount);
  const ceiling = values.length ? Math.max(...values) : 0;
  return values.map((score) => activityBarPercentage(score, ceiling));
}
