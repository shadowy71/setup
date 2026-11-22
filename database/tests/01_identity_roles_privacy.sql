-- =============================================================================
-- Campus+ database tests — 01 identity, roles, permissions, profile privacy
-- =============================================================================
-- Run with:
--   supabase db execute --file database/tests/01_identity_roles_privacy.sql
-- or via `node scripts/dev/validate-migrations.mjs` (disposable local Postgres).
--
-- Fixtures use fixed UUIDs so the file is repeatable and self-contained.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Fixtures (executed with the trusted service-role context, like a maintenance
-- script). `request.jwt.claim.role` is what makes is_trusted_writer() true.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-a000-000000000001', 'aarav@pccoepune.org', '{}'::jsonb),
  ('a0000000-0000-4000-a000-000000000002', 'sneha@pccoepune.org', '{}'::jsonb),
  ('a0000000-0000-4000-a000-000000000003', 'ishaan@pccoepune.org', '{}'::jsonb)
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-a000-000000000001', false);
select public.complete_profile('aarav', 'Aarav Sharma', 'Third year computer engineering.', 'Computer Engineering', 'Third Year', 'A');

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-a000-000000000002', false);
select public.complete_profile('sneha_mod', 'Sneha Patil', 'Moderator.', 'Information Technology', 'Final Year', 'B');

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-a000-000000000003', false);
select public.complete_profile('ishaan', 'Ishaan Rao', null, 'Mechanical Engineering', 'Second Year', 'C');

-- Promote Sneha to Moderator the way an operator would (trusted writer path).
insert into public.user_roles (user_id, role_key, granted_by)
select p.id, 'moderator', null from public.profiles p where p.username = 'sneha_mod'
on conflict (user_id, role_key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. The auth trigger created exactly one profile per auth user, and the
--    baseline student role, and no username yet.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
  v_students integer;
begin
  select count(*) into v_count from public.profiles where username is not null;
  perform public.test_assert(v_count = 3, 'three profiles should have claimed usernames');

  select count(*) into v_students
  from public.user_roles ur join public.roles r on r.key = ur.role_key
  where r.key = 'student';
  perform public.test_assert(v_students = 3, 'every profile should hold the student role by default');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A student can read their own private row but not another student's email.
-- ---------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_own integer;
  v_others integer;
  v_email_columns integer;
begin
  select count(*) into v_own from public.profile_private where profile_id = public.current_profile_id();
  perform public.test_assert(v_own = 1, 'a student must be able to read their own private profile row');

  select count(*) into v_others
  from public.profile_private
  where profile_id <> public.current_profile_id();
  perform public.test_assert(v_others = 0, 'a student must NOT be able to read other students private rows');

  -- The institutional email is stored exactly once, in Supabase Auth. No copy
  -- may exist anywhere in the API schema (spec §81, §86).
  select count(*) into v_email_columns
  from information_schema.columns
  where table_schema = 'public'
    and column_name ~ 'email'
    and table_name <> 'colleges';
  perform public.test_assert(v_email_columns = 0,
    'the public schema must not store any student email address');
end;
$$;

-- The public projection carries no private columns at all.
do $$
declare
  v_columns text;
  v_rows integer;
begin
  select string_agg(column_name, ',' order by column_name) into v_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'public_profiles';

  perform public.test_assert(v_columns not like '%email%', 'public_profiles must not expose an email column');
  perform public.test_assert(v_columns not like '%auth_user_id%', 'public_profiles must not expose auth identifiers');

  select count(*) into v_rows from public.public_profiles where username = 'ishaan';
  perform public.test_assert(v_rows = 1, 'public_profiles must expose other students'' public identity');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Permission resolution: student vs moderated role.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.test_assert(public.has_permission('create_posts'), 'a student holds create_posts');
  perform public.test_assert(public.has_permission('send_messages'), 'a student holds send_messages');
  perform public.test_assert(not public.has_permission('review_reports'), 'a student must not hold review_reports');
  perform public.test_assert(not public.has_permission('manage_users'), 'a student must not hold manage_users');
  perform public.test_assert(not public.has_permission('view_audit_logs'), 'a student must not read audit logs');
  perform public.test_assert(not public.has_permission('view_random_sessions'), 'a student must never unmask Random sessions');
  perform public.test_assert(not public.is_staff(), 'a student is not staff');
end;
$$;

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-a000-000000000002', false);
do $$
begin
  perform public.test_assert(public.has_permission('review_reports'), 'a moderator holds review_reports');
  perform public.test_assert(public.has_permission('remove_posts'), 'a moderator holds remove_posts');
  perform public.test_assert(public.is_staff(), 'a moderator is staff');
  perform public.test_assert(not public.has_permission('assign_roles'), 'a moderator must NOT assign roles');
  perform public.test_assert(not public.has_permission('view_audit_logs'), 'a moderator must NOT read the audit log');
  perform public.test_assert(not public.has_permission('manage_platform_settings'), 'a moderator must NOT change platform settings');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A student cannot grant themselves a role (spec: "Student cannot assign
--    themselves Moderator").
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-a000-000000000001', false);
select public.test_assert_denied(
  $sql$insert into public.user_roles (user_id, role_key)
       select id, 'moderator' from public.profiles where username = 'aarav'$sql$,
  'a student must not be able to insert a moderator role for themselves'
);

select public.test_assert_denied(
  $sql$insert into public.user_roles (user_id, role_key)
       select id, 'admin' from public.profiles where username = 'aarav'$sql$,
  'a student must not be able to insert an admin role for themselves'
);

-- Even a moderator cannot hand out authority.
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-a000-000000000002', false);
select public.test_assert_denied(
  $sql$insert into public.user_roles (user_id, role_key)
       select id, 'admin' from public.profiles where username = 'ishaan'$sql$,
  'a moderator must not be able to grant the admin role'
);

-- ---------------------------------------------------------------------------
-- 5. A student cannot change their own account status or reputation.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-a000-000000000001', false);

-- Column privileges make these columns unwritable by any client, so PostgreSQL
-- rejects the statement outright (rather than a policy silently filtering it).
select public.test_assert_denied(
  $sql$update public.profile_private set account_status = 'banned' where profile_id = public.current_profile_id()$sql$,
  'a student must not be able to ban themselves through a direct update'
);
select public.test_assert_denied(
  $sql$update public.profile_private set profile_completed = false where profile_id = public.current_profile_id()$sql$,
  'a student must not be able to reset their own onboarding state'
);
select public.test_assert_denied(
  $sql$update public.profiles set reputation_score = 5, reputation_count = 999 where id = public.current_profile_id()$sql$,
  'a student must not be able to inflate their own reputation'
);
select public.test_assert_denied(
  $sql$update public.profiles set college_id = null where id = public.current_profile_id()$sql$,
  'a student must not be able to move themselves to another college'
);
select public.test_assert_denied(
  $sql$update public.posts set status = 'published' where false$sql$,
  'students must not be able to write post moderation state at all'
);
select public.test_assert_denied(
  $sql$update public.platform_settings set value = '"open"'::jsonb where key = 'allowed_email_domains'$sql$,
  'a student must not be able to change platform settings'
);

-- Legitimate profile edits still work.
update public.profiles set bio = 'Updated bio' where id = public.current_profile_id();
do $$
declare
  v_bio text;
begin
  select bio into v_bio from public.profiles where id = public.current_profile_id();
  perform public.test_assert(v_bio = 'Updated bio', 'a student must be able to edit their own bio');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Username rules: uniqueness, reserved names, format.
-- ---------------------------------------------------------------------------
select public.test_assert_denied(
  $sql$select public.complete_profile('sneha_mod', 'Impostor')$sql$,
  'an already-claimed username must be rejected'
);
select public.test_assert_denied(
  $sql$select public.complete_profile('admin', 'Not Allowed')$sql$,
  'reserved usernames must be rejected'
);
select public.test_assert_denied(
  $sql$select public.complete_profile('Has Spaces', 'Nope')$sql$,
  'usernames with spaces must be rejected'
);
select public.test_assert_denied(
  $sql$select public.complete_profile('12345', 'Nope')$sql$,
  'all-numeric usernames must be rejected'
);
select public.test_assert_denied(
  $sql$select public.complete_profile('aarav2', 'Rename')$sql$,
  'an existing username must not be changeable through complete_profile'
);

-- ---------------------------------------------------------------------------
-- 7. Audit logs and reports are not readable by students.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.audit_logs;
  perform public.test_assert(v_rows = 0, 'a student must not read audit logs');
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- 8. The domain gate classifies foreign email addresses at insert time.
-- ---------------------------------------------------------------------------
-- Migration 080 replaced outright rejection with classification: a personal
-- address is provisioned as an external visitor (suite 24 covers that contract
-- in full), and can never obtain student access. What must NOT change is that
-- an institutional-looking domain still resolves only for the real institution.
do $$
declare
  v_type public.account_type;
  v_college uuid;
begin
  insert into auth.users (id, email)
  values ('b0000000-0000-4000-a000-000000000009', 'outsider@gmail.com');

  select pp.account_type, pp.college_id into v_type, v_college
    from public.profile_private pp
   where pp.auth_user_id = 'b0000000-0000-4000-a000-000000000009';

  perform public.test_assert(v_type = 'visitor',
    'a non-institutional email must be classified as an external visitor');
  perform public.test_assert(v_college is null,
    'a non-institutional email must not be attached to a college');
end;
$$;

select public.test_assert(
  public.allowed_email_domain('someone@pccoepune.org'),
  'the configured institutional domain must be allowed'
);
select public.test_assert(
  not public.allowed_email_domain('someone@pccoepune.org.evil.com'),
  'a look-alike domain must not be allowed'
);

-- ---------------------------------------------------------------------------
-- 9. Suspension is enforced by the database, not by the interface.
-- ---------------------------------------------------------------------------
update public.profile_private
   set account_status = 'suspended', suspended_until = now() + interval '7 days'
 where profile_id = (select id from public.profiles where username = 'ishaan');

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-a000-000000000003', false);
do $$
begin
  perform public.test_assert(not public.is_active_user(), 'a suspended account is not an active user');
  perform public.test_assert(not public.has_permission('create_posts'), 'a suspended account loses its permissions');
end;
$$;

select public.test_assert_denied(
  $sql$insert into public.posts (author_id, body) values (public.current_profile_id(), 'Trying to post while suspended')$sql$,
  'a suspended account must not be able to create posts'
);

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

-- Suspension expiry restores the account.
select public.lift_expired_suspensions();
update public.profile_private set suspended_until = now() - interval '1 minute'
 where profile_id = (select id from public.profiles where username = 'ishaan');
select public.lift_expired_suspensions();
do $$
declare
  v_status public.account_status;
begin
  select account_status into v_status from public.profile_private
   where profile_id = (select id from public.profiles where username = 'ishaan');
  perform public.test_assert(v_status = 'active', 'lift_expired_suspensions() must restore an expired suspension');
end;
$$;
