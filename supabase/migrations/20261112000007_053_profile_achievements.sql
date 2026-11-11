-- Student-submitted profile achievements are distinct from system-awarded,
-- deterministic badges. They are labelled self-reported in the application.
create table public.profile_achievements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(btrim(title)) between 3 and 140),
  description text not null check (length(btrim(description)) between 5 and 1000),
  category text not null check (category in ('academic','competition','community','creative','sport','other')),
  achieved_on date,
  status public.content_status not null default 'published' check (status in ('published','hidden','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profile_achievements_owner_idx on public.profile_achievements(owner_id, achieved_on desc, created_at desc);
create trigger profile_achievements_touch before update on public.profile_achievements for each row execute function public.touch_updated_at();
alter table public.profile_achievements enable row level security;
create policy profile_achievements_read on public.profile_achievements for select to authenticated using (
  public.feature_enabled('achievements') and (
    (status = 'published' and public.is_active_profile(owner_id) and not public.is_blocked_with_current(owner_id))
    or owner_id = public.current_profile_id() or public.has_permission('moderate_all')
  )
);
create policy profile_achievements_insert on public.profile_achievements for insert to authenticated with check (
  public.feature_enabled('achievements') and public.is_active_user() and owner_id = public.current_profile_id() and status = 'published'
);
create policy profile_achievements_update on public.profile_achievements for update to authenticated using (
  public.feature_enabled('achievements') and (owner_id = public.current_profile_id() or public.has_permission('moderate_all'))
) with check (public.feature_enabled('achievements') and (owner_id = public.current_profile_id() or public.has_permission('moderate_all')));
create policy profile_achievements_delete on public.profile_achievements for delete to authenticated using (
  public.feature_enabled('achievements') and owner_id = public.current_profile_id()
);
revoke all on public.profile_achievements from anon, authenticated;
grant select, delete on public.profile_achievements to authenticated;
grant insert (owner_id,title,description,category,achieved_on) on public.profile_achievements to authenticated;
grant update (title,description,category,achieved_on,status) on public.profile_achievements to authenticated;
grant all on public.profile_achievements to service_role;
create function public.guard_profile_achievement_status() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status is distinct from old.status then
    if not public.has_permission('moderate_all') then
      raise exception 'Only moderators can change achievement status' using errcode='42501';
    end if;
    insert into public.audit_logs(actor_user_id,action,target_type,target_id,metadata,visibility)
    values (public.current_profile_id(),'achievement.moderate','profile_achievement',new.id,jsonb_build_object('previous_status',old.status,'new_status',new.status),'staff');
    insert into public.moderation_actions(moderator_id,action,target_type,target_id,previous_status,new_status)
    values (public.current_profile_id(),'achievement.moderate','profile_achievement',new.id,old.status::text,new.status::text);
  end if;
  return new;
end $$;
revoke all on function public.guard_profile_achievement_status() from public,anon,authenticated;
create trigger guard_profile_achievement_status before update on public.profile_achievements for each row execute function public.guard_profile_achievement_status();
select public.backup_sync_triggers();
