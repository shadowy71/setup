-- Private, directional follow relationships between existing Campus+ profiles.
-- No counters or public follower lists are exposed.
create table public.user_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint user_follows_no_self check (follower_id <> followed_id)
);

create index user_follows_followed_idx on public.user_follows (followed_id, follower_id);
create index posts_following_feed_idx on public.posts (author_id, created_at desc, id desc)
  where status = 'published' and deleted_at is null;

alter table public.user_follows enable row level security;
revoke all on public.user_follows from public, anon, authenticated;
grant select, insert, delete on public.user_follows to authenticated;
grant all on public.user_follows to service_role;

create policy user_follows_select_own on public.user_follows
  for select to authenticated using (follower_id = public.current_profile_id());
create policy user_follows_insert_own on public.user_follows
  for insert to authenticated with check (
    follower_id = public.current_profile_id()
    and public.is_active_user()
    and public.is_active_profile(followed_id)
    and not public.is_blocked_with_current(followed_id)
  );
create policy user_follows_delete_own on public.user_follows
  for delete to authenticated using (follower_id = public.current_profile_id());

-- Preserve the existing snapshot and change-capture contract for new tables.
select public.backup_sync_triggers();

-- Invoker RLS is retained. Explicit predicates also prevent a moderator's
-- broader post policy from widening the ordinary Following feed.
create function public.following_feed(p_limit integer default 10, p_offset integer default 0)
returns setof public.posts
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select p.*
  from public.user_follows f
  join public.posts p on p.author_id = f.followed_id
  where f.follower_id = public.current_profile_id()
    and public.is_active_user()
    and public.feature_enabled('feed')
    and p.status = 'published'
    and p.deleted_at is null
    and public.is_active_profile(p.author_id)
    and not public.is_blocked_with_current(p.author_id)
    and not public.is_muted_by_current(p.author_id)
    and ((p.community_id is null and p.visibility in ('public', 'campus'))
      or (p.community_id is not null and public.can_view_community(p.community_id)))
  order by p.created_at desc, p.id desc
  limit greatest(1, least(coalesce(p_limit, 10), 50))
  offset greatest(0, least(coalesce(p_offset, 0), 500));
$$;
revoke all on function public.following_feed(integer, integer) from public, anon;
grant execute on function public.following_feed(integer, integer) to authenticated, service_role;
