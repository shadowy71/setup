-- =============================================================================
-- Campus+ database tests — 06 authentication and account lifecycle
-- =============================================================================
-- The authentication contract (spec §7, §8, §9, §81, §83, §86):
--
--   institutional email → passwordless OTP (Supabase Auth) → student profile
--
-- There is no PRN anywhere, no Campus+ password, and the institutional email is
-- never stored outside Supabase Auth. These tests drive the database side of
-- that contract: the domain gate on signup, provisioning, onboarding, username
-- rules, and what each account state is allowed to do.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The domain gate rejects non-institutional addresses before a profile exists
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_allowed integer;
begin
  perform public.test_assert(public.allowed_email_domain('student@pccoepune.org'),
    'an institutional address must pass the domain gate');
  perform public.test_assert(public.allowed_email_domain('Student@PCCOEPUNE.ORG'),
    'the domain check must be case-insensitive');
  perform public.test_assert(not public.allowed_email_domain('student@gmail.com'),
    'a personal address must fail the domain gate');
  perform public.test_assert(not public.allowed_email_domain('student@pccoepune.org.evil.com'),
    'a look-alike domain must fail the domain gate');
  perform public.test_assert(not public.allowed_email_domain('not-an-email'),
    'a malformed address must fail the domain gate');
  perform public.test_assert(not public.allowed_email_domain(null),
    'a missing address must fail the domain gate');
end;
$$;

-- Expected domain rejection is SQLSTATE 42501, not an arbitrary trigger error.
-- The inner PL/pgSQL block is a subtransaction: catching that expected error
-- rolls back only the rejected insert. The following SELECT runs in the same
-- outer transaction and would fail with 25P02 if recovery were incorrect. An
-- uncaught rejection still requires the Auth caller to roll back its own
-- transaction; the trigger must never return NULL and pretend signup succeeded.
do $$
begin
  begin
    insert into auth.users (id, email)
    values ('f0000000-0000-4000-a000-0000000000f1', 'outsider@gmail.com');
    raise exception 'ASSERTION FAILED (operation was allowed): a personal email address must not create an account';
  exception
    when sqlstate '42501' then
      perform public.test_assert(
        sqlerrm like 'Campus+ is limited to approved institutional email addresses%',
        'the expected rejection must come from the institutional-domain trigger, not an unrelated permission error'
      );
      perform public.test_assert(
        public.allowed_email_domain('recovery@pccoepune.org'),
        'SQL after an expected domain rejection must run cleanly after subtransaction rollback'
      );
    when others then
      raise;
  end;
end;
$$;

select public.test_assert_denied(
  $sql$insert into auth.users (id, email) values ('f0000000-0000-4000-a000-0000000000f2', 'outsider@pccoepune.org.evil.com')$sql$,
  'a look-alike domain must not be able to create an account'
);

do $$
declare
  v_leaked integer;
begin
  -- Earlier suites have their own accounts, so this checks the rejected auth ids
  -- specifically rather than counting the whole table.
  select count(*) into v_leaked
  from public.profile_private
  where auth_user_id in (
    'f0000000-0000-4000-a000-0000000000f1',
    'f0000000-0000-4000-a000-0000000000f2'
  );
  perform public.test_assert(v_leaked = 0, 'a rejected signup must not leave a profile behind');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A valid signup provisions exactly one profile, private row and role
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values ('f0000000-0000-4000-a000-000000000001', 'tanvi@pccoepune.org');

do $$
declare
  v_profile uuid;
  v_rows integer;
begin
  select pp.profile_id into v_profile
  from public.profile_private pp
  where pp.auth_user_id = 'f0000000-0000-4000-a000-000000000001';

  select count(*) into v_rows
  from public.profile_private pp
  where pp.auth_user_id = 'f0000000-0000-4000-a000-000000000001';
  perform public.test_assert(v_rows = 1, 'a valid signup must create exactly one private row');
  perform public.test_assert(v_profile is not null, 'a valid signup must create a profile');
  perform public.test_assert(
    (select count(*) from public.profile_private where profile_id = v_profile) = 1,
    'a valid signup must create exactly one private row'
  );
  perform public.test_assert(
    (select count(*) from public.user_roles where user_id = v_profile and role_key = 'student') = 1,
    'a new account must hold the student role automatically'
  );
  perform public.test_assert(
    (select username from public.profiles where id = v_profile) is null,
    'a new account must not have a username until onboarding'
  );
  perform public.test_assert(
    (select profile_completed from public.profile_private where profile_id = v_profile) = false,
    'a new account must start with onboarding incomplete'
  );
  perform public.test_assert(
    (select account_status from public.profile_private where profile_id = v_profile) = 'active',
    'a new account must start active'
  );
end;
$$;

-- Duplicate accounts: the same institutional email cannot register twice.
select public.test_assert_denied(
  $sql$insert into auth.users (id, email) values ('f0000000-0000-4000-a000-0000000000ff', 'tanvi@pccoepune.org')$sql$,
  'the same institutional email must not be able to register twice'
);

-- ---------------------------------------------------------------------------
-- 3. Onboarding: username rules, privacy and idempotency
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-a000-000000000001', false);
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);

do $$
begin
  perform public.test_assert_denied(
    $sql$select public.complete_profile(p_username => 'ta', p_display_name => 'Tanvi')$sql$,
    'a username shorter than the minimum must be rejected'
  );
  perform public.test_assert_denied(
    $sql$select public.complete_profile(p_username => 'tanvi.bhat', p_display_name => 'Tanvi')$sql$,
    'a username with punctuation must be rejected'
  );
  perform public.test_assert_denied(
    $sql$select public.complete_profile(p_username => 'admin', p_display_name => 'Tanvi')$sql$,
    'an impersonating username must be rejected'
  );
  perform public.test_assert_denied(
    $sql$select public.complete_profile(p_username => 'campus_plus', p_display_name => 'Tanvi')$sql$,
    'a platform-reserved username must be rejected'
  );

  -- Taken usernames are rejected case-insensitively.
  perform public.complete_profile(
    p_username => 'tanvi_b',
    p_display_name => 'Tanvi Bhat',
    p_branch => 'Computer Engineering',
    p_year => 'Second Year',
    p_division => 'A'
  );
  perform public.test_assert(
    (select username from public.profiles where id = public.current_profile_id()) = 'tanvi_b',
    'a valid username must be claimed'
  );
  perform public.test_assert(
    (select profile_completed from public.profile_private where profile_id = public.current_profile_id()),
    'onboarding must mark the profile complete'
  );
  perform public.test_assert(
    (select count(*) from public.username_history where user_id = public.current_profile_id()) = 1,
    'the first claimed username must be recorded in history'
  );
  perform public.test_assert(
    (select division from public.profiles where id = public.current_profile_id()) = 'A',
    'the onboarding division must be stored and retrievable'
  );

  -- Divisions run A through R: the newest division saves exactly like A did
  -- (the column is plain text, so this is a storage round-trip, not a schema
  -- change). This is the same direct profile update Settings performs.
  update public.profiles
     set division = 'R'
   where id = public.current_profile_id();
  perform public.test_assert(
    (select division from public.profiles where id = public.current_profile_id()) = 'R',
    'division R must be stored and retrievable'
  );
end;
$$;

-- A second student cannot take the same handle in a different case.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
insert into auth.users (id, email)
values ('f0000000-0000-4000-a000-000000000002', 'umair@pccoepune.org');
reset role;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-a000-000000000002', false);

do $$
begin
  perform public.test_assert_denied(
    $sql$select public.complete_profile(p_username => 'TANVI_B', p_display_name => 'Umair')$sql$,
    'usernames must be unique case-insensitively'
  );
  perform public.complete_profile(
    p_username => 'umair_s',
    p_display_name => 'Umair Shaikh',
    p_branch => 'Information Technology',
    p_year => 'Third Year',
    p_division => 'B'
  );
end;
$$;

-- Username changes respect the configurable cooldown (30 days by default).
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-a000-000000000001', false);

do $$
begin
  perform public.test_assert_denied(
    $sql$select public.change_username('tanvi_bhat')$sql$,
    'a username change inside the cooldown must be refused'
  );

  perform public.test_assert(
    public.username_change_available_at() is not null,
    'the cooldown must be queryable so the UI can explain the wait'
  );
end;
$$;

-- The public projection never exposes email, auth ids or account state.
do $$
declare
  v_columns text;
begin
  select string_agg(column_name, ',' order by column_name) into v_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'public_profiles';

  perform public.test_assert(v_columns not like '%email%', 'the public projection must not carry email');
  perform public.test_assert(v_columns not like '%auth_user%', 'the public projection must not carry auth identifiers');
  perform public.test_assert(v_columns not like '%account_status%', 'the public projection must not carry account state');
  perform public.test_assert(v_columns not like '%prn%', 'the public projection must not carry a PRN');
end;
$$;

-- One student cannot read another student's private row.
do $$
declare
  v_others integer;
begin
  select count(*) into v_others
  from public.profile_private
  where profile_id <> public.current_profile_id();
  perform public.test_assert(v_others = 0, 'a student must not read another student''s private row, even knowing it exists');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Account states: suspended, banned, deactivated, reinstated
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_tanvi uuid;
begin
  select p.id into v_tanvi from public.profiles p where p.username = 'tanvi_b';

  perform public.admin_set_account_status(v_tanvi, 'suspended', 'Testing suspension', 3);
  perform public.test_assert(
    (select account_status from public.profile_private where profile_id = v_tanvi) = 'suspended',
    'the operator must be able to suspend an account'
  );
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-a000-000000000001', false);

do $$
begin
  perform public.test_assert(not public.is_active_user(), 'a suspended account is inactive');
  perform public.test_assert(not public.has_permission('create_posts'), 'a suspended account holds no permissions');

  perform public.test_assert_denied(
    $sql$insert into public.posts (author_id, body) values (public.current_profile_id(), 'Posting while suspended.')$sql$,
    'a suspended account must not be able to post'
  );
  perform public.test_assert_denied(
    $sql$insert into public.comments (post_id, author_id, body)
         select id, public.current_profile_id(), 'Comment while suspended.' from public.posts limit 1$sql$,
    'a suspended account must not be able to comment'
  );
  perform public.test_assert_denied(
    $sql$select public.get_or_create_direct_conversation((select id from public.profiles where username = 'umair_s'))$sql$,
    'a suspended account must not be able to open a conversation'
  );
  perform public.test_assert_denied(
    $sql$select public.join_random_queue()$sql$,
    'a suspended account must not be able to use Random'
  );
  perform public.test_assert_denied(
    $sql$insert into public.marketplace_listings (seller_id, title, description, category_id, price)
         select public.current_profile_id(), 'Suspended listing', 'This should not be allowed to exist.',
                c.id, 100 from public.marketplace_categories c limit 1$sql$,
    'a suspended account must not be able to list an item'
  );
  perform public.test_assert_denied(
    $sql$insert into public.blocks (blocker_id, blocked_id)
         select public.current_profile_id(), id from public.profiles where username = 'umair_s'$sql$,
    'a suspended account must not be able to block anyone'
  );
end;
$$;

-- Suspension expiry is automatic (lift_expired_suspensions), not a manual chore.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_tanvi uuid;
begin
  select p.id into v_tanvi from public.profiles p where p.username = 'tanvi_b';
  update public.profile_private set suspended_until = now() - interval '1 minute' where profile_id = v_tanvi;
  perform public.lift_expired_suspensions();
  perform public.test_assert(
    (select account_status from public.profile_private where profile_id = v_tanvi) = 'active',
    'an expired suspension must lift itself'
  );
end;
$$;

-- A ban is permanent until an admin reverses it, and blocks a different way:
-- the account can sign in but every write is refused.
do $$
declare
  v_tanvi uuid;
begin
  select p.id into v_tanvi from public.profiles p where p.username = 'tanvi_b';
  perform public.admin_set_account_status(v_tanvi, 'banned', 'Testing ban');
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-a000-000000000001', false);

do $$
begin
  perform public.test_assert(not public.is_active_user(), 'a banned account is inactive');
  perform public.test_assert_denied(
    $sql$insert into public.posts (author_id, body) values (public.current_profile_id(), 'Posting while banned.')$sql$,
    'a banned account must not be able to post'
  );
end;
$$;

-- Deactivation is self-service and reversible.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_tanvi uuid;
begin
  select p.id into v_tanvi from public.profiles p where p.username = 'tanvi_b';
  perform public.admin_set_account_status(v_tanvi, 'active', 'Ban lifted');
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-a000-000000000001', false);

do $$
begin
  perform public.test_assert(public.is_active_user(), 'a reinstated account is active again');

  perform public.deactivate_own_account('Taking a break');
  perform public.test_assert(not public.is_active_user(), 'a deactivated account is inactive');

  perform public.reactivate_own_account();
  perform public.test_assert(public.is_active_user(), 'a deactivated account must be able to come back');

  insert into public.posts (author_id, body)
  values (public.current_profile_id(), 'Back online after deactivating for a bit.');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Hard delete leaves nothing behind (no orphan profiles)
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_umair uuid;
begin
  select p.id into v_umair from public.profiles p where p.username = 'umair_s';
  perform public.test_assert(v_umair is not null, 'the second student exists before deletion');

  delete from auth.users where id = 'f0000000-0000-4000-a000-000000000002';

  perform public.test_assert(not exists (select 1 from public.profiles where id = v_umair),
    'deleting the auth user must remove the public profile too');
  perform public.test_assert(not exists (select 1 from public.profile_private where profile_id = v_umair),
    'deleting the auth user must remove the private row too');
  perform public.test_assert(not exists (select 1 from public.user_roles where user_id = v_umair),
    'deleting the auth user must remove the role rows too');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. No Campus+ password is ever stored, and no presence is recorded
-- ---------------------------------------------------------------------------
do $$
declare
  v_secret_columns integer;
  v_presence_columns integer;
begin
  select count(*) into v_secret_columns
  from information_schema.columns
  where table_schema = 'public'
    and (column_name ~ '(password|passwd|otp|totp|secret)');
  perform public.test_assert(v_secret_columns = 0,
    'the public schema must store no password, OTP or shared secret');

  select count(*) into v_presence_columns
  from information_schema.columns
  where table_schema = 'public'
    and column_name ~ '^(is_online|online|presence|typing|last_active|last_seen_at)$';
  perform public.test_assert(v_presence_columns = 0,
    'the schema must contain no presence/online/typing columns (spec §102)');
end;
$$;

-- `last_seen` exists only as private bookkeeping for abuse investigation and is
-- never exposed through the public projection or to other students.
do $$
declare
  v_in_public integer;
begin
  select count(*) into v_in_public
  from information_schema.columns
  where table_schema = 'public' and table_name = 'public_profiles' and column_name = 'last_seen';
  perform public.test_assert(v_in_public = 0, 'last_seen must not appear in the public projection');
end;
$$;
