-- Campus+ 084 — signed-in visitors may read published Home posts.
--
-- Standalone campus posts, including existing ones, are now readable by active
-- external accounts. This deliberately changes their audience: all signed-in
-- visitors can see them. It does not grant posting or commenting privileges,
-- change community access, reveal private/community-only posts, or open notices.
-- Feed and attachment RPCs are SECURITY INVOKER and inherit posts RLS.

-- Do not change community_visible_to_current(): it also guards campus-only
-- communities and other surfaces that are not part of this request.
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
      (community_id is null and (
        public.community_visible_to_current(visibility)
        or (visibility = 'campus' and public.is_visitor() and public.is_active_user())
      ))
      or (community_id is not null and public.can_view_community(community_id))
    )
  );

comment on policy posts_select_visible on public.posts is
  'Published standalone public and campus posts are readable by signed-in visitors; restricted communities and other visibility rules remain unchanged (084).';

-- Comments remain readable only when their parent post can be read. Keep the
-- existing filters and extend only the same standalone campus-post branch.
drop policy if exists comments_select_visible on public.comments;
create policy comments_select_visible on public.comments
  for select to authenticated
  using (
    status = 'published'
    and exists (
      select 1 from public.posts p
       where p.id = comments.post_id
         and p.status = 'published'
         and p.deleted_at is null
         and public.is_active_profile(p.author_id)
         and not public.is_blocked_with_current(p.author_id)
         and (
           (p.community_id is null and (
             public.community_visible_to_current(p.visibility)
             or (p.visibility = 'campus' and public.is_visitor() and public.is_active_user())
           ))
           or (p.community_id is not null and public.can_view_community(p.community_id))
         )
    )
  );

comment on policy comments_select_visible on public.comments is
  'Published comments follow their readable parent post, including standalone campus posts visible to signed-in visitors (084).';
