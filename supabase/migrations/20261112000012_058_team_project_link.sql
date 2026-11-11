-- An optional association: existing team requests stay unchanged.
alter table public.team_posts add column project_id uuid references public.projects(id) on delete set null;
create index team_posts_project_idx on public.team_posts(project_id) where project_id is not null;
grant update(project_id) on public.team_posts to authenticated;
create function public.guard_team_project_link() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.project_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id)
    and not exists(select 1 from public.projects p where p.id=new.project_id and p.creator_id=new.creator_id and p.status='published') then
    raise exception 'Only your published projects may be linked' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_team_project_link() from public,anon,authenticated;
create trigger team_project_link_guard before insert or update of project_id on public.team_posts
for each row execute function public.guard_team_project_link();
