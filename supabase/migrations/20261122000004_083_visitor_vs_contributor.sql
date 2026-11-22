-- ============================================================================
-- 083 — Visitor and External Contributor are different things
-- ============================================================================
-- 080 created two roles and 081 built the per-account grant table, but the two
-- roles were never actually distinguished. `external_contributor` shipped with
-- zero permissions (080 clears them on purpose), the admin screen offered it as
-- a grant anyway, and `has_permission()` did not know it existed. The result was
-- a role that looked like a feature and did nothing:
--
--   * an administrator could grant External Contributor and the account's
--     capabilities would not change by a single one;
--   * if an administrator *did* give that role a permission through the Roles &
--     Permissions editor, `has_permission()` would have honoured it for
--     **every** holder — including a student who had been given the role.
--
-- This migration makes the difference explicit and enforces it in the one place
-- permissions are resolved.
--
--   visitor             = the account type's baseline. Read-only, plus looking
--                         after your own profile and reporting abuse. Granted
--                         automatically by the signup trigger, never by a human.
--
--   external_contributor = an entitlement. What it confers is defined once, on
--                         the role, with the same permission editor that governs
--                         every other role — but it only ever takes effect for an
--                         *external* account. Handing it to an institutional
--                         account confers nothing, so it cannot become a second,
--                         unchecked way to widen a student.
--
-- The distinction the product cares about is therefore:
--
--   is there a person-level decision that this outside account may publish,
--   and which specific things may it publish?
--
-- `visitor_permission_grants` (081) answers it per capability for one account.
-- `external_contributor` answers it as one named entitlement over a defined set.
-- Both are gated on `account_type = 'visitor'`, and neither changes the account
-- type or confers institutional identity.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. has_permission(): the role grant only counts for an external account
-- ----------------------------------------------------------------------------
-- Re-issued from 081. The only behavioural change is the extra branch: a role
-- permission counts if it comes from the account's role — except for
-- `external_contributor`, whose permissions are conditional on being external.
--
-- Written as a condition on the *role*, not on the account, so the rule holds
-- even if the role row is inserted directly into `user_roles` rather than
-- through `grant_role()`: `user_roles_insert_admin` is a table-level policy, and
-- a policy cannot distinguish which role is being inserted. Enforcing it here
-- means the direct path confers nothing either.

create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.is_active_user(), false)
     and (
       exists (
         select 1
           from public.user_roles ur
           join public.role_permissions rp on rp.role_key = ur.role_key
          where ur.user_id = public.current_profile_id()
            and rp.permission_key = p_permission
            -- `external_contributor` is an entitlement for outside accounts
            -- only. For anybody else the row confers nothing.
            and (
              ur.role_key <> 'external_contributor'
              or public.account_type_of(public.current_profile_id()) = 'visitor'
            )
       )
       or exists (
         select 1
           from public.visitor_permission_grants g
          where g.user_id = public.current_profile_id()
            and g.permission_key = p_permission
            and public.account_type_of(public.current_profile_id()) = 'visitor'
       )
     );
$$;

comment on function public.has_permission(text) is
  'The single permission resolution point: role permissions (External Contributor only for external accounts), plus explicit per-account publishing grants held by an active external visitor.';

revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. The baseline roles, restated
-- ----------------------------------------------------------------------------
-- Restating the visitor baseline keeps this migration the single place to read
-- what a Visitor is. External Contributor stays empty *on purpose*: it is a
-- container an administrator fills, and shipping it with permissions would mean
-- an external account gained capabilities from a role nobody chose to give it.

delete from public.role_permissions where role_key = 'visitor';

insert into public.role_permissions (role_key, permission_key)
select 'visitor', p.key
from public.permissions p
where p.key in (
  'manage_own_profile',
  'report_content'
)
on conflict do nothing;

comment on column public.roles.description is
  'Shown to administrators picking a role. For external accounts, explain what the role confers rather than who holds it.';

update public.roles
   set description = 'An external account that has not been given publishing rights. Can read public content, manage their own profile and report content.'
 where key = 'visitor';

update public.roles
   set description = 'An external account an administrator has allowed to publish. Confers the publishing permissions assigned to this role, and applies to external accounts only.'
 where key = 'external_contributor';

-- ----------------------------------------------------------------------------
-- 3. The distinction, as two predicates
-- ----------------------------------------------------------------------------
-- The interface should never have to reconstruct this from `roles[]`. These are
-- stable, indexed lookups rather than aggregating the role list on every render.

create or replace function public.is_external_contributor()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles ur
     where ur.user_id = public.current_profile_id()
       and ur.role_key = 'external_contributor'
  );
$$;

comment on function public.is_external_contributor() is
  'True when the caller holds the External Contributor entitlement. Says nothing about whether it currently confers anything: that depends on the account type and on the role''s permissions.';

revoke all on function public.is_external_contributor() from public, anon;
grant execute on function public.is_external_contributor() to authenticated, service_role;

-- How this account's standing should be described. One function so the badge on
-- the profile, the card in settings and the admin list cannot drift apart.
--
--   read_only_visitor   – external, no grants, no contributor role
--   permitted_visitor   – external, with some per-account grants or role rights
--   contributor         – external, holding the External Contributor entitlement
--   institutional       – not an external account at all
create or replace function public.external_standing()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when coalesce(public.account_type_of(public.current_profile_id())::text, '') <> 'visitor'
      then 'institutional'
    when public.is_external_contributor()
      then 'contributor'
    when exists (
      select 1 from public.visitor_permission_grants g
       where g.user_id = public.current_profile_id()
    )
      then 'permitted_visitor'
    else 'read_only_visitor'
  end;
$$;

comment on function public.external_standing() is
  'Read-only visitor / permitted visitor / contributor / institutional. Describes standing for display; authorization is still has_permission().';

revoke all on function public.external_standing() from public, anon;
grant execute on function public.external_standing() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. grant_role(): the contributor entitlement is for outside accounts only
-- ----------------------------------------------------------------------------
-- `grant_role()` is deliberately generic — it is how every role is assigned, and
-- duplicating it for one role would be worse. The external-only rule becomes an
-- explicit exception there, and `has_permission()` (§1) enforces the same rule at
-- resolution time for any path that bypasses the RPC.
--
-- The rest of the function is unchanged from 016.

create or replace function public.grant_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rank integer;
  v_username text;
begin
  -- Operator context (secret key / maintenance script) may always assign roles.
  if not (public.has_permission('assign_roles') or public.is_trusted_writer()) then
    raise exception 'You do not have permission to assign roles.' using errcode = '42501';
  end if;
  -- Existence means "has an account row", not "has chosen a username". An
  -- external account arrives with a profile and no username (the username is
  -- claimed during onboarding), and the whole point of the contributor
  -- entitlement is that it can be decided at any time. Using `username` here
  -- would have refused exactly the accounts this feature exists for — the same
  -- mistake 082 fixed in admin_set_visitor_permissions().
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'That account could not be found.' using errcode = '22023';
  end if;

  -- Kept for the audit entry and the notification only; may be NULL.
  select p.username into v_username from public.profiles p where p.id = p_user;

  select r.rank into v_rank from public.roles r where r.key = p_role;
  if v_rank is null then
    raise exception 'That role does not exist.' using errcode = '22023';
  end if;

  -- The External Contributor entitlement describes an outside account that has
  -- been allowed to publish. It is meaningless, and would be a privilege leak,
  -- on an institutional account.
  if p_role = 'external_contributor' then
    if not exists (
      select 1 from public.profile_private pp
       where pp.profile_id = p_user and pp.account_type = 'visitor'
    ) then
      raise exception 'External Contributor applies to external accounts only.'
        using errcode = '42501';
    end if;
  end if;

  if not public.is_trusted_writer() then
    if p_role = 'super_admin'
       and not (public.has_role('super_admin') and public.has_permission('manage_role_authority')) then
      raise exception 'Only a Super Admin can grant the Super Admin role.' using errcode = '42501';
    end if;
    if v_rank >= public.current_role_rank() then
      raise exception 'You cannot grant a role at or above your own level.' using errcode = '42501';
    end if;
  end if;

  insert into public.user_roles (user_id, role_key, granted_by)
  values (p_user, p_role, public.current_profile_id())
  on conflict (user_id, role_key) do nothing;

  perform public.log_audit('admin.role_granted', 'user', p_user::text,
    jsonb_build_object('role', p_role, 'username', v_username), true, null, 'admin');

  perform public.notify_user(p_user, 'moderation_notice',
    'Your Campus+ role changed',
    case
      when p_role = 'external_contributor'
        then 'A Campus+ administrator made you an External Contributor. Your account type stays Visitor.'
      else 'You now have the ' || p_role || ' role on Campus+.'
    end,
    'profile', p_user::text, '/profile');

  return jsonb_build_object('ok', true, 'role', p_role);
end;
$$;

revoke all on function public.grant_role(uuid, text) from public, anon;
grant execute on function public.grant_role(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. External Contributor must be impossible to hold with nothing behind it
-- ----------------------------------------------------------------------------
-- A role that confers nothing is a trap for the next administrator: they grant
-- it, the account's interface does not change, and nobody can tell whether the
-- grant failed or the role is empty. Rather than fail the grant — which would
-- make the role unusable for the "decide the permissions first, assign second"
-- workflow — report the outcome honestly.
--
-- This is a read-only helper for the admin screen, deliberately separate from
-- `admin_set_visitor_permissions()`, which is the *per-account* mechanism.

create or replace function public.external_contributor_permissions()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(rp.permission_key order by rp.permission_key), array[]::text[])
    from public.role_permissions rp
   where rp.role_key = 'external_contributor';
$$;

comment on function public.external_contributor_permissions() is
  'What the External Contributor role currently confers. Empty means granting the role changes nothing yet: define it in Roles & Permissions.';

revoke all on function public.external_contributor_permissions() from public, anon;
grant execute on function public.external_contributor_permissions() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Verification
-- ----------------------------------------------------------------------------

do $$
declare
  v_grants int;
  v_contributors int;
  v_leak int;
begin
  select count(*) into v_grants from public.role_permissions where role_key = 'visitor';
  if v_grants <> 2 then
    raise exception '083: visitor baseline should be exactly 2 permissions, found %.', v_grants;
  end if;

  select count(*) into v_contributors from public.user_roles where role_key = 'external_contributor';
  raise notice '083: % account(s) hold External Contributor.', v_contributors;

  -- The rule this migration exists to establish: no institutional account may
  -- pick up a permission through the contributor role.
  select count(*) into v_leak
    from public.user_roles ur
    join public.profile_private pp on pp.profile_id = ur.user_id
   where ur.role_key = 'external_contributor'
     and pp.account_type <> 'visitor';
  if v_leak > 0 then
    raise exception '083: % institutional account(s) hold External Contributor.', v_leak;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. public_profiles: let a reader tell a contributor from a read-only visitor
-- ----------------------------------------------------------------------------
-- Appended last, for the same reason as 082: `create or replace view` refuses to
-- reorder existing columns. A boolean rather than the role array, so the
-- projection does not publish every account's full role list.

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
  p.visitor_college_name,
  p.visitor_year,
  coalesce(public.account_type_of(p.id) = 'visitor', false) as is_external,
  -- Appended by migration 083.
  exists (
    select 1 from public.user_roles ur
     where ur.user_id = p.id and ur.role_key = 'external_contributor'
  ) as is_contributor
from public.profiles p
where p.username is not null
  and not public.is_blocked_with_current(p.id);

comment on view public.public_profiles is
  'Public projection of profiles. Institutional email, auth ids and moderation state are structurally absent. is_staff drives the staff marker; is_external and is_contributor distinguish an outside account and whether it may publish.';

grant select on public.public_profiles to authenticated;
