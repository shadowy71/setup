-- Campus+ migration 037 — reassert least-privilege Realtime function grants
-- =============================================================================
-- Migration 030 is the policy fix: realtime.messages uses the one-argument,
-- current-user-only predicate and never calls the two-argument membership
-- oracle. Production logs that still name can_access_random_session therefore
-- need the ordered migrations applied; this file must not be used as a shortcut
-- around 030.
--
-- This small, idempotent drift repair reasserts only the final grant contract.
-- `authenticated` is the role named by the private-channel policies. Supabase's
-- optional supabase_realtime database role receives the same narrow predicate
-- when that role exists. Neither role needs the cross-user oracle.
-- =============================================================================

revoke all on function public.can_access_own_random_session(uuid) from public, anon;
grant execute on function public.can_access_own_random_session(uuid) to authenticated, service_role;

-- Close the internal oracle to API roles even if a previous manual workaround
-- granted it back. Random's SECURITY DEFINER RPCs and the service role retain
-- their intended internal path; browser roles receive no cross-user membership
-- visibility.
revoke all on function public.can_access_random_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_access_random_session(uuid, uuid) to service_role;

do $$
begin
  if to_regrole('supabase_realtime') is not null then
    execute 'revoke all on function public.can_access_random_session(uuid, uuid) from supabase_realtime';
    execute 'grant execute on function public.can_access_own_random_session(uuid) to supabase_realtime';
  end if;
end $$;
