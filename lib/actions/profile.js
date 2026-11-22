'use server';

/**
 * Profile, username, privacy and account lifecycle (spec §9, §10).
 *
 * The database owns every rule that matters here: `change_username()` enforces
 * the cooldown, uniqueness and reserved names; `deactivate_own_account()` and
 * `reactivate_own_account()` own the account state transitions. These actions
 * validate input and hand off.
 */

import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { blockUser, unblockUser } from '@/lib/blocks';
import { ROUTES } from '@/lib/constants';
import { validate, profileUpdateSchema, vUsername } from '@/lib/validation/schemas';

export async function updateProfile(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();

    const checked = validate(
      {
        display_name: formData.get('display_name'),
        bio: formData.get('bio'),
        branch: formData.get('branch'),
        year: formData.get('year'),
        division: formData.get('division'),
        show_branch_year: formData.get('show_branch_year') !== null,
        allow_dms_from_everyone: formData.get('allow_dms_from_everyone') !== null,
        visitor_college_name: formData.get('visitor_college_name'),
        visitor_year: formData.get('visitor_year'),
      },
      profileUpdateSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the highlighted fields.', checked.errors);

    const values = checked.data;
    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: values.display_name,
        bio: values.bio || null,
        branch: values.branch || null,
        year: values.year || null,
        division: values.division || null,
        show_branch_year: values.show_branch_year !== false,
        allow_dms_from_everyone: values.allow_dms_from_everyone !== false,
        // The database clears whichever pair does not belong to this account
        // type (guard_visitor_profile_fields, migration 082), so sending both
        // is safe and keeps this action unaware of the classification.
        visitor_college_name: values.visitor_college_name || null,
        visitor_year: values.visitor_year || null,
      })
      .eq('id', user.profile.id);
    if (error) throw fromPostgresError(error);

    revalidatePath(ROUTES.profile);
    revalidatePath(ROUTES.user(user.profile.username));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function changeUsername(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate({ username: formData.get('username') }, { username: (value) => vUsername(value) });
    if (!checked.ok) throw errors.validation('Please check the username.', checked.errors);

    const supabase = await getServerClient();
    const { error } = await supabase.rpc('change_username', { p_new_username: checked.data.username });
    if (error) throw fromPostgresError(error, { unique: 'That username is already taken.' });

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function blockProfile(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();
    const targetProfileId = String(formData.get('profile_id') || '');
    const reason = formData.get('reason') ? String(formData.get('reason')).slice(0, 300) : null;
    await blockUser(supabase, { userId: user.profile.id, targetProfileId, reason });
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'That person could not be blocked.');
  }
}

export async function unblockProfile(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();
    const targetProfileId = String(formData.get('profile_id') || '');
    await unblockUser(supabase, { userId: user.profile.id, targetProfileId });
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'That block could not be removed.');
  }
}

export async function deactivateAccount(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const reason = formData.get('reason') ? String(formData.get('reason')).slice(0, 300) : null;
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('deactivate_own_account', { p_reason: reason });
    if (error) throw fromPostgresError(error);
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function reactivateAccount() {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('reactivate_own_account');
    if (error) throw fromPostgresError(error);
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
