-- =============================================================================
-- Campus+ migration 030 — Realtime channel authorization must not depend on a
-- client-executable cross-user oracle (stops the `42501` flood, closes the oracle)
-- =============================================================================
-- The symptom, from the production Postgres log: 815 of 1 000 exported entries are
--   `permission denied for function can_access_random_session`  (SQLSTATE 42501)
-- arriving roughly every 15 seconds while the site is in use.
--
-- Why that happens, end to end:
--
--   1. Migration 014 gave `realtime.messages` two private-channel policies whose
--      `case` expression includes a `random` branch:
--          when 'random' then public.can_access_random_session(<uuid from the topic>)
--      Realtime evaluates that expression as the subscribing role to decide whether
--      a `random:<session uuid>` channel may be joined or broadcast on.
--   2. `can_access_random_session(p_session, p_user)` was written in migration 010 as
--      an *internal* helper: SECURITY DEFINER, and with an **optional second
--      argument** so the Random RPCs could ask about somebody else. Its second
--      parameter makes it a session-membership oracle in the wrong hands — it answers
--      "is *this other profile* in *that private session*", and the base tables
--      deliberately have no participant policies (migration 022), so the function is
--      the only thing standing between a caller and that answer.
--   3. The Random Chat UI was retired in migration 023 — there is no `/random` route,
--      no nav entry, no `random:` subscription anywhere in the application any more
--      (verified: the only `.channel(` call sites are `conversation:`, `user:` and,
--      since 029, `feed:`). But a tab that was open before the retirement, a stale
--      Router/prefetch cache, or any other long-lived client keeps trying to *rejoin*
--      the private channel it already had. Realtime re-checks the policy on every
--      (re)subscribe, and the client reconnects on its own backoff — which is the
--      ~15-second cadence, and why it only appears in active periods.
--   4. On this project, the role evaluating the policy does not have EXECUTE on that
--      helper, so each check raises 42501 instead of returning `false`. The two are
--      worlds apart: a denial is an answer, an error is a log line, a failed
--      subscription, a retried socket, and — for the connection pool — churn. The
--      `08P01 unexpected EOF on standby connection` entries line up with the same
--      loop: a Realtime socket that never reaches SUBSCRIBED is torn down while its
--      replication connection is still being set up.
--
--      Why the grant is missing in production but present in the repository's history
--      is not something this file can settle: migration 018 explicitly grants EXECUTE
--      on every public function to `authenticated`, so a fresh database built from
--      these migrations does *not* reproduce the error. Migration 022 documents an
--      earlier change made directly against the live project, outside the migration
--      history, with exactly this signature. This migration therefore stops depending
--      on that grant either way, rather than re-asserting it.
--
-- What lands here, in order of consequence:
--
--   A. `can_access_own_random_session(p_session)` — a new, deliberately narrow
--      predicate for policy use: one argument, no way to ask about anybody but the
--      caller (`public.current_profile_id()` inside), SECURITY DEFINER because the
--      base tables have no participant policies, and `false` for a session that is no
--      longer active. Granted to `authenticated` and `service_role` explicitly, so a
--      channel check can never again fail on a missing grant for the retired topic.
--   B. Both `realtime.messages` policies now call A for the `random` branch. Nothing
--      else in them changes — the `conversation`, `user` and `feed` branches are
--      carried over verbatim from 014 and 029, including the `else false` fallback.
--   C. The oracle is closed: EXECUTE on `can_access_random_session(uuid, uuid)` is
--      revoked from `public` and `anon` and `authenticated`, and kept for
--      `service_role`. Internal callers are unaffected — every one of them is a
--      SECURITY DEFINER Random RPC (`end_random_session`, `random_session_state`,
--      `send_random_message`, `report_random_session`, and the retention pair
--      `purge_random_data` / `sweep_random_state`) running as the function owner, and
--      migration 010 wrote them that way precisely so the cross-user question could
--      stay server-side. Every one of those six was verified to be SECURITY DEFINER
--      before this revoke was written. The
--      application's own `lib/actions/random.js` never calls it (it reads the two
--      participant-safe views), which was verified before this revoke was written.
--
-- This migration grants nothing on any table, changes no policy on `random_*`
-- tables, does not delete retired data, and does not touch messaging, notifications
-- or the feed channel authorization from 029 beyond carrying its branch forward.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- A. The current-user-only predicate the policies may safely call
-- ----------------------------------------------------------------------------

create or replace function public.can_access_own_random_session(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.random_session_participants rp
      join public.random_sessions rs on rs.id = rp.session_id
     where rp.session_id = p_session
       and rp.user_id = public.current_profile_id()
       and rp.left_at is null
       and rs.status = 'active'
  );
$$;

comment on function public.can_access_own_random_session is
  'Realtime channel predicate for a random session: does the *calling* student still '
  'belong to this session. One argument by design — the two-argument '
  'can_access_random_session(p_session, p_user) can answer that question about any '
  'profile, so it stays an internal helper of the SECURITY DEFINER Random RPCs and is '
  'not executable by API roles. Returns false once the session is no longer active, '
  'which is also the point of the retired feature: no new channel access.';

-- Explicit, not inherited: the whole problem was a policy that depended on a grant
-- nobody owned. `anon` is excluded, as everywhere else in this schema.
revoke all on function public.can_access_own_random_session(uuid) from public, anon;
grant execute on function public.can_access_own_random_session(uuid) to authenticated, service_role;

-- Where a hosting platform authorizes private channels through its own role, that
-- role needs the *narrow* predicate and nothing else. Guarded, because it does not
-- exist on a plain Postgres install (and must not be created here).
do $$
begin
  if to_regrole('supabase_realtime') is not null then
    execute 'grant execute on function public.can_access_own_random_session(uuid) to supabase_realtime';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- B + C. The policies use A; the oracle stops being client-callable
-- ----------------------------------------------------------------------------

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'Campus+: realtime.messages not present (plain Postgres). Skipping channel policies.';
    return;
  end if;

  -- Read (subscribe/receive). Identical to migration 029's except for the `random`
  -- branch, which now asks the current-user-only predicate.
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
            public.can_access_own_random_session(public.safe_uuid(split_part(realtime.topic(), ':', 2)))
          when 'user' then
            public.safe_uuid(split_part(realtime.topic(), ':', 2)) = public.current_profile_id()
          when 'feed' then
            public.safe_uuid(split_part(realtime.topic(), ':', 2)) = public.current_profile_id()
          else false
        end
      );
  $policy$;

  -- Write (broadcast/send). Same substitution; the policy is still insert-only for
  -- `authenticated`, so a feed or channel change remains a database fact rather than
  -- something a client asserts.
  execute $policy$
    drop policy if exists campus_channels_write on realtime.messages;
  $policy$;
  execute $policy$
    create policy campus_channels_write on realtime.messages
      for insert to authenticated
      with check (
        case split_part(realtime.topic(), ':', 1)
          when 'conversation' then
            public.can_access_conversation(public.safe_uuid(split_part(realtime.topic(), ':', 2)))
          when 'random' then
            public.can_access_own_random_session(public.safe_uuid(split_part(realtime.topic(), ':', 2)))
          when 'user' then
            public.safe_uuid(split_part(realtime.topic(), ':', 2)) = public.current_profile_id()
          else false
        end
      );
  $policy$;
end $$;

-- The oracle, off the RPC surface. PostgREST exposes every executable public function
-- to the roles that can execute it, so "not executable by `authenticated`" is what
-- makes it internal again; the Random RPCs call it as the function owner and are
-- unchanged.
revoke all on function public.can_access_random_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_access_random_session(uuid, uuid) to service_role;

comment on function public.can_access_random_session is
  'Internal: may be asked about any profile, which is exactly why it is not executable '
  'by API roles (migration 030). Callers are the SECURITY DEFINER Random RPCs in '
  'migration 010 and the service role. A policy or a client predicate must use '
  'can_access_own_random_session(uuid) instead.';
