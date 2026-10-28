-- =============================================================================
-- Campus+ database tests — 17 club governance, catalogue and lifecycle
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('97000000-0000-4000-a000-000000000001', 'club.requester@pccoepune.org'),
  ('97000000-0000-4000-a000-000000000002', 'club.initial.admin@pccoepune.org'),
  ('97000000-0000-4000-a000-000000000003', 'club.moderator@pccoepune.org'),
  ('97000000-0000-4000-a000-000000000004', 'club.outsider@pccoepune.org'),
  ('97000000-0000-4000-a000-000000000005', 'club.platform.admin@pccoepune.org')
on conflict (id) do nothing;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('97000000-0000-4000-a000-000000000001', 'club_requester', 'Club Requester'),
    ('97000000-0000-4000-a000-000000000002', 'initial_admin', 'Initial Club Admin'),
    ('97000000-0000-4000-a000-000000000003', 'club_mod', 'Club Moderator'),
    ('97000000-0000-4000-a000-000000000004', 'club_outsider', 'Club Outsider'),
    ('97000000-0000-4000-a000-000000000005', 'platform_admin', 'Platform Club Admin')
  ) as t(id, username, name)
  loop
    perform set_config('request.jwt.claim.sub', r.id, false);
    perform public.complete_profile(p_username => r.username, p_display_name => r.name,
      p_branch => 'Computer Engineering', p_year => 'Third Year');
  end loop;
end;
$$;
select public.grant_role((select id from public.profiles where username = 'platform_admin'), 'admin');
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- 1. Catalogue: 35 unique rows, no fabricated people or activity
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.test_assert(
    (select count(*) from public.communities where catalogue_key is not null) = 35,
    '1. the supplied roster reconciles to exactly 35 unique organizations including Campus+'
  );
  perform public.test_assert(
    (select count(*) from public.communities where catalogue_key is not null and created_by is null) = 35,
    '1. imported organizations have no fabricated creator'
  );
  perform public.test_assert(
    (select count(*) from public.communities where catalogue_key is not null and not admin_assigned) = 35,
    '1. imported organizations begin in the explicit admin-assignment-needed state'
  );
  perform public.test_assert(
    not exists (
      select 1 from public.community_members m
      join public.communities c on c.id = m.community_id
      where c.catalogue_key is not null
    ),
    '1. catalogue import must not fabricate memberships'
  );
  perform public.test_assert(
    (select count(*) from public.communities where catalogue_key is not null and verification_status = 'pending') = 8,
    '1. unsupported entries stay pending instead of inventing verification'
  );
  perform public.test_assert(
    (select slug from public.communities where catalogue_key = 'gdg-campus') = 'gdg-campus'
    and (select directory_aliases from public.communities where catalogue_key = 'gdg-campus') ilike '%GDSC%',
    '1. GDG/GDSC aliases reconcile on one catalogue row'
  );
  perform set_config('campus.test.imported_club',
    (select id::text from public.communities where catalogue_key = 'campus-plus'), false);
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000001', false);

-- ---------------------------------------------------------------------------
-- 2. A student can request, never directly create or approve, an official club
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.test_assert_denied(
    $sql$insert into public.communities (kind, name, slug, description, club_category, created_by)
         values ('club', 'Direct Student Club', 'direct-student-club', 'A direct club insert that must fail.', 'Technical', public.current_profile_id())$sql$,
    '2. direct student club INSERT is denied'
  );
  perform public.test_assert_denied(
    $sql$select public.create_club_with_admin('initial_admin', jsonb_build_object(
      'name', 'RPC Student Club', 'slug', 'rpc-student-club',
      'description', 'A direct club RPC call that must fail.',
      'club_category', 'Technical', 'organization_type', 'technical_club'))$sql$,
    '2. the protected creation RPC independently rejects students'
  );
end;
$$;

do $$
declare
  v_request uuid;
begin
  insert into public.club_creation_requests (
    requester_id, name, slug, description, club_category, organization_type,
    proposed_admin_username, status, community_id
  ) values (
    public.current_profile_id(), 'Lifecycle Robotics Club', 'lifecycle-robotics-club',
    'A student proposal used to verify transactional review and membership.',
    'Technical', 'technical_club', 'platform_admin', 'approved',
    current_setting('campus.test.imported_club')::uuid
  ) returning id into v_request;

  perform public.test_assert(
    (select status from public.club_creation_requests where id = v_request) = 'pending'
    and (select community_id from public.club_creation_requests where id = v_request) is null,
    '2. requester-supplied review fields are forced back to pending/null'
  );
  perform public.test_assert_denied(
    format($sql$select public.approve_club_request(%L::uuid, 'initial_admin', null)$sql$, v_request),
    '2. a requester cannot approve their own request'
  );
  perform set_config('campus.test.club_request', v_request::text, false);
end;
$$;

select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000004', false);
do $$
begin
  perform public.test_assert(
    (select count(*) from public.club_creation_requests
      where id = current_setting('campus.test.club_request')::uuid) = 0,
    '2. an unrelated student cannot read another student''s club request'
  );
end;
$$;

select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000005', false);
do $$
declare
  v_request uuid := current_setting('campus.test.club_request')::uuid;
  v_result jsonb;
  v_club uuid;
  v_audit_count integer;
begin
  perform public.test_assert_denied(
    format($sql$select public.approve_club_request(%L::uuid, 'platform_admin', null)$sql$, v_request),
    '2. approval cannot appoint a privileged platform account'
  );
  perform public.test_assert_denied(
    format($sql$select public.approve_club_request(%L::uuid, 'missing_active_user', null)$sql$, v_request),
    '2. approval requires an exact active username'
  );
  perform public.test_assert(
    (select status from public.club_creation_requests where id = v_request) = 'pending'
    and not exists (select 1 from public.communities where slug = 'lifecycle-robotics-club'),
    '2. failed validation leaves no partial club or review'
  );

  v_result := public.approve_club_request(v_request, 'initial_admin', 'Verified in the lifecycle test.');
  v_club := (v_result->>'id')::uuid;
  perform public.test_assert(v_club is not null, '2. an administrator can approve with an eligible active student');
  perform public.test_assert(
    (select count(*) from public.communities where slug = 'lifecycle-robotics-club') = 1,
    '2. approval creates exactly one club'
  );
  perform public.test_assert(
    (select count(*) from public.community_members
      where community_id = v_club and role = 'owner' and status = 'active'
      and user_id = (select id from public.profiles where username = 'initial_admin')) = 1,
    '2. approval assigns exactly one active initial owner'
  );
  perform public.test_assert(
    not exists (select 1 from public.community_members
      where community_id = v_club and user_id = (select id from public.profiles where username = 'club_requester')),
    '2. the requester is not automatically made a member or owner'
  );
  perform public.test_assert(
    (select created_by from public.communities where id = v_club) = (select id from public.profiles where username = 'platform_admin')
    and (select admin_assigned from public.communities where id = v_club),
    '2. reviewer provenance does not replace the selected owner'
  );
  perform public.test_assert(public.role_rank((select id from public.profiles where username = 'initial_admin')) < 10,
    '2. club ownership grants no platform staff rank');

  select count(*) into v_audit_count from public.audit_logs where action = 'club.request_approved' and target_id = v_club;
  v_result := public.approve_club_request(v_request, 'initial_admin', 'A retry must not duplicate anything.');
  perform public.test_assert((v_result->>'id')::uuid = v_club and (v_result->>'idempotent')::boolean,
    '2. approval retry returns the original club idempotently');
  perform public.test_assert(
    (select count(*) from public.communities where slug = 'lifecycle-robotics-club') = 1
    and (select count(*) from public.community_members where community_id = v_club and role = 'owner') = 1
    and (select count(*) from public.audit_logs where action = 'club.request_approved' and target_id = v_club) = v_audit_count,
    '2. retry adds no club, owner or audit duplicate'
  );
  perform set_config('campus.test.approved_club', v_club::text, false);
end;
$$;

-- Withdrawal is owner-only and idempotent; rejection is review-only.
select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000001', false);
do $$
declare
  v_request uuid;
begin
  insert into public.club_creation_requests (
    requester_id, name, slug, description, club_category, organization_type
  ) values (
    public.current_profile_id(), 'Withdrawn Club Proposal', 'withdrawn-club-proposal',
    'A second proposal used to verify safe withdrawal.',
    'Arts', 'creative_group'
  ) returning id into v_request;
  perform set_config('campus.test.withdraw_request', v_request::text, false);
end;
$$;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000004', false);
select public.test_assert_denied(
  format($sql$select public.withdraw_club_request(%L::uuid)$sql$, current_setting('campus.test.withdraw_request')::uuid),
  '2. another student cannot withdraw a request'
);
select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000001', false);
do $$
declare v_result jsonb;
begin
  v_result := public.withdraw_club_request(current_setting('campus.test.withdraw_request')::uuid);
  perform public.test_assert(v_result->>'status' = 'withdrawn', '2. requester can withdraw a pending request');
  v_result := public.withdraw_club_request(current_setting('campus.test.withdraw_request')::uuid);
  perform public.test_assert((v_result->>'idempotent')::boolean, '2. withdrawal retry is idempotent');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Imported clubs block joins until a real owner is assigned
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000004', false);
select public.test_assert_denied(
  format($sql$select public.join_community(%L::uuid, null)$sql$, current_setting('campus.test.imported_club')::uuid),
  '3. an unassigned imported club cannot accept members or requests'
);

select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000005', false);
do $$
declare v_result jsonb;
begin
  v_result := public.assign_club_admin(current_setting('campus.test.imported_club')::uuid, 'club_mod');
  perform public.test_assert(v_result->>'ok' = 'true', '3. staff can assign a real active initial admin');
  perform public.test_assert(
    (select admin_assigned from public.communities where id = current_setting('campus.test.imported_club')::uuid),
    '3. active owner membership derives the assigned state'
  );
end;
$$;

select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000004', false);
do $$
declare
  v_result jsonb;
  v_club uuid := current_setting('campus.test.imported_club')::uuid;
begin
  v_result := public.join_community(v_club, 'I would like to participate.');
  perform public.test_assert(v_result->>'status' = 'pending', '3. request-policy join creates a pending request');
  v_result := public.join_community(v_club, 'A duplicate click must not duplicate the request.');
  perform public.test_assert((v_result->>'idempotent')::boolean, '3. repeated join request is idempotent');
  perform public.test_assert(
    (select count(*) from public.community_join_requests where community_id = v_club and user_id = public.current_profile_id()) = 1
    and not exists (select 1 from public.community_members where community_id = v_club and user_id = public.current_profile_id()),
    '3. pending state lives in join_requests, not a divergent membership row'
  );
end;
$$;

select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000003', false);
do $$
declare
  v_request uuid;
  v_result jsonb;
  v_club uuid := current_setting('campus.test.imported_club')::uuid;
begin
  select id into v_request from public.community_join_requests
   where community_id = v_club and user_id = (select id from public.profiles where username = 'club_outsider');
  v_result := public.decide_community_join_request(v_request, 'approved');
  perform public.test_assert(v_result->>'status' = 'approved', '3. club owner can approve a join request');
  perform public.test_assert(
    (select status from public.community_members where community_id = v_club and user_id = (select id from public.profiles where username = 'club_outsider')) = 'active',
    '3. atomic approval creates the active membership'
  );
  v_result := public.decide_community_join_request(v_request, 'approved');
  perform public.test_assert((v_result->>'idempotent')::boolean, '3. repeated decision is idempotent');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Owner protection and club-scoped management
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000001', false);
select public.join_community(current_setting('campus.test.approved_club')::uuid, 'Membership for role tests.');
select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000004', false);
select public.join_community(current_setting('campus.test.approved_club')::uuid, 'Future moderator membership.');
select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000002', false);
do $$
declare
  v_club uuid := current_setting('campus.test.approved_club')::uuid;
  v_request uuid;
begin
  for v_request in select id from public.community_join_requests where community_id = v_club and status = 'pending' loop
    perform public.decide_community_join_request(v_request, 'approved');
  end loop;
  perform public.set_community_member_role(v_club, (select id from public.profiles where username = 'club_outsider'), 'moderator');
end;
$$;

select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000004', false);
do $$
declare
  v_club uuid := current_setting('campus.test.approved_club')::uuid;
begin
  perform public.test_assert_denied(
    format($sql$select public.set_community_member_role(%L::uuid, (select id from public.profiles where username = 'initial_admin'), 'member')$sql$, v_club),
    '4. a moderator cannot demote an owner through the RPC'
  );
  perform public.test_assert_denied(
    format($sql$select public.remove_community_member(%L::uuid, (select id from public.profiles where username = 'initial_admin'))$sql$, v_club),
    '4. a moderator cannot remove an owner through the RPC'
  );
  perform public.test_assert_denied(
    format($sql$update public.community_members set role = 'member'
      where community_id = %L::uuid and user_id = (select id from public.profiles where username = 'initial_admin')$sql$, v_club),
    '4. direct SQL cannot demote an owner either'
  );
  perform public.test_assert_denied(
    format($sql$delete from public.community_members
      where community_id = %L::uuid and user_id = (select id from public.profiles where username = 'initial_admin')$sql$, v_club),
    '4. direct SQL cannot delete an owner either'
  );
  perform public.test_assert_denied(
    format($sql$select public.update_club_profile(%L::uuid, jsonb_build_object(
      'name', 'Cross Club Hijack', 'description', 'A moderator of another club cannot edit this one.',
      'club_category', 'Social', 'organization_type', 'platform_community'))$sql$,
      current_setting('campus.test.imported_club')::uuid),
    '4. a moderator of one club has no management authority over another'
  );
end;
$$;

select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000002', false);
do $$
declare
  v_club uuid := current_setting('campus.test.approved_club')::uuid;
begin
  perform public.test_assert_denied(
    format($sql$select public.set_community_member_role(%L::uuid, public.current_profile_id(), 'member')$sql$, v_club),
    '4. an owner cannot demote themselves through member controls'
  );
  perform public.test_assert_denied(
    format($sql$delete from public.community_members
      where community_id = %L::uuid and user_id = public.current_profile_id()$sql$, v_club),
    '4. an owner cannot leave by deleting the protected owner row'
  );
  perform public.test_assert(
    (select count(*) from public.audit_logs where target_type = 'club' and target_id = v_club) >= 1,
    '4. the owner can read audit entries scoped to their own club'
  );
  perform public.test_assert(
    (select count(*) from public.audit_logs where target_type = 'club'
      and target_id = current_setting('campus.test.imported_club')::uuid) = 0,
    '4. the owner cannot read audit entries for an unrelated club'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Linked events/opportunities require management of that exact club
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000001', false);
do $$
declare v_club uuid := current_setting('campus.test.approved_club')::uuid;
begin
  perform public.test_assert_denied(format(
    $sql$insert into public.events (title, description, starts_on, location, club_id, status, is_official, created_by)
      values ('Unauthorized club event', 'A member who is not a manager cannot link this.', current_date + 10,
      'Room 1', %L::uuid, 'draft', false, public.current_profile_id())$sql$, v_club),
    '5. an ordinary club member cannot create club-linked event content');
  perform public.test_assert_denied(format(
    $sql$insert into public.opportunities (title, organization, description, url, club_id, source, status, created_by)
      values ('Unauthorized club opportunity', 'Lifecycle Robotics Club', 'A member who is not a manager cannot link this.',
      'https://github.com', %L::uuid, 'community', (case when public.community_submissions_require_review('opportunity') then 'pending' else 'published' end)::public.content_status, public.current_profile_id())$sql$, v_club),
    '5. an ordinary club member cannot create club-linked opportunities');
end;
$$;

select set_config('request.jwt.claim.sub', '97000000-0000-4000-a000-000000000004', false);
do $$
declare
  v_club uuid := current_setting('campus.test.approved_club')::uuid;
  v_event uuid;
  v_opportunity uuid;
begin
  insert into public.events (title, description, starts_on, location, club_id, status, is_official, created_by)
  values ('Authorized club event', 'A club moderator can submit this draft.', current_date + 10,
    'Room 1', v_club, 'draft', false, public.current_profile_id()) returning id into v_event;
  perform public.test_assert(v_event is not null, '5. a moderator can submit an event for their own club');

  insert into public.opportunities (title, organization, description, url, club_id, source, status, created_by)
  values ('Authorized club opportunity', 'Lifecycle Robotics Club', 'A club moderator can submit this opportunity.',
    'https://github.com', v_club, 'community', (case when public.community_submissions_require_review('opportunity') then 'pending' else 'published' end)::public.content_status, public.current_profile_id()) returning id into v_opportunity;
  perform public.test_assert(v_opportunity is not null, '5. a moderator can submit an opportunity for their own club');

  perform public.test_assert_denied(format(
    $sql$insert into public.events (title, description, starts_on, location, club_id, status, is_official, created_by)
      values ('Cross club event', 'Membership in another club is not management authority.', current_date + 10,
      'Room 1', %L::uuid, 'draft', false, public.current_profile_id())$sql$,
      current_setting('campus.test.imported_club')::uuid),
    '5. managing one club does not authorize content for another');
end;
$$;
