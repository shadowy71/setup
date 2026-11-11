-- Delete and audit as one operation; do not grant notice permissions to new roles.
create function public.delete_official_notice(p_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare deleted_id uuid;
begin
  if not public.is_active_user() or not public.has_permission('manage_notices') then
    raise exception 'Not allowed' using errcode='42501';
  end if;
  delete from public.notices where id=p_id returning id into deleted_id;
  if deleted_id is null then return false; end if;
  insert into public.audit_logs(actor_user_id,action,target_type,target_id,metadata,visibility)
  values(public.current_profile_id(),'notice.delete','notice',deleted_id,'{}'::jsonb,'staff');
  return true;
end $$;
revoke all on function public.delete_official_notice(uuid) from public,anon;
grant execute on function public.delete_official_notice(uuid) to authenticated;
