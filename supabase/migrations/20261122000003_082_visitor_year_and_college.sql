-- ============================================================================
-- 082 — External accounts: a real username, and their own year and college
-- ============================================================================
-- Migration 080 gave an external account a username (that path already worked,
-- and a visitor claims one through the same `complete_profile()` RPC as a
-- student) but forced every academic column to NULL. That was the wrong shape
-- for two reasons:
--
--   1. It threw away information the visitor wanted to give. "Which year are
--      you in, and where do you study?" is a fair question to ask an external
--      person, and answering it makes their profile legible.
--   2. It made two unrelated things share one column. `year` is treated
--      everywhere in this product as an *institutional* fact — it appears in
--      the student directory, the study-partner matcher and the graduation
--      year inference. If a visitor could write `year`, the value would be
--      indistinguishable from a student's, which is exactly the impersonation
--      080 existed to prevent.
--
-- So the visitor's answers get their own columns. `profiles.visitor_college_name`
-- and `profiles.visitor_year` are readable by everyone (they are profile
-- content, deliberately public) and writable only by their owner. The academic
-- columns stay institution-only, and the trigger that clears them stays.
--
-- No column here is used to place the account: classification is still
-- `profile_private.account_type`, decided by the signup trigger from the email
-- domain. Nothing in this migration makes an account institutional, and there
-- is still no write path from a client to `account_type`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The visitor's own college name and year
-- ----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists visitor_college_name text,
  add column if not exists visitor_year text;

-- Lengths mirror `LIMITS.collegeName` (2..120) and the YEARS vocabulary in
-- lib/constants.js. The CHECKs are deliberately permissive on empty string vs
-- NULL: existing rows are NULL, and a form that submits "" is normalised to
-- NULL by `complete_profile()` and by the profile update action.
alter table public.profiles
  drop constraint if exists profiles_visitor_college_name_check;
alter table public.profiles
  add constraint profiles_visitor_college_name_check check (
    visitor_college_name is null
    or (length(btrim(visitor_college_name)) between 2 and 120)
  );

alter table public.profiles
  drop constraint if exists profiles_visitor_year_check;
alter table public.profiles
  add constraint profiles_visitor_year_check check (
    visitor_year is null
    or visitor_year in ('First Year', 'Second Year', 'Third Year', 'Final Year')
  );

-- Accounts created *before* the 081/082 triggers existed still carry the
-- column default `show_branch_year = true`. Nothing leaks through it -- branch
-- and year are NULL for a visitor, so the projection renders nothing -- but the
-- invariant "an external account never displays academic details" should hold
-- for old rows as well as new ones, so they are normalised once, here.
update public.profiles p
   set show_branch_year = false
  from public.profile_private pp
 where pp.profile_id = p.id
   and pp.account_type = 'visitor'
   and p.show_branch_year;

comment on column public.profiles.visitor_college_name is
  'The institution an external account attends, as they described it. Free text, public. Never used for classification.';
comment on column public.profiles.visitor_year is
  'The study year an external account is in at their own institution. Public. Distinct from `year`, which is this college''s student data.';

-- ----------------------------------------------------------------------------
-- 2. Column privileges: owner-writable, and only for a visitor
-- ----------------------------------------------------------------------------
-- `profiles` already has its own grant model (migration 002 / 015). The two new
-- columns inherit nothing automatically — a new column is writable by any role
-- that holds a table-wide UPDATE grant. So revoke the table-wide write and
-- re-grant column by column, which is the pattern the rest of the schema uses.
--
-- The trigger in §3 is still the authority on *who* may hold values here; the
-- grants only decide which columns a client may mention at all.

revoke update on public.profiles from authenticated;
grant update (
  username, display_name, bio, branch, year, division,
  show_branch_year, allow_dms_from_everyone,
  visitor_college_name, visitor_year
) on public.profiles to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The academic columns stay institution-only; the visitor columns stay
--    external-only
-- ----------------------------------------------------------------------------
-- This replaces `guard_visitor_profile_fields()` from migration 081. It does
-- the same job for branch/year/division — a visitor cannot PUT them at the REST
-- API and appear to be a student — and adds the mirror rule: an institutional
-- account cannot claim a visitor college name or year, which would otherwise
-- let a student describe themselves as external and confuse every screen that
-- renders "where are you from".

create or replace function public.guard_visitor_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_type public.account_type;
begin
  select pp.account_type into v_account_type
    from public.profile_private pp where pp.profile_id = new.id;

  if coalesce(v_account_type::text, '') = 'visitor' then
    -- Institutional facts are not the visitor's to hold.
    new.branch := null;
    new.year := null;
    new.division := null;
    new.show_branch_year := false;
  else
    -- ... and the visitor columns are not an institutional account's to hold.
    new.visitor_college_name := null;
    new.visitor_year := null;
  end if;

  return new;
end;
$$;

comment on function public.guard_visitor_profile_fields() is
  'Branch, year and division belong to an institutional identity; visitor_college_name and visitor_year belong to an external one. Each is cleared on the wrong account type, on every write, so the REST API cannot set them either.';

-- Trigger definition is unchanged from 081 — the function it points at is
-- replaced above. Re-created anyway so this migration is self-contained.

drop trigger if exists profiles_guard_visitor_fields on public.profiles;
create trigger profiles_guard_visitor_fields
  before insert or update on public.profiles
  for each row execute function public.guard_visitor_profile_fields();

revoke all on function public.guard_visitor_profile_fields() from public, anon;

-- ----------------------------------------------------------------------------
-- 4. complete_profile(): the visitor contract gains two optional answers
-- ----------------------------------------------------------------------------
-- The old 7-argument signature is dropped rather than kept as an overload. An
-- overload would be a second way in, and PostgREST resolves by argument names
-- from the client — leaving the old one callable means the "visitor answers are
-- discarded" behaviour stays reachable. Nothing in the repository calls the
-- positional 7-argument form (checked: every call site passes fewer arguments
-- and therefore binds to the defaults below).

drop function if exists public.complete_profile(text, text, text, text, text, text, boolean);

create or replace function public.complete_profile(
  p_username text,
  p_display_name text,
  p_bio text default null,
  p_branch text default null,
  p_year text default null,
  p_division text default null,
  p_show_branch_year boolean default true,
  p_visitor_college_name text default null,
  p_visitor_year text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.current_profile_id();
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_display text := btrim(coalesce(p_display_name, ''));
  v_existing text;
  v_visitor boolean := public.is_visitor();
  v_college text := nullif(btrim(coalesce(p_visitor_college_name, '')), '');
  v_visitor_year text := nullif(btrim(coalesce(p_visitor_year, '')), '');
begin
  if v_me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Validation mirrors lib/validation/schemas.js#vUsername (defence in depth:
  -- the database is the last word).
  if v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Usernames must be 3-24 characters using lowercase letters, numbers and underscores.'
      using errcode = '22023';
  end if;
  if v_username ~ '^_|_$' or v_username ~ '__' then
    raise exception 'Usernames cannot start or end with an underscore, or repeat one.'
      using errcode = '22023';
  end if;
  if v_username ~ '^[0-9]+$' then
    raise exception 'Usernames cannot be only numbers.' using errcode = '22023';
  end if;
  if public.is_reserved_username(v_username) then
    raise exception 'That username is reserved by the platform.' using errcode = '22023';
  end if;
  if length(v_display) < 2 or length(v_display) > 60 then
    raise exception 'Display name must be between 2 and 60 characters.' using errcode = '22023';
  end if;
  if length(coalesce(p_bio, '')) > 280 then
    raise exception 'Bio must be at most 280 characters.' using errcode = '22023';
  end if;

  -- The visitor's own details are validated here too, because the CHECK
  -- constraints would otherwise surface as an opaque 23514 to the form.
  if v_college is not null and length(v_college) > 120 then
    raise exception 'College name must be at most 120 characters.' using errcode = '22023';
  end if;
  if v_visitor_year is not null
     and v_visitor_year not in ('First Year', 'Second Year', 'Third Year', 'Final Year') then
    raise exception 'Year must be one of the offered study years.' using errcode = '22023';
  end if;

  if not public.is_active_user() then
    raise exception 'This account cannot complete its profile.' using errcode = '42501';
  end if;

  select username into v_existing from public.profiles where id = v_me;
  if v_existing is not null and v_existing <> v_username then
    raise exception 'Your username can be changed from Settings once the cooldown passes.'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.profiles p where lower(p.username) = v_username and p.id <> v_me) then
    raise exception 'That username is already taken.' using errcode = '23505';
  end if;

  update public.profiles
     set username = v_username,
         display_name = v_display,
         bio = nullif(btrim(coalesce(p_bio, '')), ''),
         -- Academic details belong to an institution. A visitor's are forced to
         -- NULL so no fabricated PCCOE identity can be stored or displayed.
         branch = case when v_visitor then null else nullif(btrim(coalesce(p_branch, '')), '') end,
         year = case when v_visitor then null else nullif(btrim(coalesce(p_year, '')), '') end,
         division = case when v_visitor then null else nullif(btrim(coalesce(p_division, '')), '') end,
         show_branch_year = case when v_visitor then false else coalesce(p_show_branch_year, true) end,
         -- The visitor's own answers, and only a visitor's.
         visitor_college_name = case when v_visitor then v_college else null end,
         visitor_year = case when v_visitor then v_visitor_year else null end
   where id = v_me;

  update public.profile_private
     set profile_completed = true,
         username_changed_at = coalesce(username_changed_at, now()),
         last_seen = now()
   where profile_id = v_me;

  insert into public.username_history (user_id, old_username, new_username, changed_by)
  values (v_me, v_existing, v_username, v_me);

  perform public.evaluate_achievements(v_me);

  insert into public.audit_logs (actor_user_id, action, target_type, target_id, metadata, visibility)
  values (
    v_me, 'account.profile_created', 'user', v_me,
    jsonb_build_object('username', v_username, 'account_type', public.account_type_of(v_me)),
    'private'
  );

  return jsonb_build_object(
    'ok', true,
    'username', v_username,
    'account_type', public.account_type_of(v_me)
  );
exception
  when unique_violation then
    raise exception 'That username is already taken.' using errcode = '23505';
end;
$$;

comment on function public.complete_profile is
  'First-login onboarding for every account type: claims a unique username and completes the profile. Academic fields are institutional only; visitor_college_name and visitor_year are external only (migration 082).';

revoke all on function public.complete_profile(text, text, text, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.complete_profile(text, text, text, text, text, text, boolean, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. admin_set_visitor_permissions(): grant to an account that has no username
-- ----------------------------------------------------------------------------
-- THE BUG THIS FIXES. The function used `profiles.username` as its existence
-- check ("select username ... if null then 'That account could not be found'").
-- A username is only claimed during onboarding, so every freshly signed-in
-- external account — the exact account an administrator goes looking for —
-- was rejected as not found. Grants were impossible until the visitor happened
-- to finish onboarding first, and the admin screen could not tell the
-- difference between "no such account" and "has not picked a username yet".
--
-- Existence is now checked against `profile_private`, which is created by the
-- signup trigger and therefore exists from the first sign-in.

create or replace function public.admin_set_visitor_permissions(
  p_user uuid,
  p_permissions text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_username text;
  v_exists boolean;
  v_account_type public.account_type;
  v_wanted text[];
  v_before text[];
  v_after text[];
  v_granted text[];
  v_revoked text[];
  v_key text;
begin
  if not (public.has_permission('assign_roles') or public.is_trusted_writer()) then
    raise exception 'You do not have permission to change permissions.' using errcode = '42501';
  end if;

  -- Existence means "has an account", not "has finished onboarding". A
  -- username is only claimed during onboarding, so the old check on
  -- `profiles.username` refused every freshly signed-in external account --
  -- the exact account an administrator goes looking for. `profile_private` is
  -- created by the signup trigger and exists from the first sign-in.
  select true, pp.account_type into v_exists, v_account_type
    from public.profile_private pp where pp.profile_id = p_user;

  if coalesce(v_exists, false) is not true then
    raise exception 'That account could not be found.' using errcode = '22023';
  end if;

  -- Kept for the audit metadata only; it may be NULL for an account that has
  -- not chosen a username yet, which is no longer an error.
  select p.username into v_username from public.profiles p where p.id = p_user;

  -- This function exists for external accounts. An institutional account's
  -- capabilities come from its role, and routing it through here would be a
  -- second, unchecked way to widen a student.
  if coalesce(v_account_type::text, '') <> 'visitor' then
    raise exception 'Only external accounts can be granted publishing permissions.'
      using errcode = '42501';
  end if;

  -- Normalise and validate the requested set.
  v_wanted := array(
    select distinct lower(btrim(p))
      from unnest(coalesce(p_permissions, array[]::text[])) p
     where btrim(p) <> ''
     order by 1
  );

  foreach v_key in array v_wanted loop
    if not public.visitor_grantable_permission(v_key) then
      raise exception '% cannot be granted to an external account.', v_key
        using errcode = '42501';
    end if;
  end loop;

  select coalesce(array_agg(g.permission_key order by g.permission_key), array[]::text[])
    into v_before
    from public.visitor_permission_grants g
   where g.user_id = p_user;

  -- Replace the set with exactly what was asked for. Idempotent: calling it
  -- twice with the same list changes nothing and records nothing.
  delete from public.visitor_permission_grants g
   where g.user_id = p_user
     and not (g.permission_key = any (v_wanted));

  insert into public.visitor_permission_grants (user_id, permission_key, granted_by)
  select p_user, g.key, v_actor from unnest(v_wanted) as g(key)
  on conflict (user_id, permission_key) do nothing;

  select coalesce(array_agg(g.permission_key order by g.permission_key), array[]::text[])
    into v_after
    from public.visitor_permission_grants g
   where g.user_id = p_user;

  v_granted := array(select unnest(v_after) except select unnest(v_before));
  v_revoked := array(select unnest(v_before) except select unnest(v_after));

  if cardinality(v_granted) > 0 or cardinality(v_revoked) > 0 then
    perform public.log_audit(
      'admin.visitor_permissions_changed',
      'user',
      p_user::text,
      jsonb_build_object(
        'username', v_username,
        'account_type', 'visitor',
        'granted', to_jsonb(v_granted),
        'revoked', to_jsonb(v_revoked),
        'current', to_jsonb(v_after),
        'administrator', v_actor
      ),
      true,
      null,
      'admin'
    );

    -- Tell the account, so a capability appearing or disappearing is not a
    -- silent change to what its interface offers.
    if cardinality(v_granted) > 0 then
      perform public.notify_user(
        p_user,
        'moderation_notice',
        'Your Campus+ permissions changed',
        'A Campus+ administrator granted you additional permissions.',
        'profile',
        p_user::text,
        '/settings'
      );
    elsif cardinality(v_revoked) > 0 then
      perform public.notify_user(
        p_user,
        'moderation_notice',
        'Your Campus+ permissions changed',
        'Some of your publishing permissions were removed by a Campus+ administrator.',
        'profile',
        p_user::text,
        '/settings'
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user,
    'granted', to_jsonb(v_granted),
    'revoked', to_jsonb(v_revoked),
    'current', to_jsonb(v_after)
  );
end;
$$;

comment on function public.admin_set_visitor_permissions(uuid, text[]) is
  'Replaces an external account''s publishing grants wholesale. Works before the account has chosen a username (migration 082).';

revoke all on function public.admin_set_visitor_permissions(uuid, text[]) from public, anon;
grant execute on function public.admin_set_visitor_permissions(uuid, text[]) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. public_profiles: expose the visitor's own details, and nothing else
-- ----------------------------------------------------------------------------
-- `public_profiles` is the projection every profile screen reads. Columns are
-- appended, never reordered, because `create or replace view` refuses to move
-- an existing column and existing readers depend on the current order.
--
-- `is_external` is a boolean rather than the `account_type` enum on purpose: the
-- distinction the interface needs is "may this person be a PCCOE student?", and
-- a boolean answers exactly that without publishing the classification of every
-- row in the view.

create or replace view public.public_profiles
with (security_invoker = true)
as
select
  p.id,
  p.username,
  p.display_name,
  p.bio,
  case when p.show_branch_year then p.branch else null end as branch,
  case when p.show_branch_year then p.year else null end as year,
  p.reputation_score,
  p.reputation_count,
  p.marketplace_completed_count,
  public.is_active_profile(p.id) as is_active,
  p.created_at,
  public.is_staff_profile(p.id) as is_staff,
  -- Appended by migration 082.
  p.visitor_college_name,
  p.visitor_year,
  coalesce(public.account_type_of(p.id) = 'visitor', false) as is_external
from public.profiles p
where p.username is not null
  and not public.is_blocked_with_current(p.id);

comment on view public.public_profiles is
  'Public projection of profiles. Institutional email, auth ids and moderation state are structurally absent. `is_staff` drives the staff marker; `is_external` distinguishes an outside account without publishing its role.';

grant select on public.public_profiles to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Verification
-- ----------------------------------------------------------------------------
-- Run after applying. Each line must hold for the migration to have landed.

do $$
declare
  v_visitors int;
  v_bad_year int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name in ('visitor_college_name', 'visitor_year')
     group by table_schema, table_name
    having count(*) = 2
  ) then
    raise exception '082: profiles is missing the visitor columns.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'complete_profile'
       and pg_get_function_identity_arguments(p.oid) like '%p_visitor_college_name%'
  ) then
    raise exception '082: complete_profile() does not carry the visitor arguments.';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'complete_profile'
       and pg_get_function_identity_arguments(p.oid) not like '%p_visitor_college_name%'
  ) then
    raise exception '082: an old complete_profile() overload is still callable.';
  end if;

  -- No existing account may have gained or lost a classification.
  select count(*) into v_visitors from public.profile_private where account_type = 'visitor';
  raise notice '082: % external account(s) present.', v_visitors;

  -- A student must never hold a visitor college name.
  select count(*) into v_bad_year
    from public.profiles p
    join public.profile_private pp on pp.profile_id = p.id
   where pp.account_type <> 'visitor'
     and (p.visitor_college_name is not null or p.visitor_year is not null);
  if v_bad_year > 0 then
    raise exception '082: % institutional account(s) hold visitor-only fields.', v_bad_year;
  end if;
end $$;
