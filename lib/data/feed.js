import 'server-only';

/**
 * Read-side helpers for the feed, posts and profiles.
 *
 * Reads run as the signed-in student through the publishable key, so RLS is the
 * authority on visibility: blocks, account status, community membership and
 * moderation state are applied by the database, not by these functions.
 */

import { PAGE_SIZE } from '@/lib/constants';

/**
 * Hydrate raw post rows with everything the card needs: author identity (from
 * the block-aware public projection), staffing flag, community, counters, the
 * viewer's own reaction and poll options.
 *
 * Kept as one function so every surface that lists posts (home, explore,
 * community, profile, post detail) renders identical data and identical
 * visibility rules.
 */
export async function hydratePosts(
  supabase,
  rows,
  { currentProfileId = null, authorProfiles = null, postReactions = null } = {},
) {
  const posts = rows || [];
  if (!posts.length) return [];

  const authorIds = [...new Set(posts.map((post) => post.author_id).filter(Boolean))];
  const postIds = posts.map((post) => post.id);
  // Poll rows are already known from `kind`; most lists contain no polls at all,
  // so the three poll reads are skipped instead of asking for nothing.
  const pollIds = posts.filter((post) => post.kind === 'poll').map((post) => post.id);

  // `authorProfiles`/`postReactions` let a caller that has already read those
  // rows (post detail, which needs the comment authors and comment reactions in
  // the same breath) hand them in instead of triggering identical queries.
  const [{ data: authors }, { data: myReactions }, { data: polls }, { data: options }, { data: myVotes }] =
    await Promise.all([
      authorProfiles
        ? Promise.resolve({ data: authorProfiles })
        : supabase.from('public_profiles').select('id, username, display_name, is_staff').in('id', authorIds),
      postReactions
        ? Promise.resolve({ data: postReactions })
        : currentProfileId
          ? supabase
              .from('reactions')
              .select('target_id')
              .eq('user_id', currentProfileId)
              .eq('target_type', 'post')
              .in('target_id', postIds)
          : Promise.resolve({ data: [] }),
      pollIds.length
        ? supabase.from('posts').select('id, poll_closes_at').in('id', pollIds)
        : Promise.resolve({ data: [] }),
      pollIds.length
        ? supabase
            .from('poll_options')
            .select('id, post_id, label, position, vote_count')
            .in('post_id', pollIds)
            .order('position')
        : Promise.resolve({ data: [] }),
      currentProfileId && pollIds.length
        ? supabase.from('poll_votes').select('post_id, option_id').eq('user_id', currentProfileId).in('post_id', pollIds)
        : Promise.resolve({ data: [] }),
    ]);

  const authorById = new Map((authors || []).map((author) => [author.id, author]));
  const reactedIds = new Set((myReactions || []).map((row) => row.target_id));
  const pollIdSet = new Set((polls || []).map((row) => row.id));
  const closesAt = new Map((polls || []).map((row) => [row.id, row.poll_closes_at]));
  const myVoteByPost = new Map((myVotes || []).map((row) => [row.post_id, row.option_id]));
  const optionsByPost = new Map();
  for (const option of options || []) {
    if (!optionsByPost.has(option.post_id)) optionsByPost.set(option.post_id, []);
    optionsByPost.get(option.post_id).push(option);
  }

  return posts.map((post) => {
    const author = authorById.get(post.author_id) || {};
    return {
      ...post,
      author_username: author.username || null,
      author_display_name: author.display_name || null,
      author_is_staff: author.is_staff === true,
      reacted_by_me: reactedIds.has(post.id),
      poll: pollIdSet.has(post.id)
        ? {
            closes_at: closesAt.get(post.id) || null,
            options: (optionsByPost.get(post.id) || []).map((option) => ({
              ...option,
              mine: myVoteByPost.get(post.id) === option.id,
            })),
          }
        : null,
    };
  });
}

// Exactly the columns a card renders (`visibility`/`pinned` are query filters,
// never display fields) — list responses stay as small as the UI needs.
//
// Exported because the write path returns the same columns: a post created in
// this session is read back with `POST_COLUMNS` and run through `hydratePosts`,
// so an instant feed entry is byte-for-byte the shape a normal feed read
// produces (author block, counters, poll options, viewer state) — never a
// thinner placeholder that the next render has to repair.
export const POST_COLUMNS =
  'id, author_id, kind, title, body, gif, community_id, status, is_official, ' +
  'comment_count, reaction_count, created_at';

/** Fetch posts for a set of ids (order preserved) and hydrate them. */
export async function getPostsByIds(supabase, ids, { currentProfileId = null } = {}) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('posts').select(POST_COLUMNS).in('id', ids);
  if (error) return [];
  const byId = new Map((data || []).map((post) => [post.id, post]));
  return hydratePosts(supabase, ids.map((id) => byId.get(id)).filter(Boolean), { currentProfileId });
}

/**
 * One post with its comments, in reading order.
 *
 * Three round trips in two waves:
 *   1. the post and its comments in parallel;
 *   2. one `public_profiles` read covering the post author *and* every comment
 *      author, plus one `reactions` read covering the post and its comments,
 *      in parallel.
 * Before, the post was hydrated first and the comment authors/reactions were a
 * second, sequential pair — four reads where two answer the same question.
 * Handing the shared rows to `hydratePosts` keeps the render identical.
 */
export async function getPostDetail(supabase, postId, { currentProfileId = null } = {}) {
  const [{ data: post }, { data: comments }] = await Promise.all([
    supabase.from('posts').select(POST_COLUMNS).eq('id', postId).maybeSingle(),
    supabase
      .from('comments')
      .select('id, post_id, parent_id, author_id, body, gif, status, reaction_count, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: true }),
  ]);
  if (!post) return null;

  const commentRows = comments || [];
  // Post ids and comment ids are UUIDs from different tables, so one `in()` list
  // covering both is unambiguous once the rows are split by `target_type`.
  const authorIds = [...new Set([post.author_id, ...commentRows.map((row) => row.author_id)].filter(Boolean))];
  const reactionTargetIds = [...new Set([post.id, ...commentRows.map((row) => row.id)])];

  const [{ data: authors }, { data: myReactions }] = await Promise.all([
    authorIds.length
      ? supabase.from('public_profiles').select('id, username, display_name, is_staff').in('id', authorIds)
      : Promise.resolve({ data: [] }),
    currentProfileId && reactionTargetIds.length
      ? supabase
          .from('reactions')
          .select('target_id, target_type')
          .eq('user_id', currentProfileId)
          .in('target_type', ['post', 'comment'])
          .in('target_id', reactionTargetIds)
      : Promise.resolve({ data: [] }),
  ]);

  const reactionRows = myReactions || [];
  const [hydrated] = await hydratePosts(supabase, [post], {
    currentProfileId,
    authorProfiles: authors || [],
    postReactions: reactionRows.filter((row) => row.target_type === 'post'),
  });

  const authorById = new Map((authors || []).map((author) => [author.id, author]));
  const reacted = new Set(
    reactionRows.filter((row) => row.target_type === 'comment').map((row) => row.target_id),
  );

  return {
    post: hydrated,
    comments: commentRows.map((comment) => ({
      ...comment,
      author_username: authorById.get(comment.author_id)?.username || null,
      author_display_name: authorById.get(comment.author_id)?.display_name || null,
      author_is_staff: authorById.get(comment.author_id)?.is_staff === true,
      reacted_by_me: reacted.has(comment.id),
    })),
  };
}

/**
 * The home feed. `campus_feed()` is the single unified feed function — posts,
 * discussions, official notices, events and marketplace highlights — with
 * deterministic ordering (spec §16): no algorithm, no personalisation.
 */
export async function getCampusFeed(
  supabase,
  { limit = PAGE_SIZE.feed, offset = 0, sort = 'newest', currentProfileId = null } = {},
) {
  const { data, error } = await supabase.rpc('campus_feed', {
    p_limit: limit,
    p_offset: offset,
    p_sort: sort,
  });
  if (error) return { items: [], unavailable: true };

  const items = (data || []).map((item) => ({
    id: item.id,
    type: item.item_type,
    title: item.title,
    body: item.body,
    gif: item.gif,
    authorUsername: item.author_username,
    authorDisplayName: item.author_display_name,
    isOfficial: item.is_official,
    communitySlug: item.community_slug,
    meta: item.meta || {},
    createdAt: item.created_at,
    sortAt: item.sort_at,
  }));

  // Pull the underlying post rows so the feed can render real cards (reactions,
  // comments, poll state) for the posts it includes. `currentProfileId` is the
  // viewer's own profile id: without it every card on Home would claim the
  // viewer had not reacted and had not voted, i.e. the feed surface would hydrate
  // posts differently from every other list in the app.
  const postIds = items.filter((item) => item.type === 'post' || item.type === 'discussion' || item.type === 'poll').map((item) => item.id);
  const posts = await getPostsByIds(supabase, postIds, { currentProfileId });
  const postById = new Map(posts.map((post) => [post.id, post]));

  return { items: items.map((item) => ({ ...item, post: postById.get(item.id) || null })), unavailable: false };
}

/** Trending uses the same deterministic SQL score documented in the UI. */
export async function getTrendingPosts(supabase, { limit = 10, hours = 72 } = {}) {
  const { data, error } = await supabase.rpc('trending_posts', { p_limit: limit, p_hours: hours });
  if (error) return [];
  return data || [];
}

/**
 * Published posts by one author, newest first (profile pages — both your own
 * and others').
 *
 * Explicitly filtered to `status = 'published'`, the same rule `campus_feed()`
 * and `getCommunityPosts()` apply. Without it, `posts_select_author` (which
 * lets an author read every status of their own rows, so the permalink page
 * can still offer "restore") would leak the signed-in viewer's own
 * deleted/hidden/pending posts into their profile's post list as tombstone
 * cards — a list should only ever show live content, the same way the author
 * no longer sees a deleted post in the home feed. Deleted posts remain
 * reachable (and restorable) at their own permalink; they just do not appear
 * in this list. The database keeps the row either way (soft delete, audit
 * trail intact) — this only changes what a list query returns.
 */
export async function getPostsByAuthor(
  supabase,
  authorId,
  { limit = PAGE_SIZE.feed, offset = 0, currentProfileId = null } = {},
) {
  if (!authorId) return [];
  const { data, error } = await supabase
    .from('posts')
    .select(POST_COLUMNS)
    .eq('author_id', authorId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (error) return [];
  return hydratePosts(supabase, data || [], { currentProfileId });
}

/**
 * Published posts inside one community, newest first (community page).
 *
 * Explicitly filtered to `status = 'published'`, the same rule `campus_feed()`
 * applies to the home feed. Without it, `posts_select_author` (which lets an
 * author read every status of their own rows) would leak the author's own
 * deleted/hidden/pending posts into this *shared* feed as tombstone cards next
 * to everyone else's live posts — a feed should only ever show live content.
 */
export async function getCommunityPosts(
  supabase,
  communityId,
  { limit = PAGE_SIZE.feed, offset = 0, currentProfileId = null } = {},
) {
  if (!communityId) return [];
  const { data, error } = await supabase
    .from('posts')
    .select(POST_COLUMNS)
    .eq('community_id', communityId)
    .eq('status', 'published')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.max(0, limit - 1));
  if (error) return [];
  return hydratePosts(supabase, data || [], { currentProfileId });
}
