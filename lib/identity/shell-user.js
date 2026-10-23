/**
 * The one identity adapter for the application shell.
 *
 * The server session (`lib/auth/session.js`) carries things a browser must
 * never see: the auth user id, the account status, the full permission set and
 * (indirectly) the institutional email. The shell needs five facts and nothing
 * else, so they are derived once, here, on the server:
 *
 *   username     the handle, without the leading `@`
 *   displayName  the name to show — never empty, never `undefined`
 *   division     the saved timetable division, or null (never guessed)
 *   roles        the role keys, used only to mark staff
 *   staffLabel   a human label for the staff dot, or null for students
 *
 * This module is pure and framework-free so it can be unit-tested directly and
 * imported from a server component without pulling in `server-only` guards that
 * would break those tests.
 */

/** Role keys that make a profile "staff" in the chrome. */
const STAFF_ROLES = new Set(['moderator', 'admin', 'super_admin']);

/** The label shown beside the staff dot. One place, one vocabulary. */
const STAFF_LABELS = {
  moderator: 'Moderator',
  admin: 'Administrator',
  super_admin: 'Administrator',
};

/** Coerce anything into a trimmed, non-empty string or null. */
function text(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Reduce a session user to the shell contract.
 *
 * Returns `null` when there is no profile — an authenticated but unprovisioned
 * account has no identity to render, and inventing one would put a nameless
 * "someone" in the chrome.
 *
 * @param {{profile?: object|null, roles?: string[]}|null|undefined} user
 * @returns {{username: string|null, displayName: string, division: string|null, roles: string[], staffLabel: string|null}|null}
 */
export function toShellUser(user) {
  const profile = user?.profile;
  if (!profile) return null;

  const username = text(profile.username);
  // A missing or blank display name falls back to the handle — the same rule the
  // rest of the product uses — so no surface can render `@undefined`.
  const displayName = text(profile.display_name) || username || 'Student';

  const roles = Array.isArray(user.roles) ? user.roles.filter((role) => typeof role === 'string') : [];

  return {
    username,
    displayName,
    division: text(profile.division),
    roles,
    staffLabel: staffLabelFor(roles),
  };
}

/** True when any of the role keys is a staff role. */
export function isStaffRoles(roles) {
  return Array.isArray(roles) && roles.some((role) => STAFF_ROLES.has(role));
}

/** Human label for the strongest staff role held, or null for students. */
export function staffLabelFor(roles) {
  if (!Array.isArray(roles)) return null;
  if (roles.includes('super_admin')) return STAFF_LABELS.super_admin;
  if (roles.includes('admin')) return STAFF_LABELS.admin;
  if (roles.includes('moderator')) return STAFF_LABELS.moderator;
  return null;
}

/** The `@handle` line, which must never be `@undefined` or a stray `@`. */
export function handleOf(shellUser) {
  return shellUser?.username ? `@${shellUser.username}` : '';
}
