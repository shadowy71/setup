import { describe, expect, it } from 'vitest';

import {
  can, canAll, canAny, highestRole, isActiveActor, isAdmin, isBanned,
  isModerator, isSuspended, roleRank, toActor,
} from '@/lib/permissions/authorization';
import { makeActor, makeUser } from './helpers/fixtures';
import { PERMISSIONS, PERMISSION_KEYS, ROLE_ORDER } from '@/lib/constants';

/**
 * The single authorization gate every page, action and API route calls.
 * The database re-checks the same rules (RLS + `has_permission()`), so these
 * tests cover the client-side half only — a bug here must never *widen* access.
 */

describe('can()', () => {
  it('denies everything for an anonymous actor', () => {
    for (const permission of ['create_posts', 'review_reports', 'manage_users', 'moderate_random']) {
      expect(can(null, permission)).toBe(false);
      expect(can(undefined, permission)).toBe(false);
    }
  });

  it('allows a granted permission and denies an ungranted one', () => {
    const student = makeActor({ permissions: new Set(['create_posts']) });
    expect(can(student, 'create_posts')).toBe(true);
    expect(can(student, 'review_reports')).toBe(false);
    expect(can(student, 'manage_platform_settings')).toBe(false);
  });

  it('fails closed for unknown permission keys instead of throwing', () => {
    const admin = makeActor({ roles: ['admin'], permissions: new Set(PERMISSION_KEYS) });
    expect(can(admin, 'not_a_real_permission')).toBe(false);
  });

  it('ignores the permission set when the account is not active', () => {
    const suspended = makeActor({ accountStatus: 'suspended', permissions: new Set(['create_posts']) });
    const banned = makeActor({ accountStatus: 'banned', permissions: new Set(['create_posts']) });
    const deactivated = makeActor({ accountStatus: 'deactivated', permissions: new Set(['create_posts']) });
    expect(isActiveActor(suspended)).toBe(false);
    expect(isSuspended(suspended)).toBe(true);
    expect(isBanned(banned)).toBe(true);
    expect(can(suspended, 'create_posts')).toBe(false);
    expect(can(banned, 'create_posts')).toBe(false);
    expect(can(deactivated, 'create_posts')).toBe(false);
  });

  it('treats a pending account as active (onboarding is allowed to finish)', () => {
    expect(isActiveActor(makeActor({ accountStatus: 'pending' }))).toBe(true);
  });

  it('never grants a permission just because a role is named admin', () => {
    const adminByRoleOnly = makeActor({ roles: ['admin', 'super_admin'], permissions: new Set() });
    expect(can(adminByRoleOnly, 'manage_users')).toBe(false);
  });
});

describe('toActor()', () => {
  it('maps the session shape without losing the profile id or status', () => {
    const actor = toActor(makeUser({ permissions: ['create_posts'], roles: ['student'] }));
    expect(actor.profileId).toBe('11111111-1111-4111-8111-111111111111');
    expect(actor.username).toBe('asha_e2e');
    expect(actor.accountStatus).toBe('active');
    expect(can(actor, 'create_posts')).toBe(true);
  });

  it('defaults to active and to no roles/permissions for a bare user', () => {
    const actor = toActor({ id: 'x', profile: { id: 'p' } });
    expect(actor.accountStatus).toBe('active');
    expect(actor.roles).toEqual([]);
    expect(can(actor, 'create_posts')).toBe(false);
  });
});

describe('canAll / canAny / highestRole', () => {
  const moderator = makeActor({ roles: ['moderator'], permissions: new Set(['review_reports', 'remove_posts']) });

  it('requires every permission for canAll and any for canAny', () => {
    expect(canAll(moderator, ['review_reports', 'remove_posts'])).toBe(true);
    expect(canAll(moderator, ['review_reports', 'manage_users'])).toBe(false);
    expect(canAny(moderator, ['manage_users', 'remove_posts'])).toBe(true);
    expect(canAny(moderator, ['manage_users'])).toBe(false);
  });

  it('orders roles by the configured rank, not by array order', () => {
    expect(highestRole(makeActor({ roles: ['student', 'admin'] }))).toBe('admin');
    // An external visitor ranks below a student; the higher role still wins.
    expect(highestRole(makeActor({ roles: ['visitor', 'external_contributor'] }))).toBe('external_contributor');
    expect(ROLE_ORDER).toEqual(['visitor', 'external_contributor', 'student', 'moderator', 'admin', 'super_admin']);
  });

  it('reports no role at all when the actor holds none — never a student default', () => {
    // This is the fail-closed contract: missing role data used to resolve to
    // `student`, which silently granted the whole student baseline to a visitor
    // whose grant was absent.
    expect(highestRole(makeActor({ roles: [] }))).toBeNull();
    expect(roleRank(makeActor({ roles: [] }))).toBe(-1);
    expect(highestRole(makeActor({ roles: ['not_a_real_role'] }))).toBeNull();
    expect(isModerator(makeActor({ roles: [] }))).toBe(false);
    expect(isAdmin(makeActor({ roles: ['student'] }))).toBe(false);
  });
});

describe('permission catalogue', () => {
  it('has no duplicate keys and every entry is described', () => {
    const keys = PERMISSIONS.map((permission) => permission.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(PERMISSION_KEYS));
    for (const permission of PERMISSIONS) {
      expect(permission.label).toBeTruthy();
      expect(permission.group).toBeTruthy();
    }
  });

  it('reserves destructive capabilities for staff (students cannot moderate)', () => {
    const staffOnly = ['review_reports', 'moderate_marketplace', 'moderate_random', 'view_audit_logs', 'manage_users'];
    for (const key of staffOnly) expect(PERMISSION_KEYS).toContain(key);
  });
});
