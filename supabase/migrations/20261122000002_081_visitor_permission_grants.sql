-- Campus+ migration 081 — per-account publishing grants for external users
-- Supabase CLI filename: 20261005000035_081_visitor_permission_grants.sql
-- This file is part of the single authoritative migration history in supabase/migrations/.
-- =============================================================================
-- Campus+ 081 — individual permission grants for external accounts
-- =============================================================================
-- 080 introduced the Visitor role and the External Contributor role. Roles are
-- the right model for *groups* of capability, but `role_permissions` maps a role
-- to permissions globally: granting `create_posts` to `external_contributor`
-- would give it to every holder of that role at once. The product requirement is
-- the opposite —
--
--     Visitor A: posts + comments
--     Visitor B: posts only
--     Visitor C: read only
--
-- — so the three accounts cannot share one permission set. This migration adds
-- the smallest thing that expresses that, *inside* the existing model:
--
--   `visitor_permission_grants` records a permission granted to one account.
--   `has_permission()` — the single function every policy and every RPC already
--   calls — unions role-derived permissions with these grants. There is still
--   exactly one permission catalogue (`public.permissions`), one resolution
--   point (`has_permission`) and one audit trail. No second role table, and no
--   second authorization system.
--
-- Why this and not a role row per person: `roles.key` is constrained to
-- `^[a-z0-9_]{2,40}$` and roles are shared, editable objects. Minting one role
-- per external account would put per-person state in a table designed for
-- configuration, would need a deterministic name the schema cannot encode (a
-- UUID is 36 characters of dashes), and would let an administrator grant it to
-- the wrong person by mistake. A direct grant is explicit, one row, trivially
-- auditable and impossible to mis-apply.
--
-- Grants are:
--   * only writable by `admin_set_visitor_permissions()` (SECURITY DEFINER,
--     permission-checked, audited) — the table has no client write policy;
--   * restricted to an allow-list of publishing permissions, enforced in the
--     database rather than in the admin form;
--   * only applicable to an external account: a student's capabilities come
--     from their role, and this must never become a way to top up arbitrary
--     accounts;
--   * ignored the moment the account stops being an active visitor.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. The grant table
-- ----------------------------------------------------------------------------

create table if not exists public.visitor_permission_grants (
  user_id        uuid not null references public.profiles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  granted_by     uuid references public.profiles (id) on delete set null,
  granted_at     timestamptz not null default now(),
  primary key (user_id, permission_key)
);

create index if not exists visitor_permission_grants_user_idx
  on public.visitor_permission_grants (user_id);

comment on table public.visitor_permission_grants is
  'A publishing capability an administrator granted to one external account. Unioned into has_permission(); never client-writable.';
comment on column public.visitor_permission_grants.granted_by is
  'The administrator who made the grant. Retained if that profile is deleted so the audit trail keeps its actor id.';

alter table public.visitor_permission_grants enable row level security;

-- The account may see what it currently holds (the profile screen and the
-- "you cannot post yet" affordance both need it). Nobody may see anyone else's
-- except staff who manage users.
drop policy if exists visitor_permission_grants_select_self on public.visitor_permission_grants;
create policy visitor_permission_grants_select_self on public.visitor_permission_grants
  for select to authenticated
  using (user_id = public.current_profile_id());

drop policy if exists visitor_permission_grants_select_staff on public.visitor_permission_grants;
create policy visitor_permission_grants_select_staff on public.visitor_permission_grants
  for select to authenticated
  using (public.has_permission('manage_users'));

-- No INSERT/UPDATE/DELETE policy exists, so no client can write. The definer
-- function below is the only writer, and it is owned by postgres.

revoke insert, update, delete on public.visitor_permission_grants from authenticated, anon;
grant select on public.visitor_permission_grants to authenticated;

-- ----------------------------------------------------------------------------
-- 2. The allow-list, in the database
-- ----------------------------------------------------------------------------
-- A visitor may be allowed to *publish*. Nothing here can reach administration,
-- moderation, campus-official content, role management or another account's
-- data. Keeping the list in SQL is what makes the admin form a convenience
-- rather than the boundary: a crafted RPC call with `manage_users` fails here.

create or replace function public.visitor_grantable_permission(p_permission text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_permission = any (array[
    'create_posts', 'create_comments', 'create_polls',
    'create_marketplace_listing', 'create_gigs', 'create_housing_post', 'create_ride_post',
    'send_messages',
    'submit_resources', 'submit_opportunities', 'create_projects',
    'create_lost_found', 'create_team_posts', 'create_study_posts', 'submit_events',
    'react_content', 'rsvp_events', 'join_clubs', 'use_gifs'
  ]), false);
$$;

comment on function public.visitor_grantable_permission(text) is
  'Allow-list of capabilities an administrator may grant to an external account. Everything else stays role-only.';

revoke all on function public.visitor_grantable_permission(text) from public, anon;
grant execute on function public.visitor_grantable_permission(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. has_permission() — role permissions ∪ per-account grants
-- ----------------------------------------------------------------------------
-- The one resolution point. The additional branch is deliberately narrow:
--   * it only fires for an *external* account (a student's grants are ignored,
--     so this can never become a quiet promotion path);
--   * it requires the account to be active (`is_active_user()`), so a
--     suspension still removes every capability;
--   * it is an indexed lookup by the caller's own profile id.

create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_user()
     and (
       exists (
         select 1
         from public.user_roles ur
         join public.role_permissions rp on rp.role_key = ur.role_key
         where ur.user_id = public.current_profile_id()
           and rp.permission_key = p_permission
           and (ur.expires_at is null or ur.expires_at > now())
       )
       or (
         -- Individual publishing grant for an external account (migration 081).
         exists (
           select 1
           from public.visitor_permission_grants g
           where g.user_id = public.current_profile_id()
             and g.permission_key = p_permission
         )
         and public.account_type_of(public.current_profile_id()) = 'visitor'
       )
     );
$$;

comment on function public.has_permission(text) is
  'The single permission resolution point: role permissions, plus explicit per-account publishing grants held by an active external visitor.';

-- ----------------------------------------------------------------------------
-- 4. Administrator surface
-- ----------------------------------------------------------------------------

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

  select p.username into v_username from public.profiles p where p.id = p_user;
  if v_username is null then
    raise exception 'That account could not be found.' using errcode = '22023';
  end if;

  select pp.account_type into v_account_type
    from public.profile_private pp where pp.profile_id = p_user;

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
  'Replaces the publishing permissions held by one external account. Audited, allow-listed, and refused for institutional accounts.';

revoke all on function public.admin_set_visitor_permissions(uuid, text[]) from public, anon;
grant execute on function public.admin_set_visitor_permissions(uuid, text[]) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Reading an external account's email, for authorised administrators
-- ----------------------------------------------------------------------------
-- Supabase Auth is the only place an email is stored (migration 002 says so
-- explicitly). An administrator needs it to recognise an external person, who
-- has no institutional identity to go on. Rather than duplicating the address
-- onto a table, expose it through this narrow, permission-checked function.

create or replace function public.admin_external_user_emails(p_profile_ids uuid[])
returns table (profile_id uuid, email text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.has_permission('manage_users') or public.is_trusted_writer()) then
    raise exception 'You do not have permission to read account emails.' using errcode = '42501';
  end if;

  return query
    select pp.profile_id, u.email::text
      from public.profile_private pp
      join auth.users u on u.id = pp.auth_user_id
     where pp.profile_id = any (coalesce(p_profile_ids, array[]::uuid[]))
       and pp.account_type = 'visitor';
end;
$$;

comment on function public.admin_external_user_emails(uuid[]) is
  'Verified emails for external accounts only, for administrators who manage users. The address is never copied to a public table.';

revoke all on function public.admin_external_user_emails(uuid[]) from public, anon;
grant execute on function public.admin_external_user_emails(uuid[]) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Guard: a grant can never attach to a non-visitor, and never widens a role
-- ----------------------------------------------------------------------------
-- Defence in depth for the maintenance path: even a trusted writer cannot use
-- this table to hand a student a capability outside their role, because the
-- insert is refused at the row level.

create or replace function public.guard_visitor_permission_grant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_type public.account_type;
begin
  select pp.account_type into v_account_type
    from public.profile_private pp where pp.profile_id = new.user_id;

  if coalesce(v_account_type::text, '') <> 'visitor' then
    raise exception 'Publishing grants apply to external accounts only.'
      using errcode = '42501';
  end if;

  if not public.visitor_grantable_permission(new.permission_key) then
    raise exception '% is not a grantable publishing permission.', new.permission_key
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists visitor_permission_grants_guard on public.visitor_permission_grants;
create trigger visitor_permission_grants_guard
  before insert or update on public.visitor_permission_grants
  for each row execute function public.guard_visitor_permission_grant();

revoke all on function public.guard_visitor_permission_grant() from public, anon;

-- ----------------------------------------------------------------------------
-- 7. Institutional profile fields stay empty on an external account
-- ----------------------------------------------------------------------------
-- `complete_profile()` already nulls branch/year/division for a visitor, but
-- `profiles_update_self` lets an account update its own row column by column.
-- Without this guard a visitor could PUT a branch and year straight at the REST
-- API and appear to be a student in every listing that renders those fields.
-- The academic fields belong to an institutional identity, so the database, not
-- the settings form, is what keeps them empty.

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
    new.branch := null;
    new.year := null;
    new.division := null;
    new.show_branch_year := false;
  end if;

  return new;
end;
$$;

comment on function public.guard_visitor_profile_fields() is
  'An external account has no branch, year or division; clears them on every write so the REST API cannot set them either.';

drop trigger if exists profiles_guard_visitor_fields on public.profiles;
create trigger profiles_guard_visitor_fields
  before insert or update on public.profiles
  for each row execute function public.guard_visitor_profile_fields();

revoke all on function public.guard_visitor_profile_fields() from public, anon;

-- ----------------------------------------------------------------------------
-- 9. Listing external accounts, with search that actually searches
-- ----------------------------------------------------------------------------
-- The admin screen has to answer "find this external person" by username,
-- display name *or* email. Those three live in different places — `profiles`,
-- and `auth.users` for the address — and the address cannot be read by the
-- client at all. Paging each table and filtering the page in JavaScript would
-- only ever search the rows already fetched, so a visitor who is not on the
-- first page would be invisible to the search box.
--
-- Doing it here also makes `total` truthful: the count and the rows come from
-- the same predicate, so pagination cannot disagree with the search.

create or replace function public.admin_list_external_users(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  profile_id uuid,
  auth_user_id uuid,
  username text,
  display_name text,
  email text,
  account_type public.account_type,
  account_status public.account_status,
  created_at timestamptz,
  roles text[],
  total bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_term text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not (public.has_permission('manage_users') or public.is_trusted_writer()) then
    raise exception 'You do not have permission to list external accounts.' using errcode = '42501';
  end if;

  return query
    with matched as (
      select pp.profile_id,
             pp.auth_user_id,
             p.username,
             p.display_name,
             u.email::text as email,
             pp.account_type,
             pp.account_status,
             coalesce(p.created_at, pp.created_at) as created_at,
             coalesce(
               (select array_agg(ur.role_key order by ur.role_key)
                  from public.user_roles ur where ur.user_id = pp.profile_id),
               array[]::text[]
             ) as roles
        from public.profile_private pp
        join auth.users u on u.id = pp.auth_user_id
        left join public.profiles p on p.id = pp.profile_id
       where pp.account_type = 'visitor'
         and (
           v_term is null
           or p.username ilike '%' || v_term || '%'
           or p.display_name ilike '%' || v_term || '%'
           or u.email ilike '%' || v_term || '%'
         )
    )
    select m.profile_id, m.auth_user_id, m.username, m.display_name, m.email,
           m.account_type, m.account_status, m.created_at, m.roles,
           count(*) over () as total
      from matched m
     order by m.created_at desc nulls last, m.profile_id
     limit v_limit offset v_offset;
end;
$$;

comment on function public.admin_list_external_users(text, integer, integer) is
  'External accounts for the admin screen: one row per visitor, with username, display name, verified email, roles and a search across all three.';

revoke all on function public.admin_list_external_users(text, integer, integer) from public, anon;
grant execute on function public.admin_list_external_users(text, integer, integer) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. A granted capability never widens scope
-- ----------------------------------------------------------------------------
-- Granting `create_posts` answers "may this account publish at all?". It must
-- not also answer "…into a private community?" or "…to a campus-only audience?",
-- because those audiences are made of accounts the visitor is not part of. The
-- insert policy in migration 005 checked permission, visibility and membership
-- independently and so allowed exactly that: a visitor holding `create_posts`
-- could publish a post with `visibility = 'campus'`, or into a community it had
-- joined, and it would then be delivered to campus-only readers.
--
-- External accounts publish to the public sphere, and to communities that are
-- themselves public. The `posts_update_author` policy is re-issued for the same
-- reason: without it a visitor could create a public post and then widen it with
-- an UPDATE, which would make the insert guard decorative.

create or replace function public.post_scope_allowed_to_current(p_visibility public.visibility_level, p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not public.is_visitor() then true
    -- An external account never addresses an institutional audience ...
    when p_visibility in ('campus', 'community', 'private') then false
    -- ... and never posts inside a community it could not show the post to.
    when p_community is null then true
    else exists (
      select 1 from public.communities c
       where c.id = p_community
         and c.visibility = 'public'
    )
  end;
$$;

comment on function public.post_scope_allowed_to_current(public.visibility_level, uuid) is
  'An external account may publish to the public sphere only. Institutional accounts are unaffected.';

revoke all on function public.post_scope_allowed_to_current(public.visibility_level, uuid) from public, anon;
grant execute on function public.post_scope_allowed_to_current(public.visibility_level, uuid) to authenticated, service_role;

drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts
  for insert to authenticated
  with check (
    author_id = public.current_profile_id()
    and public.is_active_user()
    and public.has_permission('create_posts')
    and public.is_active_profile(author_id)
    and status in ('published', 'pending')
    and (is_official = false or public.has_permission('manage_notices'))
    and (community_id is null or public.can_post_in_community(community_id))
    and (kind <> 'poll' or public.has_permission('create_polls'))
    -- migration 081: holding the capability must not also widen the audience
    and public.post_scope_allowed_to_current(visibility, community_id)
  );

comment on policy posts_insert_own on public.posts is
  'Own posts only. External accounts are limited to the public sphere and public communities (migration 081).';

-- The author's update path is re-issued to re-check the same invariants. Editing
-- a post must not be a way to reach an audience the insert refused.
drop policy if exists posts_update_author on public.posts;
create policy posts_update_author on public.posts
  for update to authenticated
  using (author_id = public.current_profile_id() and public.is_active_user())
  with check (
    author_id = public.current_profile_id()
    and public.has_permission('create_posts')
    and (is_official = false or public.has_permission('manage_notices'))
    and (community_id is null or public.can_post_in_community(community_id))
    and (kind <> 'poll' or public.has_permission('create_polls'))
    and public.post_scope_allowed_to_current(visibility, community_id)
  );

comment on policy posts_update_author on public.posts is
  'Own posts only, re-checked against the same capability and scope rules as insert (migration 081).';
