-- Campus+ migration 080 — external accounts and the Visitor role
-- Supabase CLI filename: 20261005000034_080_external_accounts.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 080 — automatic external-user classification + Visitor RBAC
-- =============================================================================
-- Until now Campus+ assumed every authenticated user was an institutional
-- student: migration 002 declared `profile_private.college_id` NOT NULL, and
-- migration 012 rejected any auth user whose domain was not an approved
-- institution. This migration removes that assumption *without* creating a
-- parallel identity system and without weakening a single existing policy.
--
-- The model after 080:
--
--   account_type = 'student'   institutional address on an active college
--   account_type = 'visitor'   any other verified address (e.g. Gmail)
--
-- Account type is decided in the database from the verified address at the
-- moment the auth user is created. It is never accepted from the client, and
-- it is deliberately independent of *authorization*: an external visitor who
-- is granted publishing permissions stays a visitor. Roles decide what an
-- account may do; account_type records which institution, if any, it belongs
-- to. Conflating the two is how "grant one permission" quietly becomes
-- "become a student", so they are separate columns with separate guards.
--
-- Read access is unchanged: every policy that reads "public" content already
-- lets any authenticated user in, so a visitor sees exactly what an anonymous
-- browser sees plus the authenticated extras they have permission for. Write
-- access is unchanged for the same reason: every content-creation policy
-- already requires a specific permission, and `visitor` holds none of them.
--
-- Forward-only: no earlier migration is edited.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Account classification
-- ----------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'account_type') then
    create type public.account_type as enum ('student', 'visitor');
  end if;
end $$;

alter table public.profile_private
  add column if not exists account_type public.account_type not null default 'student';

comment on column public.profile_private.account_type is
  'Authoritative account classification, set once by the auth trigger from the verified email domain and never client-writable. Independent of the roles granted in user_roles.';

-- Visitors have no institution; students must have exactly one. Written as a
-- CHECK rather than a trigger so an impossible row cannot exist even for a
-- moment, and so a future backfill that forgets the rule fails loudly.
do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profile_private'::regclass
       and conname = 'profile_private_account_type_college'
  ) then
    alter table public.profile_private
      add constraint profile_private_account_type_college
      check (
        (account_type = 'student' and college_id is not null)
        or (account_type = 'visitor' and college_id is null)
      );
  end if;
end $$;

-- `college_id` becomes nullable for visitors only; the CHECK above is what
-- keeps students attached to a real institution.
alter table public.profile_private
  alter column college_id drop not null;

create index if not exists profile_private_account_type_idx
  on public.profile_private (account_type, created_at desc);

-- Every account that already existed was provisioned by the institutional-only
-- trigger, so it is a student. This is a no-op for a fresh database and is
-- kept explicit so the intent is auditable rather than implied by the default.
update public.profile_private
   set account_type = 'student'
 where account_type is distinct from 'student'
   and college_id is not null;

-- ----------------------------------------------------------------------------
-- 2. Central email classification
-- ----------------------------------------------------------------------------
-- One authoritative function answers "which institution does this verified
-- address belong to, if any?". It reads `colleges.email_domains` (the mapping
-- the rest of the platform already uses) so there is no second domain list to
-- drift, and it normalises the address the same way the application does:
-- trim, lowercase, take the part after the final '@'.
--
-- It returns the college id plus the normalised domain, or NULL for the
-- college when the domain is not an active institution. `allowed_email_domain`
-- (migration 012) keeps working exactly as before: it is a boolean wrapper for
-- "is this an institutional address", which is still the right question for
-- the sign-in screen.

create or replace function public.normalize_email_domain(p_email text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(split_part(btrim(coalesce(p_email, '')), '@', 2))), '');
$$;

comment on function public.normalize_email_domain(text) is
  'Lower-cased domain of an email address, or NULL when there is no meaningful domain. Used for account classification.';

create or replace function public.classify_institutional_email(p_email text)
returns table (domain text, college_id uuid, account_type public.account_type)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_domain text := public.normalize_email_domain(p_email);
  v_college uuid;
begin
  if v_domain is null then
    return query select null::text, null::uuid, 'visitor'::public.account_type;
    return;
  end if;

  -- A college may list the same domain twice; `limit 1` keeps the resolution
  -- deterministic and the `order by` prefers the longest-lived institution.
  select c.id
    into v_college
    from public.colleges c
   where c.is_active
     and exists (
       select 1 from unnest(c.email_domains) d
       where lower(btrim(d)) = v_domain
     )
   order by c.created_at asc
   limit 1;

  if v_college is null then
    return query select v_domain, null::uuid, 'visitor'::public.account_type;
  else
    return query select v_domain, v_college, 'student'::public.account_type;
  end if;
end;
$$;

comment on function public.classify_institutional_email(text) is
  'Authoritative server-side classification: active college for the verified domain, otherwise an external visitor. The only place account_type is decided.';

revoke all on function public.classify_institutional_email(text) from public, anon;
revoke all on function public.normalize_email_domain(text) from public, anon;
grant execute on function public.classify_institutional_email(text) to authenticated, service_role;
grant execute on function public.normalize_email_domain(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Replace the institutional-only signup gate with classification
-- ----------------------------------------------------------------------------
-- Migration 012's `enforce_institutional_domain()` raised for every address
-- outside an approved domain, which made an external account impossible to
-- create. The replacement accepts any address that Supabase Auth has already
-- verified — classification, not rejection, is now the gate — and still
-- refuses an account with no email at all, because Campus+ has no
-- phone-only or anonymous identity.

create or replace function public.enforce_verified_email_domain()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(new.email, '')));
begin
  if v_email = '' then
    raise exception 'Campus+ requires an email address to create an account.'
      using errcode = '42501';
  end if;

  if position('@' in v_email) = 0 then
    raise exception 'Campus+ requires a valid email address to create an account.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.enforce_verified_email_domain() is
  'Signup gate: an account must have an email address. Domain membership no longer rejects a signup — it decides account_type in handle_new_user().';

-- Swap the trigger. `drop trigger` then `create trigger` (rather than
-- renaming) keeps exactly one BEFORE INSERT hook on auth.users, so ordering
-- against the separate AFTER INSERT provisioning trigger is unchanged.
drop trigger if exists enforce_institutional_domain_trigger on auth.users;
drop function if exists public.enforce_institutional_domain();

create trigger enforce_verified_email_domain_trigger
  before insert on auth.users
  for each row execute function public.enforce_verified_email_domain();

-- ----------------------------------------------------------------------------
-- 4. Provisioning: classify, then assign the matching baseline role
-- ----------------------------------------------------------------------------
-- Same shape as migration 012's `handle_new_user()`, with three changes:
--   * the college is resolved from the classification instead of raising,
--   * `account_type` is written explicitly,
--   * the baseline role is `student` for an institutional account and
--     `visitor` for an external one.
--
-- The role choice is made here, in the definer function, from `new.email` —
-- the address Supabase Auth verified. A client can influence neither the
-- address nor the role, and `prevent_privilege_escalation()` still guards the
-- direct-write path.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(new.email, '')));
  v_class record;
  v_profile uuid;
  v_display text;
  v_username_seed text;
begin
  select * into v_class from public.classify_institutional_email(v_email);

  if v_class.domain is null then
    -- The BEFORE INSERT gate should have caught this; refuse rather than
    -- provision a half-classified identity.
    raise exception 'Campus+ could not classify this account.' using errcode = '42501';
  end if;

  v_display := coalesce(
    nullif(btrim(coalesce(new.raw_user_meta_data->>'display_name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data->>'name', '')), ''),
    initcap(replace(split_part(v_email, '@', 1), '.', ' '))
  );

  -- Mark the provisioning work so guards such as prevent_privilege_escalation()
  -- know this is the database's own baseline setup, not a client asking for a
  -- role. Transaction-local: it disappears when this trigger's transaction ends.
  perform set_config('campus.system_context', 'on', true);

  insert into public.profiles (display_name)
  values (left(v_display, 60))
  returning id into v_profile;

  insert into public.profile_private (
    profile_id, auth_user_id, college_id, account_type, account_status, profile_completed
  ) values (
    v_profile, new.id, v_class.college_id, v_class.account_type, 'active', false
  );

  -- Baseline role. Additional roles are granted deliberately and audited.
  insert into public.user_roles (user_id, role_key)
  values (
    v_profile,
    case when v_class.account_type = 'student' then 'student' else 'visitor' end
  )
  on conflict do nothing;

  -- The first username_history row is written by complete_profile() once the
  -- account actually claims a handle.

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates profiles + profile_private with the classified account_type and the matching baseline role (student for an institution, visitor otherwise). Username is chosen during onboarding.';

-- ----------------------------------------------------------------------------
-- 5. The Visitor role
-- ----------------------------------------------------------------------------
-- A built-in role with the *lowest* rank in the hierarchy. Rank 0 currently
-- belongs to Student, and `grant_role()` refuses to grant a role ranked at or
-- above the granter's own rank — so giving Visitor rank 0 would force every
-- operator to outrank a student to grant it. Negative ranks keep the existing
-- comparison exact without special-casing the role anywhere.
--
-- `roles.rank` is `check (rank between 0 and 1000)` in migration 002, so the
-- constraint must be widened before the row can exist.
alter table public.roles drop constraint if exists roles_rank_check;
alter table public.roles add constraint roles_rank_check check (rank between -100 and 1000);

insert into public.roles (key, label, description, rank, is_system) values
  ('visitor', 'Visitor',
   'External account verified by Google. Reads explicitly public content; cannot publish until an administrator grants a role.',
   -10, true)
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description,
      rank = excluded.rank,
      is_system = excluded.is_system;

-- A dedicated, readable role for granting publishing rights to individual
-- external accounts without ever handing them the Student role. It is a normal
-- row in the normal tables: administrators edit its permissions with the same
-- permission editor they already use.
insert into public.roles (key, label, description, rank, is_system) values
  ('external_contributor', 'External Contributor',
   'An external account an administrator has allowed to publish selected content. Still not an institutional student.',
   -5, true)
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description,
      rank = excluded.rank,
      is_system = excluded.is_system;

-- Default visitor permissions: strictly read-only plus the ability to look
-- after its own account and report abuse. Every content-creation permission is
-- conspicuous by its absence, which is the point — this list is an allow-list,
-- so a permission added to the catalogue later is NOT granted to visitors by
-- default.
--
-- `react_content` and `rsvp_events` are deliberately absent: both are outward
-- interactions that announce a visitor in campus activity. Granting either to
-- an individual visitor is an administrator's decision, not a default.
insert into public.role_permissions (role_key, permission_key)
select 'visitor', p.key
from public.permissions p
where p.key in (
  'manage_own_profile',
  'report_content'
)
on conflict do nothing;

-- External Contributor starts with *nothing*. An administrator grants the
-- specific capabilities that account needs, one at a time, which is exactly
-- the "Visitor A can post but not comment" requirement.
delete from public.role_permissions where role_key = 'external_contributor';

-- Defence in depth: a visitor must never accumulate a staff permission by
-- accident. Anything outside the visitor allow-list is removed even if an
-- operator added it by hand before this migration ran.
delete from public.role_permissions rp
 where rp.role_key = 'visitor'
   and rp.permission_key not in ('manage_own_profile', 'report_content');

-- ----------------------------------------------------------------------------
-- 6. Account-type helpers (read-only, used by policies and the app)
-- ----------------------------------------------------------------------------

create or replace function public.account_type_of(p_profile uuid)
returns public.account_type
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pp.account_type from public.profile_private pp where pp.profile_id = p_profile;
$$;

create or replace function public.current_account_type()
returns public.account_type
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.account_type_of(public.current_profile_id());
$$;

create or replace function public.is_visitor(p_profile uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.account_type_of(coalesce(p_profile, public.current_profile_id())) = 'visitor', false);
$$;

create or replace function public.is_institutional(p_profile uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.account_type_of(coalesce(p_profile, public.current_profile_id())) = 'student', false);
$$;

comment on function public.is_visitor(uuid) is
  'True for an external account. Fails closed to false when the account type cannot be resolved.';

revoke all on function public.account_type_of(uuid) from public, anon;
revoke all on function public.current_account_type() from public, anon;
revoke all on function public.is_visitor(uuid) from public, anon;
revoke all on function public.is_institutional(uuid) from public, anon;
grant execute on function public.account_type_of(uuid) to authenticated, service_role;
grant execute on function public.current_account_type() to authenticated, service_role;
grant execute on function public.is_visitor(uuid) to authenticated, service_role;
grant execute on function public.is_institutional(uuid) to authenticated, service_role;

-- `current_profile_id()` is the linchpin of every policy. It is unchanged in
-- behaviour but restated here so this migration is self-contained and so the
-- SECURITY DEFINER + pinned search_path shape is guaranteed on a database that
-- somehow predates it.
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pp.profile_id from public.profile_private pp where pp.auth_user_id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- 7. Campus-scoped content is institutional-only
-- ----------------------------------------------------------------------------
-- Until 080 "authenticated" meant "has an institutional account", so a policy
-- that said `visibility in ('public','campus')` effectively meant "everyone at
-- this institution". With external accounts that reading silently widens
-- `campus` visibility to the whole internet's Google users. These three
-- functions are the single gate for that visibility level, so the correction
-- lives here rather than being copied into a dozen policies.
--
--   * `community_visible_to_current(visibility)` — campus requires an
--     institutional account; public is open to any authenticated user;
--     private is limited to members/staff exactly as before.
--   * `can_view_community()` — same rules, now expressed through the helper.
--   * `posts_select_visible` — rebuilt to call the helper for the
--     community-less branch.

create or replace function public.community_visible_to_current(p_visibility public.visibility_level)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_visibility = 'public' then true
    when p_visibility = 'campus' then public.is_institutional()
    else false
  end;
$$;

comment on function public.community_visible_to_current(public.visibility_level) is
  'The one place campus-level visibility is decided. External visitors see public content only, never campus-only content.';

create or replace function public.can_view_community(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.communities c
    where c.id = p_community
      and c.status = 'published'
      and (
        public.community_visible_to_current(c.visibility)
        or public.is_community_member(c.id)
        or public.has_permission('moderate_communities')
        or public.has_permission('moderate_all')
      )
  );
$$;

comment on function public.can_view_community(uuid) is
  'Visibility gate reused by community, post, discussion and chat policies. Campus-level visibility requires an institutional account (migration 080).';

revoke all on function public.community_visible_to_current(public.visibility_level) from public, anon;
grant execute on function public.community_visible_to_current(public.visibility_level) to authenticated, service_role;

-- Posts without a community are readable when their visibility permits it.
-- Rewritten from migration 005 with the campus branch delegated to the helper.
drop policy if exists posts_select_visible on public.posts;
create policy posts_select_visible on public.posts
  for select to authenticated
  using (
    status = 'published'
    and deleted_at is null
    and public.is_active_profile(author_id)
    and not public.is_blocked_with_current(author_id)
    and not public.is_muted_by_current(author_id)
    and (
      (community_id is null and public.community_visible_to_current(visibility))
      or (community_id is not null and public.can_view_community(community_id))
    )
  );

comment on policy posts_select_visible on public.posts is
  'Signed-in readers see published posts whose visibility permits it. Campus-only posts require an institutional account; external visitors see public posts only (migration 080).';

-- Comments inherit their post's visibility. Migration 005 repeated the
-- visibility expression inline; rewrite it to use the helper so there is one
-- definition of "campus".
drop policy if exists comments_select_visible on public.comments;
create policy comments_select_visible on public.comments
  for select to authenticated
  using (
    status = 'published'
    and exists (
      select 1
      from public.posts p
      where p.id = comments.post_id
        and p.status = 'published'
        and p.deleted_at is null
        and public.is_active_profile(p.author_id)
        and not public.is_blocked_with_current(p.author_id)
        and (
          (p.community_id is null and public.community_visible_to_current(p.visibility))
          or (p.community_id is not null and public.can_view_community(p.community_id))
        )
    )
  );

comment on policy comments_select_visible on public.comments is
  'A comment is readable when its post is. Campus-only posts gate their comments to institutional accounts (migration 080).';

-- ----------------------------------------------------------------------------
-- 8. Notices are institutional announcements
-- ----------------------------------------------------------------------------
-- `notices` has no visibility column: it is the college noticeboard. Migration
-- 041 gave `anon` a narrow published-event read precisely because events are
-- public-facing; no such carve-out exists for notices, which routinely carry
-- internal dates, room numbers and staff instructions. With external accounts
-- the old "any authenticated user" read would mean "any Gmail address on
-- earth". Restrict signed-in reads to institutional accounts, keeping the
-- archive and staff policies untouched.
drop policy if exists notices_select_published on public.notices;
create policy notices_select_published on public.notices
  for select to authenticated
  using (
    public.is_institutional()
    and status = 'published'
    and (expires_at is null or expires_at > now())
  );

comment on policy notices_select_published on public.notices is
  'The noticeboard is campus-internal. External visitors do not read notices (migration 080); staff policies are unchanged.';

-- ----------------------------------------------------------------------------
-- 9. Onboarding for both account types
-- ----------------------------------------------------------------------------
-- `complete_profile()` is the only supported onboarding path: it owns username
-- uniqueness, the reserved list, the cooldown and the audit entry. Institutional
-- accounts keep every existing rule. Visitors claim the same username and
-- display name but must not be able to invent academic details: branch, year
-- and division are the college's, so a visitor's values are forced to NULL
-- regardless of what the client sends.

create or replace function public.complete_profile(
  p_username text,
  p_display_name text,
  p_bio text default null,
  p_branch text default null,
  p_year text default null,
  p_division text default null,
  p_show_branch_year boolean default true
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
         show_branch_year = case when v_visitor then false else coalesce(p_show_branch_year, true) end
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
  'First-login onboarding for every account type: claims a unique username and completes the profile. Academic fields are institutional only (migration 080).';

-- ----------------------------------------------------------------------------
-- 10. Guard: account_type is never client-writable, and never drifts
-- ----------------------------------------------------------------------------
-- Column privileges already stop a client from writing `account_type`
-- (migration 015 revokes UPDATE on profile_private entirely). This trigger is
-- the second layer, and it is the one that matters for a future maintenance
-- path that forgets the rule: an account may not move between classifications,
-- and may not be attached to a college while remaining external.

create or replace function public.guard_account_type()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.account_type is distinct from old.account_type then
    -- Promotion to an institutional account (e.g. a student who later gets a
    -- college address) is a deliberate administrative act, not a side effect.
    if public.in_system_context()
       or public.has_permission('manage_users') then
      null;
    else
      raise exception 'Account type cannot be changed from here.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profile_private_guard_account_type on public.profile_private;
create trigger profile_private_guard_account_type
  before update on public.profile_private
  for each row execute function public.guard_account_type();

-- ----------------------------------------------------------------------------
-- 11. Onboarding completeness no longer requires institutional details
-- ----------------------------------------------------------------------------
-- `profile_completed` and the username are the only onboarding requirements for
-- both account types. Nothing anywhere requires branch/year/division, so the
-- same gate now serves visitors without change; this comment records that the
-- absence of a college is intentionally not part of it.

comment on column public.profile_private.profile_completed is
  'True once onboarding has claimed a username. Institutional details are optional for students and forbidden for visitors (migration 080).';

-- ----------------------------------------------------------------------------
-- 12. Read access for external accounts
-- ----------------------------------------------------------------------------
-- Visitors reach content through the same authenticated policies as students.
-- The only additional surface they need is a way to render a profile card for
-- people they share a public community with — already covered by
-- `profiles_select_authenticated`. No policy is widened by this section; it is
-- recorded here so a reviewer can see that the question was asked.
--
-- Deliberately NOT granted to visitors, and left exactly as they were:
--   * conversations / messages / message_reads  — membership only, so an
--     external account has no inbox until someone messages it.
--   * random_*                                   — requires use_random_chat.
--   * event_registrations, marketplace_interactions, ratings — member actions.
--   * notices, campus-only posts and communities — gated in sections 7 and 8.
--   * admin / moderation tables                  — permission-gated.

-- ----------------------------------------------------------------------------
-- 13. Explicit grants for the new RPC surface
-- ----------------------------------------------------------------------------
-- `create or replace function` preserves the old ACL, but a brand-new function
-- gets PUBLIC EXECUTE by default. Migration 018's policy is that no definer
-- function is callable by `anon`; make that true for everything added here.

revoke all on function public.classify_institutional_email(text) from public, anon;
revoke all on function public.normalize_email_domain(text) from public, anon;
revoke all on function public.account_type_of(uuid) from public, anon;
revoke all on function public.current_account_type() from public, anon;
revoke all on function public.is_visitor(uuid) from public, anon;
revoke all on function public.is_institutional(uuid) from public, anon;
revoke all on function public.community_visible_to_current(public.visibility_level) from public, anon;
revoke all on function public.enforce_verified_email_domain() from public, anon;
revoke all on function public.guard_account_type() from public, anon;

grant execute on function public.complete_profile(text, text, text, text, text, text, boolean) to authenticated;
revoke execute on function public.complete_profile(text, text, text, text, text, text, boolean) from anon;
