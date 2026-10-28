'use server';

/**
 * Communities, clubs and study groups.
 *
 * There is one communities table, one membership model and one scoped club
 * permission predicate in PostgreSQL. These actions validate input and call
 * that model; browser visibility is never treated as authorization.
 */

import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { enforceRateLimit } from '@/lib/ratelimit';
import { ROUTES, UUID_REGEX, USERNAME_REGEX } from '@/lib/constants';
import { slugify } from '@/lib/utils';
import { validate, communitySchema, clubSchema, studyGroupSchema } from '@/lib/validation/schemas';

function clubPayload(formData) {
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
    visibility: formData.get('visibility') || 'campus',
    join_policy: formData.get('join_policy') || 'request',
    verification_status: formData.get('verification_status') || 'pending',
    source_label: formData.get('source_label'),
    source_url: formData.get('source_url'),
  };
}

function revalidateCommunity(id, slug = null) {
  revalidatePath(ROUTES.communities);
  revalidatePath(ROUTES.clubs);
  if (slug) revalidatePath(ROUTES.community(slug));
  if (id && UUID_REGEX.test(id)) {
    revalidatePath(ROUTES.club(id));
    revalidatePath(ROUTES.clubManage(id));
  }
}

export async function createCommunity(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'community_create', user.profile.id);

    const kind = ['community', 'study_group'].includes(String(formData.get('kind')))
      ? String(formData.get('kind'))
      : 'community';
    if (String(formData.get('kind')) === 'club') {
      throw errors.forbidden('Official clubs are created only after a club request is reviewed. Ordinary communities and study groups remain available.');
    }
    if (!can(toActor(user), 'create_communities')) {
      throw errors.forbidden('Your account cannot create communities right now.');
    }

    const payload = {
      name: formData.get('name'),
      slug: formData.get('slug') || slugify(formData.get('name')),
      description: formData.get('description'),
      subject: formData.get('subject'),
      branch: formData.get('branch'),
      year: formData.get('year'),
      meeting_info: formData.get('meeting_info'),
      contact_info: formData.get('contact_info'),
      external_url: formData.get('external_url'),
      visibility: kind === 'study_group' ? 'community' : formData.get('visibility') || 'campus',
      join_policy: formData.get('join_policy') || 'open',
    };
    const checked = validate(payload, kind === 'study_group' ? studyGroupSchema : communitySchema);
    if (!checked.ok) throw errors.validation('Please check the community details.', checked.errors);

    const { data, error } = await supabase
      .from('communities')
      .insert({
        kind,
        name: checked.data.name,
        slug: checked.data.slug,
        description: checked.data.description,
        subject: checked.data.subject || null,
        branch: checked.data.branch || null,
        year: checked.data.year || null,
        meeting_info: checked.data.meeting_info || null,
        contact_info: checked.data.contact_info || null,
        external_url: checked.data.external_url || null,
        visibility: checked.data.visibility || 'campus',
        join_policy: checked.data.join_policy || 'open',
        status: 'published',
        is_official: false,
        created_by: user.profile.id,
      })
      .select('id, slug')
      .single();
    if (error) throw fromPostgresError(error, { unique: 'That name or link is already taken.', rls: 'You cannot create a community right now.' });

    revalidateCommunity(data.id, data.slug);
    return { ok: true, id: data.id, href: ROUTES.community(data.slug) };
  } catch (error) {
    return toActionError(error, 'That community could not be created.');
  }
}

export async function joinCommunity(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const communityId = String(formData.get('community_id') || '');
    if (!UUID_REGEX.test(communityId)) throw errors.notFound('That community could not be found.');
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('join_community', {
      p_community: communityId,
      p_message: String(formData.get('message') || '').slice(0, 300) || null,
    });
    if (error) throw fromPostgresError(error, { rls: 'You cannot join that community.' });
    revalidateCommunity(communityId, String(formData.get('slug') || '') || null);
    return { ok: true, pending: data?.status === 'pending', status: data?.status || null };
  } catch (error) {
    return toActionError(error, 'That join request could not be sent.');
  }
}

export async function leaveCommunity(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const communityId = String(formData.get('community_id') || '');
    if (!UUID_REGEX.test(communityId)) throw errors.notFound('That community could not be found.');
    const supabase = await getServerClient();
    const { data, error } = await supabase
      .from('community_members')
      .delete()
      .eq('community_id', communityId)
      .eq('user_id', user.profile.id)
      .select('user_id')
      .maybeSingle();
    if (error) throw fromPostgresError(error, { rls: 'A club owner cannot leave without an ownership transfer by Campus+ staff.' });
    revalidateCommunity(communityId, String(formData.get('slug') || '') || null);
    return { ok: true, left: Boolean(data) };
  } catch (error) {
    return toActionError(error);
  }
}

/** One PostgreSQL transaction locks, decides and (on approval) joins the member. */
export async function decideJoinRequest(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const requestId = String(formData.get('request_id') || '');
    const decision = String(formData.get('decision') || '');
    if (!UUID_REGEX.test(requestId)) throw errors.notFound('That join request could not be found.');
    if (!['approved', 'rejected'].includes(decision)) throw errors.validation('Choose approve or reject.');
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('decide_community_join_request', {
      p_request: requestId,
      p_decision: decision,
    });
    if (error) throw fromPostgresError(error, { rls: 'Only this community’s managers can decide its requests.' });
    revalidateCommunity(String(formData.get('community_id') || ''), String(formData.get('slug') || '') || null);
    return { ok: true, status: data?.status || decision };
  } catch (error) {
    return toActionError(error);
  }
}

/** Open (or create) the community's single chat room. */
export async function openCommunityChat(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const communityId = String(formData.get('community_id') || '');
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('open_community_chat', { p_community: communityId });
    if (error) throw fromPostgresError(error, { rls: 'That chat is not open to you.' });
    return { ok: true, conversationId: data, href: ROUTES.conversation(data) };
  } catch (error) {
    return toActionError(error, 'That chat could not be opened.');
  }
}

/** Staff creation still requires a real active initial administrator. */
export async function createClub(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    if (!can(toActor(user), 'manage_clubs')) {
      throw errors.forbidden('Official clubs are created only by Campus+ club administrators. You can submit a club request instead.');
    }
    const adminUsername = String(formData.get('admin_username') || '').trim().toLowerCase();
    if (!USERNAME_REGEX.test(adminUsername)) throw errors.validation('Enter the exact active Campus+ username of the initial club administrator.');
    const checked = validate(clubPayload(formData), clubSchema);
    if (!checked.ok) throw errors.validation('Please check the club details.', checked.errors);

    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'community_create', user.profile.id);
    const { data, error } = await supabase.rpc('create_club_with_admin', {
      p_admin_username: adminUsername,
      p_payload: checked.data,
    });
    if (error) throw fromPostgresError(error, { unique: 'That club name or link is already taken.', rls: 'You cannot create a club right now.' });
    revalidateCommunity(data.id, data.slug);
    revalidatePath(ROUTES.admin);
    return { ok: true, id: data.id, href: ROUTES.clubManage(data.id) };
  } catch (error) {
    return toActionError(error, 'That club could not be created.');
  }
}

/** Slug, provenance and verification stay immutable to ordinary club managers. */
export async function updateClub(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    if (!UUID_REGEX.test(id)) throw errors.notFound('That club could not be found.');
    const checked = validate(clubPayload(formData), clubSchema);
    if (!checked.ok) throw errors.validation('Please check the club details.', checked.errors);
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('update_club_profile', {
      p_club: id,
      p_payload: checked.data,
    });
    if (error) throw fromPostgresError(error, { rls: 'Only this club’s owners and moderators can edit it.' });
    revalidateCommunity(id);
    return { ok: true, id: data?.id || id, href: ROUTES.clubManage(id) };
  } catch (error) {
    return toActionError(error, 'That club could not be saved.');
  }
}

export async function setCommunityMemberRole(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const communityId = String(formData.get('community_id') || '');
    const memberId = String(formData.get('user_id') || '');
    const role = String(formData.get('role') || '');
    if (!UUID_REGEX.test(communityId) || !UUID_REGEX.test(memberId)) throw errors.notFound('That membership could not be found.');
    if (!['member', 'moderator'].includes(role)) throw errors.validation('Choose a valid role.');
    if (memberId === user.profile.id) throw errors.validation('You cannot change your own role.');
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('set_community_member_role', {
      p_community: communityId,
      p_member: memberId,
      p_role: role,
    });
    if (error) throw fromPostgresError(error, { rls: 'Only the club owner can change member roles.' });
    revalidateCommunity(communityId);
    return { ok: true, role: data?.role || role };
  } catch (error) {
    return toActionError(error);
  }
}

export async function removeCommunityMember(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const communityId = String(formData.get('community_id') || '');
    const memberId = String(formData.get('user_id') || '');
    if (!UUID_REGEX.test(communityId) || !UUID_REGEX.test(memberId)) throw errors.notFound('That member could not be found.');
    if (memberId === user.profile.id) throw errors.validation('Use “Leave” to leave a club.');
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('remove_community_member', {
      p_community: communityId,
      p_member: memberId,
    });
    if (error) throw fromPostgresError(error, { rls: 'Only this club’s managers can remove members.' });
    revalidateCommunity(communityId);
    return { ok: true, removed: data?.ok === true };
  } catch (error) {
    return toActionError(error);
  }
}
