-- =============================================================================
-- Campus+ database tests — 16 random-session channel authorization
-- =============================================================================
-- Migration 030 exists because production was filling its Postgres log with
-- `42501 permission denied for function can_access_random_session`, roughly every 15
-- seconds, from the `random` branch of the two `realtime.messages` channel policies —
-- a branch reached by clients that are still trying to rejoin a retired feature. An
-- error is not a denial: it costs a log line, a failed subscription and a reconnect,
-- and it hides the real question ("may this student see this channel?").
--
-- This suite pins the fixed shape of that path, and the security boundary that came
-- with it:
--
--   1. The policies ask a *current-user-only* predicate, and that predicate alone is
--      what `authenticated` may call. The two-argument helper — which answers the same
--      question about any profile, and is therefore a session-membership oracle — is
--      no longer reachable by a client role at all, while the SECURITY DEFINER Random
--      RPCs that legitimately need it keep working under the service role.
--   2. A participant of an active session is authorized on `random:<session>`; a
--      student who left, a student who was never in it, and a closed session are not —
--      each as a clean `false`, never as an exception.
--   3. Legitimate Realtime messaging survives: a participant can still broadcast on
--      their own session channel and their own `user:` channel, so the hardening did
--      not become a feature flag for the whole socket layer.
--
-- Fixture ids are `16fa…`, and every row this file writes is deleted again. As in
-- suite 15, `auth.users.id` and `profiles.id` are different uuids: the JWT claim
-- below carries the *auth* id, the channel topic carries the *profile* id.
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('16fa0000-0000-4000-a000-000000000001', 'rand.dana@pccoepune.org'),
  ('16fa0000-0000-4000-a000-000000000002', 'rand.eshan@pccoepune.org'),
  ('16fa0000-0000-4000-a000-000000000003', 'rand.farah@pccoepune.org')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', '16fa0000-0000-4000-a000-000000000001', false);
select public.complete_profile('rand_dana', 'Rand Dana');
select set_config('request.jwt.claim.sub', '16fa0000-0000-4000-a000-000000000002', false);
select public.complete_profile('rand_eshan', 'Rand Eshan');
select set_config('request.jwt.claim.sub', '16fa0000-0000-4000-a000-000000000003', false);
select public.complete_profile('rand_farah', 'Rand Farah');
select set_config('request.jwt.claim.sub', '', false);

insert into public.__test_scratch (key, value)
select 'rand_' || split_part(p.username, '_', 2) || '_profile', p.id
  from public.profiles p
 where p.username in ('rand_dana', 'rand_eshan', 'rand_farah')
on conflict (key) do update set value = excluded.value;

-- One session that is open and has two members, one of whom has since left; one that
-- is closed with both still marked as members. `random_sessions_order` requires
-- participant_a < participant_b, and `side` has to follow it, so both are derived.
insert into public.random_sessions (id, participant_a, participant_b, status)
select '16fa0000-0000-4000-b000-000000000001',
       least(x.value, y.value), greatest(x.value, y.value), 'active'
  from public.__test_scratch x, public.__test_scratch y
 where x.key = 'rand_dana_profile' and y.key = 'rand_eshan_profile';

insert into public.random_sessions (id, participant_a, participant_b, status, ended_at)
select '16fa0000-0000-4000-b000-000000000002',
       least(x.value, y.value), greatest(x.value, y.value), 'ended', now()
  from public.__test_scratch x, public.__test_scratch y
 where x.key = 'rand_dana_profile' and y.key = 'rand_farah_profile';

insert into public.random_session_participants (session_id, user_id, side, left_at)
select '16fa0000-0000-4000-b000-000000000001', s.value,
       case when s.value = rs.participant_a then 'a' else 'b' end,
       case when s.key = 'rand_eshan_profile' then now() else null end
  from public.__test_scratch s
  join public.random_sessions rs on rs.id = '16fa0000-0000-4000-b000-000000000001'
 where s.key in ('rand_dana_profile', 'rand_eshan_profile');

insert into public.random_session_participants (session_id, user_id, side)
select '16fa0000-0000-4000-b000-000000000002', s.value,
       case when s.value = rs.participant_a then 'a' else 'b' end
  from public.__test_scratch s
  join public.random_sessions rs on rs.id = '16fa0000-0000-4000-b000-000000000002'
 where s.key in ('rand_dana_profile', 'rand_farah_profile');

-- Channel traffic the authorization decides whether a student can see. Seeded by the
-- cluster owner, because the assertions below are about what `authenticated` may read.
delete from realtime.messages where topic like 'random:16fa%';
insert into realtime.messages (topic, extension, payload, private) values
  ('random:16fa0000-0000-4000-b000-000000000001', 'broadcast', '{"body":"open"}'::jsonb, true),
  ('random:16fa0000-0000-4000-b000-000000000002', 'broadcast', '{"body":"closed"}'::jsonb, true);
-- The `user:` probe rows carry a real profile id, because that branch compares the
-- topic against current_profile_id() and the assertion has to be about a channel that
-- exists for this student and one that exists for another.
insert into realtime.messages (topic, extension, payload, private)
select 'user:' || value, 'broadcast', '{"body":"self"}'::jsonb, true
  from public.__test_scratch
 where key in ('rand_dana_profile', 'rand_farah_profile');

-- ---------------------------------------------------------------------------
-- 1. The shape of the policies, read back from the catalog
-- ---------------------------------------------------------------------------

do $$
declare
  v_read text;
  v_write text;
begin
  select qual into v_read
    from pg_policies
   where schemaname = 'realtime' and tablename = 'messages' and policyname = 'campus_channels_read';
  select with_check into v_write
    from pg_policies
   where schemaname = 'realtime' and tablename = 'messages' and policyname = 'campus_channels_write';

  perform public.test_assert(v_read is not null and v_write is not null,
    'both realtime channel policies must exist — migration 030 recreates them, it does not drop them');

  -- The two-argument name is not a substring of the one-argument name, so this is a
  -- real absence check rather than a spelling accident.
  perform public.test_assert(v_read like '%can_access_own_random_session(%',
    'the read policy must authorize the random topic through the current-user-only predicate');
  perform public.test_assert(v_write like '%can_access_own_random_session(%',
    'the write policy must authorize the random topic through the current-user-only predicate');
  perform public.test_assert(
    position('can_access_random_session(' in v_read) = 0
    and position('can_access_random_session(' in v_write) = 0,
    'no channel policy may call the two-argument session-membership oracle');

  -- Branches that were already working must still be there after a rewrite.
  perform public.test_assert(
    v_read like '%can_access_conversation(%' and v_read like '%''user''%' and v_read like '%''feed''%',
    'the conversation, user and feed branches must survive the recreation of the read policy');
  perform public.test_assert(
    v_write like '%can_access_conversation(%' and v_write like '%''user''%'
    and v_write like '%''conversation''%' and position('''feed''' in v_write) = 0,
    'the write policy must keep its branches and still refuse to accept a client-written feed event');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Grants: the safe predicate only, and never for an anonymous caller
-- ---------------------------------------------------------------------------

select public.test_assert(
  has_function_privilege('authenticated', 'public.can_access_own_random_session(uuid)', 'execute'),
  'authenticated must be able to execute the channel predicate, or every reconnect on a retired topic becomes a 42501 in the log'
);
select public.test_assert(
  has_function_privilege('service_role', 'public.can_access_own_random_session(uuid)', 'execute'),
  'service_role must be able to execute the channel predicate'
);
select public.test_assert(
  not has_function_privilege('anon', 'public.can_access_own_random_session(uuid)', 'execute'),
  'anon must not be able to execute the channel predicate'
);
select public.test_assert(
  not has_function_privilege('authenticated', 'public.can_access_random_session(uuid, uuid)', 'execute'),
  'the oracle is a private session-membership check; PostgREST exposes every executable public function, so authenticated must not have it'
);
select public.test_assert(
  not has_function_privilege('anon', 'public.can_access_random_session(uuid, uuid)', 'execute'),
  'anon must not be able to execute the session-membership oracle'
);
select public.test_assert(
  has_function_privilege('service_role', 'public.can_access_random_session(uuid, uuid)', 'execute'),
  'the internal cross-user check must stay available to the service role and the SECURITY DEFINER Random RPCs'
);

-- The hosted Realtime role is conditional in the migrations and present in the
-- compatibility harness. It gets the narrow predicate only; migration 037 also
-- removes any direct legacy-oracle grant left by a manual production workaround.
do $$
begin
  if to_regrole('supabase_realtime') is not null then
    perform public.test_assert(
      has_function_privilege('supabase_realtime', 'public.can_access_own_random_session(uuid)', 'execute'),
      'the hosted Realtime role must execute the current-user-only channel predicate'
    );
    perform public.test_assert(
      not has_function_privilege('supabase_realtime', 'public.can_access_random_session(uuid, uuid)', 'execute'),
      'the hosted Realtime role must not inherit a direct grant on the cross-user oracle'
    );
  end if;
end $$;

-- Migration 018 grants execute on every public function through a loop, so the shape
-- of this function is what keeps it safe to hand to a client role at all: definer (the
-- base random tables have no participant policies), a pinned search_path, and one
-- argument — it must never grow a way to name another student.
select public.test_assert(
  (select prosecdef from pg_proc where oid = 'public.can_access_own_random_session(uuid)'::regprocedure),
  'the channel predicate has to run as its owner, since a student cannot select from the random base tables'
);
select public.test_assert(
  (select p.proowner = o.proowner
     from pg_proc p, pg_proc o
    where p.oid = 'public.can_access_own_random_session(uuid)'::regprocedure
      and o.oid = 'public.can_access_random_session(uuid, uuid)'::regprocedure),
  'the narrow predicate must retain the migration owner used by the established internal Random functions'
);
select public.test_assert(
  (select o.prosecdef and exists (
       select 1 from unnest(o.proconfig) as c
        where replace(c, ' ', '') = 'search_path=public,pg_temp'
     )
     from pg_proc o
    where o.oid = 'public.can_access_random_session(uuid, uuid)'::regprocedure),
  'the retained internal oracle must stay SECURITY DEFINER with its exact pinned search_path'
);
select public.test_assert(
  (select exists (select 1 from unnest(proconfig) as c
                    where c like 'search_path=public%')
     from pg_proc where oid = 'public.can_access_own_random_session(uuid)'::regprocedure),
  'the channel predicate must pin search_path like every other security definer function here'
);
select public.test_assert(
  (select pg_get_function_arguments(oid) = 'p_session uuid'
     from pg_proc where oid = 'public.can_access_own_random_session(uuid)'::regprocedure),
  'the channel predicate takes only the session — never a profile to ask about'
);
select public.test_assert(
  (select provolatile = 's' and prokind = 'f'
     from pg_proc where oid = 'public.can_access_own_random_session(uuid)'::regprocedure),
  'the channel predicate must stay a stable function, since Realtime evaluates it per subscription'
);
-- The oracle keeps its two-argument signature for internal use; asserting it here keeps
-- "we revoked it, we did not delete it" honest for the retained Random RPCs.
select public.test_assert(
  (select pronargs = 2
     and pg_get_function_arguments(oid) like 'p_session uuid, p_user uuid DEFAULT NULL%'
     from pg_proc where oid = 'public.can_access_random_session(uuid, uuid)'::regprocedure),
  'the internal oracle must still exist with its optional second argument for the SECURITY DEFINER RPCs'
);

-- ---------------------------------------------------------------------------
-- 3. What each student can actually answer
-- ---------------------------------------------------------------------------

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);

-- Dana: still in an active session.
select set_config('request.jwt.claim.sub', '16fa0000-0000-4000-a000-000000000001', false);
select public.test_assert(
  (select public.can_access_own_random_session('16fa0000-0000-4000-b000-000000000001')),
  'a participant of an open session must be authorized on that channel'
);
select public.test_assert(
  not (select public.can_access_own_random_session('16fa0000-0000-4000-b000-000000000002')),
  'a closed session must not authorize a channel, even for a former participant'
);
select public.test_assert(
  not (select public.can_access_own_random_session(null)),
  'a malformed topic resolves to null through safe_uuid, and null must answer "no" rather than error'
);
-- The oracle cannot be borrowed, not even to ask about herself.
select public.test_assert_denied(
  $sql$ select public.can_access_random_session('16fa0000-0000-4000-b000-000000000001', null) $sql$,
  'authenticated must not be able to call the two-argument oracle at all'
);
-- Channel view for the authorized case. Channel authorization is per channel rather
-- than per row — the policy predicate reads `realtime.topic()`, not the row's own
-- topic — so "some rows are visible" is what a granted join looks like from inside,
-- exactly as in suite 15.
select set_config('realtime.topic', 'random:16fa0000-0000-4000-b000-000000000001', false);
select public.test_assert(
  (select count(*) from realtime.messages where private) > 0,
  'an authorized participant must see the channel rows'
);
-- Legitimate messaging is not collateral damage: a participant may still broadcast.
insert into realtime.messages (topic, extension, payload, private)
values ('random:16fa0000-0000-4000-b000-000000000001', 'broadcast', '{"body":"from dana"}'::jsonb, true);
select public.test_assert(
  (select count(*) from realtime.messages
    where private and payload->>'body' = 'from dana') = 1,
  'a participant must still be able to broadcast on their own session channel'
);
select set_config('realtime.topic',
  (select 'user:' || value from public.__test_scratch where key = 'rand_dana_profile'), false);
select public.test_assert(
  (select count(*) from realtime.messages where private) > 0,
  'the per-user channel topic must stay authorized for its owner'
);
select set_config('realtime.topic',
  (select 'user:' || value from public.__test_scratch where key = 'rand_farah_profile'), false);
select public.test_assert(
  (select count(*) from realtime.messages where private) = 0,
  'another student''s per-user channel must stay closed while the policies are being hardened'
);
-- The RPC that consults the oracle for the caller still answers for a participant,
-- which is what the revoke had to leave alone.
select public.test_assert(
  (select (public.random_session_state('16fa0000-0000-4000-b000-000000000001') ->> 'status') = 'active'),
  'random_session_state must keep working for a participant now that the oracle is not client-executable'
);
select set_config('realtime.topic', '', false);

-- Eshan: was in the session, then left.
select set_config('request.jwt.claim.sub', '16fa0000-0000-4000-a000-000000000002', false);
select public.test_assert(
  not (select public.can_access_own_random_session('16fa0000-0000-4000-b000-000000000001')),
  'a student who left the session must lose channel access without an error'
);
select set_config('realtime.topic', 'random:16fa0000-0000-4000-b000-000000000001', false);
select public.test_assert(
  (select count(*) from realtime.messages where private) = 0,
  'a former participant must not be able to read the channel'
);
select public.test_assert_denied(
  $sql$
    insert into realtime.messages (topic, extension, payload, private)
    values ('random:16fa0000-0000-4000-b000-000000000001', 'broadcast', '{"body":"resent"}'::jsonb, true)
  $sql$,
  'a former participant must not be able to broadcast on the channel either'
);
select set_config('realtime.topic', '', false);

-- Farah: never in either session. This is the eavesdropping case the oracle used to
-- make possible, so both directions are asserted.
select set_config('request.jwt.claim.sub', '16fa0000-0000-4000-a000-000000000003', false);
select public.test_assert(
  not (select public.can_access_own_random_session('16fa0000-0000-4000-b000-000000000001')),
  'a student who is not in the session must be denied'
);
select public.test_assert_denied(
  $sql$ select public.can_access_random_session('16fa0000-0000-4000-b000-000000000001',
         (select value from public.__test_scratch where key = 'rand_dana_profile')) $sql$,
  'the oracle must not be reachable by a student, so private session membership stays private'
);
select set_config('realtime.topic', 'random:16fa0000-0000-4000-b000-000000000001', false);
select public.test_assert(
  (select count(*) from realtime.messages where private) = 0,
  'a stranger must not be able to join a private session channel'
);
select public.test_assert_denied(
  $sql$
    insert into realtime.messages (topic, extension, payload, private)
    values ('random:16fa0000-0000-4000-b000-000000000001', 'broadcast', '{"body":"eavesdrop"}'::jsonb, true)
  $sql$,
  'a stranger must not be able to write onto a session channel'
);
-- A retired feature must not leave a signed-in-only hole for anonymous callers either.
select set_config('request.jwt.claim.role', 'anon', false);
select set_config('request.jwt.claim.sub', '', false);
reset role;
set role anon;
select public.test_assert_denied(
  $sql$ select public.can_access_own_random_session('16fa0000-0000-4000-b000-000000000001') $sql$,
  'anon must not be able to execute the channel predicate'
);
select public.test_assert_denied(
  $sql$ select public.can_access_random_session('16fa0000-0000-4000-b000-000000000001', null) $sql$,
  'anon must not be able to execute the session-membership oracle'
);
reset role;

-- ---------------------------------------------------------------------------
-- 4. The internal path the revoke must not have broken
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.role', 'service_role', false);
select public.test_assert(
  (select public.can_access_random_session('16fa0000-0000-4000-b000-000000000001',
     (select value from public.__test_scratch where key = 'rand_dana_profile'))),
  'the retained Random RPCs still ask the oracle about a specific profile as the function owner'
);
-- The retained RPCs are unchanged: `random_session_state` asked the oracle for the
-- caller and answered for dana above, and as a non-participant it still returns null
-- rather than an error, which is the "do not distinguish not found from not yours"
-- contract from migration 010.
select public.test_assert(
  public.random_session_state('16fa0000-0000-4000-b000-000000000001') is null,
  'the retained random_session_state RPC must keep refusing a stranger without raising'
);

-- ---------------------------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------------------------

delete from realtime.messages
 where topic like 'random:16fa%'
    or topic in (select 'user:' || value from public.__test_scratch where key like 'rand_%');
delete from public.random_sessions
 where id in ('16fa0000-0000-4000-b000-000000000001', '16fa0000-0000-4000-b000-000000000002');
delete from public.__test_scratch where key like 'rand_%';
