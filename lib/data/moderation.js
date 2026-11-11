import 'server-only';

/**
 * Staff reads (spec §51, §52, §55).
 *
 * The report queue joins each report to a short human summary of what was
 * reported, so a moderator can triage without opening twelve tabs. Randomized
 * session reports deliberately expose no participant identity here — identities
 * are released only through the audited `view_random_sessions` path.
 */

import { PAGE_SIZE, ROUTES } from '@/lib/constants';

/** Column that carries a human title for each reportable target type. */
const TARGET_SUMMARY = {
  user: { table: 'public_profiles', title: 'username', url: null },
  post: { table: 'posts', title: 'title', url: '/post' },
  comment: { table: 'comments', title: 'body', url: null },
  message: { table: 'messages', title: 'body', url: null },
  conversation: { table: 'conversations', title: 'title', url: '/chat' },
  community: { table: 'communities', title: 'name', url: '/communities' },
  marketplace_listing: { table: 'marketplace_listings', title: 'title', url: '/market/listing' },
  gig: { table: 'gigs', title: 'title', url: ROUTES.gigs },
  deal: { table: 'campus_deals', title: 'title', url: null },
  event: { table: 'events', title: 'title', url: '/campus/events' },
  club: { table: 'communities', title: 'name', url: ROUTES.clubs },
  resource: { table: 'official_resources', title: 'title', url: '/explore/resources' },
  opportunity: { table: 'opportunities', title: 'title', url: '/explore/opportunities' },
  project: { table: 'projects', title: 'title', url: '/explore/projects' },
  lost_found: { table: 'lost_found', title: 'title', url: '/campus/lost-found' },
  housing_post: { table: 'housing_posts', title: 'title', url: '/campus/housing' },
  ride_post: { table: 'ride_posts', title: 'origin', url: '/campus/rides' },
  poll: { table: 'posts', title: 'title', url: '/post' },
  random_session: { table: null, title: null, url: null },
};

/** The URL a moderator should be sent to when acting on a target. */
export function moderatorTargetUrl(targetType, targetId) {
  const config = TARGET_SUMMARY[targetType];
  // Random sessions have no public URL at all (spec §29) and a missing id must
  // never render a "/post/null" link.
  if (!config?.url || !targetId) return null;
  return `${config.url}/${targetId}`;
}

export async function getReportSummaries(supabase, reports) {
  const byType = new Map();
  for (const report of reports) {
    if (!byType.has(report.target_type)) byType.set(report.target_type, []);
    byType.get(report.target_type).push(report.target_id);
  }

  const summaries = new Map();
  await Promise.all(
    [...byType.entries()].map(async ([type, ids]) => {
      const config = TARGET_SUMMARY[type];
      if (!config?.table) return;
      const { data } = await supabase.from(config.table).select(`id, ${config.title}`).in('id', [...new Set(ids)]);
      for (const row of data || []) {
        summaries.set(`${type}:${row.id}`, row[config.title] || null);
      }
    }),
  );
  return summaries;
}

export async function listReports(supabase, { status = ['pending', 'reviewing'], limit = PAGE_SIZE.admin, offset = 0 } = {}) {
  let query = supabase
    .from('reports')
    .select('id, reporter_id, target_type, target_id, reason, details, status, assigned_to, reviewed_by, reviewed_at, resolution, random_session_id, created_at')
    .order('created_at', { ascending: true })
    .range(offset, offset + Math.max(0, limit - 1));
  query = Array.isArray(status) ? query.in('status', status) : query.eq('status', status);
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };

  const reports = data || [];
  const summaries = await getReportSummaries(supabase, reports);

  const reporterIds = [...new Set(reports.map((report) => report.reporter_id))];
  const { data: reporters } = reporterIds.length
    ? await supabase.from('public_profiles').select('id, username, display_name').in('id', reporterIds)
    : { data: [] };
  const reporterById = new Map((reporters || []).map((person) => [person.id, person]));

  return {
    items: reports.map((report) => ({
      ...report,
      summary: summaries.get(`${report.target_type}:${report.target_id}`) || null,
      reporter_username: reporterById.get(report.reporter_id)?.username || null,
      moderator_url: moderatorTargetUrl(report.target_type, report.target_id),
    })),
    unavailable: false,
  };
}

export async function getReport(supabase, id) {
  const { data } = await supabase
    .from('reports')
    .select('id, reporter_id, target_type, target_id, reason, details, status, assigned_to, reviewed_by, reviewed_at, resolution, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const summaries = await getReportSummaries(supabase, [data]);
  return { ...data, summary: summaries.get(`${data.target_type}:${data.target_id}`) || null };
}

export async function listMarketplaceQueue(supabase, { limit = 40 } = {}) {
  const [pending, flagged] = await Promise.all([
    supabase
      .from('marketplace_listings')
      .select('id, seller_id, title, description, price, is_free, status, moderation_reason, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit),
    supabase
      .from('marketplace_listings')
      .select('id, seller_id, title, description, price, is_free, status, moderation_reason, created_at')
      .in('status', ['hidden', 'removed', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  const rows = [...(pending.data || []), ...(flagged.data || [])];
  const sellerIds = [...new Set(rows.map((row) => row.seller_id))];
  const { data: sellers } = sellerIds.length
    ? await supabase.from('public_profiles').select('id, username, display_name').in('id', sellerIds)
    : { data: [] };
  const sellerById = new Map((sellers || []).map((person) => [person.id, person]));

  return {
    pending: (pending.data || []).map((row) => ({ ...row, seller_username: sellerById.get(row.seller_id)?.username || null })),
    flagged: (flagged.data || []).map((row) => ({ ...row, seller_username: sellerById.get(row.seller_id)?.username || null })),
  };
}

export async function listRandomReports(supabase, { status = ['pending', 'reviewing'], limit = 30 } = {}) {
  const { data } = await supabase
    .from('random_reports')
    .select('id, session_id, reporter_user_id, target_user_id, reason, details, status, reviewed_by, reviewed_at, resolution, created_at')
    .in('status', status)
    .order('created_at', { ascending: true })
    .limit(limit);

  const rows = data || [];
  const personIds = [...new Set(rows.flatMap((row) => [row.reporter_user_id, row.target_user_id]))];
  const { data: people } = personIds.length
    ? await supabase.from('public_profiles').select('id, username').in('id', personIds)
    : { data: [] };
  const byId = new Map((people || []).map((person) => [person.id, person]));

  return rows.map((row) => ({
    ...row,
    reporter_username: byId.get(row.reporter_user_id)?.username || null,
    target_username: byId.get(row.target_user_id)?.username || null,
  }));
}

export async function listModerationHistory(supabase, { limit = 40 } = {}) {
  const { data } = await supabase
    .from('moderation_actions')
    .select('id, moderator_id, report_id, action, target_type, target_id, previous_status, new_status, note, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = data || [];
  const moderatorIds = [...new Set(rows.map((row) => row.moderator_id).filter(Boolean))];
  const { data: moderators } = moderatorIds.length
    ? await supabase.from('public_profiles').select('id, username').in('id', moderatorIds)
    : { data: [] };
  const byId = new Map((moderators || []).map((person) => [person.id, person]));
  return rows.map((row) => ({ ...row, moderator_username: byId.get(row.moderator_id)?.username || null }));
}

export async function getReportCounts(supabase) {
  const [pending, reviewing, resolved, random] = await Promise.all([
    supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'reviewing'),
    supabase.from('reports').select('id', { count: 'exact', head: true }).in('status', ['resolved', 'dismissed']),
    supabase.from('random_reports').select('id', { count: 'exact', head: true }).in('status', ['pending', 'reviewing']),
  ]);
  return {
    pending: pending.count ?? 0,
    reviewing: reviewing.count ?? 0,
    resolved: resolved.count ?? 0,
    random: random.count ?? 0,
  };
}
