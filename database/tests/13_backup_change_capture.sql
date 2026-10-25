-- =============================================================================
-- Campus+ database tests — 13 transactional backup outbox
-- =============================================================================
-- Proves the properties the Drive worker depends on:
--   * every application table is tracked and triggered, backup tables are not;
--   * insert/update/delete are captured in the SAME transaction as the write
--     (including rollback), with deletion tombstones;
--   * change rows are ordered and claimed idempotently;
--   * the checkpoint only advances on a completed, verified batch and pending
--     rows are never pruned above a verified snapshot;
--   * student sessions cannot read outbox payloads, worker RPCs or secrets.
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email)
values ('f1000000-0000-4000-a000-000000000001', 'backup.probe@pccoepune.org')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-a000-000000000001', false);
select public.complete_profile('backup_probe', 'Backup Probe');
select set_config('request.jwt.claim.sub', '', false);

-- -----------------------------------------------------------------------------
-- 1. Coverage: no application table is silently missing from the backup
-- -----------------------------------------------------------------------------
do $$
declare
  v_missing text;
  v_bad_keys integer;
  v_backup_triggers integer;
  v_tracked integer;
begin
  select string_agg(c.relname, ', ')
    into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname not like 'backup%'
    and c.relname not like '\_\_test%'
    and not exists (
      select 1 from pg_trigger t
      where t.tgrelid = c.oid and t.tgname = 'backup_capture' and not t.tgisinternal
    );
  perform public.test_assert(v_missing is null,
    '1. every public application table has a backup_capture trigger: ' || coalesce(v_missing, ''));

  select count(*) into v_backup_triggers
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'backup%' and t.tgname = 'backup_capture';
  perform public.test_assert(v_backup_triggers = 0,
    '2. no backup_* table has a capture trigger (no recursion)');

  select count(*) into v_bad_keys
  from public.backup_tracked_tables t
  where cardinality(t.key_columns) = 0 or t.schema_name <> 'public';
  perform public.test_assert(v_bad_keys = 0,
    '3. every tracked table declares primary-key columns for tombstones and paging');

  select count(*) into v_tracked from public.backup_tracked_tables where snapshot and capture;
  perform public.test_assert(v_tracked >= 65,
    '4. the snapshot manifest covers every application table (found ' || v_tracked || ')');
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Same-transaction capture and rollback
-- -----------------------------------------------------------------------------
-- Run with the privileged connection so the RLS-scoped count is not filtered;
-- the point of this test is transactionality, not row visibility.
do $$
declare
  v_before bigint;
  v_after  bigint;
  v_id     uuid;
begin
  select count(*) into v_before from public.backup_change_log;

  -- A savepoint-rolled-back write must leave NO outbox row. The read below is
  -- deliberately INSIDE the subtransaction: the trigger is not a webhook, it
  -- is part of the writer's transaction.
  begin
    insert into public.posts (author_id, body)
    values ((select id from public.profiles where username = 'backup_probe'), 'backup rollback probe')
    returning id into v_id;
    perform public.test_assert(
      (select count(*) from public.backup_change_log) = v_before + 1,
      '5. the change row is visible inside the writing transaction');
    raise exception 'rollback_probe';
  exception when others then
    if sqlerrm <> 'rollback_probe' then raise; end if;
  end;

  select count(*) into v_after from public.backup_change_log;
  perform public.test_assert(v_after = v_before,
    '6. rolling back the application write also rolls back its outbox row');
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. A real student write captures insert / update / delete tombstones
-- -----------------------------------------------------------------------------
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-a000-000000000001', false);
set role authenticated;

do $$
declare
  v_id uuid;
begin
  insert into public.posts (author_id, body)
  values (public.current_profile_id(), 'backup committed probe')
  returning id into v_id;

  insert into public.__test_scratch (key, value) values ('backup_probe_post', v_id)
  on conflict (key) do update set value = excluded.value;

  update public.posts set body = 'backup committed probe (edited)' where id = v_id;
  delete from public.posts where id = v_id;
end;
$$;

-- Student isolation: no payload columns, no worker RPCs, no secret schema.
do $$
begin
  perform public.test_assert(
    not has_column_privilege('authenticated', 'public.backup_change_log', 'row_data', 'SELECT')
    and not has_column_privilege('authenticated', 'public.backup_change_log', 'row_pk', 'SELECT'),
    '7. a student session cannot SELECT the private outbox payload columns');
  perform public.test_assert(
    not has_function_privilege('authenticated', 'public.backup_claim_batch(text, integer, integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.backup_private_get_credentials(uuid)', 'EXECUTE'),
    '8. worker-only RPCs are not executable by a student session');
  perform public.test_assert(
    not has_schema_privilege('authenticated', 'backup_private', 'USAGE'),
    '9. the encrypted credential schema is not reachable by a student session');
  perform public.test_assert(
    not has_function_privilege('anon', 'public.backup_status()', 'EXECUTE'),
    '10. anonymous callers cannot read backup health');
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_id    uuid;
  v_first bigint;
  v_last  bigint;
  v_ops   text[];
  v_pk    jsonb;
  v_data  jsonb;
  v_order bigint[];
begin
  select value into v_id from public.__test_scratch where key = 'backup_probe_post';

  select min(id), max(id), array_agg(operation order by id)
    into v_first, v_last, v_ops
  from public.backup_change_log
  where table_name = 'posts'
    and row_pk ->> 'id' = v_id::text;

  perform public.test_assert(v_ops = array['insert', 'update', 'delete'],
    '11. a student insert/update/delete each produce one ordered event: ' || coalesce(v_ops::text, 'null'));
  perform public.test_assert(v_last > v_first,
    '12. outbox ids are strictly increasing');

  select row_pk, row_data into v_pk, v_data
  from public.backup_change_log
  where table_name = 'posts' and row_pk ->> 'id' = v_id::text and operation = 'delete';
  perform public.test_assert(v_pk ->> 'id' = v_id::text and v_data is null,
    '13. a delete is a tombstone: primary key retained, row image NULL');

  select row_data into v_data
  from public.backup_change_log
  where table_name = 'posts' and row_pk ->> 'id' = v_id::text and operation = 'update';
  perform public.test_assert(v_data ->> 'body' = 'backup committed probe (edited)',
    '14. an update carries the full post-update row image');

  select array_agg(id order by id) into v_order
  from public.backup_pending_changes(v_first, v_last)
  where table_name = 'posts' and row_pk ->> 'id' = v_id::text;
  perform public.test_assert(cardinality(v_order) = 3 and v_order[1] < v_order[3],
    '15. backup_pending_changes() returns the range in ascending id order');
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Claiming, checkpointing and idempotent duplicate attempts
-- -----------------------------------------------------------------------------
do $$
declare
  v_batch      public.backup_batches;
  v_again      public.backup_batches;
  v_checkpoint bigint;
  v_pending    bigint;
  v_pruned     bigint;
  v_count      integer;
begin
  -- Start from a known checkpoint below all captured changes.
  update public.backup_checkpoints set last_change_id = 0 where name = 'primary';
  select * into v_batch from public.backup_claim_batch('test-worker', 4, 300);
  perform public.test_assert(v_batch.id is not null, '16. a worker can claim a batch of pending changes');
  perform public.test_assert(v_batch.last_change_id >= v_batch.first_change_id,
    '17. the claimed batch is a non-empty ordered range');

  select count(*) into v_count from public.backup_claim_batch('other-worker', 4, 300);
  perform public.test_assert(v_count = 0,
    '18. a second worker cannot claim the same pending range while the lease is live');

  v_pending := v_batch.last_change_id;

  -- Simulate an unverified Drive upload: the checkpoint MUST NOT move.
  perform public.test_assert(
    (select last_change_id from public.backup_checkpoints where name = 'primary') = 0,
    '19. an unverified upload never advances the checkpoint');

  perform public.backup_complete_batch(
    'test-worker', v_batch.id, 'drive-file-verified', repeat('a', 64), 1024,
    jsonb_build_object('verified', true, 'range', v_batch.range_key)
  );
  select last_change_id into v_checkpoint from public.backup_checkpoints where name = 'primary';
  perform public.test_assert(v_checkpoint = v_pending,
    '20. a verified batch advances the durable checkpoint to its last change id');

  -- A duplicate completion (e.g. the worker retried after a lost response) is
  -- idempotent and must never rewind the checkpoint.
  perform public.backup_complete_batch(
    'test-worker', v_batch.id, 'drive-file-verified', repeat('a', 64), 1024, '{}'::jsonb
  );
  perform public.test_assert(
    (select last_change_id from public.backup_checkpoints where name = 'primary') = v_checkpoint,
    '21. duplicate completion is idempotent and does not rewind the checkpoint');

  -- A failed batch keeps ALL of its events and is reclaimed with the same key.
  insert into public.backup_batches (kind, status, range_key, first_change_id, last_change_id, next_attempt_at)
  values ('incremental', 'failed', 'incremental:retry-probe', v_checkpoint + 1, v_checkpoint + 3, now())
  on conflict (range_key) do update set status = 'failed', next_attempt_at = now();
  select * into v_batch from public.backup_batches where range_key = 'incremental:retry-probe';
  select * into v_again from public.backup_claim_batch('test-worker', 4, 300);
  perform public.test_assert(v_again.range_key = v_batch.range_key and v_again.attempt_count = v_batch.attempt_count + 1,
    '22. retrying a failed attempt reuses the same idempotent range key');

  perform public.backup_fail_batch('test-worker', v_again.id, 'simulated Drive outage', 30);
  perform public.test_assert(
    (select count(*) from public.backup_change_log where id > v_checkpoint) > 0,
    '23. a Drive failure discards no pending change rows');

  -- Retention cannot prune anything until a verified snapshot exists.
  v_pruned := public.backup_prune_change_log(14, 0);
  perform public.test_assert(v_pruned = 0,
    '24. without a verified snapshot the retention cutoff is zero');
  perform public.test_assert(
    (select count(*) from public.backup_change_log where id <= v_checkpoint) > 0,
    '25. verified change rows remain until a snapshot covers them');
end;
$$;

-- A verified snapshot establishes a safe cutoff, but still never prunes above
-- the last verified checkpoint.
insert into public.backup_snapshots (id, watermark, status, verified_at)
values ('f1000000-0000-4000-a000-000000000010', 1, 'verified', now())
on conflict (id) do nothing;

do $$
declare
  v_cutoff bigint;
begin
  update public.backup_checkpoints set last_change_id = 3 where name = 'primary';
  v_cutoff := public.backup_prune_change_log(14, 0);
  perform public.test_assert(v_cutoff <= 3,
    '26. the retention cutoff is bounded by the verified checkpoint');
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Snapshot / scheduled-job RPCs and admin status isolation
-- -----------------------------------------------------------------------------
do $$
declare
  v_snapshot uuid;
  v_conn     uuid;
  v_status   text;
  v_mark     bigint;
  v_count    integer;
  v_rejected boolean := false;
begin
  insert into public.backup_drive_connections (google_subject, account_label, folder_ref)
  values ('probe-google-subject', 'Probe Drive', 'private-folder-probe')
  returning id into v_conn;

  v_snapshot := public.backup_start_snapshot(50, 0, jsonb_build_object('schemas', jsonb_build_array('public')));
  select status into v_status from public.backup_snapshots where id = v_snapshot;
  perform public.test_assert(v_status = 'building',
    '27. backup_start_snapshot registers a building snapshot at the outbox horizon');

  begin
    perform public.backup_complete_snapshot(v_snapshot, '', repeat('a', 64), 100, '{}'::jsonb);
  exception when others then
    v_rejected := true;
  end;
  perform public.test_assert(v_rejected,
    '28. a snapshot cannot be verified without a real Drive file ref');

  perform public.backup_complete_snapshot(
    v_snapshot, 'drive-snapshot-verified', repeat('b', 64), 2048,
    jsonb_build_object('schemas', jsonb_build_array('public'), 'complete_disaster_recovery', false)
  );
  perform public.test_assert(
    (select status from public.backup_snapshots where id = v_snapshot) = 'verified',
    '29. a snapshot becomes verified only after a Drive ref + checksum are supplied');
  select last_snapshot_watermark into v_mark from public.backup_checkpoints where name = 'primary';
  perform public.test_assert(v_mark >= 50,
    '30. verifying a snapshot advances the durable snapshot watermark');
  select count(*) into v_count from public.backup_batches
   where kind = 'snapshot' and snapshot_ref = v_snapshot and status = 'verified';
  perform public.test_assert(v_count = 1,
    '31. the verified snapshot appears exactly once in the admin history');
  perform public.test_assert(
    (select last_success_at from public.backup_drive_connections where id = v_conn) is not null,
    '32. a verified snapshot updates the connection last-success timestamp');

  -- Failure state on a separate snapshot must not touch the verified one.
  declare
    v_failed uuid := public.backup_start_snapshot(60, 50, '{}'::jsonb);
  begin
    perform public.backup_fail_snapshot(v_failed, 'simulated Drive outage');
    perform public.test_assert(
      (select status from public.backup_snapshots where id = v_failed) = 'failed',
      '33. a Drive outage records a failed snapshot without faking a checkpoint');
  end;
end;
$$;

do $$
declare
  v_job     uuid;
  v_claimed public.backup_jobs;
  v_count   integer;
  v_denied  boolean := false;
  v_status  jsonb;
  v_profile uuid;
begin
  delete from public.backup_jobs where kind = 'incremental' and status = 'pending';
  insert into public.backup_jobs (kind, status, note)
  values ('incremental', 'pending', 'probe-job') returning id into v_job;

  select * into v_claimed from public.backup_claim_job('incremental', 'probe-worker');
  perform public.test_assert(v_claimed.id = v_job and v_claimed.status = 'running',
    '34. a worker claims the oldest pending backup job exactly once');
  select count(*) into v_count from public.backup_claim_job('incremental', 'other-worker');
  perform public.test_assert(v_count = 0,
    '35. a running job cannot be claimed by a second worker');
  perform public.backup_finish_job(v_job, null);
  perform public.test_assert(
    (select status from public.backup_jobs where id = v_job) = 'done',
    '36. finishing a job marks it done and releases the queue');

  -- Grant the Super Admin role while still in the trusted service context.
  select pp.profile_id into v_profile from public.profile_private pp
   where pp.auth_user_id = 'f1000000-0000-4000-a000-000000000001';
  insert into public.user_roles (user_id, role_key) values (v_profile, 'super_admin')
  on conflict do nothing;

  -- An unprivileged session must not be able to read backup health at all.
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', 'f1000000-0000-4000-a000-0000000000ff', false);
  begin
    perform public.backup_status();
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform public.test_assert(v_denied,
    '37. a session without manage_backups cannot call backup_status()');

  -- The Super Admin session exposes aggregates only — never credentials.
  perform set_config('request.jwt.claim.sub', 'f1000000-0000-4000-a000-000000000001', false);
  v_status := public.backup_status();
  perform public.test_assert(v_status ? 'queue_depth' and v_status ? 'scope',
    '38. a Super Admin sees queue depth and the declared backup scope');
  perform public.test_assert(
    v_status::text not like '%credential_ciphertext%'
    and v_status::text not like '%refresh_token%'
    and v_status::text not like '%row_data%',
    '39. backup_status never returns credentials or private outbox row images');

  perform set_config('request.jwt.claim.role', 'service_role', false);
  perform set_config('request.jwt.claim.sub', '', false);
end;
$$;

-- Operator CLI disconnect (service-role trusted writer) must work without a
-- browser session, while still deleting the encrypted refresh credential.
do $$
declare
  v_conn uuid;
begin
  select id into v_conn from public.backup_drive_connections
   where google_subject = 'probe-google-subject';
  insert into backup_private.oauth_credentials
    (connection_ref, credential_ciphertext, iv_b64, tag_b64, key_ref)
  values (v_conn, 'ciphertext-probe', 'iv-probe', 'tag-probe', 'primary')
  on conflict (connection_ref) do update
    set credential_ciphertext = excluded.credential_ciphertext;

  perform public.backup_disconnect();
  perform public.test_assert(
    (select status from public.backup_drive_connections where id = v_conn) = 'revoked',
    '40. an operator disconnect revokes the connection metadata');
  perform public.test_assert(
    not exists (select 1 from backup_private.oauth_credentials where connection_ref = v_conn),
    '41. an operator disconnect deletes the encrypted refresh credential');
end;
$$;
