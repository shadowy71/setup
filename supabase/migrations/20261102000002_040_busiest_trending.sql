-- =============================================================================
-- Campus+ migration 040 — "Busiest right now": real, recent engagement
-- =============================================================================
-- The Home rail's bars were normalized against the highest counter in the three
-- rows on screen (lib/social/activity-scale.js), so two likes filled the track.
-- The bar is now normalized against a fixed benchmark, but a fixed benchmark is
-- only honest if the number behind it is a real trending score and not a
-- lifetime total from whichever posts happen to be on page one.
--
-- `public.trending_posts(integer, integer)` already exists (migration 011) and
-- is the RPC Explore uses. It is repaired here rather than replaced: the output
-- contract, the invoker-security RLS boundary and the grants are untouched.
--
--   score = ( Σ likes·decay(age) + comment_weight·Σ comments·decay(age) )
--           × ( post_floor + (1 - post_floor)·2^(-postAge / postHalfLife) )
--
--   decay(age) = (2^(-age / halfLife) - 2^(-window / halfLife))
--                / (1 - 2^(-window / halfLife))        for 0 <= age <= window
--              = 0                                    outside the window
--
--   window      = p_hours (48 h by default; 24–48 h is the intended range)
--   halfLife    = setting_int('trending_half_life_hours', 12)
--   commentWeight = setting_int('trending_comment_weight', 2)
--   postHalfLife  = setting_int('trending_post_age_half_life_hours', 72)
--   post_floor  = 0.5 (a genuinely active old post is never worth zero)
--
-- Those numbers are published in lib/constants.js (TRENDING_*) and pinned by
-- tests/trending.test.js. The half-life weights are read from the existing
-- platform_settings table through setting_int(), so the campus can recalibrate
-- without another migration; no new table, column or function is introduced.
--
-- What changes in behaviour:
--   * Only engagement inside the window counts. A post with 100 accumulated
--     likes and no recent activity scores 0; 12 fresh likes outrank it.
--   * A like is one `reactions` row. The existing
--     reactions_unique_per_item(user_id, target_type, target_id) constraint
--     makes that one per student, so duplicate likes cannot inflate the score
--     and no per-user/per-post N+1 read is needed.
--   * The unbounded `count(distinct commenters)` scan over ALL comments is
--     replaced by two windowed aggregations using the partial indexes below.
--   * Candidates are posts with recent engagement plus posts published inside
--     the window. If neither exists, the newest campus posts are returned with
--     score 0 so a quiet campus still sees real (unexaggerated) discussions.
--   * Ordering is score desc, created_at desc, id asc — deterministic even when
--     every score is zero. No random tie-break, no fabricated engagement.
--   * `security invoker` + the published/not-deleted/campus-only predicates
--     keep deleted, hidden, blocked and community-scoped rows out.
-- =============================================================================

-- Windowed engagement reads. Both partial indexes match the CTE predicates, so
-- a growing reactions/comments table is not scanned in full on every refresh.
create index if not exists reactions_recent_post_idx
  on public.reactions (created_at desc)
  where target_type = 'post';

create index if not exists comments_recent_published_idx
  on public.comments (created_at desc)
  where status = 'published' and deleted_at is null;

create or replace function public.trending_posts(
  p_limit integer default 20,
  p_hours integer default 48
)
returns table (
  id uuid,
  author_id uuid,
  username text,
  display_name text,
  title text,
  body text,
  kind public.post_kind,
  gif jsonb,
  reaction_count integer,
  comment_count integer,
  participant_count integer,
  created_at timestamptz,
  score real
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with tuning as (
    select
      greatest(coalesce(p_hours, 48), 1)::numeric as window_hours,
      least(greatest(coalesce(p_limit, 20), 1), 50)::integer as lim,
      greatest(public.setting_int('trending_half_life_hours', 12), 1)::numeric as half_life,
      greatest(public.setting_int('trending_post_age_half_life_hours', 72), 1)::numeric as post_half_life,
      greatest(public.setting_int('trending_comment_weight', 2), 0)::numeric as comment_weight,
      0.5::numeric as post_floor
  ),
  params as (
    select
      t.*,
      power(0.5::numeric, t.window_hours / t.half_life) as edge,
      now() - make_interval(hours => t.window_hours::integer) as since
    from tuning t
  ),
  -- One row per (student, post) because of reactions_unique_per_item. The decay
  -- reaches 0 exactly at the window edge, so an old like cannot trickle in.
  recent_likes as (
    select
      r.target_id as post_id,
      count(*)::integer as recent_count,
      coalesce(sum(
        greatest(
          (
            power(0.5::numeric,
              greatest(extract(epoch from (now() - r.created_at)) / 3600.0, 0)::numeric
              / (select half_life from params))
            - (select edge from params)
          ) / nullif(1 - (select edge from params), 0),
          0::numeric
        )
      ), 0::numeric) as weighted
    from public.reactions r
    where r.target_type = 'post'
      and r.created_at > (select since from params)
    group by r.target_id
  ),
  recent_comments as (
    select
      c.post_id,
      count(*)::integer as recent_count,
      count(distinct c.author_id)::integer as participants,
      coalesce(sum(
        greatest(
          (
            power(0.5::numeric,
              greatest(extract(epoch from (now() - c.created_at)) / 3600.0, 0)::numeric
              / (select half_life from params))
            - (select edge from params)
          ) / nullif(1 - (select edge from params), 0),
          0::numeric
        )
      ), 0::numeric) as weighted
    from public.comments c
    where c.status = 'published'
      and c.deleted_at is null
      and c.created_at > (select since from params)
    group by c.post_id
  ),
  active_ids as (
    select post_id from recent_likes
    union
    select post_id from recent_comments
  ),
  -- A new discussion with no engagement yet still belongs in the list, at 0%.
  fresh_posts as (
    select p.id as post_id
    from public.posts p
    where p.status = 'published'
      and p.deleted_at is null
      and p.community_id is null
      and p.created_at > (select since from params)
  ),
  candidate_ids as (
    select post_id from active_ids
    union
    select post_id from fresh_posts
  ),
  -- Only when the window is completely quiet: the newest real posts, score 0.
  fallback_ids as (
    select p.id as post_id
    from public.posts p
    where p.status = 'published'
      and p.deleted_at is null
      and p.community_id is null
      and not exists (select 1 from candidate_ids)
    -- posts_feed_idx serves this order; no window over the whole posts table.
    order by p.created_at desc, p.id asc
    limit (select lim from params)
  ),
  ids as (
    select post_id from candidate_ids
    union all
    select post_id from fallback_ids
  )
  select
    p.id,
    p.author_id,
    pr.username,
    pr.display_name,
    p.title,
    p.body,
    p.kind,
    p.gif,
    p.reaction_count,
    p.comment_count,
    coalesce(rc.participants, 0)::integer as participant_count,
    p.created_at,
    (
      (
        coalesce(rl.weighted, 0::numeric)
        + (select comment_weight from params) * coalesce(rc.weighted, 0::numeric)
      )
      * (
          (select post_floor from params)
          + (1 - (select post_floor from params))
            * power(0.5::numeric,
                greatest(extract(epoch from (now() - p.created_at)) / 3600.0, 0)::numeric
                / (select post_half_life from params))
        )
    )::real as score
  from ids i
  join public.posts p on p.id = i.post_id
  join public.profiles pr on pr.id = p.author_id
  left join recent_likes rl on rl.post_id = p.id
  left join recent_comments rc on rc.post_id = p.id
  where p.status = 'published'
    and p.deleted_at is null
    and p.community_id is null
  order by score desc, p.created_at desc, p.id asc
  limit (select lim from params);
$$;

comment on function public.trending_posts(integer, integer) is
  'Deterministic recent-engagement trending score. Formula and defaults are published in lib/constants.js#TRENDING_FORMULA; bar normalization lives in lib/social/activity-scale.js. SECURITY INVOKER so RLS still decides visibility.';
