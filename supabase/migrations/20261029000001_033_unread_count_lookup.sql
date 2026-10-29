-- =============================================================================
-- Campus+ migration 033 — bounded authorization for the shell unread snapshot
-- =============================================================================
-- The navigation snapshot previously re-entered conversation/member/message RLS
-- for every message in every one of the caller's conversations. The function's
-- result is already scoped to the current profile's active memberships, so that
-- repeated work is unnecessary. Keep the exact same boundary explicitly:
--   * public.current_profile_id() comes from the verified JWT;
--   * membership must belong to that profile and be active;
--   * the conversation must be published (the membership policy's condition);
--   * only incoming messages after that membership's read position are counted.
--
-- There is no conversation argument, no message body/member projection and no
-- staff/non-member branch. A non-member therefore receives no row to filter.
-- The existing exact-count, read-receipt and foreign-thread SQL tests remain
-- authoritative. SECURITY DEFINER only avoids re-running equivalent RLS checks;
-- it does not broaden the rows or fields this function can return.
-- =============================================================================

create or replace function public.messaging_unread_counts()
returns table (
  conversation_id uuid,
  last_read_at    timestamptz,
  unread_count    integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    mine.conversation_id,
    mine.last_read_at,
    (
      select count(*)::integer
      from public.messages msg
      where msg.conversation_id = mine.conversation_id
        and msg.sender_id <> public.current_profile_id()
        and (mine.last_read_at is null or msg.created_at > mine.last_read_at)
    ) as unread_count
  from public.conversation_members mine
  join public.conversations c on c.id = mine.conversation_id
  where mine.user_id = public.current_profile_id()
    and mine.status = 'active'
    and c.status = 'published'
  order by mine.conversation_id;
$$;

comment on function public.messaging_unread_counts() is
  'Exact incoming unread counts for the JWT profile only, bounded to active memberships in published conversations; no message content or arbitrary conversation input.';

revoke all on function public.messaging_unread_counts() from public, anon;
grant execute on function public.messaging_unread_counts() to authenticated, service_role;
