-- Campus+ migration 031 — club governance, requests and scoped management
-- =============================================================================
-- Clubs remain communities (kind = 'club'). This migration adds the directory
-- metadata and protected workflows the club screens use; it does not create a
-- parallel membership or permission system.
--
-- The important authority boundaries are:
--   * ordinary students can REQUEST a club, never INSERT one;
--   * platform staff with manage_clubs review requests and choose an active
--     initial administrator by username;
--   * approval is one transaction and one retry-safe RPC;
--   * club owners/moderators are authoritative only for their own club;
--   * imported clubs may have no administrator until a real account is assigned.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Directory metadata on the existing communities table
-- ---------------------------------------------------------------------------

alter table public.communities
  add column organization_type text,
  add column verification_status text not null default 'pending',
  add column source_label text,
  add column source_url text,
  add column directory_aliases text not null default '',
  add column catalogue_key text,
  add column admin_assigned boolean not null default false;

alter table public.communities alter column created_by drop not null;

alter table public.communities
  add constraint communities_creator_required_for_groups
    check (kind = 'club' or created_by is not null),
  add constraint communities_organization_type_check
    check (
      organization_type is null
      or (
        kind = 'club'
        and organization_type in (
          'collegiate_team', 'technical_club', 'computing_community',
          'department_association', 'professional_chapter', 'creative_group',
          'service_organization', 'sports_group', 'platform_community'
        )
      )
    ),
  add constraint communities_verification_status_check
    check (verification_status in ('pending', 'source_checked')),
  add constraint communities_source_label_check
    check (source_label is null or length(source_label) <= 160),
  add constraint communities_source_url_check
    check (source_url is null or source_url ~ '^https?://'),
  add constraint communities_directory_aliases_check
    check (length(directory_aliases) <= 800),
  add constraint communities_catalogue_key_check
    check (catalogue_key is null or catalogue_key ~ '^[a-z0-9-]{3,80}$');

create unique index communities_catalogue_key_idx
  on public.communities (catalogue_key) where catalogue_key is not null;
create index communities_organization_type_idx
  on public.communities (organization_type, status) where kind = 'club';
create index communities_admin_assignment_idx
  on public.communities (admin_assigned) where kind = 'club';

comment on column public.communities.organization_type is
  'Controlled organization taxonomy for clubs. Independent of the original six discovery categories.';
comment on column public.communities.verification_status is
  'Directory-source state only. source_checked means a cited source lists the organization, not institutional endorsement of this page.';
comment on column public.communities.admin_assigned is
  'Derived from an active owner membership. False is an explicit admin-assignment-needed state, never a fabricated owner.';

-- Existing owner rows are real assignments. Imported rows are backfilled from
-- those rows rather than from created_by, which is provenance, not a club role.
update public.communities c
   set admin_assigned = exists (
     select 1 from public.community_members m
      where m.community_id = c.id and m.role = 'owner' and m.status = 'active'
   )
 where c.kind = 'club';

-- The creator trigger still serves ordinary communities and study groups. A
-- null-creator imported club, or a club created inside the protected workflow,
-- gets its owner from the explicit assignment step instead.
create or replace function public.add_community_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.created_by is not null
     and not (new.kind = 'club' and public.in_system_context()) then
    insert into public.community_members (community_id, user_id, role, status)
    values (new.id, new.created_by, 'owner', 'active')
    on conflict (community_id, user_id) do update set role = 'owner', status = 'active';
  end if;
  return new;
end;
$$;

create or replace function public.sync_club_admin_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid := coalesce(new.community_id, old.community_id);
begin
  update public.communities c
     set admin_assigned = exists (
       select 1 from public.community_members m
        where m.community_id = c.id and m.role = 'owner' and m.status = 'active'
     )
   where c.id = v_community and c.kind = 'club';
  return coalesce(new, old);
end;
$$;

create trigger community_members_sync_club_admin
  after insert or update or delete on public.community_members
  for each row execute function public.sync_club_admin_assignment();

-- Extend the original counter/ownership guard to the new governance fields.
-- Club managers may edit their public profile, but cannot self-verify a source,
-- rewrite catalogue provenance, or toggle the derived administrator flag.
create or replace function public.guard_community_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    new.member_count := (
      select count(*) from public.community_members m
      where m.community_id = old.id and m.status = 'active'
    );
    new.post_count := (
      select count(*) from public.posts p
      where p.community_id = old.id and p.status = 'published' and p.deleted_at is null
    );
    new.created_by := old.created_by;
    new.kind := old.kind;
    new.is_official := old.is_official;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
    new.admin_assigned := exists (
      select 1 from public.community_members m
      where m.community_id = old.id and m.role = 'owner' and m.status = 'active'
    );
    if not (old.kind = 'club' and public.has_permission('manage_clubs')) then
      new.verification_status := old.verification_status;
      new.source_label := old.source_label;
      new.source_url := old.source_url;
      new.directory_aliases := old.directory_aliases;
      new.catalogue_key := old.catalogue_key;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- One scoped predicate, built from the existing membership/global permissions
-- ---------------------------------------------------------------------------

create or replace function public.can_manage_club(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.communities c
     where c.id = p_club
       and c.kind = 'club'
       and (
         public.is_community_moderator(c.id)
         or public.has_permission('manage_clubs')
         or public.has_permission('moderate_communities')
         or public.has_permission('moderate_all')
       )
  );
$$;

comment on function public.can_manage_club(uuid) is
  'Current actor may manage this specific club through its owner/moderator membership or an explicit global club/community permission.';

-- ---------------------------------------------------------------------------
-- Student club-creation requests (not clubs, not memberships)
-- ---------------------------------------------------------------------------

create table public.club_creation_requests (
  id                       uuid primary key default gen_random_uuid(),
  requester_id             uuid not null references public.profiles (id) on delete cascade,
  name                     text not null check (length(btrim(name)) between 3 and 80),
  slug                     text not null check (slug ~ '^[a-z0-9-]{3,60}$'),
  description              text not null check (length(description) between 10 and 1000),
  subject                  text check (subject is null or length(subject) <= 120),
  club_category            text not null check (club_category in ('Technical', 'Cultural', 'Sports', 'Arts', 'Entrepreneurship', 'Social')),
  organization_type        text not null check (organization_type in (
                             'collegiate_team', 'technical_club', 'computing_community',
                             'department_association', 'professional_chapter', 'creative_group',
                             'service_organization', 'sports_group', 'platform_community')),
  recruitment_info         text check (recruitment_info is null or length(recruitment_info) <= 1000),
  meeting_info             text check (meeting_info is null or length(meeting_info) <= 200),
  contact_info             text check (contact_info is null or length(contact_info) <= 200),
  external_url             text check (external_url is null or external_url ~ '^https?://'),
  source_label             text check (source_label is null or length(source_label) <= 160),
  source_url               text check (source_url is null or source_url ~ '^https?://'),
  proposed_admin_username  text check (proposed_admin_username is null or proposed_admin_username ~ '^[a-z0-9_]{3,24}$'),
  status                   text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewed_by              uuid references public.profiles (id) on delete set null,
  reviewed_at              timestamptz,
  review_note              text check (review_note is null or length(review_note) <= 1000),
  community_id             uuid unique references public.communities (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index club_creation_requests_queue_idx
  on public.club_creation_requests (status, created_at);
create index club_creation_requests_requester_idx
  on public.club_creation_requests (requester_id, created_at desc);
create unique index club_creation_requests_one_pending_slug_idx
  on public.club_creation_requests (slug) where status = 'pending';

create trigger club_creation_requests_touch before update on public.club_creation_requests
  for each row execute function public.touch_updated_at();

alter table public.club_creation_requests enable row level security;

create policy club_creation_requests_select_own on public.club_creation_requests
  for select to authenticated using (requester_id = public.current_profile_id());
create policy club_creation_requests_select_admin on public.club_creation_requests
  for select to authenticated using (public.has_permission('manage_clubs'));
create policy club_creation_requests_insert_own on public.club_creation_requests
  for insert to authenticated with check (
    requester_id = public.current_profile_id()
    and public.is_active_user()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and community_id is null
  );
-- No client UPDATE policy: withdrawal and review are protected RPCs below.

create or replace function public.guard_club_creation_request_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.slug := lower(btrim(new.slug));
  new.proposed_admin_username := nullif(lower(btrim(coalesce(new.proposed_admin_username, ''))), '');
  if not public.is_trusted_writer() then
    new.requester_id := public.current_profile_id();
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.community_id := null;
  end if;
  if exists (select 1 from public.communities c where c.slug = new.slug) then
    raise exception 'A community or club already uses that link.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger club_creation_requests_guard_insert
  before insert on public.club_creation_requests
  for each row execute function public.guard_club_creation_request_insert();

-- Notify every distinct active manage_clubs holder. No email, push or private
-- message is created; this is the existing notifications table.
create or replace function public.notify_club_request_admins()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid;
begin
  for v_admin in
    select distinct ur.user_id
      from public.user_roles ur
      join public.role_permissions rp on rp.role_key = ur.role_key
     where rp.permission_key = 'manage_clubs'
       and public.is_active_profile(ur.user_id)
  loop
    perform public.notify_user(
      v_admin, 'club_activity', 'Club request: ' || new.name,
      'Review the request and choose an initial club administrator.',
      'club_request', new.id::text, '/admin?tab=clubs'
    );
  end loop;
  return new;
end;
$$;

create trigger club_creation_requests_notify_admin
  after insert on public.club_creation_requests
  for each row execute function public.notify_club_request_admins();

-- ---------------------------------------------------------------------------
-- Resolve and validate an initial administrator
-- ---------------------------------------------------------------------------

create or replace function public.resolve_club_admin(p_username text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select p.id into v_id
    from public.profiles p
   where p.username = lower(btrim(coalesce(p_username, '')))
     and public.account_status_of(p.id) = 'active'::public.account_status;
  if v_id is null then
    raise exception 'Choose an active Campus+ username for the initial club administrator.' using errcode = '22023';
  end if;
  if public.role_rank(v_id) >= 10 or exists (
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.role_key = ur.role_key
    where ur.user_id = v_id
      and (ur.expires_at is null or ur.expires_at > now())
      and rp.permission_key in (
        'manage_clubs', 'moderate_all', 'manage_users', 'assign_roles',
        'manage_roles', 'manage_permissions', 'manage_role_authority', 'manage_backups'
      )
  ) then
    raise exception 'Choose an active student account without platform-wide administrative privileges.' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Protected club creation and request approval
-- ---------------------------------------------------------------------------

create or replace function public.create_club_with_admin(
  p_admin_username text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_admin uuid;
  v_club uuid;
  v_slug text;
begin
  if not public.has_permission('manage_clubs') then
    raise exception 'Only Campus+ club administrators can create a club.' using errcode = '42501';
  end if;
  v_admin := public.resolve_club_admin(p_admin_username);
  v_slug := lower(btrim(coalesce(p_payload->>'slug', '')));
  perform set_config('campus.system_context', 'on', true);

  insert into public.communities (
    kind, name, slug, description, subject, club_category, organization_type,
    recruitment_info, meeting_info, contact_info, external_url, visibility,
    join_policy, status, is_official, created_by, approved_by, approved_at,
    member_count, verification_status, source_label, source_url
  ) values (
    'club', p_payload->>'name', v_slug, p_payload->>'description',
    nullif(p_payload->>'subject', ''), p_payload->>'club_category', p_payload->>'organization_type',
    nullif(p_payload->>'recruitment_info', ''), nullif(p_payload->>'meeting_info', ''),
    nullif(p_payload->>'contact_info', ''), nullif(p_payload->>'external_url', ''),
    coalesce(p_payload->>'visibility', 'campus')::public.visibility_level,
    coalesce(p_payload->>'join_policy', 'request'),
    'published', true, v_actor, v_actor, now(), 0,
    case when p_payload->>'verification_status' = 'source_checked' then 'source_checked' else 'pending' end,
    nullif(p_payload->>'source_label', ''), nullif(p_payload->>'source_url', '')
  ) returning id into v_club;

  insert into public.community_members (community_id, user_id, role, status)
  values (v_club, v_admin, 'owner', 'active');

  perform public.log_audit('club.created', 'club', v_club::text,
    jsonb_build_object('admin_username', lower(btrim(p_admin_username))), true, null, 'admin');
  perform public.notify_user(v_admin, 'club_activity', 'You are now a club administrator',
    'Open the club management workspace to review its details and membership.',
    'club', v_club::text, '/clubs/' || v_club::text || '/manage');

  return jsonb_build_object('ok', true, 'id', v_club, 'slug', v_slug, 'admin_id', v_admin);
end;
$$;

create or replace function public.approve_club_request(
  p_request uuid,
  p_admin_username text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.club_creation_requests;
  v_admin uuid;
  v_club uuid;
begin
  if not public.has_permission('manage_clubs') then
    raise exception 'Only Campus+ club administrators can review club requests.' using errcode = '42501';
  end if;

  select * into v_request from public.club_creation_requests where id = p_request for update;
  if v_request.id is null then
    raise exception 'That club request could not be found.' using errcode = '22023';
  end if;
  -- A retry after a committed approval returns the same club and does not
  -- insert another community, membership, notification or audit row.
  if v_request.status = 'approved' and v_request.community_id is not null then
    return jsonb_build_object('ok', true, 'id', v_request.community_id, 'slug',
      (select slug from public.communities where id = v_request.community_id), 'idempotent', true);
  end if;
  if v_request.status <> 'pending' then
    raise exception 'That club request has already been reviewed.' using errcode = '22023';
  end if;

  v_admin := public.resolve_club_admin(p_admin_username);
  perform set_config('campus.system_context', 'on', true);

  insert into public.communities (
    kind, name, slug, description, subject, club_category, organization_type,
    recruitment_info, meeting_info, contact_info, external_url, visibility,
    join_policy, status, is_official, created_by, approved_by, approved_at,
    member_count, verification_status, source_label, source_url
  ) values (
    'club', v_request.name, v_request.slug, v_request.description, v_request.subject,
    v_request.club_category, v_request.organization_type, v_request.recruitment_info,
    v_request.meeting_info, v_request.contact_info, v_request.external_url,
    'campus', 'request', 'published', true, v_actor, v_actor, now(), 0,
    'pending', v_request.source_label, v_request.source_url
  ) returning id into v_club;

  insert into public.community_members (community_id, user_id, role, status)
  values (v_club, v_admin, 'owner', 'active');

  update public.club_creation_requests
     set status = 'approved', reviewed_by = v_actor, reviewed_at = now(),
         review_note = left(nullif(btrim(coalesce(p_review_note, '')), ''), 1000),
         community_id = v_club
   where id = v_request.id;

  perform public.log_audit('club.request_approved', 'club', v_club::text,
    jsonb_build_object('request_id', v_request.id, 'requester_id', v_request.requester_id,
                       'admin_username', lower(btrim(p_admin_username))), true,
    nullif(btrim(coalesce(p_review_note, '')), ''), 'admin');
  perform public.notify_user(v_request.requester_id, 'club_activity',
    'Your club request was approved', v_request.name || ' now has a club page.',
    'club', v_club::text, '/clubs/' || v_club::text);
  perform public.notify_user(v_admin, 'club_activity', 'You are now a club administrator',
    v_request.name || ' was assigned to you by a Campus+ club administrator.',
    'club', v_club::text, '/clubs/' || v_club::text || '/manage');

  return jsonb_build_object('ok', true, 'id', v_club, 'slug', v_request.slug, 'admin_id', v_admin);
end;
$$;

create or replace function public.reject_club_request(
  p_request uuid,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.club_creation_requests;
begin
  if not public.has_permission('manage_clubs') then
    raise exception 'Only Campus+ club administrators can review club requests.' using errcode = '42501';
  end if;
  select * into v_request from public.club_creation_requests where id = p_request for update;
  if v_request.id is null then
    raise exception 'That club request could not be found.' using errcode = '22023';
  end if;
  if v_request.status = 'rejected' then
    return jsonb_build_object('ok', true, 'status', 'rejected', 'idempotent', true);
  end if;
  if v_request.status <> 'pending' then
    raise exception 'That club request has already been reviewed.' using errcode = '22023';
  end if;

  update public.club_creation_requests
     set status = 'rejected', reviewed_by = v_actor, reviewed_at = now(),
         review_note = left(nullif(btrim(coalesce(p_review_note, '')), ''), 1000)
   where id = v_request.id;

  perform public.log_audit('club.request_rejected', 'club_request', v_request.id::text,
    jsonb_build_object('requester_id', v_request.requester_id), true,
    nullif(btrim(coalesce(p_review_note, '')), ''), 'admin');
  perform public.notify_user(v_request.requester_id, 'club_activity',
    'Your club request was not approved',
    coalesce(nullif(btrim(coalesce(p_review_note, '')), ''), 'You can withdraw the request and submit a revised proposal.'),
    'club_request', v_request.id::text, '/clubs/request');

  return jsonb_build_object('ok', true, 'status', 'rejected');
end;
$$;

create or replace function public.withdraw_club_request(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.club_creation_requests;
begin
  select * into v_request from public.club_creation_requests where id = p_request for update;
  if v_request.id is null or v_request.requester_id <> public.current_profile_id() then
    raise exception 'That club request could not be found.' using errcode = '42501';
  end if;
  if v_request.status = 'withdrawn' then
    return jsonb_build_object('ok', true, 'status', 'withdrawn', 'idempotent', true);
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only a pending club request can be withdrawn.' using errcode = '22023';
  end if;
  update public.club_creation_requests set status = 'withdrawn', reviewed_at = now() where id = v_request.id;
  return jsonb_build_object('ok', true, 'status', 'withdrawn');
end;
$$;

-- ---------------------------------------------------------------------------
-- Initial admin assignment for imported/unassigned clubs
-- ---------------------------------------------------------------------------

create or replace function public.assign_club_admin(p_club uuid, p_admin_username text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_admin uuid;
  v_name text;
begin
  if not public.has_permission('manage_clubs') then
    raise exception 'Only Campus+ club administrators can assign an initial club admin.' using errcode = '42501';
  end if;
  select name into v_name from public.communities where id = p_club and kind = 'club';
  if v_name is null then
    raise exception 'That club could not be found.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.community_members
     where community_id = p_club and role = 'owner' and status = 'active'
  ) then
    raise exception 'This club already has an administrator.' using errcode = '22023';
  end if;

  v_admin := public.resolve_club_admin(p_admin_username);
  insert into public.community_members (community_id, user_id, role, status)
  values (p_club, v_admin, 'owner', 'active')
  on conflict (community_id, user_id) do update set role = 'owner', status = 'active';

  perform public.log_audit('club.admin_assigned', 'club', p_club::text,
    jsonb_build_object('admin_username', lower(btrim(p_admin_username))), true, null, 'admin');
  perform public.notify_user(v_admin, 'club_activity', 'You are now a club administrator',
    v_name || ' was assigned to you by a Campus+ club administrator.',
    'club', p_club::text, '/clubs/' || p_club::text || '/manage');
  return jsonb_build_object('ok', true, 'id', p_club, 'admin_id', v_admin);
end;
$$;

-- ---------------------------------------------------------------------------
-- Membership request and decision workflow (one row path, atomic decisions)
-- ---------------------------------------------------------------------------

create or replace function public.join_community(p_community uuid, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_community public.communities;
  v_existing public.community_members;
  v_request public.community_join_requests;
  v_manager uuid;
begin
  if not public.is_active_profile(v_actor) then
    raise exception 'Your account cannot join communities right now.' using errcode = '42501';
  end if;
  select * into v_community from public.communities where id = p_community and status = 'published';
  if v_community.id is null or not public.can_view_community(p_community) then
    raise exception 'That community could not be found.' using errcode = '22023';
  end if;
  if v_community.kind = 'club' and not v_community.admin_assigned then
    raise exception 'Membership opens after a club administrator is assigned.' using errcode = '22023';
  end if;

  select * into v_existing from public.community_members
   where community_id = p_community and user_id = v_actor;
  if v_existing.id is not null and v_existing.status = 'active' then
    return jsonb_build_object('ok', true, 'status', 'active', 'idempotent', true);
  end if;

  select * into v_request from public.community_join_requests
   where community_id = p_community and user_id = v_actor;
  if v_request.id is not null and v_request.status = 'pending' then
    return jsonb_build_object('ok', true, 'status', 'pending', 'idempotent', true);
  end if;

  if v_community.join_policy = 'open' then
    insert into public.community_members (community_id, user_id, role, status)
    values (p_community, v_actor, 'member', 'active')
    on conflict (community_id, user_id) do update set status = 'active';
    return jsonb_build_object('ok', true, 'status', 'active');
  end if;
  if v_community.join_policy <> 'request' then
    raise exception 'This community is invite only.' using errcode = '42501';
  end if;

  insert into public.community_join_requests (community_id, user_id, message, status)
  values (p_community, v_actor, left(nullif(btrim(coalesce(p_message, '')), ''), 300), 'pending')
  on conflict (community_id, user_id) do update
    set message = excluded.message, status = 'pending', decided_by = null, decided_at = null, created_at = now();
  delete from public.community_members
   where community_id = p_community and user_id = v_actor and status = 'pending';

  for v_manager in
    select user_id from public.community_members
     where community_id = p_community and status = 'active' and role in ('owner', 'moderator')
  loop
    perform public.notify_user(v_manager,
      (case when v_community.kind = 'club' then 'club_activity' else 'community_activity' end)::public.notification_type,
      'New join request for ' || v_community.name,
      'Open the membership workspace to review the request.',
      case when v_community.kind = 'club' then 'club' else 'community' end,
      p_community::text,
      case when v_community.kind = 'club' then '/clubs/' || p_community::text || '/manage?view=members'
           else '/communities/' || v_community.slug end);
  end loop;
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

create or replace function public.decide_community_join_request(p_request uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.community_join_requests;
  v_kind public.community_kind;
  v_slug text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or reject.' using errcode = '22023';
  end if;
  select * into v_request from public.community_join_requests where id = p_request for update;
  if v_request.id is null then
    raise exception 'That join request could not be found.' using errcode = '22023';
  end if;
  select kind, slug into v_kind, v_slug from public.communities where id = v_request.community_id;
  if not (
    public.is_community_moderator(v_request.community_id)
    or public.has_permission('manage_clubs') and v_kind = 'club'
    or public.has_permission('moderate_communities')
    or public.has_permission('moderate_all')
  ) then
    raise exception 'Only this community''s managers can decide its requests.' using errcode = '42501';
  end if;
  if v_request.status = p_decision::public.join_request_status then
    return jsonb_build_object('ok', true, 'status', v_request.status, 'idempotent', true);
  end if;
  if v_request.status <> 'pending' then
    raise exception 'That join request has already been decided.' using errcode = '22023';
  end if;

  update public.community_join_requests
     set status = p_decision::public.join_request_status, decided_by = v_actor, decided_at = now()
   where id = v_request.id;
  if p_decision = 'approved' then
    insert into public.community_members (community_id, user_id, role, status)
    values (v_request.community_id, v_request.user_id, 'member', 'active')
    on conflict (community_id, user_id) do update set status = 'active';
  else
    delete from public.community_members
     where community_id = v_request.community_id and user_id = v_request.user_id and status = 'pending';
  end if;

  perform public.notify_user(v_request.user_id,
    (case when v_kind = 'club' then 'club_activity' else 'community_activity' end)::public.notification_type,
    'Your join request was ' || p_decision,
    case when p_decision = 'approved' then 'You can now open the community feed.' else 'The club or community manager reviewed your request.' end,
    case when v_kind = 'club' then 'club' else 'community' end,
    v_request.community_id::text,
    case when v_kind = 'club' then '/clubs/' || v_request.community_id::text else '/communities/' || v_slug end);

  if v_kind = 'club' then
    perform public.log_audit('club.join_request_' || p_decision, 'club', v_request.community_id::text,
      jsonb_build_object('request_id', v_request.id, 'member_id', v_request.user_id), false, null, 'private');
  end if;
  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

-- Decisions go through the atomic RPC, not a client update followed by a second
-- membership write. Existing SELECT and cancellation policies remain intact.
drop policy if exists community_join_requests_decide on public.community_join_requests;
revoke update on public.community_join_requests from authenticated, anon;

create or replace function public.set_community_member_role(
  p_community uuid, p_member uuid, p_role public.community_role
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_old public.community_role;
  v_kind public.community_kind;
begin
  if p_role not in ('member', 'moderator') or p_member = v_actor then
    raise exception 'Choose another member and a valid club role.' using errcode = '22023';
  end if;
  select kind into v_kind from public.communities where id = p_community;
  if not (
    public.has_permission('manage_clubs') and v_kind = 'club'
    or exists (
      select 1 from public.community_members m
       where m.community_id = p_community and m.user_id = v_actor
         and m.role = 'owner' and m.status = 'active'
    )
  ) then
    raise exception 'Only the owner can change member roles.' using errcode = '42501';
  end if;

  update public.community_members set role = p_role
   where community_id = p_community and user_id = p_member and status = 'active' and role <> 'owner'
  returning role into v_old;
  if not found then
    raise exception 'That membership could not be found or is the owner.' using errcode = '22023';
  end if;
  if v_kind = 'club' then
    perform public.log_audit('club.member_role_changed', 'club', p_community::text,
      jsonb_build_object('member_id', p_member, 'role', p_role), false, null, 'private');
    perform public.notify_user(p_member, 'club_activity', 'Your club role changed',
      'A club owner changed your role to ' || p_role || '.', 'club', p_community::text,
      '/clubs/' || p_community::text || '/manage');
  end if;
  return jsonb_build_object('ok', true, 'role', p_role);
end;
$$;

create or replace function public.remove_community_member(p_community uuid, p_member uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind public.community_kind;
begin
  if p_member = public.current_profile_id() then
    raise exception 'Use Leave to leave this community.' using errcode = '22023';
  end if;
  select kind into v_kind from public.communities where id = p_community;
  if not (
    public.is_community_moderator(p_community)
    or public.has_permission('manage_clubs') and v_kind = 'club'
    or public.has_permission('moderate_communities')
    or public.has_permission('moderate_all')
  ) then
    raise exception 'Only this community''s managers can remove members.' using errcode = '42501';
  end if;
  delete from public.community_members
   where community_id = p_community and user_id = p_member and role <> 'owner';
  if not found then
    raise exception 'That member could not be found, or owners cannot be removed.' using errcode = '22023';
  end if;
  if v_kind = 'club' then
    perform public.log_audit('club.member_removed', 'club', p_community::text,
      jsonb_build_object('member_id', p_member), false, null, 'private');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Direct database writes get the same owner protections as the RPCs. A
-- moderator must never demote/delete an owner or move a membership to a club.
create or replace function public.guard_community_membership_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_trusted_writer() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.role = 'owner' and public.community_kind_of(old.community_id) = 'club' then
      raise exception 'A club owner membership cannot be removed directly.' using errcode = '42501';
    end if;
    return old;
  end if;
  new.community_id := old.community_id;
  new.user_id := old.user_id;
  new.joined_at := old.joined_at;
  if old.role = 'owner' and new.role <> 'owner'
     and public.community_kind_of(old.community_id) = 'club' then
    raise exception 'A club owner cannot be demoted directly.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger community_members_guard_write
  before update or delete on public.community_members
  for each row execute function public.guard_community_membership_write();

-- Replace the original role guard with the same check plus owner protection;
-- the write guard above runs first, then this validates who may grant roles.
create or replace function public.guard_community_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_trusted_writer() then return new; end if;
  if new.role is distinct from old.role then
    if not public.is_community_moderator(new.community_id)
       and not (public.has_permission('manage_clubs') and public.community_kind_of(new.community_id) = 'club') then
      raise exception 'Only community owners and moderators can change member roles.' using errcode = '42501';
    end if;
    if new.role = 'owner' and not exists (
      select 1 from public.community_members m
       where m.community_id = new.community_id and m.user_id = public.current_profile_id()
         and m.role = 'owner' and m.status = 'active'
    ) and not (public.has_permission('manage_clubs') and public.community_kind_of(new.community_id) = 'club') then
      raise exception 'Only an owner can transfer ownership.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Club inserts use create_club_with_admin / approve_club_request. Ordinary
-- communities and study groups keep the existing self-creation path.
drop policy if exists communities_insert_own on public.communities;
create policy communities_insert_own on public.communities
  for insert to authenticated with check (
    public.is_active_user()
    and created_by = public.current_profile_id()
    and kind in ('community', 'study_group')
    and public.has_permission('create_communities')
  );

-- ---------------------------------------------------------------------------
-- Club profile update through one scoped, audited RPC
-- ---------------------------------------------------------------------------

create or replace function public.update_club_profile(p_club uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_manage_club(p_club) then
    raise exception 'Only this club''s managers can edit it.' using errcode = '42501';
  end if;
  update public.communities set
    name = p_payload->>'name', description = p_payload->>'description',
    subject = nullif(p_payload->>'subject', ''), club_category = p_payload->>'club_category',
    organization_type = p_payload->>'organization_type',
    recruitment_info = nullif(p_payload->>'recruitment_info', ''),
    meeting_info = nullif(p_payload->>'meeting_info', ''),
    contact_info = nullif(p_payload->>'contact_info', ''),
    external_url = nullif(p_payload->>'external_url', ''),
    visibility = coalesce(p_payload->>'visibility', 'campus')::public.visibility_level,
    join_policy = coalesce(p_payload->>'join_policy', 'request')
   where id = p_club and kind = 'club';
  if not found then raise exception 'That club could not be found.' using errcode = '22023'; end if;
  perform public.log_audit('club.profile_updated', 'club', p_club::text, '{}'::jsonb, false, null, 'private');
  return jsonb_build_object('ok', true, 'id', p_club);
end;
$$;

-- Club-scoped audit entries are readable by that club's managers and global
-- staff, never by unrelated members. No direct-message data is involved.
create policy audit_logs_select_club_managers on public.audit_logs
  for select to authenticated
  using (target_type = 'club' and target_id is not null and public.can_manage_club(target_id));

-- Extend the existing audit writer only for scoped club lifecycle entries.
create or replace function public.log_audit(
  p_action text, p_target_type text default null, p_target_id text default null,
  p_metadata jsonb default null, p_also_moderation boolean default false,
  p_reason text default null, p_visibility public.moderation_visibility default 'staff'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_id uuid;
  v_is_staff boolean;
  v_is_club_action boolean := false;
begin
  if v_actor is null and not public.is_trusted_writer() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  v_is_staff := public.is_staff() or public.is_trusted_writer();
  if p_target_type = 'club' and p_target_id ~ '^[0-9a-f-]{36}$'
     and p_action in ('club.join_request_approved', 'club.join_request_rejected',
                      'club.member_role_changed', 'club.member_removed', 'club.profile_updated') then
    v_is_club_action := public.can_manage_club(p_target_id::uuid);
  end if;

  if not v_is_staff and not v_is_club_action
     and p_action not like 'account.%' and p_action not like 'user.%'
     and p_action not like 'content.self_%'
     and p_action <> 'marketplace.completed' then
    raise exception 'You do not have permission to write audit entries.' using errcode = '42501';
  end if;

  insert into public.audit_logs (actor_user_id, action, target_type, target_id, metadata, visibility)
  values (
    v_actor, left(p_action, 80), left(p_target_type, 60),
    case when p_target_id ~ '^[0-9a-f-]{36}$' then p_target_id::uuid else null end,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'reason', p_reason, 'actor_username', (select username from public.profiles where id = v_actor)),
    case when v_is_staff then p_visibility else 'private'::public.moderation_visibility end
  ) returning id into v_id;

  if p_also_moderation and v_is_staff then
    insert into public.moderation_actions (moderator_id, report_id, action, target_type, target_id, note)
    values (v_actor, nullif(p_metadata->>'report_id', '')::uuid, left(p_action, 60),
      left(p_target_type, 60),
      case when p_target_id ~ '^[0-9a-f-]{36}$' then p_target_id::uuid else null end,
      left(p_reason, 1000));
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Club-linked events and opportunities verify the SPECIFIC club
-- ---------------------------------------------------------------------------

alter table public.opportunities add column club_id uuid references public.communities (id) on delete set null;
create index opportunities_club_idx on public.opportunities (club_id);

create or replace function public.guard_club_linked_content()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_trusted_writer() or new.club_id is null then return new; end if;
  if not exists (select 1 from public.communities c where c.id = new.club_id and c.kind = 'club') then
    raise exception 'Content can only be linked to a club.' using errcode = '22023';
  end if;
  if tg_table_name = 'events'
     and (public.has_permission('manage_events') or public.has_permission('moderate_all')) then return new; end if;
  if tg_table_name = 'opportunities'
     and (public.has_permission('manage_official_content') or public.has_permission('moderate_all')) then return new; end if;
  if not public.can_manage_club(new.club_id) then
    raise exception 'Only this club''s managers can link content to it.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger events_guard_club_link before insert or update on public.events
  for each row execute function public.guard_club_linked_content();
create trigger opportunities_guard_club_link before insert or update on public.opportunities
  for each row execute function public.guard_club_linked_content();

-- Managers can see their club's submitted drafts even when another manager
-- authored them. Ordinary viewers keep the existing published/author policies.
create policy events_select_club_managers on public.events
  for select to authenticated
  using (club_id is not null and public.can_manage_club(club_id));
create policy opportunities_select_club_managers on public.opportunities
  for select to authenticated
  using (club_id is not null and public.can_manage_club(club_id));

-- ---------------------------------------------------------------------------
-- Grants: metadata verification is staff-only; lifecycle RPCs are executable
-- by authenticated users because every function checks its own authority.
-- ---------------------------------------------------------------------------

grant update (organization_type) on public.communities to authenticated;
grant update (club_id) on public.opportunities to authenticated;
revoke update on public.club_creation_requests from authenticated, anon;

revoke all on function public.can_manage_club(uuid) from public, anon;
revoke all on function public.resolve_club_admin(text) from public, anon;
grant execute on function public.can_manage_club(uuid) to authenticated, service_role;
grant execute on function public.resolve_club_admin(text) to service_role;

-- Migration 018's default grants cover the other new functions. Make the
-- anonymous boundary explicit for the state-changing entry points as well.
revoke all on function public.create_club_with_admin(text, jsonb) from public, anon;
revoke all on function public.approve_club_request(uuid, text, text) from public, anon;
revoke all on function public.reject_club_request(uuid, text) from public, anon;
revoke all on function public.withdraw_club_request(uuid) from public, anon;
revoke all on function public.assign_club_admin(uuid, text) from public, anon;
revoke all on function public.join_community(uuid, text) from public, anon;
revoke all on function public.decide_community_join_request(uuid, text) from public, anon;
revoke all on function public.set_community_member_role(uuid, uuid, public.community_role) from public, anon;
revoke all on function public.remove_community_member(uuid, uuid) from public, anon;
revoke all on function public.update_club_profile(uuid, jsonb) from public, anon;

grant execute on function public.create_club_with_admin(text, jsonb) to authenticated, service_role;
grant execute on function public.approve_club_request(uuid, text, text) to authenticated, service_role;
grant execute on function public.reject_club_request(uuid, text) to authenticated, service_role;
grant execute on function public.withdraw_club_request(uuid) to authenticated, service_role;
grant execute on function public.assign_club_admin(uuid, text) to authenticated, service_role;
grant execute on function public.join_community(uuid, text) to authenticated, service_role;
grant execute on function public.decide_community_join_request(uuid, text) to authenticated, service_role;
grant execute on function public.set_community_member_role(uuid, uuid, public.community_role) to authenticated, service_role;
grant execute on function public.remove_community_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.update_club_profile(uuid, jsonb) to authenticated, service_role;
