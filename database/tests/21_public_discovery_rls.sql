-- =============================================================================
-- Campus+ database tests — 21 public discovery: anon / authenticated / staff
-- =============================================================================
-- Migration 041 is the ONLY place anonymous reads are opened. This suite
-- exercises the real PostgreSQL roles (not a hidden button, not a mocked
-- client): `set role anon` and `set role authenticated`, with RLS enabled and
-- the real column grants in force.
--
-- Public discovery. Private student data. Authenticated participation.
-- Controlled administration.
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures. Fixed ids so the assertions can name exactly what they expect.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('98000000-0000-4000-a000-000000000001', 'discovery.student@pccoepune.org')
on conflict (id) do nothing;

do $fixture$
begin
  perform set_config('request.jwt.claim.sub', '98000000-0000-4000-a000-000000000001', false);
  perform public.complete_profile(
    p_username => 'discovery_student',
    p_display_name => 'Discovery Student',
    p_branch => 'Computer Engineering',
    p_year => 'Third Year'
  );
end $fixture$;
select set_config('request.jwt.claim.sub', '', false);

insert into public.__test_scratch (key, value)
select 'discovery_profile', id from public.profiles where username = 'discovery_student'
on conflict (key) do update set value = excluded.value;
select public.test_assert(
  (select value from public.__test_scratch where key = 'discovery_profile') is not null,
  '0. the discovery fixture has a real Campus+ profile'
);

-- Four clubs: one publicly listed, one campus-only, one private, one hidden.
insert into public.communities
  (id, kind, name, slug, description, visibility, join_policy, status, is_official, created_by, member_count)
values
  ('98100000-0000-4000-a000-000000000001', 'club', 'Pub Discovery Club', 'pub-discovery-club',
   'A published club that is explicitly listed on the open web.', 'public', 'request', 'published', false, null, 3),
  ('98100000-0000-4000-a000-000000000002', 'club', 'Campus Discovery Club', 'campus-discovery-club',
   'A published club visible only to signed-in campus accounts.', 'campus', 'request', 'published', false, null, 2),
  ('98100000-0000-4000-a000-000000000003', 'club', 'Private Discovery Club', 'private-discovery-club',
   'A published club whose members-only visibility stays private.', 'private', 'invite', 'published', false, null, 1),
  ('98100000-0000-4000-a000-000000000004', 'club', 'Hidden Discovery Club', 'hidden-discovery-club',
   'A public club that has not been published yet.', 'public', 'request', 'draft', false, null, 0)
on conflict (id) do nothing;

-- Two events: one published, one draft.
insert into public.events
  (id, title, description, starts_on, location, status, is_official, created_by, published_at, registration_info, registration_url)
values
  ('98200000-0000-4000-a000-000000000001', 'Public Discovery Meetup',
   'A published event with intentionally public registration notes.', '2026-12-01', 'Seminar Hall',
   'published', false, (select value from public.__test_scratch where key = 'discovery_profile'), now(),
   'Free entry for everyone.', 'https://example.org/register'),
  ('98200000-0000-4000-a000-000000000002', 'Unpublished Discovery Draft',
   'A draft event that must never be visible anonymously.', '2026-12-02', 'Lab 4',
   'draft', false, (select value from public.__test_scratch where key = 'discovery_profile'), null, null, null)
on conflict (id) do nothing;

-- Four posts: public, campus-only, deleted, and public inside a private club.
insert into public.posts
  (id, author_id, kind, title, body, community_id, visibility, status, deleted_at)
values
  ('98300000-0000-4000-a000-000000000001', (select value from public.__test_scratch where key = 'discovery_profile'), 'post',
   'Public club announcement', 'Everyone may read this announcement.',
   '98100000-0000-4000-a000-000000000001', 'public', 'published', null),
  ('98300000-0000-4000-a000-000000000002', (select value from public.__test_scratch where key = 'discovery_profile'), 'post',
   'Campus club announcement', 'Only campus accounts may read this.',
   '98100000-0000-4000-a000-000000000001', 'campus', 'published', null),
  ('98300000-0000-4000-a000-000000000003', (select value from public.__test_scratch where key = 'discovery_profile'), 'post',
   'Deleted club announcement', 'This post was removed.',
   '98100000-0000-4000-a000-000000000001', 'public', 'published', now()),
  ('98300000-0000-4000-a000-000000000004', (select value from public.__test_scratch where key = 'discovery_profile'), 'post',
   'Private club announcement', 'The parent club is not public.',
   '98100000-0000-4000-a000-000000000003', 'public', 'published', null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Catalog-level contract: exactly three scoped anon SELECT policies
-- ---------------------------------------------------------------------------
do $catalog$
begin
  perform public.test_assert(
    (select count(*) from pg_policies
      where schemaname = 'public' and 'anon' = any(roles)) = 3,
    '1. exactly three anonymous policies exist'
  );
  perform public.test_assert(
    not exists (
      select 1 from pg_policies
       where schemaname = 'public' and 'anon' = any(roles)
         and (cmd <> 'SELECT' or coalesce(qual, '') in ('', 'true')
              or tablename not in ('communities', 'events', 'posts'))
    ),
    '1. anon policies are scoped SELECTs on communities/events/posts only'
  );
  perform public.test_assert(
    not exists (
      select 1 from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'
    ),
    '1. anon holds no table-level privilege'
  );
  perform public.test_assert(
    not exists (
      select 1 from information_schema.column_privileges
       where table_schema = 'public' and grantee = 'anon'
         and (privilege_type <> 'SELECT'
              or table_name not in ('communities', 'events', 'posts'))
    ),
    '1. anon column grants are read-only and limited to three tables'
  );
  perform public.test_assert(
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and has_function_privilege('anon', p.oid, 'EXECUTE')
         and p.proname not in ('allowed_email_domain', 'is_reserved_username',
                               'feature_enabled', 'setting', 'setting_int')
         and p.proname not like 'test%'
         -- Trigger functions are not RPCs: they need a NEW/OLD row and are
         -- only invoked by triggers. An earlier migration left a few reachable
         -- through PUBLIC; they cannot be called to read or change a row.
         and p.prorettype <> 'trigger'::regtype
    ),
    '1. anon cannot execute any management or data RPC'
  );
end $catalog$;

-- ---------------------------------------------------------------------------
-- 2. ANON: public club and event rows only, through the public projection
-- ---------------------------------------------------------------------------
reset role;
set role anon;
select set_config('request.jwt.claim.role', 'anon', false);
select set_config('request.jwt.claim.sub', '', false);

do $anon_reads$
begin
  perform public.test_assert(
    exists (select 1 from public.communities
             where slug = 'pub-discovery-club' and kind = 'club'
               and status = 'published' and visibility = 'public'),
    '2. anon can read a published, explicitly public club by slug'
  );
  perform public.test_assert(
    exists (select 1 from public.communities where slug = 'coding-club'),
    '2. the 35 imported catalogue clubs were explicitly made public'
  );
  perform public.test_assert(
    not exists (select 1 from public.communities where slug = 'campus-discovery-club')
    and not exists (select 1 from public.communities where slug = 'private-discovery-club')
    and not exists (select 1 from public.communities where slug = 'hidden-discovery-club'),
    '2. anon cannot read campus-only, private or unpublished clubs'
  );
  perform public.test_assert(
    not exists (select 1 from public.communities where kind <> 'club'),
    '2. anon cannot read non-club communities'
  );
  perform public.test_assert(
    (select count(*) from public.events where status = 'published') > 0
    and not exists (select 1 from public.events where id = '98200000-0000-4000-a000-000000000002'),
    '2. anon reads published events only, never a draft'
  );
  perform public.test_assert(
    exists (select 1 from public.posts where id = '98300000-0000-4000-a000-000000000001'),
    '2. anon reads an explicitly public announcement in a public club'
  );
  perform public.test_assert(
    not exists (select 1 from public.posts where id = '98300000-0000-4000-a000-000000000002')
    and not exists (select 1 from public.posts where id = '98300000-0000-4000-a000-000000000003')
    and not exists (select 1 from public.posts where id = '98300000-0000-4000-a000-000000000004'),
    '2. anon cannot read campus-only, deleted or private-club posts'
  );
end $anon_reads$;

-- ---------------------------------------------------------------------------
-- 3. ANON: private columns and whole-table reads fail closed
-- ---------------------------------------------------------------------------
select public.test_assert_denied(
  $sql$select * from public.communities$sql$,
  '3. anon cannot select the whole communities table'
);
select public.test_assert_denied(
  $sql$select created_by, approved_by, catalogue_key from public.communities$sql$,
  '3. anon cannot read administrator identity or internal catalogue keys'
);
select public.test_assert_denied(
  $sql$select created_by, updated_by, search_vector from public.events$sql$,
  '3. anon cannot read event provenance or search plumbing'
);
select public.test_assert_denied(
  $sql$select author_id, moderated_by, moderation_reason from public.posts$sql$,
  '3. anon cannot read post author identity or moderation notes'
);
select public.test_assert_denied(
  $sql$select * from public.community_members$sql$,
  '3. anon cannot read club members'
);
select public.test_assert_denied(
  $sql$select * from public.community_join_requests$sql$,
  '3. anon cannot read join requests or their messages'
);
select public.test_assert_denied(
  $sql$select * from public.event_registrations$sql$,
  '3. anon cannot read attendee / RSVP records'
);

-- ---------------------------------------------------------------------------
-- 4. ANON: every mutation and management RPC is denied
-- ---------------------------------------------------------------------------
select public.test_assert_denied(
  $sql$insert into public.communities (kind, name, slug, description, visibility, status, created_by)
       values ('club', 'Anon Made Club', 'anon-made-club', 'An anonymous club insert.', 'public', 'published', null)$sql$,
  '4. anon cannot create a club'
);
select public.test_assert_denied(
  $sql$update public.communities set name = 'Defaced Club' where slug = 'pub-discovery-club'$sql$,
  '4. anon cannot edit a club'
);
select public.test_assert_denied(
  $sql$delete from public.communities where slug = 'pub-discovery-club'$sql$,
  '4. anon cannot delete a club'
);
select public.test_assert_denied(
  $sql$insert into public.community_members (community_id, user_id, role, status)
       values ('98100000-0000-4000-a000-000000000001', '98000000-0000-4000-a000-000000000001', 'owner', 'active')$sql$,
  '4. anon cannot become a club member'
);
select public.test_assert_denied(
  $sql$insert into public.community_join_requests (community_id, user_id, message)
       values ('98100000-0000-4000-a000-000000000001', '98000000-0000-4000-a000-000000000001', 'anon join')$sql$,
  '4. anon cannot submit a join request'
);
select public.test_assert_denied(
  $sql$insert into public.events (title, description, starts_on, location, status, created_by)
       values ('Anon Event', 'An anonymous event insert.', '2026-12-05', 'Ground', 'published', '98000000-0000-4000-a000-000000000001')$sql$,
  '4. anon cannot create an event'
);
select public.test_assert_denied(
  $sql$insert into public.event_registrations (event_id, user_id, status)
       values ('98200000-0000-4000-a000-000000000001', '98000000-0000-4000-a000-000000000001', 'going')$sql$,
  '4. anon cannot RSVP'
);
select public.test_assert_denied(
  $sql$insert into public.posts (author_id, body, community_id, visibility, status)
       values ('98000000-0000-4000-a000-000000000001', 'Anonymous post',
               '98100000-0000-4000-a000-000000000001', 'public', 'published')$sql$,
  '4. anon cannot post a club announcement'
);
select public.test_assert_denied(
  $sql$select public.global_search('discovery', 'clubs', 10, 0)$sql$,
  '4. anon cannot call the authenticated global_search RPC'
);
select public.test_assert_denied(
  $sql$select public.can_manage_club('98100000-0000-4000-a000-000000000001')$sql$,
  '4. anon cannot call a management predicate'
);
select public.test_assert_denied(
  $sql$select public.decide_community_join_request('00000000-0000-4000-a000-000000000000', 'approve')$sql$,
  '4. anon cannot decide a join request'
);

-- ---------------------------------------------------------------------------
-- 5. AUTHENTICATED: existing student boundaries are unchanged
-- ---------------------------------------------------------------------------
reset role;
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', (select value::text from public.__test_scratch where key = 'discovery_profile'), false);

do $student$
begin
  perform public.test_assert(
    exists (select 1 from public.communities where slug = 'campus-discovery-club'),
    '5. a signed-in student can still read a campus-only published club'
  );
  perform public.test_assert(
    not exists (select 1 from public.communities where slug = 'private-discovery-club'),
    '5. a non-member student cannot read a private club'
  );
  perform public.test_assert(
    exists (select 1 from public.events where id = '98200000-0000-4000-a000-000000000001'),
    '5. a signed-in student can read published events'
  );
  perform public.test_assert(
    not exists (select 1 from public.events where id = '98200000-0000-4000-a000-000000000002'),
    '5. a student who is not staff or the submitter cannot read a draft event'
  );
  perform public.test_assert(
    not exists (select 1 from public.communities where slug = 'hidden-discovery-club'),
    '5. a student who is not staff or the creator cannot read an unpublished club'
  );
  perform public.test_assert(
    not public.can_manage_club('98100000-0000-4000-a000-000000000001'),
    '5. an ordinary student has no club-management permission'
  );
  perform public.test_assert(
    exists (
      select 1 from public.global_search('Pub Discovery', 'clubs', 20, 0) g
       where g.url = '/c/pub-discovery-club'
    ),
    '5. global_search returns the canonical slug URL for clubs'
  );
end $student$;

select public.test_assert_denied(
  $sql$update public.communities set is_official = true where slug = 'pub-discovery-club'$sql$,
  '5. a student cannot mark a club official'
);
select public.test_assert_denied(
  $sql$select public.approve_club_request('00000000-0000-4000-a000-000000000000', 'nobody', null)$sql$,
  '5. a student cannot approve a club request'
);
select public.test_assert_denied(
  $sql$select public.assign_club_admin('98100000-0000-4000-a000-000000000001', 'nobody')$sql$,
  '5. a student cannot assign a club administrator'
);
select public.test_assert_denied(
  $sql$select public.reject_club_request('00000000-0000-4000-a000-000000000000', null)$sql$,
  '5. a student cannot reject a club creation request'
);

reset role;
select set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- 6. Explicit visibility decision: exactly the 35 catalogue rows changed
-- ---------------------------------------------------------------------------
do $visibility$
begin
  perform public.test_assert(
    (select count(*) from public.communities
      where catalogue_key is not null and kind = 'club' and status = 'published'
        and visibility = 'public') = 35,
    '6. all 35 published catalogue clubs are explicitly public, not every campus row'
  );
  perform public.test_assert(
    (select count(*) from public.communities
      where kind = 'club' and status = 'published' and visibility = 'campus') >= 1,
    '6. the migration did not silently make every campus club public'
  );
end $visibility$;
