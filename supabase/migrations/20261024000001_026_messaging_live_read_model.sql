-- =============================================================================
-- Campus+ migration 026 — exact unread state for live messaging
-- =============================================================================
-- No new tables or client-writable columns. The navigation badge and reconnect
-- path need the caller's per-conversation read position and exact unread count,
-- including counts above the old 30-message presentation window. Both functions
-- remain SECURITY INVOKER: conversation, membership, message, block and account
-- visibility continue to be decided by the existing RLS policies.
-- Existing index used by both reads: messages_conversation_idx
-- (conversation_id, created_at DESC).
-- =============================================================================

create or replace function public.conversation_inbox(p_limit integer default 30)
returns table (
  id                      uuid,
  kind                    public.conversation_kind,
  title                   text,
  community_id            uuid,
  status                  public.content_status,
  last_message_at         timestamptz,
  created_at              timestamptz,
  is_muted                boolean,
  last_read_at            timestamptz,
  unread                  integer,
  last_message_id         uuid,
  last_message_sender_id  uuid,
  last_message_body       text,
  last_message_gif        jsonb,
  last_message_created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with mine as (
    select m.conversation_id, m.is_muted, m.last_read_at
    from public.conversation_members m
    where m.user_id = public.current_profile_id()
      and m.status = 'active'
  )
  select
    c.id,
    c.kind,
    c.title,
    c.community_id,
    c.status,
    c.last_message_at,
    c.created_at,
    mine.is_muted,
    mine.last_read_at,
    (
      select count(*)::integer
      from public.messages msg
      where msg.conversation_id = c.id
        and msg.sender_id <> public.current_profile_id()
        and (mine.last_read_at is null or msg.created_at > mine.last_read_at)
    ) as unread,
    latest.id,
    latest.sender_id,
    latest.body,
    latest.gif,
    latest.created_at
  from public.conversations c
  join mine on mine.conversation_id = c.id
  left join lateral (
    select msg.id, msg.sender_id, msg.body, msg.gif, msg.created_at
    from public.messages msg
    where msg.conversation_id = c.id
    order by msg.created_at desc
    limit 1
  ) latest on true
  order by c.last_message_at desc
  limit coalesce(p_limit, 30);
$$;

comment on function public.conversation_inbox(integer) is
  'RLS-scoped inbox: newest message preview and exact unread count per visible conversation.';

/** A small shell snapshot: no message bodies, member lists, or profile joins. */
create or replace function public.messaging_unread_counts()
returns table (
  conversation_id uuid,
  last_read_at    timestamptz,
  unread_count    integer
)
language sql
stable
security invoker
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
  order by mine.conversation_id;
$$;

comment on function public.messaging_unread_counts() is
  'RLS-scoped exact unread counts and read positions for the signed-in member; used by the private navigation badge and reconnect sync.';

revoke all on function public.conversation_inbox(integer) from public, anon;
grant execute on function public.conversation_inbox(integer) to authenticated, service_role;
revoke all on function public.messaging_unread_counts() from public, anon;
grant execute on function public.messaging_unread_counts() to authenticated, service_role;
