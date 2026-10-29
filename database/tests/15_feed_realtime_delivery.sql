-- =============================================================================
-- Campus+ database tests — 15 live feed delivery, publication scope and the
-- visibility rules the client's instant feed placement mirrors
-- =============================================================================
-- This suite is the database half of "a new post reaches a feed that is already
-- open". The client half (`lib/social/feed-state.js`) refuses to place a row it was
-- not handed by the server, on the strength of the same predicates asserted here — so
-- if any of these rules ever changes, the optimistic placement has to change with it
-- rather than quietly show something the feed would not.
--
-- Three things are proved:
--   1. `public.posts` is on the Realtime publication, and the publication still
--      contains exactly what it is supposed to: fixing a stale feed must not turn
--      into a licence to stream private tables.
--   2. A `feed:<profile id>` channel is joinable by that student and by nobody else,
--      and cannot be broadcast on at all.
--   3. A published post reaches another student's feed; pending, hidden, removed,
--      community-scoped and blocked-away rows reach nobody's feed — while the author
--      can still read their own, which is what lets the app say "sent for review"
--      instead of pretending that a write is a publication.
--
-- Fixture ids are `15fe…` and nothing else, so the rows this file creates (and
-- deletes again) cannot collide with another suite's probe account. Note that
-- `auth.users.id` and `profiles.id` are different uuids by design, and every FK
-- below points at the *profile*; the scratch table is what maps one to the other.
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('15fe0000-0000-4000-a000-000000000001', 'feed.asha@pccoepune.org'),
  ('15fe0000-0000-4000-a000-000000000002', 'feed.bilal@pccoepune.org'),
  ('15fe0000-0000-4000-a000-000000000003', 'feed.chaya@pccoepune.org')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', '15fe0000-0000-4000-a000-000000000001', false);
select public.complete_profile('feed_asha', 'Feed Asha');
select set_config('request.jwt.claim.sub', '15fe0000-0000-4000-a000-000000000002', false);
select public.complete_profile('feed_bilal', 'Feed Bilal');
select set_config('request.jwt.claim.sub', '15fe0000-0000-4000-a000-000000000003', false);
select public.complete_profile('feed_chaya', 'Feed Chaya');
select set_config('request.jwt.claim.sub', '', false);

insert into public.__test_scratch (key, value)
select 'feed_' || split_part(p.username, '_', 2) || '_profile', p.id
  from public.profiles p
 where p.username in ('feed_asha', 'feed_bilal', 'feed_chaya')
on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------------------
-- 1. Publication membership and scope
-- ---------------------------------------------------------------------------

do $$
declare
  v_published text[];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'no supabase_realtime publication in this cluster — skipping publication membership checks';
    return;
  end if;

  perform public.test_assert(
    exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts'
    ),
    'public.posts must be on the realtime publication, or an open feed can never learn about a new post'
  );

  select coalesce(array_agg(tablename order by tablename), '{}')
    into v_published
    from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public';

  -- Nothing private joined the stream on the way in. The tables the feed does not
  -- need are named explicitly, so an accidental widening cannot hide behind a count.
  perform public.test_assert(
    not (v_published && array[
      'profile_private', 'audit_logs', 'moderation_actions', 'backup_private',
      'random_messages', 'blocks', 'mutes', 'community_join_requests',
      'poll_votes', 'reactions', 'mentions', 'username_history'
    ]),
    'the feed fix must not widen realtime delivery beyond posts'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Private-channel authorization for the feed topic
-- ---------------------------------------------------------------------------
-- `realtime.messages` is the authorization gate Realtime consults for a private
-- channel, with `realtime.topic()` set to the channel being joined. A row-count probe
-- under a chosen topic is therefore the same check the server performs.
--
-- The topic carries the *profile* id — which is what `LiveFeedProvider` subscribes
-- to, and what migration 029 compares against `current_profile_id()`.

-- Seeded by the cluster owner: an `authenticated` session may not write to a feed
-- channel at all (one of the assertions below), so it cannot seed its own.
delete from realtime.messages where topic like 'feed:%';
insert into realtime.messages (topic, extension, payload, private)
select 'feed:' || value, 'postgres_changes', '{}'::jsonb, true
  from public.__test_scratch
 where key in ('feed_asha_profile', 'feed_bilal_profile');

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '15fe0000-0000-4000-a000-000000000001', false);

-- Asha, on her own topic: authorized. Channel authorization is per channel rather
-- than per row, so "the whole probe set is readable" is what a granted channel looks
-- like from the inside.
select set_config('realtime.topic',
  (select 'feed:' || value from public.__test_scratch where key = 'feed_asha_profile'), false);
select public.test_assert(
  (select count(*) from realtime.messages where private) = 2,
  'a student must be able to join their own feed channel'
);

-- Asha, on Bilal's topic: nothing. A feed channel is not a way to eavesdrop on
-- another student's subscription.
select set_config('realtime.topic',
  (select 'feed:' || value from public.__test_scratch where key = 'feed_bilal_profile'), false);
select public.test_assert(
  (select count(*) from realtime.messages where private) = 0,
  'a student must not be able to join another student''s feed channel'
);

-- Nobody may broadcast onto a feed channel, not even onto their own: migration 029
-- deliberately left the write policy without a `feed` branch, so a feed change stays
-- a database fact rather than something a client asserts.
select public.test_assert_denied(
  $sql$
    insert into realtime.messages (topic, extension, payload, private)
    select 'feed:' || value, 'broadcast', '{"body":"injected"}'::jsonb, true
      from public.__test_scratch
     where key = 'feed_asha_profile'
  $sql$,
  'a student must not be able to broadcast onto a feed channel'
);

-- The channels migration 014 already authorized still resolve: recreating the read
-- policy in 029 must not have narrowed them.
select set_config('realtime.topic',
  (select 'user:' || value from public.__test_scratch where key = 'feed_asha_profile'), false);
select public.test_assert(
  (select count(*) from realtime.messages where private) = 2,
  'the per-user channel topic must stay authorized for its owner'
);

select set_config('realtime.topic', '', false);

-- ---------------------------------------------------------------------------
-- 3. What the feed is allowed to show
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

-- Asha posts to campus. Bilal and Chaya are ordinary students.
insert into public.posts (id, author_id, kind, body, visibility, status)
values ('15fe0000-0000-4000-b000-000000000001',
        (select value from public.__test_scratch where key = 'feed_asha_profile'),
        'post', 'Live feed probe: the lab 3 projector is fixed.', 'campus', 'published');

-- One awaiting review, one hidden by a moderator: states that must never be
-- presented as "on the feed" to anybody, the author's own feed included.
insert into public.posts (id, author_id, kind, body, visibility, status, deleted_at)
values
  ('15fe0000-0000-4000-b000-000000000002',
   (select value from public.__test_scratch where key = 'feed_asha_profile'),
   'post', 'Live feed probe: awaiting review.', 'campus', 'pending', null),
  ('15fe0000-0000-4000-b000-000000000003',
   (select value from public.__test_scratch where key = 'feed_asha_profile'),
   'post', 'Live feed probe: hidden after a report.', 'campus', 'hidden', null),
  ('15fe0000-0000-4000-b000-000000000005',
   (select value from public.__test_scratch where key = 'feed_asha_profile'),
   'post', 'Live feed probe: softly deleted.', 'campus', 'published', now());

insert into public.communities (name, slug, description, visibility, join_policy, created_by, status)
values ('Feed Only Circle', 'feed-only-circle', 'Members-only circle used by the feed probe.',
        'community', 'invite',
        (select value from public.__test_scratch where key = 'feed_asha_profile'), 'published')
on conflict (slug) do nothing;

insert into public.__test_scratch (key, value)
select 'feed_community', id from public.communities where slug = 'feed-only-circle'
on conflict (key) do update set value = excluded.value;

-- Asha is the circle's creator, so she is a member; the post is published and
-- visible to her, and invisible to everyone else.
insert into public.posts (id, author_id, kind, body, visibility, status, community_id)
values ('15fe0000-0000-4000-b000-000000000004',
        (select value from public.__test_scratch where key = 'feed_asha_profile'),
        'post', 'Live feed probe: circle only.', 'community', 'published',
        (select value from public.__test_scratch where key = 'feed_community'));

-- Bilal's view: the published campus row is there, exactly once; nothing else is.
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '15fe0000-0000-4000-a000-000000000002', false);

select public.test_assert(
  (select count(*) from public.campus_feed(50, 0, 'newest')
    where id = '15fe0000-0000-4000-b000-000000000001') = 1,
  'a published campus post must be in another student''s feed'
);
select public.test_assert(
  (select count(*) from public.campus_feed(50, 0, 'newest')
    where id in ('15fe0000-0000-4000-b000-000000000002',
                 '15fe0000-0000-4000-b000-000000000003',
                 '15fe0000-0000-4000-b000-000000000004')) = 0,
  'a pending, hidden or community-scoped post must not appear in the campus feed'
);
select public.test_assert(
  (select count(*) from public.posts
    where id in ('15fe0000-0000-4000-b000-000000000002',
                 '15fe0000-0000-4000-b000-000000000003',
                 '15fe0000-0000-4000-b000-000000000004')) = 0,
  'another student cannot select a post the feed does not show'
);
select public.test_assert(
  (select count(*) from public.posts
    where community_id = (select value from public.__test_scratch where key = 'feed_community')) = 0,
  'a non-member cannot read a members-only community post'
);

-- The bounded reconciliation lookup answers only which already-loaded IDs are
-- still eligible. It must match campus_feed rather than posts_select_author:
-- pending, hidden, deleted and community-scoped rows return no visible ID.
select public.test_assert(
  (select array_agg(id order by id) from public.campus_feed_post_visibility(array[
    '15fe0000-0000-4000-b000-000000000001'::uuid,
    '15fe0000-0000-4000-b000-000000000002'::uuid,
    '15fe0000-0000-4000-b000-000000000003'::uuid,
    '15fe0000-0000-4000-b000-000000000004'::uuid,
    '15fe0000-0000-4000-b000-000000000005'::uuid
  ])) = array['15fe0000-0000-4000-b000-000000000001'::uuid],
  'another student reconciles only the published campus post as visible'
);

-- Asha's own view: she can read the states that are not published — that is what
-- makes an honest "sent for review" possible — and her own feed still excludes them.
select set_config('request.jwt.claim.sub', '15fe0000-0000-4000-a000-000000000001', false);

select public.test_assert(
  (select count(*) from public.posts
    where id in ('15fe0000-0000-4000-b000-000000000002',
                 '15fe0000-0000-4000-b000-000000000003')) = 2,
  'an author must still be able to read their own unpublished rows'
);
select public.test_assert(
  (select count(*) from public.campus_feed(50, 0, 'newest')
    where id in ('15fe0000-0000-4000-b000-000000000002',
                 '15fe0000-0000-4000-b000-000000000003')) = 0,
  'an author''s own feed must not show their unapproved or hidden post'
);
select public.test_assert(
  (select array_agg(id order by id) from public.campus_feed_post_visibility(array[
    '15fe0000-0000-4000-b000-000000000001'::uuid,
    '15fe0000-0000-4000-b000-000000000002'::uuid,
    '15fe0000-0000-4000-b000-000000000003'::uuid,
    '15fe0000-0000-4000-b000-000000000004'::uuid,
    '15fe0000-0000-4000-b000-000000000005'::uuid
  ])) = array['15fe0000-0000-4000-b000-000000000001'::uuid],
  'author read access elsewhere must not retain hidden or pending posts in shared Home reconciliation'
);

-- A block removes a published post from the blocker's feed without touching the row:
-- delivery is per subscriber, which is exactly why one shared publication is enough
-- and no additional table has to be exposed.
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);
insert into public.blocks (blocker_id, blocked_id, reason)
values ((select value from public.__test_scratch where key = 'feed_bilal_profile'),
        (select value from public.__test_scratch where key = 'feed_asha_profile'),
        'feed probe')
on conflict (blocker_id, blocked_id) do nothing;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '15fe0000-0000-4000-a000-000000000002', false);
select public.test_assert(
  (select count(*) from public.campus_feed(50, 0, 'newest')
    where id = '15fe0000-0000-4000-b000-000000000001') = 0,
  'a blocked author''s post must not appear in the blocker''s feed'
);
select public.test_assert(
  (select count(*) from public.posts
    where id = '15fe0000-0000-4000-b000-000000000001') = 0,
  'a blocked author''s post must not be selectable by the blocker'
);
select public.test_assert(
  (select count(*) from public.campus_feed_post_visibility(array[
    '15fe0000-0000-4000-b000-000000000001'::uuid
  ])) = 0,
  'a blocked author''s post must reconcile out of the blocker''s loaded feed'
);

-- Chaya blocked nobody, so she still sees it.
select set_config('request.jwt.claim.sub', '15fe0000-0000-4000-a000-000000000003', false);
select public.test_assert(
  (select count(*) from public.campus_feed(50, 0, 'newest')
    where id = '15fe0000-0000-4000-b000-000000000001') = 1,
  'blocking one student must not hide a post from the rest of campus'
);
select public.test_assert(
  (select count(*) from public.campus_feed_post_visibility(array[
    '15fe0000-0000-4000-b000-000000000001'::uuid
  ])) = 1,
  'a valid loaded post remains visible to a student who has not blocked its author'
);

-- The lookup itself enforces the bound, not only the HTTP caller. A valid ID at
-- position 511 is unchecked rather than reported as hidden or as visible.
select public.test_assert(
  (select count(*) from public.campus_feed_post_visibility(
    array_cat(
      (select array_agg(gen_random_uuid()) from generate_series(1, 510)),
      array['15fe0000-0000-4000-b000-000000000001'::uuid]
    )
  )) = 0,
  'visibility reconciliation must not inspect IDs beyond its 510-ID bound'
);

-- ---------------------------------------------------------------------------
-- Cleanup, so the suite can be re-run against a cluster that already has data
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

delete from public.blocks where blocker_id = (select value from public.__test_scratch where key = 'feed_bilal_profile');
delete from public.posts where id::text like '15fe0000-0000-4000-b%';
delete from public.community_members
 where community_id = (select value from public.__test_scratch where key = 'feed_community');
delete from public.communities where slug = 'feed-only-circle';
delete from public.__test_scratch where key like 'feed_%';
delete from realtime.messages where topic like 'feed:%';
