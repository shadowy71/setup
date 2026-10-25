-- =============================================================================
-- Campus+ migration 028 — admin-authorized, concurrency-safe backup processing
-- =============================================================================
-- Problem this fixes (no schema change to the outbox itself):
--   * The UI only ever called `backup_request_job()`, which ENQUEUES work.
--     With cron limited to once per day on Vercel Hobby, 12 queued jobs could
--     sit there forever. `runBackupWorker()` also claims only ONE job and ONE
--     batch per invocation.
--   * A Super Admin needs to be able to *drain* that queue from the browser,
--     in bounded batches, without a terminal, without exposing the service
--     role or the encrypted Drive credential, and without two runs (admin +
--     cron) uploading the same range at once.
--
-- What lands here:
--   1. `backup_run_leases` — one durable, expiring lease per backup kind.
--      Cron ticks, the CLI and the admin action all acquire it. If a function
--      is killed the lease simply expires; a later run requeues jobs that a
--      crashed run left `running`. Nothing is ever deleted.
--   2. `backup_run_log` — a short, secret-free record of each UI-triggered run
--      (status, verified object ids, redacted diagnostics) so the Admin page
--      can show queued / processing / verified / failed even after a refresh.
--   3. `backup_admin_state()` — permission-checked aggregate of job counts,
--      batch retry state, active leases and recent runs. No row images, no
--      credentials, no connection strings.
--   4. `backup_record_run()` — permission-checked, audited writer for the run
--      log. It re-checks `manage_backups` and rejects any payload that looks
--      like a secret.
--
-- Security: every table is RLS-enabled with admin read only; the lease and
-- log-writing RPCs are worker/admin gated. `backup_private` is untouched, and
-- no new grant is given to `anon` or to `authenticated` for writing state.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Durable, expiring run leases (worker-only state)
-- -----------------------------------------------------------------------------

create table if not exists public.backup_run_leases (
  kind         text primary key check (kind in ('incremental', 'snapshot')),
  lease_owner  text not null,
  lease_until  timestamptz not null,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.backup_run_log (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('incremental', 'snapshot')),
  status      text not null check (status in ('verified', 'drained', 'idle', 'busy', 'failed', 'not_configured')),
  summary     jsonb not null default '{}'::jsonb,
  actor       uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists backup_run_log_recent_idx on public.backup_run_log (created_at desc);
-- The `actor` FK is filtered when an operator asks "what did this admin run?",
-- so it needs its own index (same convention as backup_jobs.requested_by).
create index if not exists backup_run_log_actor_idx on public.backup_run_log (actor, created_at desc);

comment on table public.backup_run_leases is
  'One expiring lease per backup kind. Prevents a cron tick and an admin-triggered run from processing the same queue concurrently.';
comment on table public.backup_run_log is
  'Secret-free, audited summary of each admin-triggered backup run for the Backups page.';

alter table public.backup_run_leases enable row level security;
alter table public.backup_run_log    enable row level security;

-- 018 grants new tables to `authenticated` by default. Backup machinery is
-- worker-only: take everything away, then grant a narrow admin read policy.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['backup_run_leases', 'backup_run_log'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', v_table);
    execute format('grant all on public.%I to service_role', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_permission(''manage_backups''))',
      v_table || '_select_admin', v_table
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Worker-only lease RPCs
-- -----------------------------------------------------------------------------

/**
 * Atomically take the lease for one kind. A live lease held by a DIFFERENT
 * owner cannot be stolen. An expired lease (killed function) is taken over,
 * and jobs that the interrupted run left `running` are put back to `pending`
 * with their identity and history intact — never deleted, never marked done.
 */
create or replace function public.backup_acquire_run_lease(
  p_kind       text,
  p_worker_id  text,
  p_seconds    integer default 180
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acquired   boolean := false;
  v_expired    boolean := false;
  v_seconds    integer := greatest(30, least(coalesce(p_seconds, 180), 900));
begin
  if not public.is_trusted_writer() then
    raise exception 'backup_acquire_run_lease is worker-only' using errcode = '42501';
  end if;
  if p_kind not in ('incremental', 'snapshot') then
    raise exception 'unknown backup kind';
  end if;
  if coalesce(p_worker_id, '') = '' or length(p_worker_id) > 200 then
    raise exception 'invalid worker id';
  end if;

  select l.lease_until < now() into v_expired
    from public.backup_run_leases l where l.kind = p_kind;
  v_expired := coalesce(v_expired, false);

  insert into public.backup_run_leases (kind, lease_owner, lease_until, started_at, updated_at)
  values (p_kind, p_worker_id, now() + make_interval(secs => v_seconds), now(), now())
  on conflict (kind) do update
     set lease_owner = excluded.lease_owner,
         lease_until = excluded.lease_until,
         started_at  = excluded.started_at,
         updated_at  = now()
   where public.backup_run_leases.lease_until < now()
      or public.backup_run_leases.lease_owner = excluded.lease_owner
  returning true into v_acquired;

  v_acquired := coalesce(v_acquired, false);
  if v_acquired then
    -- Taking over an expired lease means no live run exists for this kind, so
    -- every `running` job is orphaned. Otherwise only genuinely ancient ones
    -- are recovered (a live run owns its own fresh `running` jobs).
    update public.backup_jobs j
       set status = 'pending', last_error = null, updated_at = now()
     where j.kind = p_kind
       and j.status = 'running'
       and (v_expired or j.updated_at < now() - interval '10 minutes');
  end if;
  return v_acquired;
end $$;

/** Release only our own lease. An expired lease is harmless if never released. */
create or replace function public.backup_release_run_lease(p_kind text, p_worker_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    raise exception 'backup_release_run_lease is worker-only' using errcode = '42501';
  end if;
  -- `now()` is the transaction-start timestamp, so setting it to exactly now()
  -- would leave `lease_until < now()` false inside the same transaction. Use a
  -- definitely-past value: the lease is over, and any waiting run may take it.
  update public.backup_run_leases
     set lease_until = now() - interval '1 second', updated_at = now()
   where kind = p_kind and lease_owner = p_worker_id;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Admin-visible job state + audited run log
-- -----------------------------------------------------------------------------

create or replace function public.backup_admin_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.has_permission('manage_backups') then
    raise exception 'You do not have permission to view backup job state.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'jobs', (
      select jsonb_build_object(
        'queued',     count(*) filter (where j.status = 'pending'),
        'processing', count(*) filter (where j.status = 'running'),
        'verified',   count(*) filter (where j.status = 'done'),
        'failed',     count(*) filter (where j.status = 'failed')
      ) from public.backup_jobs j
    ),
    'jobs_by_kind', coalesce((
      select jsonb_object_agg(s.kind, s.counts) from (
        select j.kind,
               jsonb_build_object(
                 'queued',     count(*) filter (where j.status = 'pending'),
                 'processing', count(*) filter (where j.status = 'running'),
                 'verified',   count(*) filter (where j.status = 'done'),
                 'failed',     count(*) filter (where j.status = 'failed')
               ) as counts
        from public.backup_jobs j group by j.kind
      ) s
    ), '{}'::jsonb),
    'recent_jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id, 'kind', j.kind, 'status', j.status,
        'note', j.note, 'last_error', left(j.last_error, 300),
        'created_at', j.created_at, 'updated_at', j.updated_at, 'completed_at', j.completed_at
      ) order by j.created_at desc)
      from (select * from public.backup_jobs order by created_at desc limit 16) j
    ), '[]'::jsonb),
    'batches', jsonb_build_object(
      'uploading',     (select count(*) from public.backup_batches where status = 'uploading'),
      'pending',       (select count(*) from public.backup_batches where status = 'pending'),
      'failed',        (select count(*) from public.backup_batches where status = 'failed'),
      'verified',      (select count(*) from public.backup_batches where status = 'verified'),
      'retry_waiting', (select count(*) from public.backup_batches where status = 'failed' and next_attempt_at > now()),
      'next_retry_at', (select min(next_attempt_at) from public.backup_batches where status = 'failed' and next_attempt_at > now())
    ),
    'snapshots', jsonb_build_object(
      'running',    (select count(*) from public.backup_snapshots where status in ('pending', 'uploading')),
      'failed',     (select count(*) from public.backup_snapshots where status = 'failed'),
      'last_error', (select left(last_error, 300) from public.backup_snapshots where status = 'failed' order by updated_at desc limit 1)
    ),
    'leases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', l.kind, 'active', l.lease_until > now(),
        'started_at', l.started_at, 'lease_until', l.lease_until
      ) order by l.kind) from public.backup_run_leases l
    ), '[]'::jsonb),
    'active', exists (select 1 from public.backup_run_leases l where l.lease_until > now()),
    'last_runs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'status', r.status,
        'record', r.summary, 'created_at', r.created_at
      ) order by r.created_at desc)
      from (select * from public.backup_run_log order by created_at desc limit 8) r
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

/**
 * Persist a secret-free run summary and write an audit entry. Called with the
 * ADMIN'S OWN RLS-scoped client so `current_profile_id()` is the real actor
 * and `manage_backups` is re-checked here, not just in the server action.
 */
create or replace function public.backup_record_run(
  p_kind   text,
  p_status text,
  p_record jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_status text := coalesce(p_status, 'failed');
  v_record jsonb := coalesce(p_record, '{}'::jsonb);
begin
  if not public.has_permission('manage_backups') then
    raise exception 'You do not have permission to run backups.' using errcode = '42501';
  end if;
  if p_kind not in ('incremental', 'snapshot') then
    raise exception 'unknown backup kind';
  end if;
  if v_status not in ('verified', 'drained', 'idle', 'busy', 'failed', 'not_configured') then
    v_status := 'failed';
  end if;
  -- Defence in depth: a client (or a future code change) must never be able
  -- to smuggle a credential into the admin-visible log.
  if v_record::text ~* '(client_secret|refresh_token|credential_ciphertext|bearer |postgresql://|password|BEGIN [A-Z ]*PRIVATE KEY)' then
    v_record := jsonb_build_object('status', v_status, 'redacted', true);
  elsif length(v_record::text) > 3500 then
    v_record := jsonb_build_object('status', v_status, 'truncated', true);
  end if;

  insert into public.backup_run_log (kind, status, summary, actor)
  values (p_kind, v_status, v_record, public.current_profile_id())
  returning id into v_id;

  perform public.log_audit(
    'backup.process', 'backup_run', v_id::text,
    jsonb_build_object('kind', p_kind, 'status', v_status, 'verified', coalesce((v_record->>'verified')::int, 0)),
    false, null, 'admin'::public.moderation_visibility
  );
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Grants — mirror migration 027's explicit, closed-by-default surface
-- -----------------------------------------------------------------------------

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'backup_acquire_run_lease(text, text, integer)',
    'backup_release_run_lease(text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;

  foreach v_fn in array array[
    'backup_admin_state()',
    'backup_record_run(text, text, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
end $$;

comment on function public.backup_admin_state() is
  'Admin-only backup job state: queued/processing/verified/failed counts, batch retry state, active leases and recent run summaries. Never returns credentials or row images.';
comment on function public.backup_record_run(text, text, jsonb) is
  'Audited, permission-checked, secret-free log of an admin-triggered backup run.';
