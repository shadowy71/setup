'use server';

/**
 * Administration (spec §51, §53, §54, §55).
 *
 * Roles, permissions, account status, platform settings and feature flags. Each
 * call lands in a SECURITY DEFINER function or a permission-checked table policy
 * that writes an audit entry, so every administrative change is attributable.
 */

import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { can, isAdmin, toActor } from '@/lib/permissions/authorization';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { validate, accountStatusSchema, platformSettingSchema, featureFlagSchema } from '@/lib/validation/schemas';
import { vUuid } from '@/lib/validation/primitives';
import { ROUTES } from '@/lib/constants';

function requirePermission(user, permission) {
  const actor = toActor(user);
  if (!can(actor, permission)) throw errors.forbidden('You do not have permission to do that.');
  return user;
}

export async function grantRole(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    requirePermission(user, 'assign_roles');
    const userId = String(formData.get('user_id') || '');
    const role = String(formData.get('role') || '');
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('grant_role', { p_user: userId, p_role: role });
    if (error) throw fromPostgresError(error, { rls: 'That role cannot be granted by you.' });
    revalidatePath(ROUTES.admin);
    revalidatePath(ROUTES.moderator);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function revokeRole(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    requirePermission(user, 'assign_roles');
    const userId = String(formData.get('user_id') || '');
    const role = String(formData.get('role') || '');
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('revoke_role', { p_user: userId, p_role: role });
    if (error) throw fromPostgresError(error, { rls: 'That role cannot be revoked by you.' });
    revalidatePath(ROUTES.admin);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setAccountStatus(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    requirePermission(user, 'manage_users');

    const checked = validate(
      {
        user_id: formData.get('user_id'),
        status: formData.get('status'),
        reason: formData.get('reason'),
        duration_days: formData.get('duration_days'),
      },
      { user_id: (v) => vUuid(v, { label: 'User' }), ...accountStatusSchema },
    );
    if (!checked.ok) throw errors.validation('That account status change is not valid.', checked.errors);

    const supabase = await getServerClient();
    const { error } = await supabase.rpc('admin_set_account_status', {
      p_user: checked.data.user_id,
      p_status: checked.data.status,
      p_reason: checked.data.reason || null,
      p_duration_days: checked.data.duration_days || null,
    });
    if (error) throw fromPostgresError(error, { rls: 'That account change is not allowed.' });

    revalidatePath(ROUTES.admin);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setPlatformSetting(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    requirePermission(user, 'manage_platform_settings');

    const raw = String(formData.get('value') ?? '');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
    const checked = validate(
      { key: formData.get('key'), value: parsed },
      platformSettingSchema,
    );
    if (!checked.ok) throw errors.validation('That setting value is not valid.', checked.errors);

    const supabase = await getServerClient();
    const { error } = await supabase.rpc('admin_set_platform_setting', {
      p_key: checked.data.key,
      p_value: checked.data.value,
    });
    if (error) throw fromPostgresError(error, { rls: 'That setting cannot be changed by you.' });
    revalidatePath(ROUTES.admin);
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setFeatureFlag(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    requirePermission(user, 'manage_feature_flags');

    const checked = validate(
      { key: formData.get('key'), enabled: formData.get('enabled') === 'true' },
      featureFlagSchema,
    );
    if (!checked.ok) throw errors.validation('That feature flag value is not valid.', checked.errors);

    const supabase = await getServerClient();
    const { error } = await supabase
      .from('feature_flags')
      .update({ enabled: checked.data.enabled, updated_by: user.profile.id })
      .eq('key', checked.data.key);
    if (error) throw fromPostgresError(error, { rls: 'That flag cannot be changed by you.' });

    revalidatePath(ROUTES.admin);
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** Grant/revoke future upload access; authorization is independently enforced in SQL. */
export async function setUploadPermission(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    requirePermission(user, 'manage_users');
    if (!isAdmin(toActor(user))) throw errors.forbidden();
    const checked = vUuid(formData.get('user_id'), { label: 'User' });
    const enabled = formData.get('enabled');
    if (!checked.ok || !['true', 'false'].includes(enabled)) throw errors.validation('Invalid upload permission.');
    const supabase = await getServerClient();
    if (!supabase) throw errors.internal();
    const { error } = await supabase.rpc('admin_set_upload_enabled', { p_user: checked.value, p_enabled: enabled === 'true' });
    if (error) throw fromPostgresError(error, { rls: 'That permission change is not allowed.' });
    revalidatePath(ROUTES.admin);
    return { ok: true };
  } catch (error) { return toActionError(error); }
}
