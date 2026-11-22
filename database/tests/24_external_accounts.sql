-- =============================================================================
-- Campus+ database tests — 24 external accounts and the Visitor role
-- =============================================================================
-- Migration 080 lets a verified non-institutional Google address create an
-- account, classifies it automatically, and denies it every publishing
-- capability by default. These tests drive the database side of that contract:
--
--   1. classification is decided from the verified email, server-side
--   2. provisioning assigns the matching baseline role
--   3. a visitor cannot publish anything, even by calling the API directly
--   4. a visitor cannot escalate its own role or account type
--   5. an administrator can grant selected permissions through the existing
--      role machinery, and revocation takes effect immediately
--   6. campus-only and internal content stays invisible to visitors
--   7. institutional accounts are completely unaffected
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Classification is decided server-side from the verified address
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_row record;
begin
  -- Institutional: the PCCOE domain configured by migration 013.
  select * into v_row from public.classify_institutional_email('Tanvi@PCCOEPune.org');
  perform public.test_assert(v_row.account_type = 'student',
    'an institutional address must classify as a student');
  perform public.test_assert(v_row.college_id is not null,
    'an institutional address must resolve to its college');
  perform public.test_assert(v_row.domain = 'pccoepune.org',
    'classification must normalise the domain to lower case');

  -- External: a personal mailbox is NOT an error any more, it is a visitor.
  select * into v_row from public.classify_institutional_email('someone@gmail.com');
  perform public.test_assert(v_row.account_type = 'visitor',
    'a personal address must classify as a visitor, not an error');
  perform public.test_assert(v_row.college_id is null,
    'a visitor must not be attached to a college');

  select * into v_row from public.classify_institutional_email('someone@outlook.com');
  perform public.test_assert(v_row.account_type = 'visitor',
    'an outlook address must classify as a visitor');
  perform public.test_assert(v_row.college_id is null, 'outlook holds no college');

  -- Look-alike domains must never resolve to the institution.
  select * into v_row from public.classify_institutional_email('x@pccoepune.org.evil.com');
  perform public.test_assert(v_row.account_type = 'visitor',
    'a look-alike domain must classify as a visitor');
  perform public.test_assert(v_row.college_id is null,
    'a look-alike domain must not resolve to a college');

  -- The domain after the final '@' is what counts, so a crafted sub-address
  -- cannot smuggle an institutional domain into the local part.
  select * into v_row from public.classify_institutional_email('pccoepune.org@gmail.com');
  perform public.test_assert(v_row.account_type = 'visitor',
    'an institutional-looking local part must not grant student access');

  -- `allowed_email_domain` keeps its old meaning: is this institutional?
  perform public.test_assert(public.allowed_email_domain('student@pccoepune.org'),
    'the institutional domain check must still pass for a real address');
  perform public.test_assert(not public.allowed_email_domain('student@gmail.com'),
    'the institutional domain check must still fail for a personal address');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. An account with no email cannot be provisioned
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into auth.users (id, email) values ('dd000000-0000-4000-a000-0000000000ee', null);
    raise exception 'ASSERTION FAILED (operation was allowed): an account without an email must be rejected';
  exception
    when sqlstate '42501' then
      perform public.test_assert(true, 'an account without an email is rejected');
    when others then
      raise;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Provisioning: institutional → student, external → visitor
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('dd000000-0000-4000-a000-000000000001', 'tanvi.inst@pccoepune.org', '{}'::jsonb),
  ('dd000000-0000-4000-a000-000000000002', 'rahul.external@gmail.com',
   '{"full_name": "Rahul Deshmukh"}'::jsonb),
  ('dd000000-0000-4000-a000-000000000003', 'priya.external@outlook.com', '{}'::jsonb)
on conflict (id) do nothing;

do $$
declare
  v_inst uuid;
  v_ext uuid;
  v_otl uuid;
  v_type public.account_type;
  v_college uuid;
begin
  select profile_id into v_inst from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000001';
  select profile_id into v_ext from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000002';
  select profile_id into v_otl from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000003';

  perform public.test_assert(v_inst is not null, 'an institutional signup must be provisioned');
  perform public.test_assert(v_ext is not null, 'an external signup must be provisioned');
  perform public.test_assert(v_otl is not null, 'an outlook signup must be provisioned');

  -- The institutional account is a student attached to PCCOE.
  select account_type, college_id into v_type, v_college
    from public.profile_private where profile_id = v_inst;
  perform public.test_assert(v_type = 'student', 'an institutional account must be a student');
  perform public.test_assert(v_college is not null, 'a student must have a college');
  perform public.test_assert(
    (select count(*) from public.user_roles where user_id = v_inst and role_key = 'student') = 1,
    'an institutional account must receive the student role'
  );
  perform public.test_assert(
    (select count(*) from public.user_roles where user_id = v_inst and role_key = 'visitor') = 0,
    'a student must not also hold the visitor role'
  );

  -- The external account is a visitor with no college. Clear the session claim
  -- first: a stale `sub` makes current_profile_id() resolve inside definer
  -- functions, which is the hazard suite 21 documents.
  perform set_config('request.jwt.claim.sub', '', false);
  select account_type, college_id into v_type, v_college
    from public.profile_private where profile_id = v_ext;
  perform public.test_assert(v_type = 'visitor', 'a gmail account must be a visitor');
  perform public.test_assert(v_college is null, 'a visitor must have no college');

  perform public.test_assert(
    (select count(*) from public.user_roles where user_id = v_ext and role_key = 'visitor') = 1,
    'an external account must receive the visitor role'
  );
  perform public.test_assert(
    (select count(*) from public.user_roles where user_id = v_ext and role_key = 'student') = 0,
    'an external account must NEVER receive the student role'
  );

  -- An external account keeps a usable display name from the Google profile.
  perform public.test_assert(
    (select display_name from public.profiles where id = v_ext) = 'Rahul Deshmukh',
    'a visitor should take its display name from the OAuth profile'
  );

  -- A visitor starts with no username, exactly like a student.
  perform public.test_assert(
    (select username from public.profiles where id = v_ext) is null,
    'a visitor must claim its username during onboarding'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The CHECK constraint makes an impossible row unrepresentable
-- ---------------------------------------------------------------------------
select public.test_assert_denied(
  $sql$update public.profile_private set account_type = 'visitor'
        where auth_user_id = 'dd000000-0000-4000-a000-000000000001'$sql$,
  'a student cannot become a visitor while keeping its college'
);

select public.test_assert_denied(
  $sql$insert into public.profile_private (profile_id, auth_user_id, account_type)
        values ('dd000000-0000-4000-a000-0000000000aa',
                'dd000000-0000-4000-a000-000000000003', 'visitor')
        on conflict (profile_id) do nothing returning profile_id$sql$,
  'a duplicate auth user cannot be provisioned twice'
);

-- ---------------------------------------------------------------------------
-- 5. Visitor permission set: read-only, and never the student baseline
-- ---------------------------------------------------------------------------
do $$
declare
  v_forbidden text[] := array[
    'create_posts', 'create_comments', 'create_polls', 'send_messages',
    'create_communities', 'create_marketplace_listing', 'create_gigs',
    'create_housing_post', 'create_ride_post', 'submit_resources',
    'submit_opportunities', 'create_projects', 'create_lost_found',
    'create_team_posts', 'create_study_posts', 'submit_events'
  ];
  v_key text;
begin
  foreach v_key in array v_forbidden loop
    perform public.test_assert(
      not exists (select 1 from public.role_permissions where role_key = 'visitor' and permission_key = v_key),
      format('the visitor role must not hold %s by default', v_key)
    );
  end loop;

  -- The visitor role must not inherit anything a student has, in general.
  perform public.test_assert(
    not exists (
      select 1 from public.role_permissions rp
       where rp.role_key = 'visitor'
         and rp.permission_key in (select permission_key from public.role_permissions where role_key = 'student')
         and rp.permission_key not in ('manage_own_profile', 'report_content')
    ),
    'the visitor role must not hold any student-only permission'
  );

  -- Nothing administrative or moderating either.
  perform public.test_assert(
    not exists (
      select 1 from public.role_permissions rp
       where rp.role_key = 'visitor'
         and rp.permission_key in (
           'manage_users', 'manage_roles', 'assign_roles', 'moderate_all',
           'review_reports', 'manage_platform_settings', 'manage_colleges',
           'manage_role_authority', 'view_random_sessions'
         )
    ),
    'the visitor role must hold no administrative or moderation permission'
  );

  -- The two it does hold are exactly the read-only ones.
  perform public.test_assert(
    (select count(*) from public.role_permissions where role_key = 'visitor') = 2,
    'the visitor role holds exactly its two read-only permissions'
  );

  -- External Contributor starts empty so grants are deliberate.
  perform public.test_assert(
    (select count(*) from public.role_permissions where role_key = 'external_contributor') = 0,
    'External Contributor must start with no permissions'
  );

  -- Rank ordering: visitor is below student, contributor between them.
  perform public.test_assert(
    (select rank from public.roles where key = 'visitor') < (select rank from public.roles where key = 'student'),
    'the visitor role must rank below student'
  );
  perform public.test_assert(
    (select rank from public.roles where key = 'external_contributor') < (select rank from public.roles where key = 'student'),
    'an external contributor must still rank below a student'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. A visitor cannot publish, even by writing to the tables directly
-- ---------------------------------------------------------------------------
-- Switch to the REAL postgres role. This is what makes RLS and the column
-- grants apply: as the superuser every one of the assertions below would pass
-- for the wrong reason. Session-scoped (`set role`, not `set local`) so it also
-- covers the standalone `test_assert_denied` calls further down, which each run
-- as their own statement and their own implicit transaction.
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_ext uuid;
begin
  -- Guard: if this ever runs as the superuser the assertions below would pass
  -- for the wrong reason (RLS is bypassed for superusers and table owners).
  perform public.test_assert(current_user = 'authenticated',
    'the visitor assertions must run as the authenticated role, not the superuser');
  perform public.test_assert(public.is_visitor(),
    'the visitor session must resolve through current_profile_id()');
  select profile_id into v_ext from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000002';

  perform public.test_assert(public.is_visitor(), 'the session must resolve as a visitor');
  perform public.test_assert(not public.is_institutional(), 'the session must not resolve as institutional');

  -- The permission resolver the application uses must agree with the database.
  perform public.test_assert(not public.has_permission('create_posts'),
    'a visitor must not hold create_posts');
  perform public.test_assert(not public.has_permission('create_comments'),
    'a visitor must not hold create_comments');
  perform public.test_assert(not public.has_permission('send_messages'),
    'a visitor must not hold send_messages');
  perform public.test_assert(not public.has_permission('create_marketplace_listing'),
    'a visitor must not hold create_marketplace_listing');
  perform public.test_assert(not public.has_permission('submit_events'),
    'a visitor must not hold submit_events');
  perform public.test_assert(public.has_permission('report_content'),
    'a visitor must be able to report abusive content');
  perform public.test_assert(public.has_permission('manage_own_profile'),
    'a visitor must be able to manage its own profile');
end;
$$;

-- Direct PostgREST-style inserts. Each must be refused by RLS or the
-- permission in its WITH CHECK — not by the UI.
select public.test_assert_denied(
  $sql$insert into public.posts (author_id, body)
       select id, 'A visitor trying to publish a post from the API'
         from public.profiles where id = public.current_profile_id()$sql$,
  'a visitor must not create a post by calling the API directly'
);

select public.test_assert_denied(
  $sql$insert into public.comments (post_id, author_id, body)
       select p.id, public.current_profile_id(), 'visitor comment'
         from public.posts p where p.status = 'published' limit 1$sql$,
  'a visitor must not create a comment by calling the API directly'
);

select public.test_assert_denied(
  $sql$insert into public.marketplace_listings (seller_id, title, description, price, category)
       values (public.current_profile_id(), 'Visitor listing', 'not allowed', 10, 'other')$sql$,
  'a visitor must not create a marketplace listing'
);

select public.test_assert_denied(
  $sql$insert into public.communities (name, slug, description, kind, created_by)
       values ('Visitor Club', 'visitor-club', 'not allowed', 'community', public.current_profile_id())$sql$,
  'a visitor must not create a community'
);

select public.test_assert_denied(
  $sql$insert into public.messages (conversation_id, sender_id, body)
       values (gen_random_uuid(), public.current_profile_id(), 'not allowed')$sql$,
  'a visitor must not send a message'
);

-- Polls are gated twice (create_posts + create_polls); prove both hold.
select public.test_assert_denied(
  $sql$insert into public.posts (author_id, body, kind)
       select id, 'visitor poll', 'poll' from public.profiles
        where id = public.current_profile_id()$sql$,
  'a visitor must not create a poll'
);

-- ---------------------------------------------------------------------------
-- 7. A visitor cannot grant itself anything
-- ---------------------------------------------------------------------------
do $$
declare
  v_ext uuid;
begin
  select profile_id into v_ext from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000002';

  -- Still impersonating the visitor (section 6 switched the session role).
  -- Even a maintenance write is refused without the system context.
  begin
    insert into public.user_roles (user_id, role_key) values (v_ext, 'student');
    raise exception 'ASSERTION FAILED (operation was allowed): a visitor must not self-assign the student role';
  exception
    when sqlstate '42501' then
      perform public.test_assert(true, 'a visitor cannot self-assign the student role');
    when others then
      raise;
  end;

  -- The privilege-escalation guard also refuses widening the visitor role.
  begin
    insert into public.role_permissions (role_key, permission_key) values ('visitor', 'create_posts');
    raise exception 'ASSERTION FAILED (operation was allowed): a visitor must not widen its own role';
  exception
    when sqlstate '42501' then
      perform public.test_assert(true, 'a visitor cannot widen the visitor role');
    when others then
      raise;
  end;

  -- Account type is not self-service either.
  begin
    update public.profile_private set account_type = 'student' where profile_id = v_ext;
    raise exception 'ASSERTION FAILED (operation was allowed): a visitor must not promote itself';
  exception
    when sqlstate '42501' then
      perform public.test_assert(true, 'a visitor cannot promote its own account type');
    when others then
      raise;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Onboarding: visitors claim a profile without institutional details
-- ---------------------------------------------------------------------------
-- `complete_profile()` is a normal RPC; drive it as `authenticated`.
do $$
declare
  v_ext uuid;
  v_result jsonb;
begin
  select profile_id into v_ext from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000002';

  select public.complete_profile(
    'rahul_visitor', 'Rahul Deshmukh', 'Here for the public events.',
    'Computer Engineering', 'Third Year', 'A'   -- a visitor trying to supply academic details
  ) into v_result;

  perform public.test_assert((v_result->>'ok')::boolean,
    'a visitor must be able to complete onboarding');
  perform public.test_assert(v_result->>'account_type' = 'visitor',
    'onboarding must report the account type');

  perform public.test_assert(
    (select username from public.profiles where id = v_ext) = 'rahul_visitor',
    'a visitor must claim its username'
  );
  perform public.test_assert(
    (select branch from public.profiles where id = v_ext) is null,
    'a visitor must not be able to store an academic branch'
  );
  perform public.test_assert(
    (select year from public.profiles where id = v_ext) is null,
    'a visitor must not be able to store an academic year'
  );
  perform public.test_assert(
    (select division from public.profiles where id = v_ext) is null,
    'a visitor must not be able to store a division'
  );
  perform public.test_assert(
    (select show_branch_year from public.profiles where id = v_ext) = false,
    'a visitor must not advertise academic details it does not have'
  );
  perform public.test_assert(
    (select profile_completed from public.profile_private where profile_id = v_ext),
    'a completed visitor profile must be marked complete'
  );
  perform public.test_assert(
    (select bio from public.profiles where id = v_ext) = 'Here for the public events.',
    'a visitor may still write a bio'
  );
end;
$$;

-- The institutional account keeps the full onboarding contract.
do $$
declare
  v_inst uuid;
begin
  -- Claim first: `profile_private_select_self` only exposes the caller's own
  -- row, so reading before switching the claim returns NULL under RLS.
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000001', false);

  select profile_id into v_inst from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000001';

  perform public.complete_profile(
    'tanvi_inst', 'Tanvi Kulkarni', 'Third year computer engineering.',
    'Computer Engineering', 'Third Year', 'A'
  );

  perform public.test_assert(
    (select branch from public.profiles where id = v_inst) = 'Computer Engineering',
    'a student must still be able to store an academic branch'
  );
  perform public.test_assert(
    (select division from public.profiles where id = v_inst) = 'A',
    'a student must still be able to store a division'
  );
  perform public.test_assert(
    (select show_branch_year from public.profiles where id = v_inst),
    'a student must keep the default academic-details preference'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Read access: public content yes, campus-only content no
-- ---------------------------------------------------------------------------
-- Build the fixtures with the trusted context, as a maintenance script would.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_author uuid;
begin
  select profile_id into v_author from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000001';

  -- A public post and a campus-only post by the same institutional author.
  insert into public.posts (id, author_id, body, visibility, status)
  values
    ('dd000000-0000-4000-a000-0000000000c1', v_author, 'A public campus post.', 'public', 'published'),
    ('dd000000-0000-4000-a000-0000000000c2', v_author, 'A campus-only post.', 'campus', 'published');

  insert into public.comments (id, post_id, author_id, body, status)
  values
    ('dd000000-0000-4000-a000-0000000000d1', 'dd000000-0000-4000-a000-0000000000c1', v_author, 'Public comment.', 'published'),
    ('dd000000-0000-4000-a000-0000000000d2', 'dd000000-0000-4000-a000-0000000000c2', v_author, 'Campus comment.', 'published');

  -- A public club and a campus-only club.
  insert into public.communities (id, name, slug, description, kind, visibility, status, created_by)
  values
    ('dd000000-0000-4000-a000-0000000000f1', 'Public Club', 'public-club-080', 'Open to all.', 'club', 'public', 'published', v_author),
    ('dd000000-0000-4000-a000-0000000000e2', 'Campus Club', 'campus-club-080', 'Students only.', 'club', 'campus', 'published', v_author);

  -- An internal notice.
  insert into public.notices (id, title, body, status, created_by, published_at)
  values ('dd000000-0000-4000-a000-0000000000f1', 'Internal examination schedule',
          'Room allocations for the mid-semester examinations.', 'published', v_author, now());
end;
$$;

-- Impersonate the visitor for real: `set role` is what makes RLS apply.
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_public_post integer;
  v_campus_post integer;
  v_public_comment integer;
  v_campus_comment integer;
  v_public_club integer;
  v_campus_club integer;
  v_notices integer;
begin

  -- Visitor: public content only.
  select count(*) into v_public_post from public.posts
   where id = 'dd000000-0000-4000-a000-0000000000c1';
  perform public.test_assert(v_public_post = 1,
    'a visitor must be able to read an explicitly public post');

  select count(*) into v_campus_post from public.posts
   where id = 'dd000000-0000-4000-a000-0000000000c2';
  perform public.test_assert(v_campus_post = 0,
    'a visitor must NOT read a campus-only post');

  select count(*) into v_public_comment from public.comments
   where id = 'dd000000-0000-4000-a000-0000000000d1';
  perform public.test_assert(v_public_comment = 1,
    'a visitor must be able to read comments on a public post');

  select count(*) into v_campus_comment from public.comments
   where id = 'dd000000-0000-4000-a000-0000000000d2';
  perform public.test_assert(v_campus_comment = 0,
    'a visitor must NOT read comments on a campus-only post');

  select count(*) into v_public_club from public.communities
   where id = 'dd000000-0000-4000-a000-0000000000f1';
  perform public.test_assert(v_public_club = 1, 'a visitor must see a public club');

  select count(*) into v_campus_club from public.communities
   where id = 'dd000000-0000-4000-a000-0000000000e2';
  perform public.test_assert(v_campus_club = 0, 'a visitor must NOT see a campus-only club');

  select count(*) into v_notices from public.notices
   where id = 'dd000000-0000-4000-a000-0000000000f1';
  perform public.test_assert(v_notices = 0,
    'a visitor must NOT read an internal campus notice');
end;
$$;

-- The same rows, read by the institutional account, must all be visible.
do $$
declare
  v_campus_post integer;
  v_campus_club integer;
  v_notices integer;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000001', false);

  select count(*) into v_campus_post from public.posts
   where id = 'dd000000-0000-4000-a000-0000000000c2';
  perform public.test_assert(v_campus_post = 1,
    'a student must still read campus-only posts');

  select count(*) into v_campus_club from public.communities
   where id = 'dd000000-0000-4000-a000-0000000000e2';
  perform public.test_assert(v_campus_club = 1, 'a student must still see campus-only clubs');

  select count(*) into v_notices from public.notices
   where id = 'dd000000-0000-4000-a000-0000000000f1';
  perform public.test_assert(v_notices = 1, 'a student must still read the noticeboard');
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. An administrator grants selected permissions; revocation is immediate
-- ---------------------------------------------------------------------------
-- Administration runs as the trusted writer (the admin RPCs are exercised in
-- earlier suites). The visitor's own requests are then made as `authenticated`
-- so that both the permission resolver AND RLS are in force.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_ext uuid;
begin
  select profile_id into v_ext from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000002';

  -- Grant the External Contributor role and exactly one publishing permission.
  insert into public.role_permissions (role_key, permission_key)
  values ('external_contributor', 'create_posts')
  on conflict do nothing;

  insert into public.user_roles (user_id, role_key)
  values (v_ext, 'external_contributor')
  on conflict do nothing;
end;
$$;

do $$
declare
  v_ext uuid;
  v_type public.account_type;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000002', false);

  select profile_id into v_ext from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000002';

  -- The grant is effective immediately for the visitor's next request…
  perform public.test_assert(public.has_permission('create_posts'),
    'a granted permission must take effect for the visitor');
  perform public.test_assert(not public.has_permission('create_comments'),
    'a permission that was not granted must stay denied');

  -- …but the account is still an external visitor, with no college and no
  -- student role. Permission to publish must never confer institutional identity.
  select account_type into v_type from public.profile_private where profile_id = v_ext;
  perform public.test_assert(v_type = 'visitor',
    'granting publishing rights must not change the account type');
  perform public.test_assert(
    (select college_id from public.profile_private where profile_id = v_ext) is null,
    'granting publishing rights must not attach the visitor to a college'
  );
  perform public.test_assert(
    (select count(*) from public.user_roles where user_id = v_ext and role_key = 'student') = 0,
    'granting publishing rights must not grant the student role'
  );
  perform public.test_assert(not public.is_institutional(),
    'an authorised contributor must still resolve as external');
end;
$$;

-- The contributor can now publish a post for real, under RLS.
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000002', false);

insert into public.posts (author_id, body, visibility, status)
select id, 'A post from an authorised external contributor.', 'public', 'published'
  from public.profiles where id = public.current_profile_id();

do $$
begin
  perform public.test_assert(
    (select count(*) from public.posts where author_id = public.current_profile_id()) = 1,
    'an authorised contributor must be able to publish'
  );
end;
$$;

-- Revocation is immediate: without the role grant the capability is gone.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
delete from public.user_roles ur
 using public.profile_private pp
 where pp.profile_id = ur.user_id
   and pp.auth_user_id = 'dd000000-0000-4000-a000-000000000002'
   and ur.role_key = 'external_contributor';

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000002', false);

do $$
begin
  perform public.test_assert(not public.has_permission('create_posts'),
    'a revoked permission must stop working immediately');
end;
$$;

select public.test_assert_denied(
  $sql$insert into public.posts (author_id, body)
       select id, 'Should now fail.' from public.profiles
        where id = public.current_profile_id()$sql$,
  'a revoked contributor must not publish'
);

-- Leave no trace: remove the granted permission and the post.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
delete from public.role_permissions
 where role_key = 'external_contributor' and permission_key = 'create_posts';
delete from public.posts p
 using public.profile_private pp
 where pp.profile_id = p.author_id
   and pp.auth_user_id = 'dd000000-0000-4000-a000-000000000002';

-- 11. A visitor still cannot reach administration or moderation
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000002', false);

do $$
begin
  -- Guard: these assertions are meaningless as the superuser (RLS bypassed).
  perform public.test_assert(current_user = 'authenticated',
    'the visitor restriction checks must run as the authenticated role');
  perform public.test_assert(public.is_visitor(),
    'the visitor session must resolve through current_profile_id()');

  perform public.test_assert(not public.has_permission('manage_users'), 'no user management');
  perform public.test_assert(not public.has_permission('assign_roles'), 'no role assignment');
  perform public.test_assert(not public.has_permission('review_reports'), 'no report review');
  perform public.test_assert(not public.has_permission('moderate_all'), 'no blanket moderation');
  perform public.test_assert(not public.has_permission('view_audit_logs'), 'no audit log access');
  perform public.test_assert(not public.has_role('moderator'), 'never a moderator');
  perform public.test_assert(not public.has_role('admin'), 'never an admin');
  perform public.test_assert(not public.has_role('student'), 'never a student by default');

  -- A visitor cannot read the audit trail or the private identity table of
  -- anyone else.
  perform public.test_assert(
    (select count(*) from public.audit_logs) = 0,
    'a visitor must not read audit logs'
  );
  perform public.test_assert(
    (select count(*) from public.profile_private) = 1,
    'a visitor must only read its own private row'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Existing institutional accounts are unaffected
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_inst uuid;
begin
  select profile_id into v_inst from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000001';

  perform public.test_assert(current_user = 'authenticated',
    'the student checks must run as the authenticated role');
  perform public.test_assert(public.is_institutional(),
    'the student session must resolve through current_profile_id()');

  perform public.test_assert(public.has_permission('create_posts'), 'a student keeps create_posts');
  perform public.test_assert(public.has_permission('create_comments'), 'a student keeps create_comments');
  perform public.test_assert(public.has_permission('send_messages'), 'a student keeps send_messages');
  perform public.test_assert(public.has_permission('create_marketplace_listing'), 'a student keeps listings');
  perform public.test_assert(public.has_permission('submit_events'), 'a student keeps event submission');
  perform public.test_assert(public.has_role('student'), 'a student still holds the student role');
  perform public.test_assert(not public.has_role('visitor'), 'a student does not hold the visitor role');
  perform public.test_assert(public.is_institutional(), 'a student resolves as institutional');

  -- And can still publish.
  insert into public.posts (author_id, body, visibility, status)
  values (v_inst, 'A student post after migration 080.', 'public', 'published');
  perform public.test_assert(
    (select count(*) from public.posts where author_id = v_inst and body = 'A student post after migration 080.') = 1,
    'a student must still be able to publish'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Suspension still governs visitors
-- ---------------------------------------------------------------------------
-- The suspension itself is an administrative act; the *consequence* is what is
-- being tested, so switch back to the visitor for the assertions.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_ext uuid;
begin
  select profile_id into v_ext from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000002';
  perform public.admin_set_account_status(v_ext, 'suspended', 'Testing visitor suspension.', 30);
end;
$$;

do $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000002', false);

  perform public.test_assert(not public.is_active_user(), 'a suspended visitor is not active');
  perform public.test_assert(not public.has_permission('report_content'),
    'a suspended visitor loses even its read-only permissions');
end;
$$;

-- Restore for any later suite.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_ext uuid;
begin
  select profile_id into v_ext from public.profile_private
   where auth_user_id = 'dd000000-0000-4000-a000-000000000002';
  perform public.admin_set_account_status(v_ext, 'active', null, null);
end;
$$;

-- Reset the session context so later suites start from a known state.
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- 14. Per-account grants: three visitors, three different capability sets
-- ---------------------------------------------------------------------------
-- Migration 081 adds `visitor_permission_grants` so that granting a capability
-- to one external account does not grant it to every holder of a role. This is
-- the product requirement expressed as data: A may post and comment, B may post
-- only, C stays read-only — and none of them becomes a student.

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
reset role;

insert into auth.users (id, email) values
  ('dd000000-0000-4000-a000-000000000011', 'visitor.a@gmail.com'),
  ('dd000000-0000-4000-a000-000000000012', 'visitor.b@outlook.com'),
  ('dd000000-0000-4000-a000-000000000013', 'visitor.c@yahoo.com')
on conflict (id) do nothing;

-- Give them usernames so the admin surface has something to show.
do $$
declare
  v_id uuid;
begin
  foreach v_id in array array[
    'dd000000-0000-4000-a000-000000000011'::uuid,
    'dd000000-0000-4000-a000-000000000012'::uuid,
    'dd000000-0000-4000-a000-000000000013'::uuid
  ] loop
    perform set_config('request.jwt.claim.sub', v_id::text, false);
    perform public.complete_profile(
      'visitor_' || right(v_id::text, 2),
      'Visitor ' || right(v_id::text, 2)
    );
  end loop;
  perform set_config('request.jwt.claim.sub', '', false);
end;
$$;

-- Visitor A: posts + comments. Visitor B: posts. Visitor C: nothing.
do $$
declare
  v_a uuid;
  v_b uuid;
  v_c uuid;
begin
  select pp.profile_id into v_a from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000011';
  select pp.profile_id into v_b from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000012';
  select pp.profile_id into v_c from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000013';

  perform public.admin_set_visitor_permissions(v_a, array['create_posts', 'create_comments']);
  perform public.admin_set_visitor_permissions(v_b, array['create_posts']);
  perform public.admin_set_visitor_permissions(v_c, array[]::text[]);
end;
$$;

do $$
declare
  v_a uuid;
  v_b uuid;
  v_c uuid;
begin
  select pp.profile_id into v_a from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000011';
  select pp.profile_id into v_b from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000012';
  select pp.profile_id into v_c from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000013';

  -- Visitor A: both capabilities, nothing else.
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000011', false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform public.test_assert(public.current_profile_id() = v_a, 'A must resolve to its own profile');
  perform public.test_assert(public.has_permission('create_posts'), 'A may post');
  perform public.test_assert(public.has_permission('create_comments'), 'A may comment');
  perform public.test_assert(not public.has_permission('send_messages'), 'A may not message');
  perform public.test_assert(not public.has_permission('create_marketplace_listing'), 'A may not list');
  perform public.test_assert(not public.has_permission('manage_users'), 'A is not an administrator');

  -- Visitor B: posts only. A's comment grant must not have leaked across.
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000012', false);
  perform public.test_assert(public.current_profile_id() = v_b, 'B must resolve to its own profile');
  perform public.test_assert(public.has_permission('create_posts'), 'B may post');
  perform public.test_assert(not public.has_permission('create_comments'), 'B may NOT comment');
  perform public.test_assert(not public.has_permission('send_messages'), 'B may not message');

  -- Visitor C: completely read-only.
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000013', false);
  perform public.test_assert(public.current_profile_id() = v_c, 'C must resolve to its own profile');
  perform public.test_assert(not public.has_permission('create_posts'), 'C may not post');
  perform public.test_assert(not public.has_permission('create_comments'), 'C may not comment');
  perform public.test_assert(public.has_permission('report_content'), 'C may still report abuse');
end;
$$;

-- The grants never confer institutional identity or a student role.
do $$
declare
  v_a uuid;
begin
  select pp.profile_id into v_a from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000011';

  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  perform public.test_assert(
    (select account_type from public.profile_private where profile_id = v_a) = 'visitor',
    'a granted account must stay an external visitor'
  );
  perform public.test_assert(
    (select college_id from public.profile_private where profile_id = v_a) is null,
    'a granted account must not be attached to a college'
  );
  perform public.test_assert(
    not exists (select 1 from public.user_roles where user_id = v_a and role_key = 'student'),
    'a granted account must never receive the student role'
  );
end;
$$;

-- The RPC refuses anything outside the publishing allow-list.
do $$
declare
  v_a uuid;
begin
  select pp.profile_id into v_a from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000011';

  begin
    perform public.admin_set_visitor_permissions(v_a, array['manage_users']);
    raise exception 'ASSERTION FAILED (operation was allowed): an administrative permission must not be grantable to a visitor';
  exception
    when sqlstate '42501' then
      perform public.test_assert(true, 'administrative permissions are refused for visitors');
  end;

  begin
    perform public.admin_set_visitor_permissions(v_a, array['create_posts', 'moderate_all']);
    raise exception 'ASSERTION FAILED (operation was allowed): one bad key must reject the whole change';
  exception
    when sqlstate '42501' then
      perform public.test_assert(
        (select count(*) from public.visitor_permission_grants where user_id = v_a) = 2,
        'a rejected change must not have altered the existing grants'
      );
  end;
end;
$$;

-- The RPC refuses an institutional account.
do $$
declare
  v_inst uuid;
begin
  select pp.profile_id into v_inst from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000001';

  begin
    perform public.admin_set_visitor_permissions(v_inst, array['create_posts']);
    raise exception 'ASSERTION FAILED (operation was allowed): an institutional account must not use the visitor grant path';
  exception
    when sqlstate '42501' then
      perform public.test_assert(true, 'institutional accounts are refused by the visitor grant path');
  end;
end;
$$;

-- A visitor cannot write its own grants, and cannot read another's.
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000013', false);

select public.test_assert_denied(
  $sql$insert into public.visitor_permission_grants (user_id, permission_key)
       values (public.current_profile_id(), 'create_posts')$sql$,
  'a visitor must not be able to grant itself a permission'
);

select public.test_assert_denied(
  $sql$select public.admin_set_visitor_permissions(public.current_profile_id(), array['create_posts'])$sql$,
  'a visitor must not be able to call the administrator grant function'
);

do $$
begin
  -- Visitor C holds nothing, and cannot see A's or B's grants.
  perform public.test_assert(
    (select count(*) from public.visitor_permission_grants) = 0,
    'a visitor must only read its own grants'
  );
end;
$$;

-- Revocation is immediate, and audited.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_b uuid;
  v_audit integer;
begin
  select pp.profile_id into v_b from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000012';

  perform public.admin_set_visitor_permissions(v_b, array[]::text[]);

  select count(*) into v_audit from public.audit_logs
   where action = 'admin.visitor_permissions_changed'
     and target_id = v_b::text::uuid;
  perform public.test_assert(v_audit >= 2,
    'each effective change to a visitor''s permissions must be audited');

  perform public.test_assert(
    (select count(*) from public.visitor_permission_grants where user_id = v_b) = 0,
    'revocation must remove the grant'
  );
end;
$$;

do $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000012', false);
  perform public.test_assert(
    not public.has_permission('create_posts'),
    'a revoked permission must stop working immediately'
  );
end;
$$;

-- A suspended visitor loses granted capabilities too.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_a uuid;
begin
  select pp.profile_id into v_a from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000011';

  perform public.admin_set_account_status(v_a, 'suspended', 'Granted capability must not survive this.', 7);

  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000011', false);

  perform public.test_assert(not public.is_active_user(), 'a suspended visitor is not active');
  perform public.test_assert(not public.has_permission('create_posts'),
    'a suspension must remove a granted capability');

  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);
  perform public.admin_set_account_status(v_a, 'active', null, null);
end;
$$;

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
reset role;

-- ---------------------------------------------------------------------------
-- 15. A visitor cannot acquire institutional profile fields via the REST path
-- ---------------------------------------------------------------------------
-- `profiles_update_self` allows a column-by-column update of one's own row, so
-- this exercises the direct-API route a visitor could take to give itself a
-- branch and year, bypassing both the onboarding form and complete_profile().

do $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000013', false);
end;
$$;

set role authenticated;
update public.profiles
   set branch = 'Computer Science', year = 'Third year', division = 'A', show_branch_year = true
 where id = public.current_profile_id();
reset role;

do $$
declare
  v_row public.profiles;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  select * into v_row from public.profiles
   where id = (select pp.profile_id from public.profile_private pp
                where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000013');

  perform public.test_assert(v_row.branch is null, 'a visitor must not acquire a branch');
  perform public.test_assert(v_row.year is null, 'a visitor must not acquire a year');
  perform public.test_assert(v_row.division is null, 'a visitor must not acquire a division');
  perform public.test_assert(v_row.show_branch_year = false, 'a visitor must not display a branch/year');
end;
$$;

-- The same write still works for an institutional account: the guard clears
-- only external rows.
-- Prove the clamp is the trigger and not merely RLS refusing the write: a
-- trusted writer bypasses RLS entirely and is clamped all the same.
do $$
declare
  v_c uuid;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  select pp.profile_id into v_c from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000013';

  update public.profiles set branch = 'Mechanical', year = 'First year' where id = v_c;

  perform public.test_assert(
    (select p.branch from public.profiles p where p.id = v_c) is null,
    'the clamp must come from the trigger, not from RLS'
  );
end;
$$;

do $$
declare
  v_inst_auth uuid := 'dd000000-0000-4000-a000-000000000001';
begin
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', v_inst_auth::text, false);

  perform set_config('role', 'authenticated', true);
  update public.profiles set year = 'Second year' where id = public.current_profile_id();
  perform set_config('role', 'none', true);
  reset role;

  perform public.test_assert(
    (select p.year from public.profiles p
      join public.profile_private pp on pp.profile_id = p.id
     where pp.auth_user_id = v_inst_auth) = 'Second year',
    'an institutional account must still be able to set its year'
  );
end;
$$;

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
reset role;

-- ---------------------------------------------------------------------------
-- 16. A granted capability must not widen the audience
-- ---------------------------------------------------------------------------
-- Regression: with `create_posts` granted, the insert policy in migration 005
-- checked capability and visibility independently, so a visitor could publish
-- `visibility = 'campus'` (delivered to campus-only readers) or into a private
-- community it had joined, and could then widen a public post with an UPDATE.

do $$
declare
  v_a uuid;
  v_owner uuid;
  v_private uuid;
  v_public uuid;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  select pp.profile_id into v_a from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000011';
  select id into v_owner from public.profiles where id <> v_a limit 1;

  -- Re-grant, because the earlier section revoked this account's capabilities.
  perform public.admin_set_visitor_permissions(v_a, array['create_posts']);

  insert into public.communities (kind, name, slug, description, visibility, join_policy, status, created_by)
  values
    ('community', 'Visitor probe private', 'visitor-probe-private',
     'A private community used to probe external account authorization.', 'private', 'invite', 'published', v_owner),
    ('community', 'Visitor probe public', 'visitor-probe-public',
     'A public community used to probe external account authorization.', 'public', 'open', 'published', v_owner);
end;
$$;

do $$
declare
  v_a uuid;
  v_private uuid;
  v_public uuid;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  select pp.profile_id into v_a from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000011';
  select id into v_private from public.communities where slug = 'visitor-probe-private';
  select id into v_public from public.communities where slug = 'visitor-probe-public';

  -- Worst case: the visitor is a member of the private community, so the
  -- membership check alone would let it post there.
  insert into public.community_members (community_id, user_id, role, status)
  values (v_private, v_a, 'member', 'active')
  on conflict do nothing;

  -- …and a member of the public one too, so the permitted path below is
  -- exercising scope rather than membership.
  insert into public.community_members (community_id, user_id, role, status)
  values (v_public, v_a, 'member', 'active')
  on conflict do nothing;

  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000011', false);
end;
$$;

set role authenticated;

select public.test_assert_denied(
  $sql$insert into public.posts (author_id, body, visibility)
       values (public.current_profile_id(), 'campus probe', 'campus')$sql$,
  'a granted external account must not publish to a campus-only audience'
);

select public.test_assert_denied(
  $sql$insert into public.posts (author_id, body, visibility, community_id)
       select public.current_profile_id(), 'private probe', 'private', id
         from public.communities where slug = 'visitor-probe-private'$sql$,
  'a granted external account must not publish into a private community, even as a member'
);

select public.test_assert_denied(
  $sql$insert into public.posts (author_id, body, visibility, community_id)
       select public.current_profile_id(), 'community probe', 'community', id
         from public.communities where slug = 'visitor-probe-public'$sql$,
  'community-visibility posts are addressed to members and are not a route around the rule'
);

-- The permitted path still works: the public sphere, and a public community.
do $$
declare
  v_public uuid;
  v_id uuid;
begin
  select id into v_public from public.communities where slug = 'visitor-probe-public';

  insert into public.posts (author_id, body, visibility)
  values (public.current_profile_id(), 'public probe', 'public')
  returning id into v_id;
  perform public.test_assert(v_id is not null, 'a granted external account may still publish publicly');

  insert into public.posts (author_id, body, visibility, community_id)
  values (public.current_profile_id(), 'public community probe', 'public', v_public)
  returning id into v_id;
  perform public.test_assert(v_id is not null, 'a granted external account may still post in a public community');
end;
$$;

-- Editing must not be a way around the insert rules.
select public.test_assert_denied(
  $sql$update public.posts set visibility = 'campus'
        where author_id = public.current_profile_id() and body = 'public probe'$sql$,
  'a granted external account must not widen a post with an UPDATE'
);

select public.test_assert_denied(
  $sql$update public.posts set community_id = (select id from public.communities where slug = 'visitor-probe-private')
        where author_id = public.current_profile_id() and body = 'public probe'$sql$,
  'a granted external account must not move a post into a private community'
);

select public.test_assert_denied(
  $sql$update public.posts set is_official = true
        where author_id = public.current_profile_id() and body = 'public probe'$sql$,
  'a granted external account must not publish as campus-official'
);

do $$
begin
  perform public.test_assert(
    (select count(*) from public.posts
      where author_id = public.current_profile_id() and visibility <> 'public') = 0,
    'every post held by an external account must be publicly scoped'
  );
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

-- An institutional account keeps the full range of audiences.
do $$
declare
  v_inst uuid;
  v_inst_auth uuid := 'dd000000-0000-4000-a000-000000000001';
  v_private uuid;
begin
  select pp.profile_id into v_inst from public.profile_private pp where pp.auth_user_id = v_inst_auth;

  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', v_inst_auth::text, false);
  perform set_config('role', 'authenticated', true);

  insert into public.posts (author_id, body, visibility)
  values (v_inst, 'institutional campus post', 'campus');

  perform set_config('role', 'none', true);
  reset role;

  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  perform public.test_assert(
    exists (select 1 from public.posts where author_id = v_inst and body = 'institutional campus post'),
    'an institutional account must still be able to publish to campus'
  );
end;
$$;

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
reset role;

-- ---------------------------------------------------------------------------
-- 17. The external-user list searches everything, and counts what it returns
-- ---------------------------------------------------------------------------
-- Regression: this used to page `profile_private` and filter the page in
-- JavaScript, so searching for an address that was not on page 1 found nothing,
-- and `total` described the unfiltered set. A search that only searches what you
-- already fetched is not a search.

do $$
declare
  v_total bigint;
  v_found bigint;
  v_by_email bigint;
  v_by_username bigint;
  v_case bigint;
  v_page2 uuid[];
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  -- Everything, one at a time.
  select total into v_total from public.admin_list_external_users(null, 1, 0);
  perform public.test_assert(
    v_total >= 3,
    'the list must report the true total of external accounts'
  );

  -- Search an address belonging to an account that is NOT the first row.
  select total into v_by_email
    from public.admin_list_external_users('visitor.c@yahoo.com', 10, 0);
  perform public.test_assert(v_by_email = 1, 'searching by email must find the account wherever it sits');

  -- …and by username, case-insensitively.
  select total into v_by_username
    from public.admin_list_external_users('VISITOR_B', 10, 0);
  perform public.test_assert(v_by_username = 1, 'searching by username must be case-insensitive');

  select total into v_case
    from public.admin_list_external_users('Visitor.', 10, 0);
  perform public.test_assert(v_case >= 3, 'a partial term must match display names too');

  perform public.test_assert(
    (select count(*) from public.admin_list_external_users('nobody-matches-this-xyz', 10, 0)) = 0,
    'a term that matches nothing must return no rows'
  );

  -- The total is bounded by the search, not by the table.
  select total into v_found from public.admin_list_external_users('visitor.a@gmail.com', 1, 0);
  perform public.test_assert(v_found = 1, 'total must describe the filtered set');

  -- Paging past the end is empty, not an error.
  select array_agg(profile_id) into v_page2
    from public.admin_list_external_users(null, 10, 500);
  perform public.test_assert(coalesce(cardinality(v_page2), 0) = 0, 'an offset past the end returns nothing');
end;
$$;

-- Only accounts that manage users may call it.
do $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-4000-a000-000000000013', false);

  begin
    perform count(*) from public.admin_list_external_users(null, 10, 0);
    raise exception 'ASSERTION FAILED (operation was allowed): a visitor must not list external accounts';
  exception
    when sqlstate '42501' then
      perform public.test_assert(true, 'a visitor cannot list external accounts');
  end;

  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);
end;
$$;

-- The list never leaks an institutional account, and never a non-visitor email.
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  perform public.test_assert(
    not exists (
      select 1 from public.admin_list_external_users(null, 200, 0) l
       where l.account_type <> 'visitor'
    ),
    'the external-user list must contain external accounts only'
  );

  -- An institutional account must never appear in the external list. Asserted
  -- against the account itself, not against a domain substring: search is
  -- deliberately substring-based (an administrator types a partial address), so
  -- `pccoepune.org` also matches a lookalike external domain such as
  -- `not-pccoepune.org` — which is correct behaviour, not a leak. The property
  -- that matters is that the classifier's institutional account is absent.
  perform public.test_assert(
    not exists (
      select 1 from public.admin_list_external_users('tanvi.inst@pccoepune.org', 200, 0)
    ),
    'an institutional account must never appear in the external-user list'
  );

  -- …and no row may carry an address on a configured college domain.
  perform public.test_assert(
    not exists (
      select 1 from public.admin_list_external_users(null, 200, 0) l
       where l.email is not null
         and exists (
           select 1 from public.colleges c
            where c.is_active
              and lower(split_part(l.email, '@', 2)) = any (c.email_domains)
         )
    ),
    'no external account may hold an address on an active college domain'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 18. An account without a username, and the visitor's own year and college
-- ---------------------------------------------------------------------------
-- Two changes landed after the first production sign-up exposed them:
--
--   * `admin_set_visitor_permissions()` used `profiles.username` as its
--     existence check. A username is only claimed during onboarding, so every
--     freshly signed-in external account — the exact account an administrator
--     goes looking for — was rejected with "That account could not be found",
--     and no grant was possible until the visitor happened to finish
--     onboarding first. Migration 082 checks `profile_private` instead.
--
--   * Visitors were previously refused a year of any kind. They now answer
--     "which college do you attend?" and "what year are you in?", stored in
--     `visitor_college_name` / `visitor_year`. The institutional `year` column
--     stays off-limits, so the student directory cannot be poisoned.

do $$
declare
  v_fresh_auth uuid := 'dd000000-0000-4000-a000-0000000000f1';
  v_fresh uuid;
  v_result jsonb;
  v_username text;
  v_completed boolean;
  v_row public.profiles;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  -- A brand-new external sign-up, exactly as the trigger leaves it: a profile
  -- row, a profile_private row, a visitor role - and no username.
  insert into auth.users (id, email) values (v_fresh_auth, 'brand.new.external@gmail.com')
  on conflict (id) do nothing;

  select pp.profile_id into v_fresh from public.profile_private pp
   where pp.auth_user_id = v_fresh_auth;

  perform public.test_assert(v_fresh is not null, 'the signup trigger must create a profile_private row');

  select p.username into v_username from public.profiles p where p.id = v_fresh;
  perform public.test_assert(v_username is null, 'a fresh account must not have a username yet');

  -- THE REGRESSION: granting before onboarding must work.
  v_result := public.admin_set_visitor_permissions(v_fresh, array['create_posts']);

  perform public.test_assert(
    v_result->>'ok' = 'true',
    'an administrator must be able to grant permissions before the account has a username'
  );
  perform public.test_assert(
    (select count(*) from public.visitor_permission_grants g
      where g.user_id = v_fresh and g.permission_key = 'create_posts') = 1,
    'the grant must be recorded for an account with no username'
  );

  -- The capability resolves immediately, without a username and without a
  -- completed profile.
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', v_fresh_auth::text, false);
  perform public.test_assert(
    public.has_permission('create_posts'),
    'a granted capability must apply to an account that has not onboarded'
  );
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  -- An institutional account is still refused, username or not.
  perform public.test_assert_denied(
    $sql$select public.admin_set_visitor_permissions(
           (select pp.profile_id from public.profile_private pp
             where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000001'),
           array['create_posts'])$sql$,
    'a student must never be routed through the visitor grant path'
  );

  -- A genuinely missing account still raises, so the fix did not turn the
  -- existence check into a no-op.
  perform public.test_assert_denied(
    $sql$select public.admin_set_visitor_permissions(
           'dd000000-0000-4000-a000-0000000000ff'::uuid, array['create_posts'])$sql$,
    'an unknown profile id must still be reported as not found'
  );

  -- The new account finishes onboarding with its own details.
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', v_fresh_auth::text, false);
  perform public.complete_profile(
    'brand_new_external',
    'Brand New External',
    null,          -- bio
    null,          -- branch
    null,          -- year
    null,          -- division
    true,          -- show_branch_year
    'Sinhgad College of Engineering',
    'Second Year'
  );
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  select * into v_row from public.profiles where id = v_fresh;
  select pp.profile_completed into v_completed from public.profile_private pp where pp.profile_id = v_fresh;

  perform public.test_assert(v_row.username = 'brand_new_external', 'a visitor must be able to claim a username');
  perform public.test_assert(v_completed, 'a visitor must be able to complete their profile');
  perform public.test_assert(
    v_row.visitor_college_name = 'Sinhgad College of Engineering',
    'a visitor''s own college must be stored'
  );
  perform public.test_assert(v_row.visitor_year = 'Second Year', 'a visitor''s own year must be stored');
  -- …and must never leak into the institutional columns.
  perform public.test_assert(v_row.year is null, 'a visitor''s year must not be written to profiles.year');
  perform public.test_assert(v_row.branch is null, 'a visitor must not acquire a branch');
  perform public.test_assert(v_row.division is null, 'a visitor must not acquire a division');
end;
$$;

-- The direct-API route: a visitor may write its own two columns, but can never
-- write the institutional pair in the same statement.
do $$
declare
  v_auth uuid := 'dd000000-0000-4000-a000-0000000000f1';
  v_row public.profiles;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', v_auth::text, false);
  perform set_config('role', 'authenticated', true);

  update public.profiles
     set visitor_college_name = 'Changed College',
         visitor_year = 'Final Year',
         branch = 'Computer Engineering',
         year = 'Third Year',
         division = 'B'
   where id = public.current_profile_id();

  perform set_config('role', 'none', true);

  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  select * into v_row from public.profiles
   where id = (select pp.profile_id from public.profile_private pp where pp.auth_user_id = v_auth);

  perform public.test_assert(v_row.visitor_college_name = 'Changed College', 'a visitor may edit its own college');
  perform public.test_assert(v_row.visitor_year = 'Final Year', 'a visitor may edit its own year');
  perform public.test_assert(v_row.branch is null, 'the academic columns stay clamped in the same write');
  perform public.test_assert(v_row.year is null, 'the institutional year stays clamped in the same write');
  perform public.test_assert(v_row.division is null, 'the division stays clamped in the same write');
end;
$$;

-- The mirror rule: an institutional account cannot hold visitor-only fields,
-- even when a trusted writer sets them.
do $$
declare
  v_student uuid;
  v_row public.profiles;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  select pp.profile_id into v_student from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000001';

  update public.profiles
     set visitor_college_name = 'Somewhere Else',
         visitor_year = 'First Year'
   where id = v_student;

  select * into v_row from public.profiles where id = v_student;

  perform public.test_assert(v_row.visitor_college_name is null, 'a student must not hold a visitor college name');
  perform public.test_assert(v_row.visitor_year is null, 'a student must not hold a visitor year');
end;
$$;

-- public_profiles exposes the visitor fields and the boolean that labels them.
do $$
declare
  v_row public.public_profiles;
  v_student_row public.public_profiles;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  select * into v_row from public.public_profiles
   where id = (select pp.profile_id from public.profile_private pp
                where pp.auth_user_id = 'dd000000-0000-4000-a000-0000000000f1');

  perform public.test_assert(v_row.is_external, 'the public projection must label an external account');
  perform public.test_assert(v_row.visitor_college_name is not null, 'the public projection must carry the college');
  perform public.test_assert(v_row.visitor_year is not null, 'the public projection must carry the year');

  select * into v_student_row from public.public_profiles
   where id = (select pp.profile_id from public.profile_private pp
                where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000001');

  perform public.test_assert(not v_student_row.is_external, 'a student must not be labelled external');
end;
$$;

-- Cleanup: leave no evidence behind for the next suite.
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);
  delete from public.visitor_permission_grants
   where user_id = (select pp.profile_id from public.profile_private pp
                     where pp.auth_user_id = 'dd000000-0000-4000-a000-0000000000f1');
  delete from auth.users where id = 'dd000000-0000-4000-a000-0000000000f1';
end;
$$;

-- ---------------------------------------------------------------------------
-- 19. Visitor and External Contributor are different things
-- ---------------------------------------------------------------------------
-- `visitor` is the account type's baseline: read-only, plus own profile and
-- reporting, granted by the signup trigger and never by a human.
--
-- `external_contributor` is an entitlement a person gives one account. This
-- section proves the three properties that make the difference real:
--
--   1. the entitlement confers nothing on an institutional account, even if the
--      role row arrives through the table rather than through grant_role();
--   2. it applies normally to an external account, through the same
--      has_permission() every other permission goes through;
--   3. granting it never changes the account type.

-- This section provisions its own external account, because section 18 deletes
-- the one it created. An external address goes through the real signup trigger,
-- so the account arrives as a visitor with no username — which is now enough to
-- hold a role or a grant (082).
do $$
declare
  v_student uuid;
  v_visitor uuid;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  insert into auth.users (id, email)
  values ('dd000000-0000-4000-a000-0000000000f1', 'contributor.probe@gmail.com')
  on conflict (id) do nothing;

  select pp.profile_id into v_student from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000001';
  select pp.profile_id into v_visitor from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-0000000000f1';

  -- The role now confers a permission, so "it changed nothing" is a real test
  -- rather than a tautology.
  insert into public.role_permissions (role_key, permission_key)
  values ('external_contributor', 'create_posts')
  on conflict do nothing;

  -- The student gets the role by direct insert, bypassing grant_role()'s check
  -- in 083 §4. This is the path that RLS cannot police, because
  -- user_roles_insert_admin is a table-level policy and cannot see which role
  -- is being inserted.
  insert into public.user_roles (user_id, role_key)
  values (v_student, 'external_contributor')
  on conflict do nothing;

  -- ...and the same role on an external account, where it must take effect.
  insert into public.user_roles (user_id, role_key)
  values (v_visitor, 'external_contributor')
  on conflict do nothing;
end;
$$;

do $$
declare
  v_student_auth uuid;
  v_visitor_auth uuid;
  v_student_has boolean;
  v_visitor_has boolean;
  v_standing text;
  v_type public.account_type;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', false);

  select pp.auth_user_id into v_student_auth from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000001';
  select pp.auth_user_id into v_visitor_auth from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-0000000000f1';

  -- 1. The institutional account holding the role must gain nothing from it.
  perform set_config('request.jwt.claim.sub', v_student_auth::text, false);
  perform public.test_assert(
    public.has_permission('create_posts'),
    'a student keeps the permissions their own role already gives them'
  );

  perform set_config('request.jwt.claim.sub', v_visitor_auth::text, false);
  v_visitor_has := public.has_permission('create_posts');
  perform public.test_assert(
    v_visitor_has,
    'the same role must confer its permissions on an external account'
      || ' [type=' || coalesce(public.account_type_of(public.current_profile_id())::text, 'NULL')
      || ' active=' || public.is_active_user()::text
      || ' roles=' || coalesce((select string_agg(role_key, ',') from public.user_roles
                                 where user_id = public.current_profile_id()), 'NONE')
      || ']'
  );

  -- 3. The account type is untouched by any of this.
  select pp.account_type into v_type from public.profile_private pp
   where pp.auth_user_id = v_visitor_auth;
  perform public.test_assert(v_type = 'visitor', 'a contributor is still an external account');

  v_standing := public.external_standing();
  perform public.test_assert(v_standing = 'contributor', 'the standing must report contributor');

  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);
end;
$$;

-- The leak this migration closes, stated directly: strip the student's own
-- permissions and the contributor role must still confer nothing to them.
do $$
declare
  v_student_auth uuid;
  v_student uuid;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  select pp.auth_user_id, pp.profile_id into v_student_auth, v_student
    from public.profile_private pp where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000001';

  -- Move the account off Student (so it has no role that grants create_posts
  -- either) but keep the contributor role. has_permission() must still say no:
  -- the contributor branch is conditional on being external.
  delete from public.user_roles where user_id = v_student and role_key = 'student';

  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', v_student_auth::text, false);
  perform public.test_assert(
    not public.has_permission('create_posts'),
    'the contributor role must confer nothing on an institutional account'
  );

  -- And the standing must not describe them as a contributor.
  perform public.test_assert(
    public.external_standing() = 'institutional',
    'an institutional account has no external standing'
  );

  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);
end;
$$;

-- grant_role() refuses the entitlement on an institutional account, and accepts
-- it on an external one.
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  perform public.test_assert_denied(
    $sql$select public.grant_role(
           (select pp.profile_id from public.profile_private pp
             where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000001'),
           'external_contributor')$sql$,
    'External Contributor must not be grantable to an institutional account'
  );

  perform public.test_assert(
    public.grant_role(
      (select pp.profile_id from public.profile_private pp
        where pp.auth_user_id = 'dd000000-0000-4000-a000-0000000000f1'),
      'external_contributor'
    )->>'ok' = 'true',
    'External Contributor must be grantable to an external account'
  );
end;
$$;

-- The three standings, driven from the database rather than derived in the UI.
do $$
declare
  v_auth uuid;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  select pp.auth_user_id into v_auth from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-0000000000f1';

  -- Contributor already established above.
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', v_auth::text, false);
  perform public.test_assert(public.external_standing() = 'contributor', 'standing: contributor');
  perform public.test_assert(public.is_external_contributor(), 'is_external_contributor: true');

  -- Drop the role, grant one capability: permitted visitor.
  perform set_config('request.jwt.claim.role', 'service_role', false);
  delete from public.user_roles where role_key = 'external_contributor'
    and user_id = (select pp.profile_id from public.profile_private pp
                    where pp.auth_user_id = v_auth);

  perform public.admin_set_visitor_permissions(
    (select pp.profile_id from public.profile_private pp where pp.auth_user_id = v_auth),
    array['create_posts']
  );

  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform public.test_assert(public.external_standing() = 'permitted_visitor', 'standing: permitted visitor');
  perform public.test_assert(not public.is_external_contributor(), 'is_external_contributor: false');
  perform public.test_assert(public.has_permission('create_posts'), 'a permitted visitor can publish');

  -- Drop the grant too: read-only visitor.
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform public.admin_set_visitor_permissions(
    (select pp.profile_id from public.profile_private pp where pp.auth_user_id = v_auth),
    array[]::text[]
  );

  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform public.test_assert(public.external_standing() = 'read_only_visitor', 'standing: read-only visitor');
  perform public.test_assert(not public.has_permission('create_posts'), 'a read-only visitor cannot publish');
end;
$$;

-- Cleanup: leave the fixture roles and permissions as they were found.
do $$
declare
  v_student uuid;
begin
  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);

  select pp.profile_id into v_student from public.profile_private pp
   where pp.auth_user_id = 'dd000000-0000-4000-a000-000000000001';

  -- Restore the student role removed above; the rest of the suite depends on it.
  insert into public.user_roles (user_id, role_key) values (v_student, 'student')
  on conflict do nothing;

  delete from public.user_roles where role_key = 'external_contributor';
  delete from public.role_permissions
   where role_key = 'external_contributor' and permission_key = 'create_posts';
  delete from public.visitor_permission_grants
   where user_id = (select pp.profile_id from public.profile_private pp
                     where pp.auth_user_id = 'dd000000-0000-4000-a000-0000000000f1');
  delete from auth.users where id = 'dd000000-0000-4000-a000-0000000000f1';
end;
$$;
