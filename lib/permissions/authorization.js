/**
 * Centralized authorization.
 *
 * One helper — `can(actor, permission)` — is used by every page, server action
 * and API route. Role checks are never scattered through components
 * (spec §106, §107). The database enforces the same rules again through RLS and
 * `has_permission()`, so a bypassed UI check still cannot mutate data.
 */

import {
  ACCOUNT_TYPES, DEFAULT_VISITOR_PERMISSIONS, EXTERNAL_STANDINGS,
  PERMISSION_KEY_SET, PERMISSION_KEYS, PERMISSIONS, ROLE_ORDER, ROLES,
} from '@/lib/constants';

/**
 * @typedef {Object} Actor
 * @property {string} [id]            auth user id
 * @property {string} [profileId]     profiles.id
 * @property {string} [username]
 * @property {string} [accountStatus] active | suspended | banned | ...
 * @property {string[]} [roles]       role keys held by the user
 * @property {Set<string>} [permissions] resolved permission keys
 * @property {string} [accountType]   student | visitor (never a permission)
 */

/** Build an Actor from the shape returned by `lib/auth/session.js`. */
export function toActor(user) {
  if (!user) return null;
  return {
    id: user.id,
    profileId: user.profile?.id || null,
    username: user.profile?.username || null,
    accountStatus: user.profile?.account_status || 'active',
    roles: Array.isArray(user.roles) ? user.roles : [],
    permissions: new Set(Array.isArray(user.permissions) ? user.permissions : []),
    accountType: user.profile?.account_type || accountTypeOf(user) || null,
  };
}

/** Where the account type lives on the flattened session user. */
function accountTypeOf(user) {
  return user?.accountType || user?.profile?.account_type || null;
}

/** True when the account belongs to an institution. Unknown types fail closed. */
export function isInstitutional(actor) {
  return actor?.accountType === ACCOUNT_TYPES.student;
}

/** True when the account is external. An unknown account type is NOT a visitor. */
export function isVisitor(actor) {
  return actor?.accountType === ACCOUNT_TYPES.visitor;
}

/**
 * True when an external account holds the External Contributor entitlement.
 *
 * Not a synonym for "can publish": a contributor whose role carries no
 * permissions can publish nothing, and a visitor with per-account grants can
 * publish without being a contributor. `can(actor, 'create_posts')` remains the
 * only question that authorizes an action; this answers "which standing is this
 * account in", which is what the interface labels.
 *
 * Institutional accounts always return false — the database refuses the role on
 * them (083 §4) and ignores it if it arrives another way (§1), so the UI must
 * not claim otherwise either.
 */
export function isExternalContributor(actor) {
  if (!isVisitor(actor)) return false;
  return Array.isArray(actor?.roles) && actor.roles.includes(ROLES.external_contributor);
}

/**
 * The standing of an external account, used for badges and copy.
 *
 * Mirrors `public.external_standing()` in the database. Kept as a pure function
 * of the actor so components do not each invent their own precedence between
 * "has the role" and "has individual grants".
 */
export function externalStanding(actor) {
  if (!isVisitor(actor)) return 'institutional';
  if (isExternalContributor(actor)) return 'contributor';

  // `toActor()` normalises permissions to a Set; raw session users carry an
  // array. Accept both rather than making every caller normalise first.
  const held = actor?.permissions;
  const has = (key) => (held instanceof Set ? held.has(key) : Array.isArray(held) ? held.includes(key) : false);

  // Anything beyond the read-only baseline was granted to this specific
  // account, which is what "permitted visitor" distinguishes.
  const beyondBaseline = PERMISSION_KEYS.some(
    (key) => has(key) && !DEFAULT_VISITOR_PERMISSIONS.includes(key),
  );
  return beyondBaseline ? 'permitted_visitor' : 'read_only_visitor';
}

/** Display metadata for an external standing key. */
export function externalStandingLabel(actor) {
  return EXTERNAL_STANDINGS[externalStanding(actor)] || EXTERNAL_STANDINGS.read_only_visitor;
}

/**
 * Highest rank role of an actor (used for "you may not act on a peer" rules).
 *
 * Returns null when the actor holds no known role. This used to default to
 * `student`, which meant "missing role data" quietly became "is a student" —
 * exactly the fail-open behaviour that must never apply to an external
 * account. Rank is now the only thing that answers `unknown`, not a guess.
 */
export function highestRole(actor) {
  const roles = (actor?.roles || []).filter((role) => ROLE_ORDER.includes(role));
  if (!roles.length) return null;
  return roles.slice().sort((a, b) => ROLE_ORDER.indexOf(b) - ROLE_ORDER.indexOf(a))[0];
}

/** Rank of the actor's highest known role, or -1 when they hold none. */
export function roleRank(actor) {
  const role = highestRole(actor);
  if (!role) return -1;
  return ROLE_ORDER.indexOf(role);
}

/** Does the actor hold this permission? Unknown permission keys fail closed. */
export function can(actor, permission) {
  if (!actor) return false;
  if (!PERMISSION_KEY_SET.has(permission)) {
    // Fail closed and make the mistake visible during development/tests.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[authorization] Unknown permission requested: ${permission}`);
    }
    return false;
  }
  if (!isActiveActor(actor)) return false;
  return Boolean(actor.permissions?.has?.(permission));
}

/** Convenience: all / any of a list. */
export function canAll(actor, permissions) {
  return permissions.every((permission) => can(actor, permission));
}

export function canAny(actor, permissions) {
  return permissions.some((permission) => can(actor, permission));
}

/** True when the account may act at all (suspension/ban enforcement — spec §83). */
export function isActiveActor(actor) {
  if (!actor) return false;
  const status = actor.accountStatus || 'active';
  return status === 'active' || status === 'pending';
}

export function isSuspended(actor) {
  return actor?.accountStatus === 'suspended';
}

export function isBanned(actor) {
  return actor?.accountStatus === 'banned';
}

/** Role helpers — visual role badges derive from these (spec §13, §108). */
export function hasRole(actor, role) {
  return Boolean(actor?.roles?.includes(role));
}

export function isModerator(actor) {
  return roleRank(actor) >= ROLE_ORDER.indexOf(ROLES.moderator);
}

export function isAdmin(actor) {
  return roleRank(actor) >= ROLE_ORDER.indexOf(ROLES.admin);
}

export function isSuperAdmin(actor) {
  return hasRole(actor, ROLES.super_admin);
}

/**
 * Does the actor show the red role dot? Only Moderator/Admin/Super Admin do;
 * students never do (spec §13).
 */
export function showsRoleBadge(actor) {
  return isModerator(actor);
}

/** Highest role that should be displayed next to the username. */
export function displayRole(actor) {
  if (!actor || !showsRoleBadge(actor)) return null;
  return highestRole(actor);
}

/**
 * Can `actor` act on `target` with this permission?
 *
 * Adds the staffing hierarchy rules that plain permission checks cannot express:
 *   - staff may not moderate themselves
 *   - staff may not moderate someone at their own rank or above
 *   - only a Super Admin may grant/revoke Super Admin
 */
export function canActOn(actor, target, permission) {
  if (!can(actor, permission)) return false;
  if (!target) return false;
  if (actor.id && target.id && actor.id === target.id) return false;
  if (roleRank(actor) <= roleRank(target)) return false;
  return true;
}

/** Guard used by role/permission administration. */
export function canManageRole(actor, roleKey) {
  if (!can(actor, 'assign_roles')) return false;
  if (roleKey === ROLES.super_admin) return isSuperAdmin(actor) && can(actor, 'manage_role_authority');
  if (roleKey === ROLES.admin) return isSuperAdmin(actor) || (isAdmin(actor) && can(actor, 'manage_role_authority'));
  // Baseline authority (Visitor, External Contributor, Student): an
  // administrator may always assign these. They grant no administrative power,
  // and the database enforces the same rule in grant_role().
  if (roleKey === ROLES.visitor || roleKey === ROLES.external_contributor || roleKey === ROLES.student) {
    return isAdmin(actor);
  }
  // Any custom role: only an administrator who also holds role authority.
  return isAdmin(actor) && can(actor, 'manage_role_authority');
}

/**
 * Rank a permission's "sensitivity" so the admin UI can warn before granting.
 * Derived from the catalogue group — no hand-maintained parallel list.
 */
export function permissionIsPlatformLevel(permission) {
  const entry = PERMISSIONS.find((p) => p.key === permission);
  return entry ? ['Administration', 'Platform'].includes(entry.group) : true;
}

export function permissionGroup(permission) {
  return PERMISSIONS.find((p) => p.key === permission)?.group || 'Other';
}

/**
 * Resolve permissions from role rows returned by the database.
 *
 * **This function fails closed.** It used to push `student` when no role rows
 * came back, so a visitor whose grant was missing — a partial provisioning
 * failure, a join that returned nothing, a transient RLS error — silently
 * became a student with every student permission. An account with no resolvable
 * role now resolves to no roles and no permissions, and `can()` denies
 * everything. Nothing in the product grants privileges for absence of data.
 */
export function permissionsFromRoles(roleRows) {
  const roles = [];
  const permissions = new Set();
  for (const row of roleRows || []) {
    const role = row?.roles || row;
    if (!role?.key) continue;
    // An unknown role key is still recorded (the UI shows what exists) but it
    // contributes nothing to rank or permissions.
    roles.push(role.key);
    for (const link of role.role_permissions || []) {
      const key = link?.permissions?.key || link?.permission_key;
      if (key && PERMISSION_KEY_SET.has(key)) permissions.add(key);
    }
  }
  return { roles: [...new Set(roles)], permissions: [...permissions] };
}

export { PERMISSION_KEYS, ROLES };
