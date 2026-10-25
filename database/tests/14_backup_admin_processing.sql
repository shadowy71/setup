-- =============================================================================
-- Campus+ database tests — 14 admin-authorized backup processing
-- =============================================================================
-- Proves the properties the Admin → Backups "run now" path depends on:
--   * a single expiring lease per kind blocks concurrent runs but never
--     deletes or silently completes queued jobs;
--   * an interrupted run's `running` jobs are requeued, not lost;
--   * failed batches become claimable again once their backoff elapses;
--   * admin state and run logging are permission-checked, secret-free and
--     audited; worker-only RPCs stay unreachable from the browser.
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email)
values ('f2000000-0000-4000-a000-000000000001', 'backup.admin028@pccoepune.org')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', 'f2000000-0000-4000-a000-000000000001', false);
select public.complete_profile('backup_admin_028', 'Backup Admin 028');
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_profile uuid;
begin
  select pp.profile_id into v_profile
    from public.profile_private pp
   where pp.auth_user_id = 'f2000000-0000-4000-a000-000000000001';
  insert into public.user_roles (user_id, role_key) values (v_profile, 'super_admin')
  on conflict do nothing;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Queued jobs are preserved, never deleted or silently completed
-- -----------------------------------------------------------------------------
do $$
declare
  v_before integer;
  v_after  integer;
  i        integer;
begin
  select count(*) into v_before from public.backup_jobs where status = 'pending';
  for i in 1..12 loop
    insert into public.backup_jobs (kind, status, note)
    values ('incremental', 'pending', '028-stuck-job-' || i);
  end loop;

  perform public.test_assert(
    public.backup_acquire_run_lease('incremental', '028-worker-a', 180),
    '1. the first worker acquires the incremental lease');

  select count(*) into v_after from public.backup_jobs where status = 'pending';
  perform public.test_assert(v_after = v_before + 12,
    '2. acquiring a lease does NOT delete or complete any of the 12 queued jobs');
  perform public.test_assert(
    (select count(*) from public.backup_jobs where note like '028-stuck-job-%' and status = 'done') = 0,
    '3. no unfinished queued job is silently marked successful');
end $$;

-- -----------------------------------------------------------------------------
-- 2. Concurrency: a second, different owner cannot steal a live lease
-- -----------------------------------------------------------------------------
do $$
begin
  perform public.test_assert(
    not public.backup_acquire_run_lease('incremental', '028-worker-b', 180),
    '4. a second worker cannot steal a live lease');

  perform public.test_assert(
    public.backup_acquire_run_lease('snapshot', '028-worker-b', 180),
    '5. leases are per kind — a snapshot run can proceed while incremental is busy');
  perform public.backup_release_run_lease('snapshot', '028-worker-b');

  -- Releasing with the WRONG owner must not free someone else's lease.
  perform public.backup_release_run_lease('incremental', '028-worker-b');
  perform public.test_assert(
    not public.backup_acquire_run_lease('incremental', '028-worker-c', 180),
    '6. only the lease owner can release it');

  perform public.backup_release_run_lease('incremental', '028-worker-a');
  perform public.test_assert(
    public.backup_acquire_run_lease('incremental', '028-worker-c', 180),
    '7. the lease is reusable immediately after the owner releases it');
end $$;

-- -----------------------------------------------------------------------------
-- 3. Crash recovery: expired lease takeover requeues orphaned running jobs
-- -----------------------------------------------------------------------------
do $$
declare
  v_job uuid;
begin
  insert into public.backup_jobs (kind, status, note)
  values ('incremental', 'running', '028-orphaned-job') returning id into v_job;

  -- Simulate a killed function: the lease has expired and a job is stuck.
  update public.backup_run_leases
     set lease_until = now() - interval '1 second'
   where kind = 'incremental';

  perform public.test_assert(
    public.backup_acquire_run_lease('incremental', '028-worker-d', 180),
    '8. an expired lease can be taken over by a new run');
  perform public.test_assert(
    (select status from public.backup_jobs where id = v_job) = 'pending',
    '9. a job orphaned by the interrupted run is requeued, not deleted or marked done');
  perform public.test_assert(
    (select count(*) from public.backup_jobs where status = 'pending') >= 12,
    '10. the original 12 queued jobs still exist after takeover');

  perform public.backup_release_run_lease('incremental', '028-worker-d');
end $$;

-- -----------------------------------------------------------------------------
-- 4. Retry: a failed batch is reclaimable once its backoff has elapsed
-- -----------------------------------------------------------------------------
do $$
declare
  v_batch public.backup_batches;
  v_id uuid;
begin
  insert into public.backup_batches (
    kind, status, range_key, first_change_id, last_change_id,
    attempt_count, next_attempt_at, last_error, created_at
  ) values (
    'incremental', 'failed', '028:retry:1:1', 1, 1,
    2, now() - interval '1 second', 'simulated Drive outage',
    now() - interval '10 years'
  ) returning id into v_id;

  select * into v_batch from public.backup_claim_batch('028-retry-worker', 500, 300);
  perform public.test_assert(v_batch.id = v_id and v_batch.status = 'uploading',
    '11. a failed batch whose backoff elapsed is reclaimed for retry (same row, new attempt)');
  perform public.test_assert(v_batch.attempt_count = 3,
    '12. the retry increments the durable attempt count for exponential backoff');

  -- A pending event set is never discarded by a failed run.
  perform public.test_assert(
    (select count(*) from public.backup_change_log) > 0,
    '13. outbox events are retained across failures');

  update public.backup_batches set status = 'failed', lease_owner = null,
         lease_until = null, next_attempt_at = now() + interval '1 hour'
   where id = v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Admin state + run log: permission checked, audited, secret-free
-- -----------------------------------------------------------------------------
do $$
declare
  v_state jsonb;
  v_denied boolean := false;
  v_run uuid;
begin
  -- Unprivileged authenticated session cannot read job state or write a log.
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'f1000000-0000-4000-a000-0000000000ff', false);
  begin
    perform public.backup_admin_state();
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform public.test_assert(v_denied,
    '14. a session without manage_backups cannot read backup job state');

  perform public.test_assert_denied(
    'select public.backup_record_run(''incremental'', ''verified'', ''{}''::jsonb)',
    '15. a session without manage_backups cannot write a run log');

  -- Super Admin session.
  perform set_config('request.jwt.claim.sub', 'f2000000-0000-4000-a000-000000000001', false);
  v_state := public.backup_admin_state();
  perform public.test_assert(
    v_state ? 'jobs' and v_state ? 'leases' and v_state ? 'batches' and v_state ? 'last_runs',
    '16. backup_admin_state returns job counts, leases, batch retry state and run history');
  perform public.test_assert(
    (v_state->'jobs'->>'queued')::int >= 12,
    '17. the admin sees the real queued-job count (12 stuck jobs preserved)');
  perform public.test_assert(
    v_state::text not like '%credential_ciphertext%'
    and v_state::text not like '%refresh_token%'
    and v_state::text not like '%row_data%'
    and v_state::text not like '%client_secret%',
    '18. backup_admin_state never returns credentials, row images or secrets');

  v_run := public.backup_record_run('incremental', 'verified',
    jsonb_build_object('verified', 2, 'objects', jsonb_build_array(jsonb_build_object('fileId', 'drive-file-028'))));
  perform public.test_assert(v_run is not null,
    '19. a Super Admin can record a run and receives its id');
  perform public.test_assert(
    exists (select 1 from public.audit_logs where action = 'backup.process' and target_type = 'backup_run' and target_id = v_run),
    '20. recording a run writes an auditable entry');
  perform public.test_assert(
    (public.backup_admin_state()->'last_runs'->0->>'status') = 'verified',
    '21. the last run is visible to the admin page after a refresh');

  -- A payload that looks like a credential is redacted, never stored verbatim.
  v_run := public.backup_record_run('snapshot', 'failed',
    jsonb_build_object('error', 'client_secret=SECRET028 refresh_token=SECRET028'));
  perform public.test_assert(
    (select summary->>'redacted' from public.backup_run_log where id = v_run) = 'true',
    '22. a run log containing credential-like text is redacted before storage');
  perform public.test_assert(
    (select summary::text from public.backup_run_log where id = v_run) not like '%SECRET028%',
    '23. the secret never reaches the admin-visible run log');

  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);
end $$;

-- -----------------------------------------------------------------------------
-- 6. Worker-only surface stays closed to the browser roles
-- -----------------------------------------------------------------------------
do $$
begin
  perform public.test_assert(
    not has_function_privilege('anon', 'public.backup_acquire_run_lease(text, text, integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.backup_acquire_run_lease(text, text, integer)', 'EXECUTE'),
    '24. the lease RPC is not executable by anon/authenticated');
  perform public.test_assert(
    not has_function_privilege('anon', 'public.backup_release_run_lease(text, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.backup_release_run_lease(text, text)', 'EXECUTE'),
    '25. the release RPC is not executable by anon/authenticated');
  perform public.test_assert(
    not has_function_privilege('anon', 'public.backup_admin_state()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.backup_record_run(text, text, jsonb)', 'EXECUTE'),
    '26. admin RPCs are not executable by anon');
  perform public.test_assert(
    not has_table_privilege('authenticated', 'public.backup_run_leases', 'INSERT')
    and not has_table_privilege('authenticated', 'public.backup_run_leases', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.backup_run_leases', 'DELETE')
    and not has_table_privilege('authenticated', 'public.backup_run_log', 'INSERT'),
    '27. browser roles cannot write lease or run-log state directly');
  perform public.test_assert(
    (select bool_and(relrowsecurity) from pg_class
      where oid in ('public.backup_run_leases'::regclass, 'public.backup_run_log'::regclass)),
    '28. both new backup state tables have RLS enabled');
  perform public.test_assert(
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname in ('backup_run_leases', 'backup_run_log') and t.tgname = 'backup_capture') = 0,
    '29. the new bookkeeping tables are excluded from the outbox (no recursion)');
end $$;
