/**
 * Scroll decisions for the live timetable.
 *
 * Kept pure so the one rule that matters can be tested without a browser:
 * bring the current (or next) session into view only when it is not already
 * fully on screen. A session that is already visible must never move the
 * page — the timetable is something people read, not a feed that chases them.
 */

/** True when the element's box is entirely inside the viewport. */
export function isFullyVisible(rect, viewportHeight) {
  return rect.top >= 0 && rect.bottom <= viewportHeight;
}

/**
 * Whether a session row needs to be brought into view.
 * `rect` is a DOMRect-like `{ top, bottom }`; a partially visible row counts
 * as needing the scroll, so the whole session (including batch rooms) reads
 * together.
 */
export function shouldScrollToSession(rect, viewportHeight) {
  if (!rect || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return false;
  return !isFullyVisible(rect, viewportHeight);
}

/**
 * The scroll behaviour to request. `scrollIntoView` obeys the document's
 * `scroll-behavior`, and the global reduced-motion rule already forces that
 * to `auto`; asking for `auto` here as well keeps the intent explicit.
 */
export function sessionScrollBehavior(reducedMotion) {
  return reducedMotion ? 'auto' : 'smooth';
}
