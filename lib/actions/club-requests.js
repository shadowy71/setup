'use server';

import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { enforceRateLimit } from '@/lib/ratelimit';
import { ROUTES, UUID_REGEX, USERNAME_REGEX } from '@/lib/constants';
import { slugify } from '@/lib/utils';
import { validate, clubRequestSchema } from '@/lib/validation/schemas';

function requestPayload(formData) {
  return {
    name: formData.get('name'),
    slug: formData.get('slug') || slugify(formData.get('name')),
    description: formData.get('description'),
    subject: formData.get('subject'),
    club_category: formData.get('club_category'),
    organization_type: formData.get('organization_type'),
    recruitment_info: formData.get('recruitment_info'),
    meeting_info: formData.get('meeting_info'),
    contact_info: formData.get('contact_info'),
    external_url: formData.get('external_url'),
    source_label: formData.get('source_label'),
    source_url: formData.get('source_url'),
    proposed_admin_username: String(formData.get('proposed_admin_username') || '').trim().toLowerCase() || null,
  };
}

export async function submitClubRequest(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(requestPayload(formData), clubRequestSchema);
    if (!checked.ok) throw errors.validation('Please check the club request.', checked.errors);
    if (checked.data.proposed_admin_username && !USERNAME_REGEX.test(checked.data.proposed_admin_username)) {
      throw errors.validation('The suggested administrator must be a valid Campus+ username.', {
        proposed_admin_username: 'Use 3–24 lowercase letters, numbers or underscores.',
      });
    }
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'community_create', user.profile.id);
    const { data, error } = await supabase
      .from('club_creation_requests')
      .insert({ ...checked.data, requester_id: user.profile.id, status: 'pending' })
      .select('id, status')
      .single();
    if (error) {
      throw fromPostgresError(error, {
        unique: 'A pending request or an existing community already uses that link. Choose another or edit the existing page.',
        rls: 'Your account cannot request a club right now.',
      });
    }
    revalidatePath(ROUTES.clubRequest);
    revalidatePath(ROUTES.admin);
    return { ok: true, id: data.id, status: data.status };
  } catch (error) {
    return toActionError(error, 'That club request could not be submitted.');
  }
}

export async function withdrawClubRequest(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const id = String(formData.get('request_id') || '');
    if (!UUID_REGEX.test(id)) throw errors.notFound('That club request could not be found.');
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('withdraw_club_request', { p_request: id });
    if (error) throw fromPostgresError(error, { rls: 'Only the requester can withdraw a pending request.' });
    revalidatePath(ROUTES.clubRequest);
    revalidatePath(ROUTES.admin);
    return { ok: true, status: data?.status || 'withdrawn' };
  } catch (error) {
    return toActionError(error);
  }
}

export async function approveClubRequest(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    if (!can(toActor(user), 'manage_clubs')) throw errors.forbidden('Only Campus+ club administrators can review club requests.');
    const id = String(formData.get('request_id') || '');
    const adminUsername = String(formData.get('admin_username') || '').trim().toLowerCase();
    if (!UUID_REGEX.test(id)) throw errors.notFound('That club request could not be found.');
    if (!USERNAME_REGEX.test(adminUsername)) throw errors.validation('Enter the exact active Campus+ username of the initial administrator.');
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'admin_action', user.profile.id);
    const { data, error } = await supabase.rpc('approve_club_request', {
      p_request: id,
      p_admin_username: adminUsername,
      p_review_note: String(formData.get('review_note') || '').slice(0, 1000) || null,
    });
    if (error) throw fromPostgresError(error, { rls: 'Only Campus+ club administrators can approve club requests.' });
    revalidatePath(ROUTES.clubs);
    revalidatePath(ROUTES.clubRequest);
    revalidatePath(ROUTES.admin);
    revalidatePath(ROUTES.club(data.id));
    return { ok: true, id: data.id, href: ROUTES.clubManage(data.id), idempotent: data.idempotent === true };
  } catch (error) {
    return toActionError(error, 'That club request could not be approved.');
  }
}

export async function rejectClubRequest(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    if (!can(toActor(user), 'manage_clubs')) throw errors.forbidden('Only Campus+ club administrators can review club requests.');
    const id = String(formData.get('request_id') || '');
    if (!UUID_REGEX.test(id)) throw errors.notFound('That club request could not be found.');
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'admin_action', user.profile.id);
    const { data, error } = await supabase.rpc('reject_club_request', {
      p_request: id,
      p_review_note: String(formData.get('review_note') || '').slice(0, 1000) || null,
    });
    if (error) throw fromPostgresError(error, { rls: 'Only Campus+ club administrators can reject club requests.' });
    revalidatePath(ROUTES.clubRequest);
    revalidatePath(ROUTES.admin);
    return { ok: true, status: data?.status || 'rejected' };
  } catch (error) {
    return toActionError(error, 'That club request could not be rejected.');
  }
}

export async function assignClubAdmin(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    if (!can(toActor(user), 'manage_clubs')) throw errors.forbidden('Only Campus+ club administrators can assign an initial club admin.');
    const clubId = String(formData.get('club_id') || '');
    const adminUsername = String(formData.get('admin_username') || '').trim().toLowerCase();
    if (!UUID_REGEX.test(clubId)) throw errors.notFound('That club could not be found.');
    if (!USERNAME_REGEX.test(adminUsername)) throw errors.validation('Enter the exact active Campus+ username of the initial administrator.');
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'admin_action', user.profile.id);
    const { data, error } = await supabase.rpc('assign_club_admin', {
      p_club: clubId,
      p_admin_username: adminUsername,
    });
    if (error) throw fromPostgresError(error, { rls: 'Only Campus+ club administrators can assign an initial club admin.' });
    revalidatePath(ROUTES.clubs);
    revalidatePath(ROUTES.club(clubId));
    revalidatePath(ROUTES.clubManage(clubId));
    revalidatePath(ROUTES.admin);
    return { ok: true, id: data.id, href: ROUTES.clubManage(clubId) };
  } catch (error) {
    return toActionError(error, 'That club administrator could not be assigned.');
  }
}
