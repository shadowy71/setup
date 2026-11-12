import 'server-only';

/**
 * Marketplace reads (spec §17–§20).
 *
 * One module for the whole market: listings, free items, gigs and campus deals.
 * The contact note is never read from the base table — it is released only by
 * `get_listing_contact_note()` after a student expresses interest, which is the
 * entire point of that column.
 */

import { PAGE_SIZE } from '@/lib/constants';

export const LISTING_COLUMNS =
  'id, seller_id, category_id, title, description, price, is_free, is_negotiable, condition, ' +
  'location, status, is_official, moderated_by, moderated_at, moderation_reason, created_at, updated_at';

const GIG_COLUMNS =
  'id, creator_id, category_id, title, description, category, skills, payment_type, compensation, ' +
  'availability, deadline, contact_details, state, status, created_at, updated_at';

export async function listCategories(supabase, { scope = null } = {}) {
  let query = supabase
    .from('marketplace_categories')
    .select('id, name, slug, description, scope, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (scope) query = query.eq('scope', scope);
  const { data } = await query;
  return data || [];
}

export async function listListings(
  supabase,
  { status = ['active', 'reserved'], categoryId = null, free = null, q = null, sellerId = null, limit = 24, offset = 0 } = {},
) {
  let query = supabase
    .from('marketplace_listings')
    .select(LISTING_COLUMNS)
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  query = Array.isArray(status) ? query.in('status', status) : query.eq('status', status);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (free === true) query = query.eq('is_free', true);
  if (free === false) query = query.eq('is_free', false);
  if (sellerId) query = query.eq('seller_id', sellerId);
  if (q) query = query.textSearch('search_vector', q, { config: 'english', type: 'websearch' });
  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getListing(supabase, id) {
  const { data } = await supabase.from('marketplace_listings').select(LISTING_COLUMNS).eq('id', id).maybeSingle();
  return data || null;
}

export async function getListingSeller(supabase, sellerId) {
  const { data } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_staff, marketplace_completed_count, reputation_score, reputation_count')
    .eq('id', sellerId)
    .maybeSingle();
  return data || null;
}

/** Released only after interest: the seller's own note for the buyer. */
export async function getListingContactNote(supabase, listingId) {
  const { data, error } = await supabase.rpc('get_listing_contact_note', { p_listing: listingId });
  if (error) return null;
  return data || null;
}

export async function getMyListingInterest(supabase, listingId, profileId) {
  if (!profileId) return null;
  const { data } = await supabase
    .from('marketplace_interactions')
    .select('id, kind, created_at')
    .eq('listing_id', listingId)
    .eq('user_id', profileId)
    .maybeSingle();
  return data || null;
}

export async function listListingInteractions(supabase, listingId, { limit = 30 } = {}) {
  const { data: interactions } = await supabase
    .from('marketplace_interactions')
    .select('id, user_id, kind, created_at')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: true })
    .limit(limit);
  const ids = [...new Set((interactions || []).map((row) => row.user_id))];
  if (!ids.length) return [];
  const { data: people } = await supabase
    .from('public_profiles')
    .select('id, username, display_name')
    .in('id', ids);
  const byId = new Map((people || []).map((person) => [person.id, person]));
  return (interactions || []).map((row) => ({
    ...row,
    username: byId.get(row.user_id)?.username || null,
    display_name: byId.get(row.user_id)?.display_name || null,
  }));
}

export async function getListingRating(supabase, listingId, raterId) {
  if (!raterId) return null;
  const { data } = await supabase
    .from('ratings')
    .select('id, score, comment, role, created_at')
    .eq('listing_id', listingId)
    .eq('rater_id', raterId)
    .maybeSingle();
  return data || null;
}

export async function listMyListings(supabase, profileId, { limit = 30 } = {}) {
  if (!profileId) return [];
  const { data } = await supabase
    .from('marketplace_listings')
    .select(LISTING_COLUMNS)
    .eq('seller_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

/**
 * The gig board. One helper for /gigs, the market summary link and the
 * moderator queue: moderation state (`status`), poster lifecycle (`state`),
 * category, a single skill, and the three sorts the page offers.
 *
 * Sorting by deadline is only meaningful for gigs that still accept work, so
 * null deadlines sink to the end instead of comparing as "now".
 */
export async function listGigs(
  supabase,
  {
    status = 'published',
    state = null,
    category = null,
    categoryId = null,
    skill = null,
    paymentType = null,
    q = null,
    sort = 'newest',
    creatorId = null,
    limit = 24,
    offset = 0,
  } = {},
) {
  let query = supabase.from('gigs').select(GIG_COLUMNS).range(offset, offset + Math.max(0, limit - 1));
  query = Array.isArray(status) ? query.in('status', status) : query.eq('status', status);
  if (state) query = Array.isArray(state) ? query.in('state', state) : query.eq('state', state);
  if (category) query = query.eq('category', category);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (creatorId) query = query.eq('creator_id', creatorId);
  if (skill) query = query.contains('skills', [skill]);
  if (paymentType) query = query.eq('payment_type', paymentType);
  if (q) query = query.textSearch('search_vector', q, { config: 'english', type: 'websearch' });

  if (sort === 'deadline') {
    query = query.order('deadline', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
  } else if (sort === 'payment') {
    query = query.order('payment_type', { ascending: true }).order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getGig(supabase, id) {
  const { data } = await supabase.from('gigs').select(`${GIG_COLUMNS}, search_vector`).eq('id', id).maybeSingle();
  return data || null;
}

/** Every distinct skill already on the board, for the filter chips. */
export async function listGigSkills(supabase, { limit = 24 } = {}) {
  const { data, error } = await supabase
    .from('gigs')
    .select('skills')
    .eq('status', 'published')
    .limit(200);
  if (error) return { items: [], unavailable: true };
  const counts = new Map();
  for (const row of data || []) {
    for (const skill of row.skills || []) {
      const key = String(skill).trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const items = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
  return { items, unavailable: false };
}

/* -------------------------------------------------------------------------- */
/* Gig applications                                                            */
/* -------------------------------------------------------------------------- */

/** The signed-in student's application to one gig, if they have one. */
export async function getGigApplication(supabase, gigId, applicantId) {
  if (!gigId || !applicantId) return null;
  const { data } = await supabase
    .from('gig_applications')
    .select('id, gig_id, applicant_id, message, status, decided_at, created_at')
    .eq('gig_id', gigId)
    .eq('applicant_id', applicantId)
    .maybeSingle();
  return data || null;
}

/**
 * Applications for a gig, with the applicant's public identity. The gig owner
 * gets every row; a student only ever sees their own (RLS decides).
 */
export async function listGigApplications(supabase, gigId, { limit = 40 } = {}) {
  if (!gigId) return [];
  const { data: applications } = await supabase
    .from('gig_applications')
    .select('id, gig_id, applicant_id, message, status, decided_by, decided_at, created_at')
    .eq('gig_id', gigId)
    .order('created_at', { ascending: false })
    .limit(limit);
  const ids = [...new Set((applications || []).map((row) => row.applicant_id))];
  if (!ids.length) return [];
  const { data: people } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_staff')
    .in('id', ids);
  const byId = new Map((people || []).map((person) => [person.id, person]));
  return (applications || []).map((row) => ({
    ...row,
    username: byId.get(row.applicant_id)?.username || null,
    display_name: byId.get(row.applicant_id)?.display_name || null,
    is_staff: byId.get(row.applicant_id)?.is_staff === true,
  }));
}

/** The signed-in student's own gigs, newest first (the /gigs "Mine" view). */
export async function listMyGigs(supabase, profileId, { limit = 40, status = null } = {}) {
  if (!profileId) return { items: [], unavailable: false };
  return listGigs(supabase, { creatorId: profileId, status: status || ['published', 'hidden', 'draft'], limit });
}

export async function listDeals(supabase, { limit = 24 } = {}) {
  const { data, error } = await supabase
    .from('campus_deals')
    .select('id, title, description, merchant, discount_details, valid_from, valid_until, contact_info, status, is_official, created_by, published_at, created_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) return { items: [], unavailable: true };
  return { items: data || [], unavailable: false };
}

export async function getDeal(supabase, id) {
  const { data } = await supabase
    .from('campus_deals')
    .select('id, title, description, merchant, discount_details, valid_from, valid_until, contact_info, status, is_official, created_by, published_at, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

export async function getMarketSummary(supabase) {
  const [active, free, sold] = await Promise.all([
    supabase.from('marketplace_listings').select('id', { count: 'exact', head: true }).in('status', ['active', 'reserved']),
    supabase.from('marketplace_listings').select('id', { count: 'exact', head: true }).eq('is_free', true).in('status', ['active', 'reserved']),
    supabase.from('marketplace_listings').select('id', { count: 'exact', head: true }).eq('status', 'sold'),
  ]);
  return {
    active: active.count ?? 0,
    free: free.count ?? 0,
    sold: sold.count ?? 0,
  };
}

export const MARKET_PAGE_SIZE = PAGE_SIZE.default;

/** Counts for the /gigs header: what is open, what pays, what has finished. */
export async function getGigSummary(supabase) {
  const [open, paid, closed, completed] = await Promise.all([
    supabase.from('gigs').select('id', { count: 'exact', head: true }).eq('status', 'published').eq('state', 'open'),
    supabase
      .from('gigs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .eq('state', 'open')
      .eq('payment_type', 'paid'),
    supabase.from('gigs').select('id', { count: 'exact', head: true }).eq('status', 'published').eq('state', 'closed'),
    supabase.from('gigs').select('id', { count: 'exact', head: true }).eq('status', 'published').eq('state', 'completed'),
  ]);
  return {
    open: open.count ?? 0,
    paid: paid.count ?? 0,
    closed: closed.count ?? 0,
    completed: completed.count ?? 0,
  };
}
