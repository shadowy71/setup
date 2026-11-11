-- Read-only operational view of Campus+ ledger rows, never the Drive account.
-- The ledger stays private; this function returns no provider IDs or checksums.
create function public.admin_storage_summary()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_actor uuid := public.current_profile_id(); v_result jsonb;
begin
  if v_actor is null or not public.is_active_profile(v_actor)
     or not (public.has_role('admin') or public.has_role('super_admin'))
     or not public.has_permission('manage_backups') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'charged_bytes', coalesce(sum(byte_size) filter (where status in ('reserved', 'ready', 'delete_pending')), 0),
    'ready_count', count(*) filter (where status = 'ready'),
    'reserved_count', count(*) filter (where status = 'reserved'),
    'delete_pending_count', count(*) filter (where status = 'delete_pending'),
    'recent', coalesce((select jsonb_agg(row_to_json(r) order by r.created_at desc, r.id desc)
      from (select id, owner_id, original_name, mime_type, byte_size, resource_type, status, created_at
            from public.storage_files order by created_at desc, id desc limit 50) r), '[]'::jsonb)
  ) into v_result from public.storage_files;
  return v_result;
end;
$$;
revoke all on function public.admin_storage_summary() from public, anon;
grant execute on function public.admin_storage_summary() to authenticated;
