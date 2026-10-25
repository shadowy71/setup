-- =============================================================================
-- Campus+ migration 027 — asynchronous Google Drive backup (database half)
-- =============================================================================
-- Supabase Postgres remains the ONE primary database. Nothing here and nothing
-- in the application ever calls Google Drive while serving a student request.
--
-- What lands in this migration:
--   1. `public.backup_change_log` — a durable transactional outbox. A row is
--      inserted by an AFTER ROW trigger *in the same transaction* as the
--      application write. Inserts, updates and deletes are all captured;
--      deletes store the primary key as a tombstone (row_data IS NULL).
--   2. A generic trigger attached to EVERY existing public application table,
--      and `backup_sync_triggers()` so a future migration can re-attach it to
--      new tables. All `backup_*` tables are excluded: the outbox can never
--      capture its own bookkeeping (no recursion, no amplification).
--   3. `public.backup_batches`, `backup_checkpoints`, `backup_snapshots`,
--      `backup_jobs`, `backup_drive_connections`, `backup_tracked_tables` —
--      the durable worker state, verified checkpoint, snapshot manifest state,
--      admin authorization and Drive connection metadata.
--   4. `backup_private` — a non-API schema for encrypted OAuth verifiers and
--      refresh credentials. It is NOT in PostgREST's exposed schemas, has no
--      grants for `anon`/`authenticated`, and is reachable only through a
--      handful of `SECURITY DEFINER` functions that check the caller.
--   5. `manage_backups` — a new permission granted to Super Admin only.
--
-- SCOPE (also written into every upload's manifest by the worker):
--   INCLUDED:  schema `public`, every application table listed in
--              `backup_tracked_tables` (65 at the time of writing).
--   EXCLUDED:  `auth.*` (Supabase Auth users/sessions/refresh tokens),
--              `storage.*`, `realtime.*`, `supabase_functions.*`, extension
--              schemas, `backup_private`, and every `public.backup_*` table.
--   THIS IS NOT COMPLETE DISASTER RECOVERY. Restoring it does not recreate
--   Supabase Auth accounts, OAuth provider configuration, RLS/grants, Storage
--   objects, secrets, or cron configuration. Those must be reprovisioned.
--
-- Safety properties enforced here:
--   * A change row is only ever removed by `backup_prune_change_log()`, which
--     refuses to prune anything above the last VERIFIED checkpoint or above
--     the oldest retained verified snapshot watermark.
--   * `backup_complete_batch()` is the ONLY writer of the checkpoint and runs
--     in the same transaction as the batch's `verified` transition.
--   * `backup_claim_batch()` takes a short quiesce lock on the outbox before
--     computing its horizon, so a transaction that allocated a lower change id
--     but has not committed yet can never be skipped.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Private schema for encrypted OAuth state
-- -----------------------------------------------------------------------------

create schema if not exists backup_private;
revoke all on schema backup_private from public, anon, authenticated;
grant usage on schema backup_private to service_role;

-- Belt and braces: even if the API roles were granted usage later, no table in
-- this schema is readable by them.
alter default privileges in schema backup_private revoke all on tables from public, anon, authenticated;
alter default privileges in schema backup_private grant all on tables to service_role;

create table if not exists backup_private.oauth_credentials (
  connection_ref       uuid primary key,
  credential_ciphertext text not null,
  iv_b64               text not null,
  tag_b64              text not null,
  key_ref              text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table backup_private.oauth_credentials enable row level security;

create table if not exists backup_private.oauth_flows (
  state_hash           text primary key,
  profile_ref          uuid not null,
  verifier_ciphertext  text not null,
  iv_b64               text not null,
  tag_b64              text not null,
  key_ref              text not null,
  redirect_uri         text not null,
  expires_at           timestamptz not null,
  created_at           timestamptz not null default now()
);
alter table backup_private.oauth_flows enable row level security;

-- No policies at all: service_role bypasses RLS; SECURITY DEFINER functions
-- owned by postgres are the only other path in.
revoke all on backup_private.oauth_credentials from public, anon, authenticated;
revoke all on backup_private.oauth_flows from public, anon, authenticated;
grant all on backup_private.oauth_credentials, backup_private.oauth_flows to service_role;

comment on schema backup_private is
  'Encrypted Google Drive OAuth verifiers and refresh credentials. Not exposed by PostgREST; no API-role grants. Plaintext tokens are never stored in the database.';

-- -----------------------------------------------------------------------------
-- 2. Permission (Super Admin only by default)
-- -----------------------------------------------------------------------------

insert into public.permissions (key, label, description, group_name) values
  ('manage_backups', 'Manage encrypted Drive backups',
   'Connect the admin-only Google Drive account, inspect backup health, request a manual backup and retry a failed batch.',
   'Platform')
on conflict (key) do update
  set label = excluded.label, description = excluded.description, group_name = excluded.group_name;

insert into public.role_permissions (role_key, permission_key)
values ('super_admin', 'manage_backups')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3. Worker state tables
-- -----------------------------------------------------------------------------

create table public.backup_tracked_tables (
  schema_name    text not null default 'public',
  table_name     text not null,
  key_columns    text[] not null default '{}'::text[],
  capture        boolean not null default true,
  snapshot       boolean not null default true,
  created_at     timestamptz not null default now(),
  primary key (schema_name, table_name),
  constraint backup_tracked_tables_scope check (schema_name = 'public'),
  constraint backup_tracked_tables_not_system check (table_name not like 'backup_%'),
  constraint backup_tracked_tables_key_columns check (cardinality(key_columns) > 0)
);

create table public.backup_change_log (
  id              bigint generated always as identity primary key,
  schema_name     text not null default 'public',
  table_name      text not null,
  operation       text not null check (operation in ('insert', 'update', 'delete')),
  row_pk          jsonb not null,
  row_data        jsonb,
  transaction_ref text not null,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint backup_change_log_tombstone check (
    (operation = 'delete' and row_data is null) or (operation <> 'delete' and row_data is not null)
  ),
  constraint backup_change_log_not_system check (table_name not like 'backup_%'),
  constraint backup_change_log_pk check (jsonb_typeof(row_pk) = 'object')
);
create index backup_change_log_table_id_idx on public.backup_change_log (table_name, id);
create index backup_change_log_created_idx on public.backup_change_log (created_at);
comment on table public.backup_change_log is
  'Transactional outbox for the Drive backup worker. Written only by AFTER ROW triggers inside the application transaction; never by a webhook.';
comment on column public.backup_change_log.row_data is
  'Full row image for insert/update; NULL for a delete. Deletes are tombstones identified by row_pk, so they survive removal of the source row.';

create table public.backup_drive_connections (
  id                uuid primary key default gen_random_uuid(),
  google_subject    text not null,
  account_label     text not null default 'Google Drive',
  folder_ref        text not null,
  folder_restricted boolean not null default true,
  scope             text not null default 'https://www.googleapis.com/auth/drive.file',
  status            text not null default 'active'
                    check (status in ('active', 'expired', 'revoked', 'error')),
  connected_by      uuid references public.profiles (id) on delete set null,
  connected_at      timestamptz not null default now(),
  last_success_at   timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint backup_drive_connections_private check (folder_restricted),
  constraint backup_drive_connections_scope check (scope = 'https://www.googleapis.com/auth/drive.file')
);
create index backup_drive_connections_status_idx on public.backup_drive_connections (status, connected_at desc);
create index backup_drive_connections_actor_idx on public.backup_drive_connections (connected_by);
comment on table public.backup_drive_connections is
  'Metadata only. OAuth verifiers and refresh credentials live encrypted in backup_private, never here and never in the browser.';

create table public.backup_snapshots (
  id                uuid primary key default gen_random_uuid(),
  watermark         bigint not null,
  previous_watermark bigint not null default 0,
  status            text not null default 'building'
                    check (status in ('building', 'uploading', 'verified', 'failed')),
  manifest          jsonb not null default '{}'::jsonb,
  drive_file_ref    text,
  content_sha256    text,
  byte_size         bigint,
  attempt_count     integer not null default 0,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  verified_at       timestamptz
);
create index backup_snapshots_created_idx on public.backup_snapshots (created_at desc);
create index backup_snapshots_status_idx on public.backup_snapshots (status, watermark desc);

create table public.backup_batches (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('incremental', 'snapshot')),
  status           text not null default 'pending'
                   check (status in ('pending', 'uploading', 'verified', 'failed')),
  range_key        text not null unique,
  first_change_id  bigint,
  last_change_id   bigint,
  snapshot_ref     uuid references public.backup_snapshots (id) on delete set null,
  connection_ref   uuid references public.backup_drive_connections (id) on delete set null,
  manifest         jsonb,
  drive_file_ref   text,
  content_sha256   text,
  byte_size        bigint,
  attempt_count    integer not null default 0,
  lease_owner      text,
  lease_until      timestamptz,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  verified_at      timestamptz,
  constraint backup_batches_incremental_range check (
    kind <> 'incremental' or (first_change_id is not null and last_change_id is not null
                              and last_change_id >= first_change_id)
  ),
  constraint backup_batches_verified_file check (
    status <> 'verified' or (drive_file_ref is not null and content_sha256 is not null)
  )
);
create index backup_batches_work_idx on public.backup_batches (status, next_attempt_at, created_at);
create index backup_batches_verified_idx on public.backup_batches (verified_at desc);
create index backup_batches_snapshot_idx on public.backup_batches (snapshot_ref);
create index backup_batches_connection_idx on public.backup_batches (connection_ref);
comment on table public.backup_batches is
  'One durable attempt per ordered change range. range_key makes retries idempotent; a batch is verified only after a Drive download+checksum check.';

create table public.backup_checkpoints (
  name                    text primary key default 'primary',
  last_change_id          bigint not null default 0,
  last_success_at         timestamptz,
  last_file_ref           text,
  last_content_sha256     text,
  last_snapshot_watermark bigint not null default 0,
  last_snapshot_at        timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint backup_checkpoints_singleton check (name = 'primary')
);
insert into public.backup_checkpoints (name, last_change_id) values ('primary', 0)
on conflict (name) do nothing;
comment on table public.backup_checkpoints is
  'Durable, monotonically advancing, successfully verified checkpoint. Only backup_complete_batch() writes last_change_id.';

create table public.backup_jobs (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('incremental', 'snapshot')),
  status         text not null default 'pending'
                 check (status in ('pending', 'running', 'done', 'failed')),
  requested_by   uuid references public.profiles (id) on delete set null,
  note           text,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index backup_jobs_pending_idx on public.backup_jobs (status, created_at);
create index backup_jobs_actor_idx on public.backup_jobs (requested_by);
comment on table public.backup_jobs is
  'Admin-authorized manual backup requests. The UI only enqueues; the background worker performs the Drive work.';

-- -----------------------------------------------------------------------------
-- 4. RLS — admin read only, no client writes, no change-log payload exposure
-- -----------------------------------------------------------------------------

alter table public.backup_tracked_tables    enable row level security;
alter table public.backup_change_log        enable row level security;
alter table public.backup_drive_connections enable row level security;
alter table public.backup_snapshots         enable row level security;
alter table public.backup_batches           enable row level security;
alter table public.backup_checkpoints       enable row level security;
alter table public.backup_jobs              enable row level security;

-- 018's default privileges give new tables SELECT/INSERT/DELETE to
-- authenticated. Backup state is written exclusively by the worker (service
-- role) and by permission-checked SECURITY DEFINER functions, so take all of
-- that away and grant back a narrow, read-only view.
do $$
declare
  v_table text;
begin
  for v_table in
    select unnest(array[
      'backup_tracked_tables', 'backup_change_log', 'backup_drive_connections',
      'backup_snapshots', 'backup_batches', 'backup_checkpoints', 'backup_jobs'
    ])
  loop
    execute format('revoke all on public.%I from public, anon, authenticated', v_table);
    execute format('grant all on public.%I to service_role', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_permission(''manage_backups''))',
      v_table || '_select_admin', v_table
    );
  end loop;
end $$;

-- The outbox contains full row images of private messages. Even a Super Admin
-- reading the admin page must not be able to select those columns through the
-- API; the worker uses service_role. Only safe metadata columns are exposed.
revoke select on public.backup_change_log from authenticated;
grant select (id, schema_name, table_name, operation, transaction_ref, occurred_at, created_at)
  on public.backup_change_log to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Generic change-capture trigger
-- -----------------------------------------------------------------------------

create or replace function public.backup_capture_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op    text;
  v_row   jsonb;
  v_keys  text[];
  v_pk    jsonb;
begin
  -- Hard recursion guard. Backup bookkeeping tables never get a trigger, but
  -- this also protects against a future migration attaching one by accident.
  if tg_table_schema = 'public' and tg_table_name like 'backup%' then
    return null;
  end if;

  v_op := lower(tg_op);
  if v_op = 'delete' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  select coalesce(array_agg(a.attname order by k.ord), '{}'::text[])
    into v_keys
  from pg_index i
  join unnest(i.indkey) with ordinality k(attnum, ord) on true
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
  where i.indrelid = tg_relid and i.indisprimary;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_pk
  from jsonb_each(v_row) e
  where e.key = any(v_keys);

  insert into public.backup_change_log (
    schema_name, table_name, operation, row_pk, row_data, transaction_ref, occurred_at
  ) values (
    tg_table_schema,
    tg_table_name,
    v_op,
    v_pk,
    case when v_op = 'delete' then null else v_row end,
    pg_current_xact_id()::text,
    now()
  );

  -- AFTER trigger: the return value is ignored. No network call, no HTTP
  -- extension, no pg_net — this insert commits or rolls back WITH the write.
  return null;
end $$;

comment on function public.backup_capture_change() is
  'Transactional outbox writer. One row per insert/update/delete in the application tables; delete rows are tombstones carrying only the primary key. Never calls Drive.';

/**
 * Attach (or re-attach) capture to every non-backup public table and record it
 * in the snapshot catalogue. Idempotent: safe to call from a later migration
 * after adding new application tables, and safe for the validation workflow to
 * call before asserting coverage.
 */
create or replace function public.backup_sync_triggers()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table record;
  v_count integer := 0;
begin
  for v_table in
    select c.oid, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not like 'backup%'
      and c.relname not like '\_\_test%'
    order by c.relname
  loop
    insert into public.backup_tracked_tables (schema_name, table_name, key_columns)
    select
      'public',
      v_table.table_name,
      coalesce(array_agg(a.attname order by k.ord), '{}'::text[])
    from pg_index i
    join unnest(i.indkey) with ordinality k(attnum, ord) on true
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where i.indrelid = v_table.oid and i.indisprimary
    on conflict (schema_name, table_name) do update
      set key_columns = excluded.key_columns, capture = true, snapshot = true;

    execute format('drop trigger if exists backup_capture on public.%I', v_table.table_name);
    execute format(
      'create trigger backup_capture after insert or update or delete on public.%I for each row execute function public.backup_capture_change()',
      v_table.table_name
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

comment on function public.backup_sync_triggers() is
  'Idempotently attaches the outbox trigger to every public application table and refreshes the snapshot table catalogue. Excludes all backup_* tables.';

select public.backup_sync_triggers();

-- -----------------------------------------------------------------------------
-- 6. Worker RPCs (service_role only)
-- -----------------------------------------------------------------------------

/**
 * Establish a clean horizon. `SHARE ROW EXCLUSIVE` conflicts with the
 * `ROW EXCLUSIVE` lock held by every transaction that inserted into the outbox,
 * so this waits for in-flight application transactions to finish and blocks new
 * ones for the few milliseconds needed to read max(id). A transaction that
 * allocated a lower id but commits later therefore cannot be skipped.
 */
create or replace function public.backup_snapshot_watermark()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_watermark bigint;
begin
  if not public.is_trusted_writer() then
    raise exception 'backup_snapshot_watermark is worker-only' using errcode = '42501';
  end if;
  lock table public.backup_change_log in share row exclusive mode;
  select coalesce(max(id), 0) into v_watermark from public.backup_change_log;
  return v_watermark;
end $$;

/** Ordered, visible change rows for one claimed range. */
create or replace function public.backup_pending_changes(p_first bigint, p_last bigint)
returns setof public.backup_change_log
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.*
  from public.backup_change_log c
  where c.id >= p_first and c.id <= p_last
  order by c.id asc
$$;

/**
 * Claim exactly one unit of work. Serialized by an advisory lock, so two
 * workers can never claim the same range. A failed batch or an expired lease is
 * reclaimed before a new range is created. `range_key` is deterministic, so a
 * duplicate attempt reuses the same batch row and the same Drive object name.
 */
create or replace function public.backup_claim_batch(
  p_worker_id     text,
  p_batch_size    integer default 500,
  p_lease_seconds integer default 300
)
returns setof public.backup_batches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch     public.backup_batches;
  v_horizon   bigint;
  v_checkpoint bigint;
  v_first     bigint;
  v_last      bigint;
  v_key       text;
  v_limit     integer := greatest(1, least(coalesce(p_batch_size, 500), 5000));
begin
  if not public.is_trusted_writer() then
    raise exception 'backup_claim_batch is worker-only' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('campus_plus_backup_claim'));

  -- Reclaim a failed batch whose backoff has elapsed, an expired lease, or a
  -- pending snapshot batch before looking for fresh changes.
  update public.backup_batches b
     set status          = 'uploading',
         lease_owner     = p_worker_id,
         lease_until     = now() + make_interval(secs => greatest(30, p_lease_seconds)),
         attempt_count   = b.attempt_count + 1,
         last_error      = null,
         updated_at      = now()
   where b.id = (
     select candidate.id
     from public.backup_batches candidate
     where candidate.status = 'pending'
        or (candidate.status = 'failed' and candidate.next_attempt_at <= now())
        or (candidate.status = 'uploading' and candidate.lease_until < now())
     order by candidate.created_at asc
     limit 1
     for update skip locked
   )
   returning * into v_batch;

  if found then
    return next v_batch;
    return;
  end if;

  lock table public.backup_change_log in share row exclusive mode;
  select coalesce(max(id), 0) into v_horizon from public.backup_change_log;
  select c.last_change_id into v_checkpoint
    from public.backup_checkpoints c where c.name = 'primary';

  select min(s.id), max(s.id) into v_first, v_last
  from (
    select c.id
    from public.backup_change_log c
    where c.id > coalesce(v_checkpoint, 0) and c.id <= v_horizon
    order by c.id asc
    limit v_limit
  ) s;

  if v_first is null then
    return;
  end if;

  v_key := 'incremental:' || v_first || ':' || v_last;
  insert into public.backup_batches (
    kind, status, range_key, first_change_id, last_change_id,
    attempt_count, lease_owner, lease_until, created_at, updated_at
  ) values (
    'incremental', 'uploading', v_key, v_first, v_last,
    1, p_worker_id, now() + make_interval(secs => greatest(30, p_lease_seconds)), now(), now()
  )
  -- A duplicate range can only be an already-stored attempt. Reclaim it ONLY
  -- when its lease is dead or it was marked failed/pending; never steal a live
  -- lease from another worker, and never re-open a verified batch.
  on conflict (range_key) do update
    set status = 'uploading',
        lease_owner = excluded.lease_owner,
        lease_until = excluded.lease_until,
        attempt_count = public.backup_batches.attempt_count + 1,
        updated_at = now()
    where public.backup_batches.status in ('pending', 'failed')
       or (public.backup_batches.status = 'uploading' and public.backup_batches.lease_until < now())
  returning * into v_batch;

  if found then
    return next v_batch;
  end if;
  return;
end $$;

/**
 * The ONLY checkpoint writer. Requires a still-valid lease and a positive
 * verification flag from the worker. Marking the batch verified and advancing
 * the checkpoint happen in one transaction: there is no window in which the
 * checkpoint points at an unverified Drive object.
 */
create or replace function public.backup_complete_batch(
  p_worker_id       text,
  p_batch_id        uuid,
  p_drive_file_ref  text,
  p_sha256          text,
  p_byte_size       bigint,
  p_manifest        jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch public.backup_batches;
begin
  if not public.is_trusted_writer() then
    raise exception 'backup_complete_batch is worker-only' using errcode = '42501';
  end if;
  if coalesce(p_drive_file_ref, '') = '' or coalesce(p_sha256, '') = '' then
    raise exception 'a verified Drive file id and checksum are required';
  end if;

  select * into v_batch from public.backup_batches b
   where b.id = p_batch_id for update;
  if not found then
    raise exception 'unknown backup batch %', p_batch_id;
  end if;
  if v_batch.status = 'verified' then
    -- Idempotent duplicate completion: never rewinds the checkpoint.
    return true;
  end if;
  if v_batch.status <> 'uploading' or v_batch.lease_owner <> p_worker_id
     or v_batch.lease_until < now() then
    raise exception 'batch lease is no longer owned by this worker';
  end if;

  update public.backup_batches
     set status = 'verified',
         drive_file_ref = p_drive_file_ref,
         content_sha256 = p_sha256,
         byte_size = p_byte_size,
         manifest = p_manifest,
         verified_at = now(),
         updated_at = now(),
         lease_owner = null,
         lease_until = null,
         last_error = null
   where id = p_batch_id;

  if v_batch.kind = 'incremental' then
    update public.backup_checkpoints
       set last_change_id = greatest(last_change_id, v_batch.last_change_id),
           last_success_at = now(),
           last_file_ref = p_drive_file_ref,
           last_content_sha256 = p_sha256,
           updated_at = now()
     where name = 'primary';
  end if;

  update public.backup_drive_connections
     set last_success_at = now(), last_error = null, updated_at = now()
   where status = 'active';

  return true;
end $$;

/** Record a retryable failure. Pending events are left untouched. */
create or replace function public.backup_fail_batch(
  p_worker_id           text,
  p_batch_id            uuid,
  p_error               text,
  p_retry_delay_seconds integer default 60
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    raise exception 'backup_fail_batch is worker-only' using errcode = '42501';
  end if;
  update public.backup_batches
     set status = 'failed',
         last_error = left(coalesce(p_error, 'unknown error'), 2000),
         next_attempt_at = now() + make_interval(secs => greatest(5, least(coalesce(p_retry_delay_seconds, 60), 86400))),
         updated_at = now(),
         lease_owner = null,
         lease_until = null
   where id = p_batch_id
     and status = 'uploading'
     and lease_owner = p_worker_id;

  update public.backup_drive_connections
     set last_error = left(coalesce(p_error, 'unknown error'), 2000), updated_at = now()
   where status = 'active';
end $$;

/**
 * Retention. Only change rows that are (a) at or below the last VERIFIED
 * checkpoint AND (b) at or below the watermark of the OLDEST retained verified
 * snapshot AND (c) older than p_min_age_days may be discarded. Without a
 * verified snapshot the cutoff stays at zero: incrementals alone can never
 * justify pruning the log, because a restore needs a base to replay onto.
 */
create or replace function public.backup_prune_change_log(
  p_keep_snapshots  integer default 14,
  p_min_age_days    integer default 7
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff bigint := 0;
  v_oldest bigint;
  v_checkpoint bigint;
begin
  if not public.is_trusted_writer() then
    raise exception 'backup_prune_change_log is worker-only' using errcode = '42501';
  end if;

  select min(watermark) into v_oldest
  from (
    select watermark from public.backup_snapshots
     where status = 'verified'
     order by created_at desc
     limit greatest(1, least(coalesce(p_keep_snapshots, 14), 365))
  ) kept;

  select last_change_id into v_checkpoint
    from public.backup_checkpoints where name = 'primary';

  if v_oldest is not null then
    v_cutoff := least(v_oldest, coalesce(v_checkpoint, 0));
  end if;

  if v_cutoff > 0 then
    delete from public.backup_change_log c
     where c.id <= v_cutoff
       and c.created_at < now() - make_interval(days => greatest(0, p_min_age_days));
  end if;
  return v_cutoff;
end $$;

-- -----------------------------------------------------------------------------
-- 6b. Snapshot + scheduled-job RPCs (service_role only)
-- -----------------------------------------------------------------------------

/** Register the start of a full snapshot at a previously established horizon. */
create or replace function public.backup_start_snapshot(
  p_watermark          bigint,
  p_previous_watermark bigint default 0,
  p_manifest           jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_trusted_writer() then
    raise exception 'backup_start_snapshot is worker-only' using errcode = '42501';
  end if;
  insert into public.backup_snapshots (watermark, previous_watermark, manifest, status)
  values (p_watermark, greatest(0, p_previous_watermark), p_manifest, 'building')
  returning id into v_id;
  return v_id;
end $$;

/**
 * Mark a snapshot verified ONLY after the Drive object has been downloaded and
 * its checksum matched. Updates the snapshot watermark in the same durable
 * checkpoint row used by incremental exports.
 */
create or replace function public.backup_complete_snapshot(
  p_snapshot_id    uuid,
  p_drive_file_ref text,
  p_sha256         text,
  p_byte_size      bigint,
  p_manifest       jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot public.backup_snapshots;
begin
  if not public.is_trusted_writer() then
    raise exception 'backup_complete_snapshot is worker-only' using errcode = '42501';
  end if;
  if coalesce(p_drive_file_ref, '') = '' or coalesce(p_sha256, '') = '' then
    raise exception 'a verified Drive file id and checksum are required';
  end if;

  select * into v_snapshot from public.backup_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'unknown snapshot %', p_snapshot_id; end if;
  if v_snapshot.status = 'verified' then return true; end if;

  update public.backup_snapshots
     set status = 'verified', drive_file_ref = p_drive_file_ref, content_sha256 = p_sha256,
         byte_size = p_byte_size, manifest = p_manifest, verified_at = now(),
         updated_at = now(), last_error = null
   where id = p_snapshot_id;

  update public.backup_checkpoints
     set last_snapshot_watermark = greatest(last_snapshot_watermark, v_snapshot.watermark),
         last_snapshot_at = now(), updated_at = now()
   where name = 'primary';

  -- A snapshot batch is also visible in the admin history.
  insert into public.backup_batches (
    kind, status, range_key, snapshot_ref, manifest,
    drive_file_ref, content_sha256, byte_size, verified_at
  ) values (
    'snapshot', 'verified', 'snapshot:' || v_snapshot.watermark || ':' || p_snapshot_id,
    p_snapshot_id, p_manifest, p_drive_file_ref, p_sha256, p_byte_size, now()
  ) on conflict (range_key) do nothing;

  update public.backup_drive_connections
     set last_success_at = now(), last_error = null, updated_at = now()
   where status = 'active';
  return true;
end $$;

create or replace function public.backup_fail_snapshot(p_snapshot_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    raise exception 'backup_fail_snapshot is worker-only' using errcode = '42501';
  end if;
  update public.backup_snapshots
     set status = 'failed', last_error = left(coalesce(p_error, 'unknown error'), 2000),
         attempt_count = attempt_count + 1, updated_at = now()
   where id = p_snapshot_id and status <> 'verified';
end $$;

/** Claim one admin-authorized or scheduled job. */
create or replace function public.backup_claim_job(p_kind text, p_worker_id text)
returns setof public.backup_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    raise exception 'backup_claim_job is worker-only' using errcode = '42501';
  end if;
  return query
  update public.backup_jobs j
     set status = 'running', updated_at = now()
   where j.id = (
     select candidate.id from public.backup_jobs candidate
      where candidate.kind = p_kind and candidate.status = 'pending'
      order by candidate.created_at asc limit 1 for update skip locked
   )
  returning j.*;
end $$;

create or replace function public.backup_finish_job(p_job_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    raise exception 'backup_finish_job is worker-only' using errcode = '42501';
  end if;
  update public.backup_jobs
     set status = case when p_error is null then 'done' else 'failed' end,
         last_error = left(p_error, 2000), completed_at = now(), updated_at = now()
   where id = p_job_id;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Admin RPCs (RLS-authenticated, permission-checked, audited)
-- -----------------------------------------------------------------------------

create or replace function public.backup_status()
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
    raise exception 'You do not have permission to view backups.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'connection', (
      select jsonb_build_object(
        'status', c.status, 'account_label', c.account_label,
        'folder_ref', c.folder_ref, 'folder_restricted', c.folder_restricted,
        'connected_at', c.connected_at, 'last_success_at', c.last_success_at,
        'last_error', c.last_error
      )
      from public.backup_drive_connections c
      order by c.connected_at desc limit 1
    ),
    'checkpoint', (
      select jsonb_build_object(
        'last_change_id', c.last_change_id, 'last_success_at', c.last_success_at,
        'last_file_ref', c.last_file_ref, 'last_snapshot_watermark', c.last_snapshot_watermark,
        'last_snapshot_at', c.last_snapshot_at
      )
      from public.backup_checkpoints c where c.name = 'primary'
    ),
    'queue_depth', (
      select count(*) from public.backup_change_log c
       where c.id > (select last_change_id from public.backup_checkpoints where name = 'primary')
    ),
    'oldest_pending_at', (
      select min(c.occurred_at) from public.backup_change_log c
       where c.id > (select last_change_id from public.backup_checkpoints where name = 'primary')
    ),
    'failed_batches', (
      select count(*) from public.backup_batches b where b.status = 'failed'
    ),
    'pending_jobs', (
      select count(*) from public.backup_jobs j where j.status in ('pending', 'running')
    ),
    'errors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'range_key', b.range_key, 'attempt_count', b.attempt_count,
        'last_error', b.last_error, 'next_attempt_at', b.next_attempt_at,
        'updated_at', b.updated_at
      ) order by b.updated_at desc)
      from (
        select * from public.backup_batches b where b.status = 'failed' order by b.updated_at desc limit 5
      ) b
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'kind', h.kind, 'range_key', h.range_key,
        'first_change_id', h.first_change_id, 'last_change_id', h.last_change_id,
        'verified_at', h.verified_at, 'byte_size', h.byte_size,
        'drive_file_ref', h.drive_file_ref, 'attempt_count', h.attempt_count
      ) order by coalesce(h.verified_at, h.created_at) desc)
      from (
        select * from public.backup_batches b
         where b.status = 'verified' or b.status = 'failed'
         order by coalesce(b.verified_at, b.created_at) desc limit 20
      ) h
    ), '[]'::jsonb),
    'snapshots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'watermark', s.watermark, 'status', s.status,
        'created_at', s.created_at, 'verified_at', s.verified_at,
        'byte_size', s.byte_size, 'drive_file_ref', s.drive_file_ref,
        'last_error', s.last_error
      ) order by s.created_at desc)
      from (select * from public.backup_snapshots order by created_at desc limit 14) s
    ), '[]'::jsonb),
    'scope', jsonb_build_object(
      'schemas', jsonb_build_array('public'),
      'tracked_tables', (select count(*) from public.backup_tracked_tables where snapshot),
      'excluded', jsonb_build_array('auth.*', 'storage.*', 'realtime.*', 'backup_private', 'public.backup_*'),
      'complete_disaster_recovery', false
    )
  ) into v_result;
  return v_result;
end $$;

/** Enqueue an admin-authorized manual run. Idempotent for 60 seconds. */
create or replace function public.backup_request_job(p_kind text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.has_permission('manage_backups') then
    raise exception 'You do not have permission to run backups.' using errcode = '42501';
  end if;
  if p_kind not in ('incremental', 'snapshot') then
    raise exception 'unknown backup kind';
  end if;

  select id into v_id from public.backup_jobs
   where kind = p_kind and status = 'pending' and created_at > now() - interval '60 seconds'
   order by created_at desc limit 1;
  if found then
    return v_id;
  end if;

  insert into public.backup_jobs (kind, requested_by, note)
  values (p_kind, public.current_profile_id(), left(coalesce(p_note, ''), 500))
  returning id into v_id;

  perform public.log_audit(
    'backup.request', 'backup_job', v_id::text,
    jsonb_build_object('kind', p_kind), false, null, 'admin'::public.moderation_visibility
  );
  return v_id;
end $$;

/** Authorized retry: reset a failed batch to immediately claimable. */
create or replace function public.backup_retry_failed(p_batch_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if not public.has_permission('manage_backups') then
    raise exception 'You do not have permission to retry backups.' using errcode = '42501';
  end if;
  update public.backup_batches
     set status = 'pending', next_attempt_at = now(), last_error = null,
         lease_owner = null, lease_until = null, updated_at = now()
   where id = p_batch_id and status = 'failed';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform public.log_audit(
      'backup.retry', 'backup_batch', p_batch_id::text,
      '{}'::jsonb, false, null, 'admin'::public.moderation_visibility
    );
  end if;
  return v_count > 0;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Encrypted private-store RPCs
-- -----------------------------------------------------------------------------

/** Store a one-time PKCE verifier for the admin OAuth round trip. */
create or replace function public.backup_start_oauth_flow(
  p_state_hash    text,
  p_redirect_uri  text,
  p_ciphertext    text,
  p_iv_b64        text,
  p_tag_b64       text,
  p_key_ref       text,
  p_expires_at    timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('manage_backups') then
    raise exception 'You do not have permission to connect Drive.' using errcode = '42501';
  end if;
  delete from backup_private.oauth_flows where expires_at < now();
  insert into backup_private.oauth_flows (
    state_hash, profile_ref, verifier_ciphertext, iv_b64, tag_b64, key_ref, redirect_uri, expires_at
  ) values (
    p_state_hash, public.current_profile_id(), p_ciphertext, p_iv_b64, p_tag_b64, p_key_ref,
    p_redirect_uri, p_expires_at
  );
  perform public.log_audit(
    'backup.oauth_start', 'backup_connection', null,
    '{}'::jsonb, false, null, 'admin'::public.moderation_visibility
  );
end $$;

/** Consume (single use) a PKCE flow. Returns the encrypted verifier. */
create or replace function public.backup_take_oauth_flow(p_state_hash text)
returns table (
  redirect_uri        text,
  verifier_ciphertext text,
  iv_b64              text,
  tag_b64             text,
  key_ref             text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('manage_backups') then
    raise exception 'You do not have permission to connect Drive.' using errcode = '42501';
  end if;
  return query
    delete from backup_private.oauth_flows f
     where f.state_hash = p_state_hash
       and f.profile_ref = public.current_profile_id()
       and f.expires_at > now()
    returning f.redirect_uri, f.verifier_ciphertext, f.iv_b64, f.tag_b64, f.key_ref;
end $$;

/**
 * Finish the connection: create the public metadata row, mark older
 * connections revoked, and store the refresh credential encrypted in the
 * private schema. `p_folder_ref` must be a folder the app itself created and
 * verified as unshared; the callback path enforces that before calling.
 */
create or replace function public.backup_store_connection(
  p_subject     text,
  p_label       text,
  p_folder_ref  text,
  p_ciphertext  text,
  p_iv_b64      text,
  p_tag_b64     text,
  p_key_ref     text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.has_permission('manage_backups') then
    raise exception 'You do not have permission to connect Drive.' using errcode = '42501';
  end if;
  if coalesce(p_folder_ref, '') = '' or coalesce(p_ciphertext, '') = '' then
    raise exception 'a restricted folder and an encrypted credential are required';
  end if;

  update public.backup_drive_connections set status = 'revoked', updated_at = now()
   where status = 'active';

  insert into public.backup_drive_connections (
    google_subject, account_label, folder_ref, folder_restricted, connected_by
  ) values (
    p_subject, left(coalesce(p_label, 'Google Drive'), 120), p_folder_ref, true,
    public.current_profile_id()
  ) returning id into v_id;

  insert into backup_private.oauth_credentials (
    connection_ref, credential_ciphertext, iv_b64, tag_b64, key_ref
  ) values (
    v_id, p_ciphertext, p_iv_b64, p_tag_b64, p_key_ref
  );

  perform public.log_audit(
    'backup.oauth_connected', 'backup_connection', v_id::text,
    jsonb_build_object('folder_ref', p_folder_ref), false, null, 'admin'::public.moderation_visibility
  );
  return v_id;
end $$;

/** Worker-only: load the encrypted refresh credential. */
create or replace function public.backup_private_get_credentials(p_connection_ref uuid)
returns table (
  credential_ciphertext text,
  iv_b64                text,
  tag_b64               text,
  key_ref               text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    raise exception 'credentials are worker-only' using errcode = '42501';
  end if;
  return query
    select c.credential_ciphertext, c.iv_b64, c.tag_b64, c.key_ref
    from backup_private.oauth_credentials c
    where c.connection_ref = p_connection_ref;
end $$;

/** Worker-only: persist a rotated refresh credential. */
create or replace function public.backup_private_rotate_credentials(
  p_connection_ref uuid,
  p_ciphertext     text,
  p_iv_b64         text,
  p_tag_b64        text,
  p_key_ref        text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_trusted_writer() then
    raise exception 'credentials are worker-only' using errcode = '42501';
  end if;
  update backup_private.oauth_credentials
     set credential_ciphertext = p_ciphertext, iv_b64 = p_iv_b64,
         tag_b64 = p_tag_b64, key_ref = p_key_ref, updated_at = now()
   where connection_ref = p_connection_ref;
end $$;

/** Admin disconnect: revoke metadata and delete the stored credential. */
create or replace function public.backup_disconnect()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- An authenticated Super Admin uses the UI button; the operator CLI calls
  -- this with the service-role key (trusted writer) after Google revocation.
  if not (public.has_permission('manage_backups') or public.is_trusted_writer()) then
    raise exception 'You do not have permission to disconnect Drive.' using errcode = '42501';
  end if;
  delete from backup_private.oauth_credentials c
   using public.backup_drive_connections d
   where c.connection_ref = d.id;
  update public.backup_drive_connections
     set status = 'revoked', updated_at = now()
   where status <> 'revoked';
  perform public.log_audit(
    'backup.oauth_disconnected', 'backup_connection', null,
    '{}'::jsonb, false, null, 'admin'::public.moderation_visibility
  );
end $$;

-- -----------------------------------------------------------------------------
-- 9. Function grants — worker-only functions must NOT be callable by students
-- -----------------------------------------------------------------------------

do $$
declare
  v_fn text;
  v_worker_only text[] := array[
    'backup_snapshot_watermark()',
    'backup_pending_changes(bigint, bigint)',
    'backup_claim_batch(text, integer, integer)',
    'backup_complete_batch(text, uuid, text, text, bigint, jsonb)',
    'backup_fail_batch(text, uuid, text, integer)',
    'backup_prune_change_log(integer, integer)',
    'backup_start_snapshot(bigint, bigint, jsonb)',
    'backup_complete_snapshot(uuid, text, text, bigint, jsonb)',
    'backup_fail_snapshot(uuid, text)',
    'backup_claim_job(text, text)',
    'backup_finish_job(uuid, text)',
    'backup_private_get_credentials(uuid)',
    'backup_private_rotate_credentials(uuid, text, text, text, text)',
    'backup_sync_triggers()'
  ];
begin
  -- 018 grants new functions to authenticated by default; revoke that for the
  -- worker/admin RPC surface and then grant back only what each needs.
  foreach v_fn in array v_worker_only loop
    execute format('revoke all on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;

  -- The trigger function must never be called directly.
  execute 'revoke all on function public.backup_capture_change() from public, anon, authenticated';

  -- Two older trigger helpers were first created before migration 018 and later
  -- replaced with CREATE OR REPLACE, which preserves their original
  -- PUBLIC EXECUTE grant. Trigger functions are never RPCs, so close that
  -- pre-existing anon surface here rather than leave the audit red.
  for v_fn in
    select distinct p.oid::regprocedure::text
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where not t.tgisinternal and n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
  end loop;

  -- Admin RPCs: authenticated, and each one re-checks manage_backups itself.
  for v_fn in
    select unnest(array[
      'backup_status()',
      'backup_request_job(text, text)',
      'backup_retry_failed(uuid)',
      'backup_start_oauth_flow(text, text, text, text, text, text, timestamptz)',
      'backup_take_oauth_flow(text)',
      'backup_store_connection(text, text, text, text, text, text, text)',
      'backup_disconnect()'
    ])
  loop
    execute format('revoke all on function public.%s from public, anon', v_fn);
    execute format('grant execute on function public.%s to authenticated, service_role', v_fn);
  end loop;
end $$;

comment on function public.backup_status() is
  'Admin-only backup health: connection status, last verified export, queue depth, failures, history and snapshot scope. Never returns credentials or row payloads.';
comment on function public.backup_complete_batch(text, uuid, text, text, bigint, jsonb) is
  'Sole writer of the durable checkpoint; requires a live lease and is called only after a verified Drive download.';
