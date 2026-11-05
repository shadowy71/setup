/**
 * Server-side session helpers.
 *
 * Reads the authenticated Supabase user, loads their Campus+ profile with
 * resolved roles and permissions, and exposes guards used by pages, server
 * actions and route handlers.
 *
 * The identity model is deliberately split in two tables:
 *
 *   profiles         — public identity + counters (readable by other students)
 *   profile_private  — account state (status, suspension, onboarding flags)
 *
 * Only the owner (and staff) may read `profile_private`, so this module loads
 * both and hands the rest of the application a single, flattened `profile`
 * object. Callers never have to know which table a field came from.
 */

import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getServerClient } from '@/lib/supabase/server';
import { permissionsFromRoles } from '@/lib/permissions/authorization';
import { ROUTES } from '@/lib/constants';
import { normalizeBranch } from '@/lib/branches';

/** Columns every profile consumer can rely on, whatever the table it lives in. */
const PROFILE_COLUMNS =
  'id, username, display_name, bio, branch, year, division, show_branch_year, ' +
  'allow_dms_from_everyone, reputation_score, reputation_count, ' +
  'marketplace_completed_count, created_at, updated_at';

const PRIVATE_COLUMNS =
  'profile_id, auth_user_id, college_id, account_status, status_reason, ' +
  'suspended_until, profile_completed, username_changed_at, last_seen';

const NEUTRAL_ACCOUNT = {
  account_status: 'active',
  status_reason: null,
  suspended_until: null,
  profile_completed: false,
  username_changed_at: null,
  last_seen: null,
  college_id: null,
  auth_user_id: null,
};

/**
 * Load the signed-in student, or null when there is no session.
 * Wrapped in React `cache` so one request resolves this once.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await getServerClient();
  if (!supabase) return null;

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) return null;
  const authUser = authData.user;

  // The auth link lives in profile_private (profiles has no auth identifier at
  // all), so the private row is resolved first — RLS lets a student read exactly
  // their own row, the public profile row and their own role grants. All three
  // are one embedded read: the previous version chained three round trips
  // (private → profile → roles) on every single page render.
  const { data: privateRow, error: privateError } = await supabase
    .from('profile_private')
    .select(
      `${PRIVATE_COLUMNS}, profiles (${PROFILE_COLUMNS}, user_roles!user_roles_user_id_fkey (roles ( key, label, rank, role_permissions ( permissions ( key ) ) )))`,
    )
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  if (privateError || !privateRow?.profile_id) {
    // Signed in but not provisioned yet: the UI sends them to onboarding, or
    // shows the "finish setting up your account" state.
    return {
      id: authUser.id,
      profile: null,
      roles: [],
      permissions: [],
      accountStatus: 'active',
      suspendedUntil: null,
      needsProfileSetup: true,
    };
  }

  const profile = privateRow.profiles || null;

  if (!profile) {
    return {
      id: authUser.id,
      profile: null,
      roles: [],
      permissions: [],
      accountStatus: privateRow.account_status || 'active',
      suspendedUntil: privateRow.suspended_until || null,
      needsProfileSetup: true,
    };
  }

  // Flatten the embedded rows back into the single shape every caller expects:
  // public profile columns + private account columns, with the role grants
  // pulled out for the permission resolution below.
  const { profiles: _private, user_roles: roleRows = [], ...publicFields } = profile;
  const { profiles: _profile, ...privateFields } = privateRow;
  const merged = { ...publicFields, ...NEUTRAL_ACCOUNT, ...privateFields, branch: normalizeBranch(publicFields.branch) };

  const { roles, permissions } = permissionsFromRoles(roleRows);

  return {
    id: authUser.id,
    lastSignInAt: authUser.last_sign_in_at,
    profile: merged,
    roles,
    permissions,
    needsProfileSetup: merged.profile_completed !== true || !merged.username,
    accountStatus: merged.account_status,
    suspendedUntil: merged.suspended_until,
  };
});

/** Account states that may not use the product at all (spec §83). */
const BLOCKED_STATUSES = ['suspended', 'banned', 'deactivated', 'deleted'];

/**
 * Full account gate used by every authenticated surface:
 *  - no session           → /login
 *  - account not usable   → /account-status
 *  - onboarding unfinished→ /onboarding
 */
export async function requireUser({ allowIncomplete = false, allowInactive = false } = {}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  if (!allowInactive && BLOCKED_STATUSES.includes(user.accountStatus)) {
    redirect('/account-status');
  }
  if (!allowIncomplete && user.needsProfileSetup) {
    redirect('/onboarding');
  }
  return user;
}

/** Guard for staff surfaces — never the only check (RLS enforces it again). */
export async function requireStaff() {
  const user = await requireUser();
  const isStaff = user.roles.some((role) => ['moderator', 'admin', 'super_admin'].includes(role));
  if (!isStaff) redirect(ROUTES.home);
  return user;
}

/** True when the current session may act (used by server actions, not pages). */
export async function getActiveUser() {
  const user = await getCurrentUser();
  if (!user || BLOCKED_STATUSES.includes(user.accountStatus)) return null;
  return user;
}

export { BLOCKED_STATUSES, PROFILE_COLUMNS, PRIVATE_COLUMNS };
