-- Campus+ 036: one authorized, RLS-scoped Admin count snapshot
--
-- The count tab previously made twelve operational HEAD/count requests and four
-- overview HEAD/count requests. This additive function keeps every predicate and
-- every caller-visible row boundary, but evaluates them in one database call.
-- SECURITY INVOKER is intentional: count(*) sees exactly the rows the calling
-- admin could count through PostgREST, rather than bypassing RLS as the function
-- owner. The explicit permission check also makes direct RPC access safe.

create or replace function public.campus_admin_dashboard_counts()
returns json
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('view_admin_overview') then
    raise exception 'view_admin_overview permission required'
      using errcode = '42501';
  end if;

  -- json, rather than jsonb, retains the operational counter order used by the
  -- existing Admin UI. Every count is exact; no estimate or reltuples value is
  -- used. All scalar subqueries share this function call's stable snapshot.
  return json_build_object(
    'counts', json_build_object(
      'profiles', (select count(*) from public.profiles),
      'posts', (select count(*) from public.posts),
      'comments', (select count(*) from public.comments),
      'reactions', (select count(*) from public.reactions),
      'communities', (select count(*) from public.communities),
      'marketplace_listings', (select count(*) from public.marketplace_listings),
      'gigs', (select count(*) from public.gigs),
      'events', (select count(*) from public.events),
      'notices', (select count(*) from public.notices),
      'reports', (select count(*) from public.reports),
      'messages', (select count(*) from public.messages),
      'random_sessions', (select count(*) from public.random_sessions)
    ),
    -- Campus+ has no presence/analytics source for this value. Preserve the
    -- existing explicit null instead of inventing a daily-active-user metric.
    'activeUsers24h', null,
    'overview', json_build_object(
      'pendingReports', (select count(*) from public.reports where status = 'pending'),
      'pendingListings', (select count(*) from public.marketplace_listings where status = 'pending'),
      'suspended', (select count(*) from public.profile_private where account_status = 'suspended'),
      'disabledFlags', (select count(*) from public.feature_flags where enabled = false)
    )
  );
end;
$$;

comment on function public.campus_admin_dashboard_counts() is
  'Exact Admin operational/overview counts for view_admin_overview callers; security invoker keeps every count under caller RLS.';

revoke all on function public.campus_admin_dashboard_counts() from public;
revoke all on function public.campus_admin_dashboard_counts() from anon;
grant execute on function public.campus_admin_dashboard_counts() to authenticated;
