import 'server-only';

/**
 * Administration reads (spec §51, §53, §54, §55).
 *
 * Users, roles, permissions, platform settings, feature flags, audit logs and
 * operational counters. Counters are real `count(*)` values — Campus+ has no
 * analytics product and invents no statistics.
 */

import { PAGE_SIZE } from '@/lib/constants';

export async function listUsers(supabase, { q = null, limit = PAGE_SIZE.admin, offset = 0 } = {}) {
  let query = supabase
    .from('profiles')
    .select('id, username, display_name, created_at, reputation_score, marketplace_completed_count', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (q) query = query.ilike('username', `%${q}%`);
  const { data, error, count } = await query;
  if (error) return { items: [], total: 0, unavailable: true };

  const users = data || [];
  const ids = users.map((user) => user.id);
  const [{ data: privateRows }, { data: roleRows }] = await Promise.all([
    ids.length
      ? supabase.from('profile_private').select('profile_id, account_status, status_reason, suspended_until').in('profile_id', ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from('user_roles').select('user_id, roles ( key, label )').in('user_id', ids)
      : Promise.resolve({ data: [] }),
  ]);
  const privateById = new Map((privateRows || []).map((row) => [row.profile_id, row]));
  const rolesByUser = new Map();
  for (const row of roleRows || []) {
    if (!rolesByUser.has(row.user_id)) rolesByUser.set(row.user_id, []);
    rolesByUser.get(row.user_id).push(row.roles?.key || null);
  }

  return {
    items: users.map((user) => ({
      ...user,
      account_status: privateById.get(user.id)?.account_status || 'unknown',
      status_reason: privateById.get(user.id)?.status_reason || null,
      suspended_until: privateById.get(user.id)?.suspended_until || null,
      roles: (rolesByUser.get(user.id) || []).filter(Boolean),
    })),
    total: count ?? users.length,
    unavailable: false,
  };
}

export async function listRoles(supabase) {
  const { data } = await supabase
    .from('roles')
    .select('key, label, description, rank, is_system')
    .order('rank', { ascending: true });
  return data || [];
}

export async function listPermissions(supabase) {
  const { data } = await supabase
    .from('permissions')
    .select('key, label, description, group_name')
    .order('group_name', { ascending: true })
    .order('key', { ascending: true });
  return data || [];
}

export async function listRolePermissions(supabase) {
  const { data } = await supabase.from('role_permissions').select('role_key, permission_key');
  return data || [];
}

export async function listPlatformSettings(supabase) {
  const { data } = await supabase
    .from('platform_settings')
    .select('key, value, description, category, is_public, updated_at')
    .order('category', { ascending: true })
    .order('key', { ascending: true });
  return data || [];
}

export async function listFeatureFlags(supabase) {
  const { data } = await supabase
    .from('feature_flags')
    .select('key, label, description, group_name, enabled, updated_at')
    .order('group_name', { ascending: true })
    .order('key', { ascending: true });
  return data || [];
}

export async function listAuditLogs(supabase, { limit = 40, offset = 0 } = {}) {
  const { data } = await supabase
    .from('audit_logs')
    .select('id, actor_user_id, action, target_type, target_id, metadata, visibility, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  const rows = data || [];
  const actorIds = [...new Set(rows.map((row) => row.actor_user_id).filter(Boolean))];
  const { data: actors } = actorIds.length
    ? await supabase.from('public_profiles').select('id, username').in('id', actorIds)
    : { data: [] };
  const byId = new Map((actors || []).map((person) => [person.id, person]));
  return rows.map((row) => ({ ...row, actor_username: byId.get(row.actor_user_id)?.username || null }));
}

export async function listOfficialContent(supabase, { table = 'notices', limit = 25 } = {}) {
  const allowed = {
    notices: 'id, title, category, importance, pinned, status, published_at, created_at',
    events: 'id, title, starts_on, start_time, location, status, is_official, published_at, created_at',
    campus_deals: 'id, title, merchant, status, published_at, created_at',
    official_resources: 'id, title, type, branch, is_official, status, published_at, created_at',
    opportunities: 'id, title, organization, source, status, published_at, created_at',
    campus_locations: 'id, name, category, status, created_at',
    campus_services: 'id, title, category, status, created_at',
    transport_information: 'id, route_name, service_status, status, created_at',
    cafeteria_information: 'id, title, hours, status, created_at',
    academic_calendar: 'id, title, entry_type, starts_on, ends_on, status, created_at',
    official_links: 'id, title, purpose, url, deadline, status, created_at',
    help_contacts: 'id, title, category, status, created_at',
    marketplace_listings: 'id, title, price, is_free, condition, location, status, created_at',
    gigs: 'id, title, category, status, created_at',
    reports: 'id, target_type, reason, status, created_at',
  };
  if (!allowed[table]) return { items: [], table: null };
  const { data } = await supabase
    .from(table)
    .select(allowed[table])
    .order('created_at', { ascending: false })
    .limit(limit);
  return { items: data || [], table };
}

const OPERATIONAL_COUNT_TABLES = [
  'profiles', 'posts', 'comments', 'reactions', 'communities', 'marketplace_listings',
  'gigs', 'events', 'notices', 'reports', 'messages', 'random_sessions',
];

export async function getOperationalCounts(supabase) {
  const results = await Promise.all(
    OPERATIONAL_COUNT_TABLES.map(async (table) => {
      const { count } = await supabase.from(table).select('id', { count: 'exact', head: true });
      return [table, count ?? 0];
    }),
  );
  const counts = Object.fromEntries(results);
  return { counts, activeUsers24h: null };
}

export async function getAdminOverview(supabase) {
  const [pendingReports, pendingListings, suspended, flags] = await Promise.all([
    supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('marketplace_listings').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('profile_private').select('profile_id', { count: 'exact', head: true }).eq('account_status', 'suspended'),
    supabase.from('feature_flags').select('key', { count: 'exact', head: true }).eq('enabled', false),
  ]);
  return {
    pendingReports: pendingReports.count ?? 0,
    pendingListings: pendingListings.count ?? 0,
    suspended: suspended.count ?? 0,
    disabledFlags: flags.count ?? 0,
  };
}

export async function getAdminDashboardCounts(supabase) {
  const { data, error } = await supabase.rpc('campus_admin_dashboard_counts');
  if (!error && data && typeof data === 'object' && !Array.isArray(data) && data.counts) {
    return {
      ...data,
      // JSON/JSONB object key order is not a database contract. Reapply the
      // original UI order explicitly so batching cannot rearrange the cards.
      counts: Object.fromEntries(OPERATIONAL_COUNT_TABLES.map((table) => [table, data.counts[table] ?? 0])),
      activeUsers24h: data.activeUsers24h ?? null,
    };
  }

  // Additive-deployment compatibility: an app server can briefly be newer than
  // its database, and a transient RPC failure must not change the existing
  // no-throw/count-fallback contract. The original exact, RLS-scoped queries stay
  // available for that case; normal operation is the single authorized RPC above.
  const [operational, overview] = await Promise.all([
    getOperationalCounts(supabase),
    getAdminOverview(supabase),
  ]);
  return { ...operational, overview };
}

/** Per-user storage account summaries; returns null when unavailable, never guessed. */
export async function getStorageUsageByUser(supabase, users) {
  const entries = await Promise.all(users.map(async ({ id }) => {
    const { data, error } = await supabase.rpc('storage_account_usage', { p_user: id });
    return [id, error ? null : (Array.isArray(data) ? data[0] : data) || null];
  }));
  return new Map(entries);
}

/** Redacted ledger summary; the database applies the admin permission boundary. */
export async function getAdminStorageSummary(supabase) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('admin_storage_summary');
  return error || !data || typeof data !== 'object' || Array.isArray(data) ? null : data;
}

/**
 * External accounts (migration 080).
 *
 * A visitor is an authenticated account whose `profile_private.account_type` is
 * `visitor`. This read exists so administrators can find them, see what they
 * currently hold and give one of them a publishing capability through the same
 * role machinery every other account uses.
 *
 * The email address is shown because an administrator needs it to recognise an
 * external person (there is no institutional identity to go on), and because
 * `profile_private` is already limited to the owner and staff by RLS. It is
 * read from Supabase Auth through a definer RPC rather than duplicated onto a
 * table, so there is still exactly one stored copy.
 */
export async function listExternalUsers(supabase, { q = null, limit = PAGE_SIZE.admin, offset = 0 } = {}) {
  // One definer RPC, because the searchable fields are split across `profiles`
  // (username, display name) and `auth.users` (the verified address, which the
  // client cannot read at all). Filtering in JavaScript after paging would only
  // ever search the rows already fetched — a visitor further down the list
  // would be unfindable — and the returned `total` would describe the unfiltered
  // set. The function applies one predicate to both the rows and the count.
  const { data, error } = await supabase.rpc('admin_list_external_users', {
    p_query: q ? String(q).trim() || null : null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return { items: [], total: 0, unavailable: true };

  const rows = Array.isArray(data) ? data : [];
  return {
    items: rows.map((row) => ({
      id: row.profile_id,
      auth_user_id: row.auth_user_id,
      username: row.username || null,
      display_name: row.display_name || null,
      email: row.email || null,
      account_type: row.account_type,
      account_status: row.account_status,
      created_at: row.created_at,
      roles: (row.roles || []).filter(Boolean),
    })),
    // PostgREST returns a bigint aggregate as a string; the pager compares it
    // numerically, so parse it here rather than at each use site.
    total: Number(rows[0]?.total ?? 0),
    unavailable: false,
  };
}

/**
 * The permissions a visitor may be granted individually.
 *
 * Deliberately narrow: an external account can be allowed to publish, and
 * nothing else. Administrative, moderation and campus-membership permissions
 * are excluded from this list *and* re-checked by
 * `admin_set_visitor_permissions()` in the database, because a UI list is not a
 * security boundary.
 */
export const VISITOR_GRANTABLE_PERMISSIONS = [
  'create_posts',
  'create_comments',
  'create_polls',
  'create_marketplace_listing',
  'create_gigs',
  'create_housing_post',
  'create_ride_post',
  'send_messages',
  'submit_resources',
  'submit_opportunities',
  'create_projects',
  'create_lost_found',
  'create_team_posts',
  'create_study_posts',
  'submit_events',
  'react_content',
  'rsvp_events',
  'join_clubs',
  'use_gifs',
];

/** Which of the grantable permissions an external account currently holds. */
export async function listVisitorGrantedPermissions(supabase, profileIds = []) {
  // Returns `null` on failure, deliberately distinct from an empty Map. An empty
  // Map means "this account holds no grants"; treating a failed read the same
  // way would render an unticked checklist, and the first Save would then
  // revoke every capability the account actually holds.
  if (!profileIds.length) return new Map();
  // The grant table, not role_permissions: a visitor always holds its baseline
  // (manage_own_profile, report_content) through the Visitor role, and showing
  // that baseline as a "grant" would put a ticked box in front of an
  // administrator for something they cannot revoke — the role owns it.
  const { data, error } = await supabase
    .from('visitor_permission_grants')
    .select('user_id, permission_key')
    .in('user_id', profileIds);
  if (error) return null;

  const byUser = new Map();
  for (const row of data || []) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, new Set());
    byUser.get(row.user_id).add(row.permission_key);
  }
  return byUser;
}
