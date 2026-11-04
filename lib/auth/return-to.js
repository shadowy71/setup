/**
 * Return-to-page sign-in links for public surfaces.
 *
 * A guest clicking Join, RSVP, Message or Post is never sent to a dead end:
 * the link carries the public page (and the intended action) through the
 * existing Google OAuth flow. `/auth/callback` already validates `next` with
 * `safeNextPath`, and the login screen passes it into the sign-in button, so
 * the visitor returns to the club or event they were reading.
 *
 * This module is pure: no `next/*`, no `server-only`, importable from pages,
 * components and unit tests alike.
 */

import { safeNextPath } from '@/lib/auth/oauth';

/**
 * @param {string} path a relative Campus+ path, e.g. `/c/coding-club`
 * @param {string|null} intent optional action hint (`join`, `rsvp`, …)
 * @returns {string} `/login?next=…` with a validated same-origin destination
 */
export function returnToHref(path, intent = null) {
  if (typeof path !== 'string' || !path) return '/login';
  const withIntent = intent
    ? `${path}${path.includes('?') ? '&' : '?'}intent=${encodeURIComponent(intent)}`
    : path;
  const safe = safeNextPath(withIntent);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : '/login';
}

/** Recognised guest intents. Anything else is treated as no intent at all. */
export const GUEST_INTENTS = Object.freeze({
  join: 'join',
  rsvp: 'rsvp',
  submitEvent: 'submit_event',
  requestClub: 'request_club',
});

/** Read a validated intent from a page's `searchParams`. */
export function readIntent(params) {
  const value = params && typeof params.intent === 'string' ? params.intent : null;
  return value && Object.values(GUEST_INTENTS).includes(value) ? value : null;
}
