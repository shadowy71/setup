-- =============================================================================
-- Campus+ database tests — 12 live messaging unread model and channel privacy
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('d1000000-0000-4000-a000-000000000001', 'live.asha@pccoepune.org'),
  ('d1000000-0000-4000-a000-000000000002', 'live.bharat@pccoepune.org'),
  ('d1000000-0000-4000-a000-000000000003', 'live.chirag@pccoepune.org')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-a000-000000000001', false);
select public.complete_profile('live_asha', 'Live Asha');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-a000-000000000002', false);
select public.complete_profile('live_bharat', 'Live Bharat');
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-a000-000000000003', false);
select public.complete_profile('live_chirag', 'Live Chirag');

-- A sends to B: B has one unread; A's own outgoing row is not unread for A.
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-a000-000000000001', false);

do $$
declare
  v_other uuid;
  v_conversation uuid;
begin
  select id into v_other from public.profiles where username = 'live_bharat';
  v_conversation := public.get_or_create_direct_conversation(v_other);
  insert into public.__test_scratch (key, value) values ('live_conversation', v_conversation);
  insert into public.messages (conversation_id, sender_id, body)
  values (v_conversation, public.current_profile_id(), 'first live message');
end;
$$;

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-a000-000000000002', false);
do $$
declare
  v_conversation uuid := (select value from public.__test_scratch where key = 'live_conversation');
  v_unread integer;
begin
  select unread_count into v_unread
  from public.messaging_unread_counts()
  where conversation_id = v_conversation;
  perform public.test_assert(v_unread = 1, '1. the recipient has exactly one unread message');

  insert into public.messages (conversation_id, sender_id, body)
  values (v_conversation, public.current_profile_id(), 'recipient reply');

  select unread_count into v_unread
  from public.messaging_unread_counts()
  where conversation_id = v_conversation;
  perform public.test_assert(v_unread = 1, '2. sending does not increase the sender unread count');

  perform public.mark_conversation_read(v_conversation);
  select unread_count into v_unread
  from public.messaging_unread_counts()
  where conversation_id = v_conversation;
  perform public.test_assert(v_unread = 0, '3. opening/marking the conversation clears its unread count');
end;
$$;

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-a000-000000000001', false);
do $$
declare
  v_conversation uuid := (select value from public.__test_scratch where key = 'live_conversation');
  v_unread integer;
begin
  select unread_count into v_unread
  from public.messaging_unread_counts()
  where conversation_id = v_conversation;
  perform public.test_assert(v_unread = 1, '4. the other incoming reply remains unread for its recipient');

  insert into public.messages (conversation_id, sender_id, body)
  select v_conversation, public.current_profile_id(), 'burst ' || n
  from generate_series(1, 35) as burst_index(n);
end;
$$;

-- Exact counts deliberately exceed the retired 30-message approximation.
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-a000-000000000002', false);
do $$
declare
  v_conversation uuid := (select value from public.__test_scratch where key = 'live_conversation');
  v_unread integer;
begin
  select unread_count into v_unread
  from public.messaging_unread_counts()
  where conversation_id = v_conversation;
  perform public.test_assert(v_unread = 35, '5. the shell RPC counts every unread message, not only the newest 30');

  select unread into v_unread from public.conversation_inbox(30) where id = v_conversation;
  perform public.test_assert(v_unread = 35, '6. inbox and navigation use the same exact unread count');

  perform public.mark_conversation_read(v_conversation);
  select unread_count into v_unread
  from public.messaging_unread_counts()
  where conversation_id = v_conversation;
  perform public.test_assert(v_unread = 0, '7. a read receipt clears the entire eligible conversation backlog');
end;
$$;

-- A non-member receives neither unread state nor an inbox row for the thread.
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-a000-000000000003', false);
do $$
declare
  v_conversation uuid := (select value from public.__test_scratch where key = 'live_conversation');
  v_rows integer;
begin
  select count(*) into v_rows
  from public.messaging_unread_counts()
  where conversation_id = v_conversation;
  perform public.test_assert(v_rows = 0, '8. unread state is invisible to non-members');

  select count(*) into v_rows from public.conversation_inbox(100) where id = v_conversation;
  perform public.test_assert(v_rows = 0, '9. inbox reconciliation cannot expose another users conversation');
end;
$$;

-- Realtime Authorization: one fixture row is visible only while the current
-- channel topic itself is authorised for the signed-in profile.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
insert into realtime.messages (topic, extension, payload)
values ('live-policy-fixture', 'broadcast', '{}'::jsonb);

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-a000-000000000001', false);
select set_config('realtime.topic', 'user:' || public.current_profile_id(), false);
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from realtime.messages where topic = 'live-policy-fixture';
  perform public.test_assert(v_rows = 1, '10. a student can subscribe to their own private user topic');
end;
$$;

select set_config(
  'realtime.topic',
  (select 'user:' || id from public.profiles where username = 'live_bharat'),
  false
);
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from realtime.messages where topic = 'live-policy-fixture';
  perform public.test_assert(v_rows = 0, '11. a student cannot subscribe to another users private topic');
end;
$$;

select set_config(
  'realtime.topic',
  'conversation:' || (select value from public.__test_scratch where key = 'live_conversation'),
  false
);
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from realtime.messages where topic = 'live-policy-fixture';
  perform public.test_assert(v_rows = 1, '12. a member can subscribe to the conversation receipt topic');
end;
$$;

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-a000-000000000003', false);
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from realtime.messages where topic = 'live-policy-fixture';
  perform public.test_assert(v_rows = 0, '13. a non-member cannot subscribe to the conversation topic');
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
delete from realtime.messages where topic = 'live-policy-fixture';
delete from public.conversations where id = (select value from public.__test_scratch where key = 'live_conversation');
delete from public.__test_scratch where key = 'live_conversation';
reset role;
