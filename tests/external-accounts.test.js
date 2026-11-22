import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  can,
  canManageRole,
  highestRole,
  isInstitutional,
  isModerator,
  isVisitor,
  permissionsFromRoles,
  roleRank,
  toActor,
} from '@/lib/permissions/authorization';
import {
  ACCOUNT_TYPES,
  DEFAULT_STUDENT_PERMISSIONS,
  DEFAULT_VISITOR_PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_ORDER,
  ROLES,
} from '@/lib/constants';
import { VISITOR_GRANTABLE_PERMISSIONS } from '@/lib/data/admin';
import {
  VISITOR_NOTICE_COOKIE,
  consumeVisitorNoticeCookie,
  showsVisitorNotice,
  visitorNoticeValue,
} from '@/lib/auth/visitor-notice';
import { visitorOnboardingSchema, onboardingSchema, validate } from '@/lib/validation/schemas';
import { makeActor } from './helpers/fixtures';

/**
 * External accounts and the Visitor role (migration 080).
 *
 * The database suite (`database/tests/24_external_accounts.sql`) proves the RLS
 * half against a real PostgreSQL instance. These tests cover the application
 * half: the permission resolver, the account-type helpers, the one-shot notice
 * and the onboarding contract. A bug in any of these must fail *closed* — the
 * database is the last word, so the client must never be more permissive.
 */

/* -------------------------------------------------------------------------- */
/* Role provisioning and the fail-closed resolver                             */
/* -------------------------------------------------------------------------- */

describe('permissionsFromRoles()', () => {
  it('resolves the permissions a role actually grants', () => {
    const { roles, permissions } = permissionsFromRoles([
      {
        roles: {
          key: 'visitor',
          role_permissions: [
            { permissions: { key: 'report_content' } },
            { permissions: { key: 'manage_own_profile' } },
          ],
        },
      },
    ]);

    expect(roles).toEqual(['visitor']);
    expect(permissions.sort()).toEqual(['manage_own_profile', 'report_content']);
  });

  it('NEVER falls back to the student role when no role rows come back', () => {
    // The regression this exists to prevent: a visitor whose grant row is
    // missing (partial provisioning, an empty join, a transient RLS error) used
    // to resolve as a student with the entire student baseline.
    for (const input of [[], null, undefined, [{}], [{ roles: null }], [{ roles: {} }]]) {
      const { roles, permissions } = permissionsFromRoles(input);
      expect(roles).toEqual([]);
      expect(permissions).toEqual([]);
      expect(roles).not.toContain(ROLES.student);
    }
  });

  it('grants nothing for a role whose links are missing or malformed', () => {
    const { permissions } = permissionsFromRoles([
      { roles: { key: 'visitor' } },
      { roles: { key: 'student', role_permissions: [null, {}, { permissions: null }] } },
    ]);
    expect(permissions).toEqual([]);
  });

  it('ignores permission keys that are not in the catalogue', () => {
    const { permissions } = permissionsFromRoles([
      { roles: { key: 'visitor', role_permissions: [{ permissions: { key: 'superuser_everything' } }] } },
    ]);
    expect(permissions).toEqual([]);
  });

  it('still resolves an ordinary student exactly as before', () => {
    const { roles, permissions } = permissionsFromRoles([
      {
        roles: {
          key: 'student',
          role_permissions: DEFAULT_STUDENT_PERMISSIONS.map((key) => ({ permissions: { key } })),
        },
      },
    ]);
    expect(roles).toEqual(['student']);
    expect(permissions).toContain('create_posts');
    expect(permissions).toHaveLength(DEFAULT_STUDENT_PERMISSIONS.length);
  });
});

describe('a visitor holding no role data', () => {
  it('can do nothing at all', () => {
    const orphan = toActor({ id: 'a', profile: { id: 'p', account_type: 'visitor' }, roles: [], permissions: [] });

    expect(orphan.accountType).toBe('visitor');
    expect(highestRole(orphan)).toBeNull();
    expect(roleRank(orphan)).toBe(-1);
    expect(can(orphan, 'create_posts')).toBe(false);
    expect(can(orphan, 'report_content')).toBe(false);
    expect(can(orphan, 'manage_own_profile')).toBe(false);
    expect(isModerator(orphan)).toBe(false);
  });

  it('cannot become a student through a missing role, an unknown role or a bad join', () => {
    for (const roles of [[], ['unknown_role'], ['visitor'], ['external_contributor']]) {
      const actor = makeActor({ roles, permissions: new Set() });
      expect(highestRole(actor)).not.toBe('student');
      expect(roleRank(actor)).toBeLessThan(ROLE_ORDER.indexOf('student'));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Visitor permissions                                                        */
/* -------------------------------------------------------------------------- */

describe('the visitor baseline', () => {
  const visitor = makeActor({
    roles: ['visitor'],
    permissions: new Set(DEFAULT_VISITOR_PERMISSIONS),
    accountType: 'visitor',
  });

  it('is exactly the read-only allow-list', () => {
    expect([...DEFAULT_VISITOR_PERMISSIONS].sort()).toEqual(['manage_own_profile', 'report_content']);
  });

  it('cannot publish anything by default', () => {
    const forbidden = [
      'create_posts', 'create_comments', 'create_polls', 'send_messages',
      'create_communities', 'create_marketplace_listing', 'create_gigs',
      'create_housing_post', 'create_ride_post', 'submit_resources',
      'submit_opportunities', 'create_projects', 'create_lost_found',
      'create_team_posts', 'create_study_posts', 'submit_events',
    ];
    for (const permission of forbidden) {
      expect(can(visitor, permission)).toBe(false);
    }
  });

  it('holds no student-only permission', () => {
    for (const permission of DEFAULT_STUDENT_PERMISSIONS) {
      if (DEFAULT_VISITOR_PERMISSIONS.includes(permission)) continue;
      expect(can(visitor, permission)).toBe(false);
    }
  });

  it('holds no administrative or moderation capability', () => {
    for (const permission of [
      'manage_users', 'manage_roles', 'manage_permissions', 'assign_roles',
      'moderate_all', 'review_reports', 'manage_platform_settings',
      'manage_colleges', 'manage_role_authority', 'view_audit_logs',
      'view_random_sessions', 'manage_backups',
    ]) {
      expect(can(visitor, permission)).toBe(false);
    }
  });

  it('can still manage its profile and report abuse', () => {
    expect(can(visitor, 'manage_own_profile')).toBe(true);
    expect(can(visitor, 'report_content')).toBe(true);
  });

  it('loses even those when suspended', () => {
    const suspended = { ...visitor, accountStatus: 'suspended' };
    expect(can(suspended, 'report_content')).toBe(false);
    expect(can(suspended, 'manage_own_profile')).toBe(false);
  });
});

describe('account type is separate from role', () => {
  it('reports an external contributor as external even with publishing rights', () => {
    // An administrator granted create_posts. The account may now post; it is
    // still not an institutional student.
    const contributor = makeActor({
      roles: ['visitor', 'external_contributor'],
      permissions: new Set(['create_posts', 'manage_own_profile', 'report_content']),
      accountType: 'visitor',
    });

    expect(can(contributor, 'create_posts')).toBe(true);
    expect(isInstitutional(contributor)).toBe(false);
    expect(isVisitor(contributor)).toBe(true);
    expect(highestRole(contributor)).toBe('external_contributor');
    expect(roleRank(contributor)).toBeLessThan(ROLE_ORDER.indexOf('student'));
  });

  it('treats an unknown account type as not institutional', () => {
    for (const accountType of [null, undefined, '', 'unknown']) {
      const actor = makeActor({ accountType });
      expect(isInstitutional(actor)).toBe(false);
    }
  });

  it('does not call an unknown account type a visitor either', () => {
    // `isVisitor` is a positive assertion, not "not a student": UI that hides
    // features uses `isInstitutional`, and nothing infers visitor status.
    expect(isVisitor(makeActor({ accountType: null }))).toBe(false);
    expect(isVisitor(makeActor({ accountType: ACCOUNT_TYPES.visitor }))).toBe(true);
  });

  it('reads the account type from the profile row as well as the flattened user', () => {
    const fromProfile = toActor({ id: 'a', profile: { id: 'p', account_type: 'visitor' } });
    expect(fromProfile.accountType).toBe('visitor');
    const flattened = toActor({ id: 'a', accountType: 'student', profile: { id: 'p' } });
    expect(flattened.accountType).toBe('student');
  });
});

/* -------------------------------------------------------------------------- */
/* Admin-controlled access                                                    */
/* -------------------------------------------------------------------------- */

describe('canManageRole() for baseline roles', () => {
  const admin = makeActor({ roles: ['admin'], permissions: new Set(['assign_roles']) });
  const moderator = makeActor({ roles: ['moderator'], permissions: new Set(['assign_roles']) });
  const student = makeActor({ roles: ['student'], permissions: new Set(['assign_roles']) });
  const visitor = makeActor({ roles: ['visitor'], permissions: new Set(), accountType: 'visitor' });

  it('lets an administrator assign the baseline roles, including Visitor', () => {
    expect(canManageRole(admin, ROLES.visitor)).toBe(true);
    expect(canManageRole(admin, ROLES.external_contributor)).toBe(true);
    expect(canManageRole(admin, ROLES.student)).toBe(true);
  });

  it('does not let a moderator or a student assign any of them', () => {
    for (const actor of [moderator, student]) {
      expect(canManageRole(actor, ROLES.visitor)).toBe(false);
      expect(canManageRole(actor, ROLES.external_contributor)).toBe(false);
      expect(canManageRole(actor, ROLES.student)).toBe(false);
    }
  });

  it('never lets a visitor assign anything, including to itself', () => {
    for (const role of Object.values(ROLES)) {
      expect(canManageRole(visitor, role)).toBe(false);
    }
  });

  it('keeps Super Admin and Admin behind their existing guards', () => {
    expect(canManageRole(admin, ROLES.admin)).toBe(false);
    expect(canManageRole(admin, ROLES.super_admin)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The one-shot visitor notice                                                */
/* -------------------------------------------------------------------------- */

describe('the visitor notice indicator', () => {
  it('accepts only its own sentinel value', () => {
    expect(showsVisitorNotice(visitorNoticeValue())).toBe(true);
    for (const value of ['', undefined, null, '0', 'true', '1 ', 'visitor']) {
      expect(showsVisitorNotice(value)).toBe(false);
    }
  });

  it('is a Campus+ cookie, not a Supabase auth cookie', () => {
    expect(VISITOR_NOTICE_COOKIE).toBe('campus_visitor_notice');
    expect(VISITOR_NOTICE_COOKIE.startsWith('sb-')).toBe(false);
  });

  it('is consumed by reading it, so a refresh cannot re-show it', async () => {
    const store = new Map([[VISITOR_NOTICE_COOKIE, '1']]);
    const fakeDocument = {
      get cookie() {
        return [...store.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
      },
      set cookie(pair) {
        const name = pair.split('=')[0].trim();
        // Max-Age=0 deletes.
        store.delete(name);
      },
    };

    const original = globalThis.document;
    globalThis.document = fakeDocument;
    try {
      expect(consumeVisitorNoticeCookie()).toBe(true);
      // Second read: nothing left to consume.
      expect(consumeVisitorNoticeCookie()).toBe(false);
      expect(store.has(VISITOR_NOTICE_COOKIE)).toBe(false);
    } finally {
      if (original === undefined) delete globalThis.document;
      else globalThis.document = original;
    }
  });

  it('renders nothing for a forged or absent value', () => {
    expect(consumeVisitorNoticeCookie()).toBe(false);
    expect(showsVisitorNotice('anything-else')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Onboarding contract                                                        */
/* -------------------------------------------------------------------------- */

describe('visitor onboarding', () => {
  const base = {
    username: 'external_person',
    display_name: 'External Person',
    bio: 'Here for the public events.',
    accept_rules: true,
  };

  it('accepts a profile without any institutional detail', () => {
    expect(validate(base, visitorOnboardingSchema).ok).toBe(true);
  });

  it('does not require branch, year or division', () => {
    const result = validate(base, visitorOnboardingSchema);
    expect(result.ok).toBe(true);
    expect(result.errors?.branch).toBeUndefined();
    expect(result.errors?.year).toBeUndefined();
    expect(result.errors?.division).toBeUndefined();
  });

  it('still requires a valid username, display name and the rules', () => {
    expect(validate({ ...base, username: 'x' }, visitorOnboardingSchema).ok).toBe(false);
    expect(validate({ ...base, display_name: '' }, visitorOnboardingSchema).ok).toBe(false);
    expect(validate({ ...base, accept_rules: false }, visitorOnboardingSchema).ok).toBe(false);
  });

  it('leaves the institutional schema untouched', () => {
    // The student flow still validates all the academic fields it always did.
    const student = validate(
      { ...base, branch: 'Computer Engineering', year: 'Third Year', division: 'A', show_branch_year: true },
      onboardingSchema,
    );
    expect(student.ok).toBe(true);
    expect(Object.keys(onboardingSchema)).toEqual(
      expect.arrayContaining(['branch', 'year', 'division', 'show_branch_year']),
    );
  });
});

describe('grantable permission allow-list', () => {
  /**
   * The admin form offers `VISITOR_GRANTABLE_PERMISSIONS`; the database accepts
   * only what `visitor_grantable_permission()` allows. If those two drift, the
   * failure is silent and asymmetric — an administrator ticks a box that is
   * refused with a confusing error, *or* (worse, if the SQL list is the wider
   * one) a capability becomes grantable without anyone reviewing it. Pin them
   * to the same list, parsed from the migration itself.
   */
  function sqlAllowList() {
    const sql = fs.readFileSync(
      new URL('../supabase/migrations/20261122000002_081_visitor_permission_grants.sql', import.meta.url),
      'utf8',
    );
    const body = sql.slice(sql.indexOf('create or replace function public.visitor_grantable_permission'));
    const array = body.slice(body.indexOf('array['), body.indexOf('])'));
    return [...array.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
  }

  it('matches the database allow-list exactly', () => {
    expect([...VISITOR_GRANTABLE_PERMISSIONS].sort()).toEqual(sqlAllowList());
  });

  it('never includes an administrative or moderation capability', () => {
    const forbidden = PERMISSION_KEYS.filter((key) =>
      /^(manage_|assign_|moderate_|remove_|review_|view_|export_|backup_|impersonate_)/.test(key),
    );
    expect(forbidden.length).toBeGreaterThan(0);
    expect(VISITOR_GRANTABLE_PERMISSIONS.filter((key) => forbidden.includes(key))).toEqual([]);
  });

  it('only names permissions that exist in the catalogue', () => {
    const unknown = VISITOR_GRANTABLE_PERMISSIONS.filter((key) => !PERMISSION_KEYS.includes(key));
    expect(unknown).toEqual([]);
  });

  it('does not overlap the permissions a visitor already holds by default', () => {
    // Anything grantable is off by default, so nothing grantable may also be
    // part of the Visitor baseline — otherwise the admin checklist would show a
    // box that is ticked-but-not-really and a revoke that cannot take effect.
    const overlap = VISITOR_GRANTABLE_PERMISSIONS.filter((key) => DEFAULT_VISITOR_PERMISSIONS.includes(key));
    expect(overlap).toEqual([]);
  });
});
