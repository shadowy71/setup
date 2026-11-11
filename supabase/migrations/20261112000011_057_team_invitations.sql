-- Invitations are private, and all mutations run through narrowly scoped RPCs.
create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_post_id uuid not null references public.team_posts(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique(team_post_id, invitee_id)
);
create index team_invitations_invitee_idx on public.team_invitations(invitee_id,status,created_at desc);
alter table public.team_invitations enable row level security;
create policy team_invitations_involved on public.team_invitations for select to authenticated using (
  public.feature_enabled('team_finder') and public.is_active_user() and
  (invitee_id=public.current_profile_id() or invited_by=public.current_profile_id()) and
  not public.is_blocked_with_current(case when invitee_id=public.current_profile_id() then invited_by else invitee_id end)
);
revoke all on public.team_invitations from public,anon,authenticated;
grant select on public.team_invitations to authenticated;
grant all on public.team_invitations to service_role;

create function public.invite_team_member(p_team uuid,p_username text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid := public.current_profile_id(); target uuid; invitation uuid;
begin
  if not public.is_active_user() or not public.feature_enabled('team_finder') then raise exception 'Unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.team_posts where id=p_team and creator_id=actor and status='published') then raise exception 'Not allowed' using errcode='42501'; end if;
  select id into target from public.profiles where username=lower(btrim(p_username)) and public.is_active_profile(id);
  if target is null or target=actor or public.is_blocked_with_current(target) then raise exception 'Student unavailable' using errcode='22023'; end if;
  if exists(select 1 from public.team_post_requests where team_post_id=p_team and user_id=target and status='accepted') then raise exception 'Already a team member' using errcode='23505'; end if;
  insert into public.team_invitations(team_post_id,invitee_id,invited_by) values(p_team,target,actor)
  on conflict(team_post_id,invitee_id) do update set status='pending',invited_by=actor,responded_at=null,created_at=now()
  returning id into invitation;
  perform public.notify_user(target,'community_activity','Team invitation','You have been invited to a team.','team_post',p_team::text,'/campus/teams/' || p_team::text);
  return invitation;
end $$;
revoke all on function public.invite_team_member(uuid,text) from public,anon;
grant execute on function public.invite_team_member(uuid,text) to authenticated;

create function public.respond_team_invitation(p_invitation uuid,p_accept boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid := public.current_profile_id(); inv public.team_invitations%rowtype; team public.team_posts%rowtype; request_status text;
begin
  if not public.is_active_user() or not public.feature_enabled('team_finder') or p_accept is null then raise exception 'Unavailable' using errcode='42501'; end if;
  select * into inv from public.team_invitations where id=p_invitation and invitee_id=actor for update;
  if not found or inv.status <> 'pending' then raise exception 'Invitation unavailable' using errcode='42501'; end if;
  select * into team from public.team_posts where id=inv.team_post_id for update;
  if not found or team.status <> 'published' or team.creator_id <> inv.invited_by or not public.is_active_profile(team.creator_id) or public.is_blocked_with_current(team.creator_id) then raise exception 'Team unavailable' using errcode='42501'; end if;
  if p_accept then
    insert into public.team_post_requests(team_post_id,user_id,status) values(team.id,actor,'pending') on conflict(team_post_id,user_id) do nothing;
    select status into request_status from public.team_post_requests where team_post_id=team.id and user_id=actor for update;
    if request_status='pending' then
      update public.team_post_requests set status='accepted' where team_post_id=team.id and user_id=actor;
    elsif request_status<>'accepted' then
      raise exception 'Existing request must be withdrawn before accepting' using errcode='22023';
    end if;
  end if;
  update public.team_invitations set status=case when p_accept then 'accepted' else 'declined' end,responded_at=now() where id=inv.id;
end $$;
revoke all on function public.respond_team_invitation(uuid,boolean) from public,anon;
grant execute on function public.respond_team_invitation(uuid,boolean) to authenticated;

create function public.remove_team_member(p_request uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare team_id uuid;
begin
  if not public.is_active_user() or not public.feature_enabled('team_finder') then raise exception 'Unavailable' using errcode='42501'; end if;
  delete from public.team_post_requests r using public.team_posts t
  where r.id=p_request and r.team_post_id=t.id and t.creator_id=public.current_profile_id() and r.status='accepted'
  returning t.id into team_id;
  if team_id is null then raise exception 'Membership unavailable' using errcode='42501'; end if;
  return team_id;
end $$;
revoke all on function public.remove_team_member(uuid) from public,anon;
grant execute on function public.remove_team_member(uuid) to authenticated;
select public.backup_sync_triggers();
