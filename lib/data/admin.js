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
