-- =============================================================================
-- Campus+ database tests — 18 exact, authorized Admin dashboard count batching
-- =============================================================================
-- The batched RPC must be a transport optimization only: all sixteen results are
-- compared with the original count queries in the same caller/RLS context.
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('18ad0000-0000-4000-a000-000000000001', 'counts.admin036@pccoepune.org'),
  ('18ad0000-0000-4000-a000-000000000002', 'counts.student036@pccoepune.org')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', '18ad0000-0000-4000-a000-000000000001', false);
select public.complete_profile('counts_admin_036', 'Counts Admin 036');
select set_config('request.jwt.claim.sub', '18ad0000-0000-4000-a000-000000000002', false);
select public.complete_profile('counts_student_036', 'Counts Student 036');
select set_config('request.jwt.claim.sub', '', false);

insert into public.user_roles (user_id, role_key)
select pp.profile_id, 'admin'
  from public.profile_private pp
 where pp.auth_user_id = '18ad0000-0000-4000-a000-000000000001'
on conflict (user_id, role_key) do nothing;

-- The function is invoker-only for browser roles; PUBLIC/anon have no execute
-- path, and the function owner cannot accidentally turn the counts into an RLS
-- bypass.
select public.test_assert(
  (select not prosecdef from pg_proc where oid = 'public.campus_admin_dashboard_counts()'::regprocedure),
  '036 Admin counts must remain security invoker so caller RLS applies'
);
select public.test_assert(
  not has_function_privilege('anon', 'public.campus_admin_dashboard_counts()', 'execute')
  and not has_function_privilege('public', 'public.campus_admin_dashboard_counts()', 'execute'),
  '036 Admin counts must not be executable by PUBLIC or anon'
);
select public.test_assert(
  has_function_privilege('authenticated', 'public.campus_admin_dashboard_counts()', 'execute'),
  '036 Admin counts should be available to authenticated callers for the permission check'
);

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '18ad0000-0000-4000-a000-000000000002', false);

select public.test_assert_denied(
  'select public.campus_admin_dashboard_counts()',
  '036 a signed-in student without view_admin_overview must not receive Admin aggregates'
);

select set_config('request.jwt.claim.sub', '18ad0000-0000-4000-a000-000000000001', false);

do $$
declare
  v_actual json;
  v_expected json;
begin
  v_actual := public.campus_admin_dashboard_counts();

  -- Keep these scalar queries identical to lib/data/admin.js's compatibility
  -- fallback. Equality therefore tests both the predicates and the exact/null
  -- response contract, not just the presence of a function with the right name.
  v_expected := json_build_object(
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
    'activeUsers24h', null,
    'overview', json_build_object(
      'pendingReports', (select count(*) from public.reports where status = 'pending'),
      'pendingListings', (select count(*) from public.marketplace_listings where status = 'pending'),
      'suspended', (select count(*) from public.profile_private where account_status = 'suspended'),
      'disabledFlags', (select count(*) from public.feature_flags where enabled = false)
    )
  );

  perform public.test_assert(
    v_actual::jsonb = v_expected::jsonb,
    '036 the single RPC must equal all sixteen original exact RLS-scoped count queries'
  );
  perform public.test_assert(
    json_typeof(v_actual -> 'activeUsers24h') = 'null',
    '036 daily active users must stay an explicit null, not an invented statistic'
  );
  perform public.test_assert(
    (select count(*) from json_object_keys(v_actual -> 'counts')) = 12,
    '036 the operational snapshot must contain exactly the original twelve counters'
  );
  perform public.test_assert(
    (select count(*) from json_object_keys(v_actual -> 'overview')) = 4,
    '036 the overview snapshot must contain exactly the original four counters'
  );
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
delete from auth.users where id in (
  '18ad0000-0000-4000-a000-000000000001',
  '18ad0000-0000-4000-a000-000000000002'
);
