-- =============================================================================
-- Campus+ migration 035 — bounded visibility reconciliation for loaded feed posts
-- =============================================================================
-- A newest-page response cannot say why an already-loaded post is absent: newer
-- rows may have pushed it to page two, or moderation/RLS may have made it
-- ineligible. This IDs-only lookup answers that separate question for the bounded
-- set of rows a Home reader already holds. It returns no body, author, status or
-- other record content, and absence is indistinguishable from an unknown id.
--
-- SECURITY INVOKER is intentional. The same posts RLS policies that guard
-- campus_feed() still decide active-author, block/mute, membership and viewer
-- visibility. The explicit campus predicates match campus_feed()'s post branch,
-- so posts_select_author does not put an author's hidden/pending row back into the
-- shared Home feed. The feature flag is matched as well.
--
-- 510 IDs covers the supported 500-entry pagination depth plus one page of
-- accepted writes. The API applies the same bound and reports exactly which IDs
-- were checked; an unchecked ID is never treated as removed by the client.
-- =============================================================================

create or replace function public.campus_feed_post_visibility(
  p_post_ids uuid[] default '{}'::uuid[]
)
returns table (id uuid)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with requested as (
    select input.id, min(input.ordinality) as position
    from unnest(coalesce(p_post_ids, '{}'::uuid[])) with ordinality as input(id, ordinality)
    group by input.id
    order by position
    limit 510
  )
  select requested.id
  from requested
  join public.posts p on p.id = requested.id
  where p.community_id is null
    and p.status = 'published'
    and p.deleted_at is null
    and public.feature_enabled('feed')
  order by requested.position;
$$;

comment on function public.campus_feed_post_visibility(uuid[]) is
  'IDs-only visibility reconciliation for at most 510 loaded Home post IDs; invoker RLS plus campus_feed post predicates, with no record content returned.';

revoke all on function public.campus_feed_post_visibility(uuid[]) from public, anon;
grant execute on function public.campus_feed_post_visibility(uuid[]) to authenticated, service_role;
