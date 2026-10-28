'use server';

/**
 * Campus life modules (spec §28–§38, §31–§38).
 *
 * Two families share this file:
 *   - student content: lost & found, housing, rides, team finder, projects,
 *     community-submitted resources and opportunities;
 *   - official content: events, notices, deals, locations, services, calendar,
 *     links, help — writable only by roles holding the matching permission.
 *
 * Both go through the same tables and the same RLS; this module never widens
 * permission, it only validates and returns the database's answer.
 */

import { revalidatePath, revalidateTag } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES } from '@/lib/constants';
import { PUBLIC_TAGS } from '@/lib/data/public-cache';
import {
  validate, lostFoundSchema, housingSchema, rideSchema, teamPostSchema,
  projectSchema, resourceSchema, opportunitySchema, eventSchema, noticeSchema,
  campusContentSchema, rsvpSchema,
} from '@/lib/validation/schemas';

/* -------------------------------------------------------------------------- */
/* Student content                                                             */
/* -------------------------------------------------------------------------- */

export async function createLostFound(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      {
        kind: formData.get('kind'),
        title: formData.get('title'),
        description: formData.get('description'),
        location: formData.get('location'),
        occurred_on: formData.get('occurred_on'),
      },
      lostFoundSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the details.', checked.errors);
    const supabase = await getServerClient();
    const { data, error } = await supabase
      .from('lost_found')
      .insert({
        kind: checked.data.kind,
        title: checked.data.title,
        description: checked.data.description,
        location: checked.data.location || null,
        occurred_on: checked.data.occurred_on || null,
        creator_id: user.profile.id,
        status: 'published',
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot post here right now.' });
    revalidatePath('/campus/lost-found');
    return { ok: true, id: data.id };
  } catch (error) {
    return toActionError(error);
  }
}

export async function resolveLostFound(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();
    // `status` stays 'published' on purpose: lost_found_select_visible (RLS)
    // only shows status = 'published' rows, and the product intentionally
    // keeps resolved reports visible "for reference" (see the lost & found
    // list page). resolved_at/resolved_by are what the UI actually checks.
    // A previous version set status = 'resolved', which does not exist in
    // the shared content_status enum ('draft'/'pending'/'published'/'hidden'/
    // 'removed'/'archived'/'deleted') — every resolve attempt raised a hard
    // 22P02 "invalid input value for enum" error.
    const { error } = await supabase
      .from('lost_found')
      .update({ resolved_at: new Date().toISOString(), resolved_by: user.profile.id })
      .eq('id', id);
    if (error) throw fromPostgresError(error, { rls: 'You cannot resolve that report.' });
    revalidatePath('/campus/lost-found');
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function createHousingPost(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      {
        title: formData.get('title'),
        description: formData.get('description'),
        area: formData.get('area'),
        budget: formData.get('budget'),
        room_type: formData.get('room_type'),
        available_from: formData.get('available_from'),
      },
      housingSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the details.', checked.errors);
    const supabase = await getServerClient();
    const { data, error } = await supabase
      .from('housing_posts')
      .insert({
        title: checked.data.title,
        description: checked.data.description,
        area: checked.data.area,
        budget: checked.data.budget || null,
        room_type: checked.data.room_type || null,
        available_from: checked.data.available_from || null,
        creator_id: user.profile.id,
        status: 'published',
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot post here right now.' });
    revalidatePath('/market/housing');
    return { ok: true, id: data.id };
  } catch (error) {
    return toActionError(error);
  }
}

export async function createRidePost(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      {
        origin: formData.get('origin'),
        destination: formData.get('destination'),
        ride_date: formData.get('ride_date'),
        ride_time: formData.get('ride_time'),
        description: formData.get('description'),
        seats: formData.get('seats'),
      },
      rideSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the ride details.', checked.errors);
    const supabase = await getServerClient();
    const { data, error } = await supabase
      .from('ride_posts')
      .insert({
        origin: checked.data.origin,
        destination: checked.data.destination,
        ride_date: checked.data.ride_date,
        ride_time: checked.data.ride_time || null,
        description: checked.data.description,
        seats: checked.data.seats || null,
        creator_id: user.profile.id,
        status: 'published',
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot post here right now.' });
    revalidatePath('/market/rides');
    return { ok: true, id: data.id };
  } catch (error) {
    return toActionError(error);
  }
}

export async function createTeamPost(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      {
        project_name: formData.get('project_name'),
        description: formData.get('description'),
        required_skills: formData.get('required_skills'),
        team_size: formData.get('team_size'),
        deadline: formData.get('deadline'),
      },
      teamPostSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the details.', checked.errors);
    const supabase = await getServerClient();
    const { data, error } = await supabase
      .from('team_posts')
      .insert({
        project_name: checked.data.project_name,
        description: checked.data.description,
        required_skills: checked.data.required_skills,
        team_size: checked.data.team_size || null,
        deadline: checked.data.deadline || null,
        creator_id: user.profile.id,
        status: 'published',
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot post here right now.' });
    revalidatePath('/campus/teams');
    revalidatePath('/campus/teams/new');
    return { ok: true, id: data.id };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Publish an opt-in study partner request. Like team posts, visibility is
 * earned by publishing — nothing about a student is discoverable until they
 * explicitly post. Closed and expired requests never list as active (RLS +
 * list helpers agree on the definition).
 */
export async function createStudyPost(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      {
        title: formData.get('title'),
        description: formData.get('description'),
        subject: formData.get('subject'),
        purpose: formData.get('purpose'),
        branch: formData.get('branch'),
        year: formData.get('year'),
        academic_context: formData.get('academic_context'),
        mode: formData.get('mode') || 'either',
        availability: formData.getAll('availability'),
        expires_on: formData.get('expires_on'),
      },
      studyPostSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the details.', checked.errors);
    const supabase = await getServerClient();
    const { data, error } = await supabase
      .from('study_partner_posts')
      .insert({
        title: checked.data.title,
        description: checked.data.description,
        subject: checked.data.subject,
        purpose: checked.data.purpose,
        branch: checked.data.branch || null,
        year: checked.data.year || null,
        academic_context: checked.data.academic_context || null,
        mode: checked.data.mode || 'either',
        availability: checked.data.availability || [],
        expires_on: checked.data.expires_on || null,
        creator_id: user.profile.id,
        status: 'published',
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot post here right now.' });
    revalidatePath('/campus/study');
    return { ok: true, id: data.id, href: ROUTES.studyPost(data.id) };
  } catch (error) {
    return toActionError(error);
  }
}

/** The creator closes their own request; RLS rejects anyone else. */
export async function closeStudyPost(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();
    const { error } = await supabase
      .from('study_partner_posts')
      .update({ closed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw fromPostgresError(error, { rls: 'Only the creator can close that request.' });
    revalidatePath('/campus/study');
    revalidatePath(ROUTES.studyPost(id));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** Reopen a closed request. An expired request stays expired — honestly. */
export async function reopenStudyPost(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();
    const { error } = await supabase
      .from('study_partner_posts')
      .update({ closed_at: null })
      .eq('id', id);
    if (error) throw fromPostgresError(error, { rls: 'Only the creator can reopen that request.' });
    revalidatePath('/campus/study');
    revalidatePath(ROUTES.studyPost(id));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function createProject(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      {
        title: formData.get('title'),
        description: formData.get('description'),
        technologies: formData.get('technologies'),
        repo_url: formData.get('repo_url'),
        live_url: formData.get('live_url'),
        team_members: formData.get('team_members'),
      },
      projectSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the project details.', checked.errors);
    const supabase = await getServerClient();
    const { data, error } = await supabase
      .from('projects')
      .insert({
        title: checked.data.title,
        description: checked.data.description,
        technologies: checked.data.technologies,
        repo_url: checked.data.repo_url || null,
        live_url: checked.data.live_url || null,
        team_members: checked.data.team_members || null,
        creator_id: user.profile.id,
        status: 'published',
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot publish a project right now.' });
    revalidatePath('/explore/projects');
    return { ok: true, id: data.id, href: ROUTES.project(data.id) };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Community submission for the resource hub. `is_official` stays false and the
 * status follows the `moderate_community_submissions` platform setting, so a
 * student submission can never masquerade as official content.
 */
export async function submitResource(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      {
        title: formData.get('title'),
        description: formData.get('description'),
        url: formData.get('url'),
        type: formData.get('type') || 'notes',
        branch: formData.get('branch'),
        year: formData.get('year'),
        semester: formData.get('semester'),
        subject: formData.get('subject'),
      },
      resourceSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the resource details.', checked.errors);
    const supabase = await getServerClient();
    const { data: requiresReview } = await supabase.rpc('community_submissions_require_review', { p_kind: 'resource' });
    const { data, error } = await supabase
      .from('official_resources')
      .insert({
        title: checked.data.title,
        description: checked.data.description,
        url: checked.data.url,
        type: checked.data.type,
        branch: checked.data.branch || null,
        year: checked.data.year || null,
        semester: checked.data.semester || null,
        subject: checked.data.subject || null,
        is_official: false,
        status: requiresReview ? 'pending' : 'published',
        submitted_by: user.profile.id,
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot submit resources right now.' });
    revalidatePath('/explore/resources');
    return { ok: true, id: data.id, pending: Boolean(requiresReview) };
  } catch (error) {
    return toActionError(error);
  }
}


/* -------------------------------------------------------------------------- */
/* RSVP                                                                        */
/* -------------------------------------------------------------------------- */

export async function setRsvp(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      { event_id: formData.get('event_id'), status: formData.get('status'), note: formData.get('note') },
      rsvpSchema,
    );
    if (!checked.ok) throw errors.validation('Choose going, interested or not going.', checked.errors);
    const supabase = await getServerClient();

    const { error } = await supabase
      .from('event_registrations')
      .upsert(
        {
          event_id: checked.data.event_id,
          user_id: user.profile.id,
          status: checked.data.status,
          note: checked.data.note || null,
        },
        { onConflict: 'event_id,user_id' },
      );
    if (error) throw fromPostgresError(error, { rls: 'You cannot RSVP to that event.' });
    revalidatePath(ROUTES.event(checked.data.event_id));
    return { ok: true, status: checked.data.status };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Submit an opportunity (spec §35). Community submissions stay labelled
 * `community` until staff verify them, and the database decides (via
 * `community_submissions_require_review`) whether they need review first.
 */
export async function submitOpportunity(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      {
        title: formData.get('title'),
        organization: formData.get('organization'),
        description: formData.get('description'),
        eligibility: formData.get('eligibility'),
        deadline: formData.get('deadline'),
        url: formData.get('url'),
        location: formData.get('location'),
        mode: formData.get('mode') || 'onsite',
        category: formData.get('category'),
        club_id: formData.get('club_id'),
      },
      opportunitySchema,
    );
    if (!checked.ok) throw errors.validation('Please check the opportunity details.', checked.errors);

    const supabase = await getServerClient();
    if (checked.data.club_id && !can(toActor(user), 'manage_official_content')) {
      const { data: allowed, error: accessError } = await supabase.rpc('can_manage_club', { p_club: checked.data.club_id });
      if (accessError) throw fromPostgresError(accessError);
      if (!allowed) throw errors.forbidden('Only this club’s managers can link an opportunity to it.');
    }
    const { data: requiresReview } = await supabase.rpc('community_submissions_require_review', { p_kind: 'opportunity' });
    const { data, error } = await supabase
      .from('opportunities')
      .insert({
        title: checked.data.title,
        organization: checked.data.organization,
        description: checked.data.description,
        eligibility: checked.data.eligibility || null,
        deadline: checked.data.deadline || null,
        url: checked.data.url || null,
        location: checked.data.location || null,
        mode: checked.data.mode || 'onsite',
        category: checked.data.category || null,
        club_id: checked.data.club_id || null,
        source: 'community',
        status: requiresReview ? 'pending' : 'published',
        created_by: user.profile.id,
        published_at: requiresReview ? null : new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot submit opportunities right now.' });
    revalidatePath('/explore/opportunities');
    if (checked.data.club_id) {
      revalidatePath(ROUTES.club(checked.data.club_id));
      revalidatePath(ROUTES.clubManage(checked.data.club_id, 'opportunities'));
    }
    return { ok: true, id: data.id, pending: Boolean(requiresReview) };
  } catch (error) {
    return toActionError(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Official campus content (spec §43–§46)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Per-table payload builders. The campus tables do not share a vocabulary
 * (`campus_locations.name` vs `campus_services.title`, `transport_information`
 * uses `route_name`, …), so the mapping is explicit rather than clever — a wrong
 * column would otherwise only surface as a runtime PostgREST error.
 */
const CAMPUS_CONTENT_TABLES = {
  campus_deals: {
    permission: 'manage_deals',
    payload: (v, now) => ({
      title: v.title,
      description: v.description || null,
      merchant: v.category || null,
      discount_details: v.body || null,
      contact_info: v.contact_info || null,
      valid_from: v.valid_from || null,
      valid_until: v.valid_until || null,
      is_official: true,
      published_at: now,
    }),
  },
  campus_locations: {
    permission: 'manage_official_content',
    payload: (v) => ({
      name: v.title,
      description: v.description || null,
      block: v.location || null,
      category: v.category || null,
      external_map_url: v.url || v.external_url || null,
    }),
  },
  campus_services: {
    permission: 'manage_official_content',
    payload: (v) => ({
      title: v.title,
      description: v.description || null,
      category: v.category || null,
      location: v.location || null,
      contact_info: v.contact_info || null,
      external_url: v.url || v.external_url || null,
    }),
  },
  transport_information: {
    permission: 'manage_official_content',
    payload: (v) => ({
      route_name: v.title,
      description: v.body || v.description || null,
      contact_info: v.contact_info || null,
    }),
  },
  cafeteria_information: {
    permission: 'manage_official_content',
    payload: (v) => ({
      title: v.title,
      description: v.description || null,
      menu_text: v.body || null,
      location: v.location || null,
      contact_info: v.contact_info || null,
    }),
  },
  academic_calendar: {
    permission: 'manage_official_content',
    payload: (v) => ({
      title: v.title,
      description: v.description || v.body || null,
      entry_type: v.category || 'academic',
      starts_on: v.starts_on || null,
      ends_on: v.ends_on || null,
    }),
  },
  official_links: {
    permission: 'manage_official_content',
    payload: (v) => ({
      title: v.title,
      description: v.description || null,
      purpose: v.category || null,
      url: v.url || v.external_url || null,
      deadline: v.deadline || null,
    }),
  },
  help_contacts: {
    permission: 'manage_official_content',
    payload: (v) => ({
      title: v.title,
      description: v.description || v.body || null,
      category: v.category || null,
      contact_info: v.contact_info || null,
      location: v.location || null,
    }),
  },
};

/** Create or update one piece of official campus information. */
export async function saveCampusContent(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();

    const table = String(formData.get('table') || '');
    const config = CAMPUS_CONTENT_TABLES[table];
    if (!config) throw errors.validation('That content type is not editable here.');
    if (!can(toActor(user), config.permission)) {
      throw errors.forbidden('You do not have permission to edit this content.');
    }

    const checked = validate(
      {
        title: formData.get('title'),
        body: formData.get('body'),
        description: formData.get('description'),
        location: formData.get('location'),
        contact_info: formData.get('contact_info'),
        external_url: formData.get('external_url'),
        category: formData.get('category'),
        url: formData.get('url'),
        starts_on: formData.get('starts_on'),
        ends_on: formData.get('ends_on'),
        deadline: formData.get('deadline'),
        valid_from: formData.get('valid_from'),
        valid_until: formData.get('valid_until'),
      },
      campusContentSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the details.', checked.errors);

    const id = String(formData.get('id') || '') || null;
    const supabase = await getServerClient();
    const payload = config.payload(checked.data, new Date().toISOString());

    const query = id
      ? supabase.from(table).update({ ...payload, updated_by: user.profile.id }).eq('id', id).select('id').single()
      : supabase.from(table).insert({ ...payload, created_by: user.profile.id }).select('id').single();
    const { data, error } = await query;
    if (error) throw fromPostgresError(error, { rls: 'You do not have permission to edit that content.' });

    revalidatePath('/campus');
    revalidatePath('/campus/utilities');
    revalidatePath(ROUTES.market);
    return { ok: true, id: data.id };
  } catch (error) {
    return toActionError(error, 'That content could not be saved.');
  }
}

/* -------------------------------------------------------------------------- */
/* Official events and notices (spec §27, §30)                                */
/* -------------------------------------------------------------------------- */

/** Create or update an official event. Staff-only; the database re-checks. */
export async function saveEvent(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      {
        title: formData.get('title'),
        description: formData.get('description'),
        starts_on: formData.get('starts_on'),
        ends_on: formData.get('ends_on'),
        start_time: formData.get('start_time'),
        end_time: formData.get('end_time'),
        location: formData.get('location'),
        organizer: formData.get('organizer'),
        registration_info: formData.get('registration_info'),
        registration_url: formData.get('registration_url'),
        club_id: formData.get('club_id'),
        capacity: formData.get('capacity'),
        category: formData.get('category'),
        show_attendees: formData.get('show_attendees') !== null,
        status: formData.get('status') || 'published',
      },
      eventSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the event details.', checked.errors);
    const id = String(formData.get('id') || '') || null;
    const supabase = await getServerClient();
    const payload = {
      title: checked.data.title,
      description: checked.data.description,
      starts_on: checked.data.starts_on,
      ends_on: checked.data.ends_on || null,
      start_time: checked.data.start_time || null,
      end_time: checked.data.end_time || null,
      location: checked.data.location,
      organizer: checked.data.organizer || null,
      registration_info: checked.data.registration_info || null,
      registration_url: checked.data.registration_url || null,
      club_id: checked.data.club_id || null,
      capacity: checked.data.capacity || null,
      category: checked.data.category || null,
      show_attendees: checked.data.show_attendees !== false,
      status: checked.data.status || 'published',
      updated_by: user.profile.id,
      published_at: checked.data.status === 'draft' ? null : new Date().toISOString(),
    };

    // Provenance is sticky: staff-created events are official, while an update
    // never flips a student submission to official — publishing a submission
    // keeps `is_official = false` so it renders as student-organized.
    const query = id
      ? supabase.from('events').update(payload).eq('id', id).select('id').single()
      : supabase.from('events').insert({ ...payload, is_official: true, created_by: user.profile.id }).select('id').single();
    const { data, error } = await query;
    if (error) throw fromPostgresError(error, { rls: 'Only staff with the events permission can manage events.' });
    revalidateTag(PUBLIC_TAGS.events);
    revalidatePath('/campus/events');
    revalidatePath('/campus');
    if (id) revalidatePath(ROUTES.event(id));
    return { ok: true, id: data.id, href: ROUTES.event(data.id) };
  } catch (error) {
    return toActionError(error, 'That event could not be saved.');
  }
}

/**
 * Submit a community event for staff review. The row is always a non-official
 * draft (RLS enforces both); publishing is a separate staff-only step, so a
 * submission can never appear official on its own.
 */
export async function submitEvent(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      {
        title: formData.get('title'),
        description: formData.get('description'),
        starts_on: formData.get('starts_on'),
        ends_on: formData.get('ends_on'),
        start_time: formData.get('start_time'),
        end_time: formData.get('end_time'),
        location: formData.get('location'),
        organizer: formData.get('organizer'),
        registration_info: formData.get('registration_info'),
        registration_url: formData.get('registration_url'),
        club_id: formData.get('club_id'),
        capacity: formData.get('capacity'),
        category: formData.get('category'),
        show_attendees: formData.get('show_attendees') !== null,
      },
      eventSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the event details.', checked.errors);
    const supabase = await getServerClient();
    if (checked.data.club_id && !can(toActor(user), 'manage_events')) {
      const { data: allowed, error: accessError } = await supabase.rpc('can_manage_club', { p_club: checked.data.club_id });
      if (accessError) throw fromPostgresError(accessError);
      if (!allowed) throw errors.forbidden('Only this club’s managers can link an event to it.');
    }
    const { data, error } = await supabase
      .from('events')
      .insert({
        title: checked.data.title,
        description: checked.data.description,
        starts_on: checked.data.starts_on,
        ends_on: checked.data.ends_on || null,
        start_time: checked.data.start_time || null,
        end_time: checked.data.end_time || null,
        location: checked.data.location,
        organizer: checked.data.organizer || null,
        registration_info: checked.data.registration_info || null,
        registration_url: checked.data.registration_url || null,
        club_id: checked.data.club_id || null,
        capacity: checked.data.capacity || null,
        category: checked.data.category || null,
        show_attendees: checked.data.show_attendees !== false,
        status: 'draft',
        is_official: false,
        created_by: user.profile.id,
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot submit events right now.' });
    revalidatePath('/campus/events');
    if (checked.data.club_id) {
      revalidatePath(ROUTES.club(checked.data.club_id));
      revalidatePath(ROUTES.clubManage(checked.data.club_id, 'events'));
    }
    return { ok: true, id: data.id, href: ROUTES.event(data.id) };
  } catch (error) {
    return toActionError(error);
  }
}

/** Staff publishes a student submission. Provenance stays community. */
export async function publishEventSubmission(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();
    const { error } = await supabase
      .from('events')
      .update({ status: 'published', published_at: new Date().toISOString(), updated_by: user.profile.id })
      .eq('id', id)
      .eq('status', 'draft');
    if (error) throw fromPostgresError(error, { rls: 'Only staff can publish events.' });
    revalidateTag(PUBLIC_TAGS.events);
    revalidatePath('/campus/events');
    revalidatePath(ROUTES.event(id));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** Staff declines a student submission; the submitter still sees their draft. */
export async function rejectEventSubmission(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();
    const { error } = await supabase
      .from('events')
      .update({ status: 'cancelled', updated_by: user.profile.id })
      .eq('id', id)
      .eq('status', 'draft');
    if (error) throw fromPostgresError(error, { rls: 'Only staff can review events.' });
    revalidateTag(PUBLIC_TAGS.events);
    revalidatePath('/campus/events');
    revalidatePath(ROUTES.event(id));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** A submitter withdraws their own unreviewed draft. */
export async function withdrawEventSubmission(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (error) throw fromPostgresError(error, { rls: 'That submission cannot be withdrawn.' });
    // Only reachable for a draft, but the tag is shared with the published list,
    // so clearing it keeps the two in step at no cost.
    revalidateTag(PUBLIC_TAGS.events);
    revalidatePath('/campus/events');
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** Create or update an official notice. Staff-only. */
export async function saveNotice(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      {
        title: formData.get('title'),
        body: formData.get('body'),
        category: formData.get('category') || 'general',
        importance: formData.get('importance') || 'normal',
        pinned: formData.get('pinned') !== null,
        expires_at: formData.get('expires_at'),
        status: formData.get('status') || 'published',
      },
      noticeSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the notice details.', checked.errors);
    const id = String(formData.get('id') || '') || null;
    const supabase = await getServerClient();
    const payload = {
      title: checked.data.title,
      body: checked.data.body,
      category: checked.data.category || 'general',
      importance: checked.data.importance || 'normal',
      pinned: checked.data.pinned === true,
      expires_at: checked.data.expires_at || null,
      status: checked.data.status || 'published',
      updated_by: user.profile.id,
      published_at: checked.data.status === 'draft' ? null : new Date().toISOString(),
    };
    const query = id
      ? supabase.from('notices').update(payload).eq('id', id).select('id').single()
      : supabase.from('notices').insert({ ...payload, created_by: user.profile.id }).select('id').single();
    const { data, error } = await query;
    if (error) throw fromPostgresError(error, { rls: 'Only staff with the notices permission can publish notices.' });
    // The public notice list is shared between students for up to a minute;
    // publishing or editing a notice must not wait that long.
    revalidateTag(PUBLIC_TAGS.notices);
    revalidatePath('/campus/noticeboard');
    revalidatePath('/campus');
    revalidatePath('/home');
    return { ok: true, id: data.id, href: ROUTES.notice(data.id) };
  } catch (error) {
    return toActionError(error, 'That notice could not be saved.');
  }
}
