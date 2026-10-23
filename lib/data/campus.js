import 'server-only';

/**
 * Read helpers for the campus surfaces: notices, events, clubs, lost & found,
 * housing, rides, team finder, resources, opportunities, projects and the
 * text-only campus utilities (spec §25–§46).
 *
 * Every query runs as the signed-in student, so RLS decides what is visible:
 * official content stays official, community submissions stay visibly
 * community-submitted, and unpublished rows never leak.
 */

import { PAGE_SIZE } from '@/lib/constants';
import { logError } from '@/lib/errors';

const PUBLISHED = 'published';

/* -------------------------------------------------------------------------- */
/* Notices                                                                    */
/* -------------------------------------------------------------------------- */

export async function listNotices(supabase, { limit = 20, offset = 0, category = null, includeExpired = false } = {}) {
  const query = supabase
    .from('notices')
    .select('id, title, body, category, importance, pinned, expires_at, status, created_by, updated_by, published_at, created_at')
    .eq('status', PUBLISHED)
    .order('pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (category) query.eq('category', category);
  if (!includeExpired) query.or(`expires_at.is.null,expires_at.gte.${new Date().toISOString()}`);
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getNotice(supabase, id) {
  const { data } = await supabase
    .from('notices')
    .select('id, title, body, category, importance, pinned, expires_at, status, created_by, updated_by, published_at, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

const EVENT_COLUMNS =
  'id, title, description, starts_on, ends_on, start_time, end_time, location, organizer, ' +
  'registration_url, capacity, show_attendees, club_id, category, status, is_official, ' +
  'created_by, updated_by, published_at, created_at';

export async function listEvents(
  supabase,
  { limit = 20, offset = 0, upcoming = true, clubId = null, from = null, to = null, category = null, source = null } = {},
) {
  let query = supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('status', PUBLISHED)
    .order('starts_on', { ascending: true })
    .range(offset, offset + Math.max(0, limit - 1));
  // An explicit date window (the calendar) replaces the upcoming/past toggle.
  if (from || to) {
    if (from) query = query.gte('starts_on', from);
    if (to) query = query.lte('starts_on', to);
  } else if (upcoming) {
    query = query.gte('starts_on', new Date().toISOString().slice(0, 10));
  } else {
    query = query.lt('starts_on', new Date().toISOString().slice(0, 10));
  }
  if (clubId) query = query.eq('club_id', clubId);
  if (category) query = query.eq('category', category);
  if (source === 'official') query = query.eq('is_official', true);
  if (source === 'community') query = query.eq('is_official', false);
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getEvent(supabase, id) {
  const { data } = await supabase
    .from('events')
    .select(`${EVENT_COLUMNS}, registration_info, discussion_post_id, updated_at`)
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

/**
 * Student submissions awaiting staff review. Only staff can see drafts through
 * RLS (`events_select_staff`); anyone else gets an empty list, never an error.
 */
export async function listEventSubmissions(supabase, { limit = 30 } = {}) {
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('status', 'draft')
    .eq('is_official', false)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

/** The viewer's own draft submissions (RLS: `events_select_own`). */
export async function listMyEventSubmissions(supabase, profileId, { limit = 30 } = {}) {
  if (!profileId) return { items: [], unavailable: false };
  const { data, error } = await supabase
    .from('events')
    .select('id, title, starts_on, location, category, status, created_at')
    .eq('status', 'draft')
    .eq('created_by', profileId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

/** The viewer's RSVP status for a set of events, keyed by event id. */
export async function listMyRsvps(supabase, eventIds, profileId) {
  if (!profileId || !eventIds?.length) return new Map();
  const { data } = await supabase
    .from('event_registrations')
    .select('event_id, status')
    .eq('user_id', profileId)
    .in('event_id', [...new Set(eventIds)]);
  return new Map((data || []).map((row) => [row.event_id, row.status]));
}

export async function getEventRsvp(supabase, eventId, profileId) {
  if (!profileId) return null;
  const { data } = await supabase
    .from('event_registrations')
    .select('id, status, note, created_at')
    .eq('event_id', eventId)
    .eq('user_id', profileId)
    .maybeSingle();
  return data || null;
}

export async function listEventAttendees(supabase, eventId, { limit = 40 } = {}) {
  const { data: registrations } = await supabase
    .from('event_registrations')
    .select('user_id, status, created_at')
    .eq('event_id', eventId)
    .in('status', ['going', 'interested'])
    .order('created_at', { ascending: true })
    .limit(limit);
  const ids = [...new Set((registrations || []).map((row) => row.user_id))];
  if (!ids.length) return [];
  const { data: people } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_staff')
    .in('id', ids);
  const byId = new Map((people || []).map((person) => [person.id, person]));
  return (registrations || []).map((row) => ({
    ...row,
    username: byId.get(row.user_id)?.username || null,
    display_name: byId.get(row.user_id)?.display_name || null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Communities, clubs and study groups                                        */
/* -------------------------------------------------------------------------- */

const COMMUNITY_COLUMNS =
  'id, kind, name, slug, description, subject, club_category, branch, year, meeting_info, ' +
  'recruitment_info, contact_info, external_url, visibility, join_policy, status, is_official, ' +
  'created_by, member_count, post_count, created_at';

/**
 * Discovery for communities, study groups and clubs.
 *
 * `q` searches the name, the subject/interest and — for clubs — the discovery
 * category, so "technical" finds the robotics club whether the word is in its
 * name, its subject or its category. PostgREST's `or=` syntax splits on commas,
 * so commas and parentheses are stripped from the term before it is sent.
 */
export async function listCommunities(
  supabase,
  { kind = null, limit = 24, offset = 0, q = null, order = 'members', category = null } = {},
) {
  let query = supabase.from('communities').select(COMMUNITY_COLUMNS).eq('status', PUBLISHED);
  if (kind) query = Array.isArray(kind) ? query.in('kind', kind) : query.eq('kind', kind);
  if (category) query = query.eq('club_category', category);
  if (q) {
    const term = String(q).replace(/[,()*%]/g, ' ').trim().slice(0, 60);
    if (term) {
      const pattern = `%${term}%`;
      query = query.or(`name.ilike.${pattern},subject.ilike.${pattern},club_category.ilike.${pattern}`);
    }
  }
  if (order === 'newest') query = query.order('created_at', { ascending: false });
  else if (order === 'name') query = query.order('name', { ascending: true });
  else query = query.order('member_count', { ascending: false }).order('name', { ascending: true });
  const { data, error } = await query.range(offset, offset + Math.max(0, limit - 1));
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

/** Published clubs per discovery category, for the filter chips on /clubs. */
export async function countClubsByCategory(supabase) {
  const { data, error } = await supabase
    .from('communities')
    .select('club_category')
    .eq('kind', 'club')
    .eq('status', PUBLISHED)
    .limit(500);
  if (error) return { counts: {}, total: 0, unavailable: true };
  const counts = {};
  for (const row of data || []) {
    const key = row.club_category || 'Uncategorised';
    counts[key] = (counts[key] || 0) + 1;
  }
  return { counts, total: (data || []).length, unavailable: false };
}

export async function getCommunityBySlug(supabase, slug) {
  const { data } = await supabase
    .from('communities')
    .select('id, kind, name, slug, description, subject, club_category, branch, year, meeting_info, ' +
    'recruitment_info, contact_info, external_url, visibility, join_policy, status, is_official, ' +
    'created_by, member_count, post_count, created_at, updated_at, approved_at, approved_by')
    .eq('slug', slug)
    .maybeSingle();
  return data || null;
}

export async function getCommunityById(supabase, id) {
  const { data } = await supabase.from('communities').select(COMMUNITY_COLUMNS).eq('id', id).maybeSingle();
  return data || null;
}

export async function getCommunityMembership(supabase, communityId, profileId) {
  if (!profileId) return null;
  const { data } = await supabase
    .from('community_members')
    .select('id, community_id, user_id, role, status, joined_at')
    .eq('community_id', communityId)
    .eq('user_id', profileId)
    .maybeSingle();
  return data || null;
}

export async function listCommunityMembers(supabase, communityId, { limit = 60, status = 'active' } = {}) {
  let query = supabase
    .from('community_members')
    .select('user_id, role, status, joined_at')
    .eq('community_id', communityId)
    .order('role', { ascending: true })
    .order('joined_at', { ascending: true })
    .limit(limit);
  // Managers review pending members too; everyone else only ever sees active
  // members (RLS would hide the rest anyway).
  if (status) query = query.eq('status', status);
  const { data: members } = await query;
  const ids = [...new Set((members || []).map((member) => member.user_id))];
  if (!ids.length) return [];
  const { data: people } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_staff')
    .in('id', ids);
  const byId = new Map((people || []).map((person) => [person.id, person]));
  return (members || []).map((member) => ({
    ...member,
    username: byId.get(member.user_id)?.username || null,
    display_name: byId.get(member.user_id)?.display_name || null,
    is_staff: byId.get(member.user_id)?.is_staff === true,
  }));
}

export async function listJoinRequests(supabase, communityId, { limit = 30 } = {}) {
  const { data: requests } = await supabase
    .from('community_join_requests')
    .select('id, user_id, message, status, decided_by, decided_at, created_at')
    .eq('community_id', communityId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);
  const ids = [...new Set((requests || []).map((row) => row.user_id))];
  if (!ids.length) return [];
  const { data: people } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_staff')
    .in('id', ids);
  const byId = new Map((people || []).map((person) => [person.id, person]));
  return (requests || []).map((row) => ({
    ...row,
    username: byId.get(row.user_id)?.username || null,
    display_name: byId.get(row.user_id)?.display_name || null,
  }));
}

export async function getCommunityChatConversation(supabase, communityId) {
  const { data } = await supabase
    .from('conversations')
    .select('id, kind, title, status, last_message_at')
    .eq('community_id', communityId)
    .eq('kind', 'group')
    .maybeSingle();
  return data || null;
}

/* -------------------------------------------------------------------------- */
/* Lost & found, housing, rides, teams                                        */
/* -------------------------------------------------------------------------- */

export async function listLostFound(supabase, { kind = null, resolved = false, limit = 24, offset = 0 } = {}) {
  // Resolving a report never changes `status` (see resolveLostFound) — it
  // stays 'published' so the item remains visible under RLS. "Resolved" vs.
  // "active" is purely resolved_at: null means still open, non-null means
  // resolved. The "Resolved" tab must show only resolved items, not
  // everything, so this now filters explicitly in both directions instead of
  // only ever excluding resolved items.
  let query = supabase
    .from('lost_found')
    .select('id, kind, title, description, location, occurred_on, status, resolved_at, resolved_by, creator_id, created_at')
    .eq('status', PUBLISHED)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (kind) query = query.eq('kind', kind);
  query = resolved ? query.not('resolved_at', 'is', null) : query.is('resolved_at', null);
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getLostFound(supabase, id) {
  const { data } = await supabase
    .from('lost_found')
    .select('id, kind, title, description, location, occurred_on, status, resolved_at, resolved_by, creator_id, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

export async function listHousingPosts(supabase, { limit = 24, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('housing_posts')
    .select('id, title, description, area, budget, room_type, available_from, status, creator_id, created_at')
    .eq('status', PUBLISHED)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getHousingPost(supabase, id) {
  const { data } = await supabase
    .from('housing_posts')
    .select('id, title, description, area, budget, room_type, available_from, status, creator_id, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

export async function listRidePosts(supabase, { limit = 24, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('ride_posts')
    .select('id, origin, destination, ride_date, ride_time, description, seats, status, creator_id, created_at')
    .eq('status', PUBLISHED)
    .order('ride_date', { ascending: true })
    .range(offset, offset + Math.max(0, limit - 1));
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function listTeamPosts(supabase, { limit = 24, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('team_posts')
    .select('id, project_name, description, required_skills, team_size, deadline, status, creator_id, created_at')
    .eq('status', PUBLISHED)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function listTeamRequests(supabase, teamPostId) {
  const { data } = await supabase
    .from('team_post_requests')
    .select('id, user_id, message, status, decided_at, created_at')
    .eq('team_post_id', teamPostId)
    .order('created_at', { ascending: true });
  return data || [];
}

/* -------------------------------------------------------------------------- */
/* Study Partner Finder (opt-in requests, coarse availability only)            */
/* -------------------------------------------------------------------------- */

const STUDY_COLUMNS =
  'id, title, description, subject, purpose, branch, year, academic_context, ' +
  'mode, availability, expires_on, closed_at, status, creator_id, created_at, updated_at';

/** Active listings: published, open, unexpired. RLS enforces blocks + status. */
export async function listStudyPosts(
  supabase,
  { limit = 24, offset = 0, q = null, subject = null, purpose = null, mode = null, availability = null, branch = null, year = null } = {},
) {
  const today = new Date().toISOString().slice(0, 10);
  let query = supabase
    .from('study_partner_posts')
    .select(STUDY_COLUMNS)
    .eq('status', PUBLISHED)
    .is('closed_at', null)
    .or(`expires_on.is.null,expires_on.gte.${today}`)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (purpose) query = query.eq('purpose', purpose);
  if (mode) query = query.eq('mode', mode);
  if (branch) query = query.eq('branch', branch);
  if (year) query = query.eq('year', year);
  if (subject) query = query.ilike('subject', `%${subject}%`);
  if (availability) query = query.contains('availability', [availability]);
  if (q) query = query.textSearch('search_vector', q, { config: 'english', type: 'websearch' });
  const { data, error } = await query;
  if (error) {
    logError(error, { route: 'data/campus/listStudyPosts' });
    return { items: [], unavailable: true };
  }
  return { items: data || [], unavailable: false };
}

export async function getStudyPost(supabase, id) {
  const { data, error } = await supabase
    .from('study_partner_posts')
    .select(STUDY_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logError(error, { route: 'data/campus/getStudyPost' });
  }
  return data || null;
}

/** The creator's own requests, including closed and expired ones. */
export async function listMyStudyPosts(supabase, profileId, { limit = 30 } = {}) {
  if (!profileId) return { items: [], unavailable: false };
  const { data, error } = await supabase
    .from('study_partner_posts')
    .select('id, title, subject, purpose, mode, expires_on, closed_at, status, created_at')
    .eq('creator_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    logError(error, { route: 'data/campus/listMyStudyPosts' });
    return { items: [], unavailable: true };
  }
  return { items: data || [], unavailable: false };
}

/** True when the request should no longer appear as an active opportunity. */
export function isStudyPostActive(post, today = new Date().toISOString().slice(0, 10)) {
  if (!post || post.status !== PUBLISHED || post.closed_at) return false;
  if (post.expires_on && post.expires_on < today) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Resources, opportunities, projects                                         */
/* -------------------------------------------------------------------------- */

export async function listResources(
  supabase,
  { limit = 24, offset = 0, q = null, subject = null, branch = null, year = null, semester = null, type = null, source = null } = {},
) {
  let query = supabase
    .from('official_resources')
    .select('id, title, description, url, branch, year, semester, subject, type, is_official, status, submitted_by, approved_by, published_at, created_at')
    .eq('status', PUBLISHED)
    .order('published_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (branch) query = query.eq('branch', branch);
  if (year) query = query.eq('year', year);
  if (semester) query = query.eq('semester', semester);
  if (type) query = query.eq('type', type);
  if (source === 'official') query = query.eq('is_official', true);
  if (source === 'community') query = query.eq('is_official', false);
  if (subject) query = query.ilike('subject', `%${subject}%`);
  if (q) query = query.textSearch('search_vector', q, { config: 'english', type: 'websearch' });
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

/**
 * Subject collections for the knowledge exchange: real subjects with real
 * counts, derived from published rows. An empty hub yields no collections.
 */
export async function listResourceSubjects(supabase, { limit = 12 } = {}) {
  const { data, error } = await supabase
    .from('official_resources')
    .select('subject')
    .eq('status', PUBLISHED)
    .not('subject', 'is', null)
    .limit(500);
  if (error) return { items: [], unavailable: true };
  const counts = new Map();
  for (const row of data || []) {
    const subject = String(row.subject || '').trim();
    if (!subject) continue;
    const key = subject.toLowerCase();
    if (!counts.has(key)) counts.set(key, { subject, count: 0 });
    counts.get(key).count += 1;
  }
  const items = [...counts.values()].sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject));
  return { items: items.slice(0, limit), unavailable: false };
}

export async function getResource(supabase, id) {
  const { data } = await supabase
    .from('official_resources')
    .select('id, title, description, url, branch, year, semester, subject, type, is_official, status, submitted_by, created_by, approved_by, published_at, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

export async function listOpportunities(
  supabase,
  { limit = 24, offset = 0, source = null, category = null, mode = null, q = null } = {},
) {
  let query = supabase
    .from('opportunities')
    .select('id, title, organization, description, eligibility, deadline, url, location, mode, source, category, status, approved_by, published_at, created_at')
    .eq('status', PUBLISHED)
    .order('published_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (source) query = query.eq('source', source);
  if (category) query = query.eq('category', category);
  if (mode) query = query.eq('mode', mode);
  if (q) query = query.or(`title.ilike.%${q}%,organization.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getOpportunity(supabase, id) {
  const { data } = await supabase
    .from('opportunities')
    .select('id, title, organization, description, eligibility, deadline, url, location, mode, source, status, created_by, approved_by, published_at, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

export async function listProjects(supabase, { limit = 24, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, title, description, technologies, repo_url, live_url, team_members, creator_id, status, reaction_count, created_at')
    .eq('status', PUBLISHED)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getProject(supabase, id) {
  const { data } = await supabase
    .from('projects')
    .select('id, title, description, technologies, repo_url, live_url, team_members, creator_id, status, reaction_count, moderated_by, moderated_at, moderation_reason, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

/* -------------------------------------------------------------------------- */
/* Campus utilities (text-only directory, spec §43–§46)                       */
/* -------------------------------------------------------------------------- */

const UTILITY_TABLES = {
  locations: {
    table: 'campus_locations',
    columns: 'id, name, description, block, category, external_map_url, sort_order',
    order: { column: 'sort_order', ascending: true },
  },
  services: {
    table: 'campus_services',
    columns: 'id, title, description, category, location, hours, contact_info, external_url',
    order: { column: 'title', ascending: true },
  },
  transport: {
    table: 'transport_information',
    columns: 'id, route_name, description, timings, pickup_locations, service_status, contact_info',
    order: { column: 'route_name', ascending: true },
  },
  cafeteria: {
    table: 'cafeteria_information',
    columns: 'id, title, description, menu_text, offers, hours, location, contact_info',
    order: { column: 'title', ascending: true },
  },
  calendar: {
    table: 'academic_calendar',
    columns: 'id, title, description, entry_type, starts_on, ends_on, audience',
    order: { column: 'starts_on', ascending: true },
    dateColumn: 'starts_on',
  },
  links: {
    table: 'official_links',
    columns: 'id, title, description, purpose, audience, url, deadline',
    order: { column: 'title', ascending: true },
  },
  help: {
    table: 'help_contacts',
    columns: 'id, title, category, description, contact_info, location, availability, sort_order',
    order: { column: 'sort_order', ascending: true },
  },
};

export const UTILITY_KEYS = Object.keys(UTILITY_TABLES);

export async function listUtility(supabase, key, { limit = 60, from = null } = {}) {
  const config = UTILITY_TABLES[key];
  if (!config) return { items: [], unavailable: true };
  let query = supabase
    .from(config.table)
    .select(config.columns)
    .eq('status', PUBLISHED)
    .order(config.order.column, { ascending: config.order.ascending })
    .limit(limit);
  if (from && config.dateColumn) query = query.gte(config.dateColumn, from);
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

/** Official content counts used by the campus hub (real numbers only). */
/** Counts for the Campus hub strip. Only the seven figures the hub renders are
 * queried: the open-communities count had no consumer, so it cost one database
 * round trip per visit for nothing. */
export async function getCampusSummary(supabase) {
  const [notices, events, clubs, resources, opportunities, projects, study] = await Promise.all([
    supabase.from('notices').select('id', { count: 'exact', head: true }).eq('status', PUBLISHED),
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('status', PUBLISHED).gte('starts_on', new Date().toISOString().slice(0, 10)),
    supabase.from('communities').select('id', { count: 'exact', head: true }).eq('kind', 'club').eq('status', PUBLISHED),
    supabase.from('official_resources').select('id', { count: 'exact', head: true }).eq('status', PUBLISHED),
    supabase.from('opportunities').select('id', { count: 'exact', head: true }).eq('status', PUBLISHED),
    supabase.from('projects').select('id', { count: 'exact', head: true }).eq('status', PUBLISHED),
    supabase.from('study_partner_posts').select('id', { count: 'exact', head: true }).eq('status', PUBLISHED).is('closed_at', null).gte('expires_on', new Date().toISOString().slice(0, 10)),
  ]);
  return {
    notices: notices.count ?? 0,
    events: events.count ?? 0,
    clubs: clubs.count ?? 0,
    resources: resources.count ?? 0,
    opportunities: opportunities.count ?? 0,
    projects: projects.count ?? 0,
    study: study.count ?? 0,
  };
}

export const CAMPUS_PAGE_SIZE = PAGE_SIZE.default;
