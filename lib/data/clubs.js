import 'server-only';

/** Club-specific reads over the existing community and campus tables. */

const REQUEST_COLUMNS =
  'id, requester_id, name, slug, description, subject, club_category, organization_type, ' +
  'recruitment_info, meeting_info, contact_info, external_url, source_label, source_url, ' +
  'proposed_admin_username, status, reviewed_by, reviewed_at, review_note, community_id, created_at, updated_at';

export async function listMyClubCreationRequests(supabase, profileId, { limit = 12 } = {}) {
  if (!profileId) return { items: [], unavailable: false };
  const { data, error } = await supabase
    .from('club_creation_requests')
    .select(REQUEST_COLUMNS)
    .eq('requester_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { items: data || [], unavailable: Boolean(error) };
}

export async function listClubCreationRequests(supabase, { status = null, limit = 60 } = {}) {
  let query = supabase
    .from('club_creation_requests')
    .select(REQUEST_COLUMNS)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  const rows = data || [];
  const ids = [...new Set(rows.flatMap((row) => [row.requester_id, row.reviewed_by]).filter(Boolean))];
  const { data: people } = ids.length
    ? await supabase.from('public_profiles').select('id, username, display_name').in('id', ids)
    : { data: [] };
  const byId = new Map((people || []).map((person) => [person.id, person]));
  return {
    items: rows.map((row) => ({
      ...row,
      requester_username: byId.get(row.requester_id)?.username || null,
      requester_display_name: byId.get(row.requester_id)?.display_name || null,
      reviewer_username: byId.get(row.reviewed_by)?.username || null,
    })),
    unavailable: Boolean(error),
  };
}

export async function listPendingCommunityJoinRequests(supabase, profileId) {
  if (!profileId) return [];
  const { data } = await supabase
    .from('community_join_requests')
    .select('community_id, status, created_at')
    .eq('user_id', profileId)
    .eq('status', 'pending')
    .limit(300);
  return data || [];
}

export async function getCommunityJoinRequest(supabase, communityId, profileId) {
  if (!profileId) return null;
  const { data } = await supabase
    .from('community_join_requests')
    .select('id, community_id, user_id, status, created_at, decided_at')
    .eq('community_id', communityId)
    .eq('user_id', profileId)
    .maybeSingle();
  return data || null;
}

export async function listUnassignedClubs(supabase, { limit = 60 } = {}) {
  const { data, error } = await supabase
    .from('communities')
    .select('id, name, slug, club_category, organization_type, verification_status, source_label, admin_assigned, created_at')
    .eq('kind', 'club')
    .eq('status', 'published')
    .eq('admin_assigned', false)
    .order('name', { ascending: true })
    .limit(limit);
  return { items: data || [], unavailable: Boolean(error) };
}

/**
 * Real, current counts for management cards. `null` means the count could not
 * be read; the UI never turns that into a fabricated zero.
 */
export async function getClubAnalytics(supabase, clubId) {
  const specs = [
    ['members', 'community_members', 'community_id', { status: 'active' }],
    ['pendingRequests', 'community_join_requests', 'community_id', { status: 'pending' }],
    ['posts', 'posts', 'community_id', { status: 'published' }],
    ['events', 'events', 'club_id', { status: 'published' }],
    ['opportunities', 'opportunities', 'club_id', { status: 'published' }],
  ];
  const entries = await Promise.all(
    specs.map(async ([key, table, foreignKey, extra]) => {
      let query = supabase.from(table).select('id', { count: 'exact', head: true }).eq(foreignKey, clubId).match(extra);
      const { count, error } = await query;
      return [key, { value: error ? null : count ?? 0, unavailable: Boolean(error) }];
    }),
  );
  return Object.fromEntries(entries);
}

/** All workspace feeds are actual rows visible to this manager through RLS. */
export async function getClubWorkspaceData(supabase, clubId, profileId) {
  const [events, opportunities, audit, inbox] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, description, starts_on, start_time, location, organizer, status, is_official, created_by, published_at, created_at')
      .eq('club_id', clubId)
      .order('starts_on', { ascending: false })
      .limit(40),
    supabase
      .from('opportunities')
      .select('id, title, organization, description, deadline, url, location, mode, category, source, status, created_by, published_at, created_at')
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('audit_logs')
      .select('id, actor_user_id, action, target_type, target_id, metadata, visibility, created_at')
      .eq('target_type', 'club')
      .eq('target_id', clubId)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('notifications')
      .select('id, type, title, body, reference_type, reference_id, url, read_at, created_at')
      .eq('recipient_id', profileId)
      .eq('reference_type', 'club')
      .eq('reference_id', clubId)
      .order('created_at', { ascending: false })
      .limit(40),
  ]);

  const auditRows = audit.data || [];
  const actorIds = [...new Set(auditRows.map((row) => row.actor_user_id).filter(Boolean))];
  const { data: actors } = actorIds.length
    ? await supabase.from('public_profiles').select('id, username, display_name').in('id', actorIds)
    : { data: [] };
  const actorById = new Map((actors || []).map((actor) => [actor.id, actor]));

  return {
    events: events.data || [],
    opportunities: opportunities.data || [],
    audit: auditRows.map((row) => ({
      ...row,
      actor_username: actorById.get(row.actor_user_id)?.username || null,
      actor_display_name: actorById.get(row.actor_user_id)?.display_name || null,
    })),
    inbox: inbox.data || [],
    unavailable: {
      events: Boolean(events.error),
      opportunities: Boolean(opportunities.error),
      audit: Boolean(audit.error),
      inbox: Boolean(inbox.error),
    },
  };
}
