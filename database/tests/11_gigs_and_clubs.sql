-- =============================================================================
-- Campus+ database tests — 11 gigs and clubs sections
-- =============================================================================
-- Migration 025 gives the two dedicated sections the data they render:
--
--   Gigs — a poster-controlled lifecycle (open/closed/completed) next to the
--     moderation status, the fields the gig form collects, and one
--     `gig_applications` table with its own RLS so "apply" is a real action.
--   Clubs — a discovery category on the shared `communities` table, plus a
--     guard that stops a non-staff writer from minting an official club.
--
-- These are the rules the UI depends on; if any of them regress, the buttons
-- on /gigs and /clubs would either stop working or start lying.
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('96000000-0000-4000-a000-000000000001', 'gig.owner@pccoepune.org'),
  ('96000000-0000-4000-a000-000000000002', 'gig.applicant@pccoepune.org'),
  ('96000000-0000-4000-a000-000000000003', 'gig.outsider@pccoepune.org'),
  ('96000000-0000-4000-a000-000000000004', 'club.admin@pccoepune.org')
on conflict (id) do nothing;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('96000000-0000-4000-a000-000000000001', 'gig_owner', 'Gig Owner'),
    ('96000000-0000-4000-a000-000000000002', 'gig_applicant', 'Gig Applicant'),
    ('96000000-0000-4000-a000-000000000003', 'gig_outsider', 'Gig Outsider'),
    ('96000000-0000-4000-a000-000000000004', 'club_admin', 'Club Admin')
  ) as t(id, username, name)
  loop
    perform set_config('request.jwt.claim.sub', r.id, false);
    perform public.complete_profile(p_username => r.username, p_display_name => r.name,
      p_branch => 'Computer Engineering', p_year => 'Third Year');
  end loop;
end;
$$;

-- The campus team account. `grant_role` is the same path the admin console uses.
select public.grant_role((select id from public.profiles where username = 'club_admin'), 'admin');

select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- 1. A gig keeps moderation status and lifecycle separate
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_gig uuid;
  v_state public.gig_state;
  v_payment text;
  v_skills text[];
begin
  insert into public.gigs
    (creator_id, title, description, category, skills, payment_type, compensation, deadline, contact_details)
  values
    (public.current_profile_id(), 'Maths tutoring for first year',
     'Two sessions a week before the mid-semester exam, library discussion room.',
     'Tutoring', array['Calculus', 'Linear algebra'], 'paid', '₹500 per session',
     current_date + 14, 'Tell me your branch, year and the topics you are stuck on.')
  returning id, state, payment_type, skills into v_gig, v_state, v_payment, v_skills;

  perform public.test_assert(v_state = 'open', '1. a new gig must be open for applications');
  perform public.test_assert(v_payment = 'paid', '1. payment_type must be stored as submitted');
  perform public.test_assert(v_skills @> array['Calculus'], '1. required skills must be stored as a text array');
  perform public.test_assert(
    (select status from public.gigs where id = v_gig) = 'published',
    '1. a gig must start published (the platform is post-moderated)'
  );

  perform set_config('campus.test.gig', v_gig::text, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Applications: who may apply, who may read, who may decide
-- ---------------------------------------------------------------------------

-- The owner cannot apply to their own gig.
do $$
begin
  perform public.test_assert_denied(
    format(
      $sql$insert into public.gig_applications (gig_id, applicant_id, message)
           values (%L::uuid, public.current_profile_id(), 'I would like to take this gig on.')$sql$,
      current_setting('campus.test.gig')::uuid
    ),
    '2. posting a gig must not allow applying to it'
  );
end;
$$;

select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000002', false);

do $$
declare
  v_gig uuid := current_setting('campus.test.gig')::uuid;
  v_application uuid;
begin
  insert into public.gig_applications (gig_id, applicant_id, message)
  values (v_gig, public.current_profile_id(), 'I topped calculus last semester and can do weekday evenings.')
  returning id into v_application;

  perform public.test_assert(v_application is not null, '2. an active student must be able to apply to an open gig');
  perform public.test_assert(
    (select status from public.gig_applications where id = v_application) = 'pending',
    '2. a new application must be pending'
  );

  perform public.test_assert_denied(
    format(
      $sql$insert into public.gig_applications (gig_id, applicant_id, message)
           values (%L::uuid, public.current_profile_id(), 'Applying twice to the same gig.')$sql$,
      v_gig
    ),
    '2. one student must not be able to apply twice to the same gig'
  );

  perform public.test_assert_denied(
    format($sql$update public.gig_applications set status = 'accepted' where id = %L::uuid$sql$, v_application),
    '2. an applicant must not be able to accept their own application'
  );

  perform set_config('campus.test.application', v_application::text, false);
end;
$$;

-- A third student sees nothing, even with the gig id.
select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000003', false);

do $$
declare
  v_seen integer;
  v_gig uuid := current_setting('campus.test.gig')::uuid;
begin
  select count(*) into v_seen from public.gig_applications where gig_id = v_gig;
  perform public.test_assert(v_seen = 0, '2. an unrelated student must not see another student''s applications');

  insert into public.gig_applications (gig_id, applicant_id, message)
  values (v_gig, public.current_profile_id(), 'I can help with calculus and linear algebra.');

  perform set_config('campus.test.application_3', (
    select id::text from public.gig_applications where gig_id = v_gig and applicant_id = public.current_profile_id()
  ), false);
end;
$$;

select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_count integer;
  v_gig uuid := current_setting('campus.test.gig')::uuid;
  v_app uuid := current_setting('campus.test.application_3')::uuid;
begin
  select count(*) into v_count from public.gig_applications where gig_id = v_gig;
  perform public.test_assert(v_count = 2, '2. the gig owner must see every application for their gig');

  update public.gig_applications set status = 'accepted' where id = v_app;
  perform public.test_assert(
    (select status from public.gig_applications where id = v_app) = 'accepted',
    '2. the gig owner must be able to accept an application'
  );
  perform public.test_assert(
    (select decided_by from public.gig_applications where id = v_app) = public.current_profile_id(),
    '2. the decision must record who made it'
  );
end;
$$;

-- The applicant sees the decision; the outsider still sees only their own.
select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000003', false);
do $$
begin
  perform public.test_assert(
    (select count(*) from public.gig_applications) = 1,
    '2. an applicant must see exactly their own application'
  );
  perform public.test_assert(
    (select status from public.gig_applications) = 'accepted',
    '2. an applicant must see the owner''s decision'
  );
end;
$$;

-- Withdrawal is the applicant's own transition and nothing else.
select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000002', false);
do $$
declare
  v_app uuid := current_setting('campus.test.application')::uuid;
begin
  update public.gig_applications set status = 'withdrawn' where id = v_app;
  perform public.test_assert(
    (select status from public.gig_applications where id = v_app) = 'withdrawn',
    '2. an applicant must be able to withdraw a pending application'
  );
  -- RLS filters the row out of the UPDATE entirely (no error, zero rows), so
  -- the assertion is on the stored status rather than on an exception.
  update public.gig_applications set status = 'accepted' where id = v_app;
  perform public.test_assert(
    (select status from public.gig_applications where id = v_app) = 'withdrawn',
    '2. a withdrawn application must not become accepted'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Lifecycle: closed and completed gigs take no new applications
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_gig uuid := current_setting('campus.test.gig')::uuid;
begin
  update public.gigs set state = 'closed' where id = v_gig;
  perform public.test_assert(
    (select state from public.gigs where id = v_gig) = 'closed',
    '3. the owner must be able to close their gig'
  );
end;
$$;

select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000002', false);
do $$
declare
  v_gig uuid := current_setting('campus.test.gig')::uuid;
begin
  perform public.test_assert_denied(
    format(
      $sql$insert into public.gig_applications (gig_id, applicant_id, message)
           values (%L::uuid, public.current_profile_id(), 'Applying to a closed gig must fail.')$sql$,
      v_gig
    ),
    '3. a closed gig must not accept applications'
  );
end;
$$;

-- A different student cannot move someone else's gig, and cannot rewrite it.
select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000003', false);
do $$
declare
  v_gig uuid := current_setting('campus.test.gig')::uuid;
  v_before text;
begin
  select title into v_before from public.gigs where id = v_gig;
  update public.gigs set state = 'open', title = 'Hijacked gig' where id = v_gig;
  perform public.test_assert(
    (select state from public.gigs where id = v_gig) = 'closed',
    '3. only the poster may reopen a gig'
  );
  perform public.test_assert(
    (select title from public.gigs where id = v_gig) = v_before,
    '3. only the poster may edit a gig'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Clubs: category, official status, and the insert guard
-- ---------------------------------------------------------------------------
-- A student without manage_clubs cannot create a club at all.
select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000002', false);
do $$
begin
  perform public.test_assert_denied(
    $sql$insert into public.communities (kind, name, slug, description, club_category, created_by)
         values ('club', 'Unauthorised Club', 'unauthorised-club', 'A club a student tried to create.', 'Technical', public.current_profile_id())$sql$,
    '4. only staff with manage_clubs may create a club'
  );
  perform public.test_assert_denied(
    $sql$select public.create_club_with_admin('gig_owner', jsonb_build_object(
      'name', 'Unauthorised RPC Club', 'slug', 'unauthorised-rpc-club',
      'description', 'A student cannot call the protected club creation function.',
      'club_category', 'Technical', 'organization_type', 'technical_club'))$sql$,
    '4. the protected creation RPC must also reject a student'
  );
end;
$$;

-- A student cannot mint official content either.
do $$
begin
  perform public.test_assert_denied(
    $sql$insert into public.communities (kind, name, slug, description, is_official, created_by)
         values ('community', 'Pretend Official Space', 'pretend-official-space', 'A student attempt at an official label.', true, public.current_profile_id())$sql$,
    '4. a student must not be able to publish official content'
  );
end;
$$;

select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000004', false);

do $$
declare
  v_club uuid;
  v_approved_by uuid;
  v_result jsonb;
begin
  -- Direct INSERT is no longer the staff creation path either. The protected
  -- RPC validates an exact active username and creates the owner atomically.
  v_result := public.create_club_with_admin('gig_owner', jsonb_build_object(
    'name', 'Robotics and Automation Club',
    'slug', 'robotics-and-automation-club',
    'description', 'Builds competition robots and runs weekly workshops in the robotics lab.',
    'club_category', 'Technical',
    'organization_type', 'technical_club',
    'subject', 'Robotics, embedded systems',
    'recruitment_info', 'Open to first and second year students.'
  ));
  v_club := (v_result->>'id')::uuid;
  select approved_by into v_approved_by from public.communities where id = v_club;

  perform public.test_assert(v_club is not null, '4. staff with manage_clubs must be able to create a club through the protected workflow');
  perform public.test_assert(
    v_approved_by = public.current_profile_id(),
    '4. an official club must record who approved it'
  );
  perform public.test_assert(
    (select admin_assigned from public.communities where id = v_club),
    '4. the selected active administrator must become the initial owner'
  );
  perform public.test_assert(
    (select club_category from public.communities where id = v_club) = 'Technical',
    '4. the discovery category must be stored'
  );

  perform set_config('campus.test.club', v_club::text, false);
end;
$$;

-- The category list is closed, and only clubs carry one.
do $$
begin
  perform public.test_assert_denied(
    $sql$insert into public.communities (kind, name, slug, description, club_category, is_official, created_by)
         values ('club', 'Astrology Club', 'astrology-club', 'A category that is not on the campus list.', 'Astrology', true, public.current_profile_id())$sql$,
    '4. a category outside the six campus categories must be rejected'
  );
  perform public.test_assert_denied(
    $sql$insert into public.communities (kind, name, slug, description, club_category, created_by)
         values ('community', 'Technical Topics', 'technical-topics', 'A community carrying a club category.', 'Technical', public.current_profile_id())$sql$,
    '4. only kind = club may carry a club category'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Club edits: managers only, category included
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000001', false);
do $$
declare
  v_club uuid := current_setting('campus.test.club')::uuid;
begin
  update public.communities set club_category = 'Entrepreneurship' where id = v_club;
  perform public.test_assert(
    (select club_category from public.communities where id = v_club) = 'Entrepreneurship',
    '5. the club owner must be able to change the discovery category'
  );
end;
$$;

select set_config('request.jwt.claim.sub', '96000000-0000-4000-a000-000000000002', false);
do $$
declare
  v_club uuid := current_setting('campus.test.club')::uuid;
begin
  update public.communities set club_category = 'Sports', name = 'Hijacked Club' where id = v_club;
  perform public.test_assert(
    (select club_category from public.communities where id = v_club) = 'Entrepreneurship',
    '5. a non-manager must not change a club category'
  );
  perform public.test_assert(
    (select name from public.communities where id = v_club) = 'Robotics and Automation Club',
    '5. a non-manager must not rename a club'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The club board is discoverable by category and interest
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
reset role;

do $$
declare
  v_by_category integer;
  v_by_interest integer;
begin
  select count(*) into v_by_category
  from public.communities
  where kind = 'club' and status = 'published' and club_category = 'Entrepreneurship';

  select count(*) into v_by_interest
  from public.communities
  where kind = 'club' and (subject ilike '%embedded%' or name ilike '%robotics%');

  perform public.test_assert(v_by_category >= 1, '6. clubs must be filterable by their discovery category');
  perform public.test_assert(v_by_interest >= 1, '6. clubs must be searchable by name and interest');
end;
$$;
