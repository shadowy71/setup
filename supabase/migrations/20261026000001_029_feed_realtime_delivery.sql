-- =============================================================================
-- Campus+ migration 029 — live delivery of new posts to already-open feeds
-- =============================================================================
-- Problem this fixes (no change to any row, policy or column):
--   A post was written and published correctly, but a feed that was already open
--   could not find out about it. Two configurations were missing, and only two:
--
--     1. `public.posts` was not a member of the `supabase_realtime` publication.
--        Realtime only ever *reads* the logical replication stream for tables in
--        that publication, so no Postgres Changes event for a post can exist
--        regardless of what any client subscribes to or what RLS allows. This was
--        deliberate once (migration 014 published only the messaging tables and
--        `notifications`) and simply never revisited when the feed grew a
--        client-side surface.
--     2. A private channel on a `feed:<profile id>` topic had no matching branch in
--        the `realtime.messages` read policy from migration 014, whose `case`
--        expression ends in `else false`. Every other branch there is for chat or
--        for the per-user fan-out channel the shell already owns.
--
-- What lands here:
--   1. `public.posts` is added to the publication — one table, the one the feed
--      needs. `comments`, `reactions`, `poll_votes`, `mentions` and every private
--      table stay out of the stream, so this does not widen what Realtime can read
--      beyond "a post row changed".
--   2. `campus_channels_read` gains a `feed` branch: the subscriber may receive
--      events on their own `feed:<uuid>` topic and nobody else's. The
--      `campus_channels_write` policy is left exactly as it is, so nothing can
--      broadcast on a feed topic at all.
--
-- What this does NOT do (and deliberately must not):
--   * It does not change row visibility. Delivery is authorised per subscriber by
--     the existing `posts` SELECT policies — `posts_select_visible` (published,
--     not deleted, active author, not blocked, not muted, community membership via
--     `can_view_community()`), `posts_select_author` and `posts_select_staff`. A
--     student therefore cannot receive a post they could not already fetch with the
--     same publishable key. Private channels additionally honour column-level
--     SELECT grants, and `public.posts` restricts no column from `authenticated`
--     beyond what those policies already expose.
--   * It adds no trigger, no outbox, no queue and no polling endpoint. The
--     application side of this change only *invalidates* a rendered feed and lets
--     the existing read path (`campus_feed()` and its hydration) decide what shows;
--     no payload generated here is ever rendered directly.
--   * It grants nothing new to `anon` (migration 014 revokes all of it) and no
--     service-role key is involved anywhere: Postgres Changes over a browser
--     channel with the publishable key is the whole mechanism.
--
-- Style: identical to migration 014 — guarded so it applies cleanly on plain
-- PostgreSQL where neither the publication nor `realtime.messages` exists, and
-- idempotent on re-apply.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Publication membership: posts rows are now on the stream
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.posts;
    exception
      when duplicate_object then null;
      -- The role applying migrations is not the table owner on every hosting
      -- topology. Say so, and say what to run, rather than aborting a deployment
      -- over a delivery optimisation the app degrades away from safely.
      when insufficient_privilege then
        raise notice 'Campus+: % is not the owner of public.posts. As the table owner or super user run: alter publication supabase_realtime add table public.posts;', current_user;
    end;
  else
    raise notice 'Campus+: no supabase_realtime publication here — Postgres Changes for posts are unavailable until the hosting platform creates it.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Private-channel authorization for the per-student feed topic
-- ----------------------------------------------------------------------------
-- Topics in use, all owned by the subscriber:
--   conversation:<uuid>  random:<uuid>  user:<profile uuid>   (014)
--   feed:<profile uuid>                                      (this migration)
--
-- The topic is the subscriber's own profile id, so the policy is a
-- "you may join your own channel" check; which *rows* arrive is the table's
-- SELECT policy's decision above.

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'Campus+: realtime.messages not present (plain Postgres). Skipping channel policies.';
    return;
  end if;

  execute $policy$
    drop policy if exists campus_channels_read on realtime.messages;
  $policy$;
  execute $policy$
    create policy campus_channels_read on realtime.messages
      for select to authenticated
      using (
        case split_part(realtime.topic(), ':', 1)
          when 'conversation' then
            public.can_access_conversation(public.safe_uuid(split_part(realtime.topic(), ':', 2)))
          when 'random' then
            public.can_access_random_session(public.safe_uuid(split_part(realtime.topic(), ':', 2)))
          when 'user' then
            public.safe_uuid(split_part(realtime.topic(), ':', 2)) = public.current_profile_id()
          when 'feed' then
            public.safe_uuid(split_part(realtime.topic(), ':', 2)) = public.current_profile_id()
          else false
        end
      );
  $policy$;
end $$;
