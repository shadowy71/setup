/**
 * Global search (spec §54, §86).
 *
 * One PostgreSQL function, `public.global_search(query, scope, limit, offset)`,
 * runs as the calling user (SECURITY INVOKER) so RLS plus the search-specific
 * policies decide what is visible. That single detail is what makes search
 * respect blocks, account status, community visibility and conversation
 * privacy without duplicating authorization in JavaScript.
 *
 * No search server, no embeddings, no AI (spec §2, §90).
 */

import 'server-only';
import { PAGE_SIZE, SEARCH_SCOPES, SCOPE_LABELS } from '@/lib/constants';
import { fromPostgresError, errors } from '@/lib/errors';
import { enforceRateLimit } from '@/lib/ratelimit';

// The scope list lives in lib/constants.js so client components can render the
// tabs without importing this server-only module.
export { SEARCH_SCOPES, SCOPE_LABELS };

/**
 * @returns {Promise<{
 *   groups: Array<{scope:string,label:string,items:Array}>,
 *   hasMore: boolean,
 *   offset: number,
 *   limit: number,
 *   unavailable?: boolean,
 * }>}
 *
 * Pagination contract: the function asks Postgres for one row more than the
 * page and reports `hasMore` from that probe row. `global_search()` returns
 * rows, not a count, so there is deliberately no `total` field — an exact
 * total would have to be invented in JavaScript from a partial page.
 */
export async function globalSearch(supabase, {
  query,
  scope = 'all',
  limit = PAGE_SIZE.search,
  offset = 0,
  enforceLimit = true,
  userId = null,
}) {
  if (!supabase) return { groups: [], hasMore: false, offset: 0, limit, unavailable: true };
  const q = String(query || '').trim();
  if (q.length < 2) throw errors.validation('Type at least 2 characters to search.');

  const pageSize = Math.min(Math.max(Number(limit) || PAGE_SIZE.search, 1), 50);
  const start = Math.max(Number(offset) || 0, 0);

  if (enforceLimit) await enforceRateLimit(supabase, 'search_query', userId);

  const { data, error } = await supabase.rpc('global_search', {
    p_query: q,
    p_scope: scope,
    // One extra row: its presence is the only honest continuation signal the
    // function can give us.
    p_limit: pageSize + 1,
    p_offset: start,
  });
  if (error) throw fromPostgresError(error);

  const allRows = Array.isArray(data) ? data : [];
  const hasMore = allRows.length > pageSize;
  const rows = hasMore ? allRows.slice(0, pageSize) : allRows;
  const groups = [];
  for (const row of rows) {
    const item = {
      scope: row.scope,
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      snippet: row.snippet,
      url: row.url,
      meta: row.meta || null,
      rank: Number(row.rank) || 0,
    };
    let group = groups.find((g) => g.scope === item.scope);
    if (!group) {
      group = { scope: item.scope, label: SCOPE_LABELS[item.scope] || item.scope, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }

  return { groups, hasMore, offset: start, limit: pageSize, query: q, scope };
}

/**
 * Lightweight username autocomplete used by the mention/DM/recipient pickers.
 * Only public identity fields are returned (spec §81, §86).
 */
export async function searchUsernames(supabase, { query, limit = 8, excludeUserId = null }) {
  const q = String(query || '').trim().replace(/^@/, '');
  if (q.length < 2) return [];
  // branch/year are already narrowed by the view to honour `show_branch_year`,
  // and `is_active` keeps suspended accounts out of every picker.
  const { data, error } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, branch, year')
    .eq('is_active', true)
    .ilike('username', `${q}%`)
    .neq('id', excludeUserId || '00000000-0000-0000-0000-000000000000')
    .order('username', { ascending: true })
    .limit(Math.min(limit, 20));
  if (error) return [];
  return data || [];
}
