import 'server-only';
import { cache } from 'react';

/**
 * Read helpers for public profiles and the viewer's own profile.
 *
 * Visibility is the database's job: `public_profiles` hides blocked people in
 * both directions (spec §14) and withholds branch/year unless the student chose
 * to show them. These helpers therefore never post-filter — they only shape the
 * rows for rendering.
 */

export const PUBLIC_PROFILE_COLUMNS =
  'id, username, display_name, bio, branch, year, reputation_score, reputation_count, ' +
  'marketplace_completed_count, is_active, created_at, is_staff';

/**
 * One public profile by username, or null when it does not exist / is blocked.
 * Wrapped in React `cache` so the page body and `generateMetadata` share the
 * same read instead of hitting Supabase twice per request.
 */
export const getPublicProfile = cache(async function getPublicProfile(supabase, username) {
  const handle = String(username || '').trim().toLowerCase();
  if (!handle) return null;
  const { data } = await supabase
    .from('public_profiles')
    .select(PUBLIC_PROFILE_COLUMNS)
    .eq('username', handle)
    .maybeSingle();
  return data || null;
});

/**
 * Counts shown on a profile: published posts and comments (no vanity metrics).
 *
 * Request-scoped `cache`: the profile surfaces ask for the same two counts more
 * than once (header and body), and the answer cannot change while a read-only
 * render is in flight. Arguments are primitives, so the cache key is exact.
 */
export const getProfileCounts = cache(async function getProfileCounts(supabase, profileId) {
  if (!profileId) return { posts: 0, comments: 0 };
  const [posts, comments] = await Promise.all([
    supabase.from('posts').select('id', { count: 'exact', head: true }).eq('author_id', profileId).eq('status', 'published'),
    supabase
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', profileId)
      .eq('status', 'published'),
  ]);
  return { posts: posts.count ?? 0, comments: comments.count ?? 0 };
});

/** Does the viewer currently block this profile? (Central block logic, spec §60.) */
export const isBlockingProfile = cache(async function isBlockingProfile(supabase, viewerProfileId, targetProfileId) {
  if (!viewerProfileId || !targetProfileId) return false;
  const { data } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocker_id', viewerProfileId)
    .eq('blocked_id', targetProfileId)
    .maybeSingle();
  return Boolean(data);
});

/** The viewer's own editable row (Settings → Profile reads this). */
export const getOwnProfile = cache(async function getOwnProfile(supabase, profileId) {
  const { data } = await supabase
    .from('profiles')
    .select(
      'id, username, display_name, bio, branch, year, division, show_branch_year, ' +
        'allow_dms_from_everyone, reputation_score, reputation_count, marketplace_completed_count, created_at',
    )
    .eq('id', profileId)
    .maybeSingle();
  return data || null;
});
