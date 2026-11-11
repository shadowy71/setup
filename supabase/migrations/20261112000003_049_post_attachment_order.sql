-- Reorder only an exact snapshot of this owner's current ready attachments.
-- The account and post locks serialize this with reservations and removals.
create function public.storage_reorder_post_attachments(p_owner uuid,p_post uuid,p_files uuid[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare expected integer; supplied integer;
begin
  if p_owner is null or p_post is null or p_files is null or not public.is_active_profile(p_owner) then raise exception 'Invalid request' using errcode='42501'; end if;
  perform 1 from public.storage_accounts where profile_id=p_owner for update;
  if not found then raise exception 'Not permitted' using errcode='42501'; end if;
  perform 1 from public.posts where id=p_post and author_id=p_owner and status='published' and deleted_at is null for update;
  if not found then raise exception 'Post unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.storage_files where resource_type='post_attachment' and resource_id=p_post and status='reserved') then
    raise exception 'Upload pending' using errcode='23505';
  end if;
  select count(*) into expected from public.storage_files where resource_type='post_attachment' and resource_id=p_post and owner_id=p_owner and status='ready';
  select count(distinct id) into supplied from unnest(p_files) id;
  if expected <> coalesce(array_length(p_files,1),0) or supplied <> expected or exists (
    select 1 from unnest(p_files) id where not exists (
      select 1 from public.storage_files f join public.post_attachment_links l on l.file_id=f.id
      where f.id=id and f.owner_id=p_owner and f.resource_type='post_attachment' and f.resource_id=p_post and f.status='ready' and l.post_id=p_post))
  then raise exception 'Attachments changed; reload' using errcode='23505'; end if;
  update public.post_attachment_links l set position=ordered.ordinality-1
    from unnest(p_files) with ordinality as ordered(file_id,ordinality)
    where l.file_id=ordered.file_id and l.post_id=p_post;
end $$;
revoke all on function public.storage_reorder_post_attachments(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.storage_reorder_post_attachments(uuid,uuid,uuid[]) to service_role;
