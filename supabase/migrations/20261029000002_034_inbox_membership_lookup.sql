-- =============================================================================
-- Campus+ migration 034 — bounded authorization for conversation inbox
-- =============================================================================
-- The inbox has the same member-only boundary as messaging_unread_counts(), but
-- also returns each visible conversation's latest preview. Keep every field and
-- predicate while making the boundary explicit once per inbox query instead of
-- re-entering member/message RLS for every message considered by the aggregates
-- and latest-message lookups.
--
-- There is still no arbitrary conversation argument. Rows require the verified
-- JWT profile, active membership and a published conversation; a non-member gets
-- no row and therefore no preview. Only that member's own read position/mute
-- state is returned. The exact unread and latest-message calculations, ordering
-- and p_limit behavior are unchanged. Database suite 12's recipient, non-member,
-- overflow-count and read-receipt tests cover this contract.
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
security definer
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
  where c.status = 'published'
  order by c.last_message_at desc
  limit coalesce(p_limit, 30);
$$;

comment on function public.conversation_inbox(integer) is
  'Member-only inbox with exact unread counts and latest previews for the JWT profile; active membership in a published conversation is required for every row.';

revoke all on function public.conversation_inbox(integer) from public, anon;
grant execute on function public.conversation_inbox(integer) to authenticated, service_role;
