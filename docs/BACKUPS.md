# Campus+ encrypted, recoverable Google Drive backups

**Status of this implementation:** the code, migrations, offline restore test and
schema checks are in this repository. **No production Google Drive upload or
restore has been performed by this change.** The operator acceptance checklist at
the end of this document must pass against the real Supabase project and the real
Drive folder before anyone may call the production backup working.

---

## 1. What is and is not backed up

Supabase Postgres remains the **sole primary database** for every normal read and
write. Google Drive is a secondary, append-only, encrypted copy. The application
never calls Drive while serving a student request, never reads Drive to fill in a
missing record, and never falls back to Drive per record.

### Included

* **Schema `public` only** — every application table listed in
  `public.backup_tracked_tables` (65 tables at the time of migration 027).
  `backup_sync_triggers()` re-scans `pg_catalog` and adds triggers/catalogue rows
  for tables introduced by later migrations.
* All three event kinds: `INSERT`, `UPDATE`, `DELETE`. Deletes are tombstones:
  `row_pk` holds the primary key and `row_data` is `NULL`, so a delete survives
  removal of the source row.
* Reference/configuration data in `public` (roles, permissions, feature flags,
  platform settings, colleges, categories, timetable-independent tables).
* Full snapshots: a consistent table image plus a checkpoint watermark.

### Excluded — this is NOT complete disaster recovery

* `auth.*` — Supabase Auth users, encrypted passwords, sessions, refresh tokens,
  identities, MFA factors. **Auth data is not restored.**
* `storage.*` objects and buckets, `realtime.*`, `supabase_functions.*`,
  `vault`, extension schemas and `supabase_migrations`.
* `backup_private` (encrypted OAuth verifiers/refresh credentials) and all
  `public.backup_*` tables (outbox, batches, checkpoints, snapshots, jobs,
  connection metadata, tracked-table catalogue).
* Database roles, grants, RLS policies, triggers and functions — these come from
  `supabase/migrations/` or `supabase/bundle/campus-plus-schema.sql`.
* Edge/config secrets, OAuth provider settings, Vercel cron configuration and
  DNS.

Every encrypted object carries a manifest that states the same exclusions and
sets `complete_disaster_recovery: false`. A restore therefore requires:
(1) a fresh database created from the migration history, (2) this restore
procedure, (3) reprovisioning Supabase Auth users/identities and provider
configuration, (4) re-creating platform secrets/cron/env configuration.

---

## 2. Architecture

```
student write ──► Supabase Postgres (COMMIT)
                     │  AFTER ROW trigger, SAME transaction
                     ▼
              public.backup_change_log   (durable transactional outbox)
                     │  no HTTP, no webhook, no pg_net
                     ▼  (cron / CLI only)
              backup_claim_batch()  ── lease + ordered range [first,last]
                     ▼
        gzip → AES-256-GCM envelope → Drive upload (restricted folder)
                     ▼
        re-download + SHA-256 verify  ──► backup_complete_batch()
                                          (checkpoint + verify in ONE txn)
```

* **Durable outbox, not a fire-and-forget webhook.** A missed cron run just
  leaves rows in the outbox; the next run picks them up. A rollback of the
  application write also rolls back its outbox row.
* **No recursion.** No `backup_*` table has a capture trigger, and the trigger
  function has an explicit guard. Worker bookkeeping writes never create new
  change rows.
* **Ordering.** `backup_claim_batch()` and `backup_snapshot_watermark()` take a
  short `SHARE ROW EXCLUSIVE` lock on the outbox. It waits for in-flight writers
  and blocks new ones only for the milliseconds needed to read `max(id)`, so a
  transaction that allocated a lower id but commits later cannot be skipped.
  `backup_pending_changes()` returns rows ordered by ascending `id`.
* **Idempotency.** Each range has a deterministic `range_key` and a
  deterministic Drive object name derived from that range, its change ids and
  the encryption key id — not from the ciphertext (a fresh GCM IV would make
  that hash differ on every attempt). The object's `appProperties` record both
  that range digest and its own ciphertext SHA-256. A duplicate attempt finds
  the existing object, verifies the download against the *stored* checksum, and
  skips the upload. `backup_complete_batch()` is the only checkpoint writer and
  is idempotent.
* **Never discard pending events early.** The checkpoint advances only after a
  verified download. `backup_prune_change_log()` refuses to prune above the last
  verified checkpoint or above the oldest retained verified snapshot.
* **Retries.** A failure stores `last_error`, increments `attempt_count` and sets
  an exponential backoff (30s → 3600s) with jitter. Events remain queued.
* **Retention.** Keep the 14 newest verified full snapshots; delete older
  snapshot objects and incremental objects older than 7 days whose last change
  id is at or below the oldest retained snapshot watermark and the verified
  checkpoint. The SQL prune function enforces the same bounds independently.

### Full snapshot consistency

1. `backup_snapshot_watermark()` quiesces the outbox briefly and returns horizon
   `H` = `max(backup_change_log.id)`.
2. `BackupStore.readAllTables()` reads **every tracked table in ONE
   `REPEATABLE READ READ ONLY` transaction** on a direct Postgres connection.
3. Any write committed during that read has `id > H` and is replayed on restore
   from the incremental objects. The manifest records `H`, the exact table list,
   insertable columns, primary keys and per-table SHA-256 digests.
4. Restoration = restore all tables, then replay incremental events with
   `id > H` in ascending order (upsert by primary key, delete by tombstone).

---

## 3. Exact environment variables

All values are **server-only**. Copy them into `.env.local` and Vercel
(Project → Settings → Environment Variables). Never prefix any of them with
`NEXT_PUBLIC_`. `.env.example` documents the same list.

| Variable | Required for | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | everything | existing Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | everything | existing publishable key (unchanged) |
| `SUPABASE_SECRET_KEY` | worker/admin service-role client | existing Supabase secret key |
| `GOOGLE_DRIVE_CLIENT_ID` | Drive OAuth | client ID of the **existing Drive-only OAuth client** |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Drive OAuth | client secret of that same client |
| `BACKUP_ENCRYPTION_KEYS` | all encryption | `primary:<base64 of 32 bytes>`; rotation: `primary:<...>,previous:<...>` |
| `BACKUP_ENCRYPTION_KEY_ID` | new objects | key id to use, default `primary`; must exist in `BACKUP_ENCRYPTION_KEYS` |
| `BACKUP_DATABASE_URL` | full snapshots, restore | direct/session Postgres connection string with `sslmode=require` |
| `BACKUP_RESTORE_DATABASE_URL` | restore scripts (optional) | separate disposable database; never the primary |
| `CRON_SECRET` | cron endpoints | **This exact name**: ≥24 random characters. Vercel Cron sends only `CRON_SECRET` as `Authorization: Bearer <value>` |
| `BACKUP_CRON_SECRET` | cron endpoints (legacy) | optional alias, also accepted; set it to the **same** value as `CRON_SECRET` or remove it |
| `BACKUP_DRIVE_REDIRECT_URI` | development only | e.g. `http://localhost:3000/api/backup/drive/callback`; **must not be set to anything else in production** |
| `BACKUP_PUBLIC_ORIGIN` | development only | origin used to build the development callback |

Generate a key with `openssl rand -base64 32`. Losing the key makes every
existing backup unrecoverable; store it in a password manager / secrets vault,
**not** in the database or Drive. Rotating keys means adding the new `primary`
and keeping old ids until all objects encrypted with them are outside retention.

`npm run check:env` validates key length, connection-string shape, cron-secret
length and refuses to let a backup secret appear in a `NEXT_PUBLIC_*` variable.

---

## 4. Google Cloud configuration (existing Drive OAuth client)

1. Google Cloud Console → the project that owns the **existing Drive-only OAuth
   client** → APIs & Services → **Library** → enable **Google Drive API**.
2. **OAuth consent screen**: set the app to *Internal* for the college Workspace
   tenant (or keep the existing testing users). Scope requested:
   `https://www.googleapis.com/auth/drive.file` only — the app can see only the
   folder and files it creates, never the admin's whole Drive.
3. **Credentials → OAuth 2.0 Client IDs → the existing Web application client.**
   Add this **exact** Authorized redirect URI:

   ```
   https://pccoe.in/api/backup/drive/callback
   ```

   For local work also add `http://localhost:3000/api/backup/drive/callback`.
   The production URL is hard-coded in `lib/backup/constants.js` and
   `resolveRedirectUri()` rejects any other value in production.
4. Copy that client's ID/secret into `GOOGLE_DRIVE_CLIENT_ID` and
   `GOOGLE_DRIVE_CLIENT_SECRET`. This is a **separate client from the one used by
   Supabase Auth for student sign-in**; student authentication code, Supabase
   provider settings and `/auth/callback` are unchanged.
5. Do **not** create a service account key or a public link. The callback creates
   a folder named `Campus+ Backups (private)` with **no `permissions.create`
   call**, then refuses it if Drive reports `shared = true` or any `anyone`
   permission. Backups are never written to a public folder.

---

## 5. Supabase / Vercel configuration

1. Apply the migrations. **No terminal needed:** Supabase dashboard → SQL
   Editor → New query → paste and Run.

   * an existing project that already has migration 027 only needs
     `supabase/migrations/20261025000002_028_backup_admin_processing.sql`
     (run it **once** — it creates new objects and is deliberately not
     idempotent, so a second run is refused rather than half-applied);
   * a brand-new project pastes the regenerated whole-schema bundle
     `supabase/bundle/campus-plus-schema.sql`.

   Migration 027 added the outbox, worker state, `backup_private`, the
   `manage_backups` permission (Super Admin only) and capture triggers on every
   public table. **Migration 028 is what makes the admin buttons process work**:
   it adds `backup_run_leases`, `backup_run_log`, `backup_admin_state()` and
   `backup_record_run()`. Without 028 the Backups page says
   "Live job state is unavailable" and admin runs report
   `Could not start a backup run`. `supabase db push` works too if you prefer
   the CLI.
2. **Do not expose `backup_private` through PostgREST.** Keep
   `supabase/config.toml` → `[api] schemas = ["public"]`. Encrypted credentials
   are only reachable through worker-only `SECURITY DEFINER` RPCs.
3. Supabase → Connect → **Session pooler / direct connection** → copy the URI
   into `BACKUP_DATABASE_URL` (add `?sslmode=require` if absent). It must be able
   to hold one `REPEATABLE READ` transaction while reading all tables.
4. Vercel: `vercel.json` declares two **once-daily** cron jobs — worker at
   01:00 UTC, full snapshot at 02:00 UTC. Vercel automatically sends
   `Authorization: Bearer <CRON_SECRET>` — it can ONLY inject the variable
   literally named `CRON_SECRET`, so add that variable to the **Production**
   environment and redeploy. `BACKUP_CRON_SECRET` is still accepted as a legacy
   alias (the endpoints accept either token), but setting only that name — or
   setting both to different values — is what produced the
   `401 {"error":"unauthorized"}` on `/api/backup/worker`. Set both to the
   same value if you keep both. **Why daily:** Vercel's Hobby plan rejects
   any cron expression that resolves to more than one run per day, and it does so
   at *deploy* time (before the build), which would break every deployment. On a
   Pro plan you may change the worker schedule to `*/5 * * * *` for a ~5-minute
   RPO; on Hobby, get the same cadence from an external scheduler (GitHub
   Actions, any cron service) calling `GET /api/backup/worker` with the bearer
   token, or run `npm run backup:worker -- --loop --interval=300` on a trusted
   host. The outbox is durable, so a less frequent schedule never loses changes
   — it only increases the time until they reach Drive.
   Both routes are capped at `maxDuration = 60`, a value every Vercel plan
   accepts; for large databases run `npm run backup:snapshot` from a host with
   no function timeout instead.
5. `SUPABASE_SECRET_KEY` must be available to the Vercel server runtime (the
   worker's service-role client). It is never sent to the browser.
6. Sign in as the first Super Admin (`npm run role:grant -- --email
   you@pccoepune.org --role super_admin`) and open **Admin → Backups** to see
   connection status, configuration presence and history.

---

## 6. Admin UI and operations

Admin → Backups (`manage_backups`, Super Admin by default) shows:

* connection status, account label, restricted-folder flag;
* last successful verified export and checkpoint id;
* queue depth and oldest pending change;
* **Queue states** — `queued`, `processing`, `verified`, `failed` from
  `backup_jobs`, plus uploading batches, batches waiting for their backoff and
  the next automatic retry time;
* failed batch count, pending jobs, recent errors and an **Authorize retry**
  button;
* backup history (verified/failed batches) and full-snapshot history;
* **Recent runs and jobs** — each admin-triggered run is written to
  `backup_run_log` with its status, verified object ids and redacted
  diagnostics, so the page still shows what happened after a refresh;
* **Connect Google Drive**, **Run incremental now**, **Run full snapshot now**,
  **Disconnect** — all audited. The two run buttons **process eligible queued
  work** in bounded batches (up to 12 units / ~45s per click) rather than
  enqueueing another job, so repeated clicks cannot pile up duplicates and a
  stuck queue can be drained from the browser without a terminal;
* presence-only server configuration report and the exact callback URL;
* the explicit disaster-recovery limitation notice.

`runBackupWorker()` claims exactly one job and one batch per unit, so the
processor loops over units until the queue drains, a unit fails, or the
deadline hits. Concurrency is protected twice: a durable per-kind lease in
`backup_run_leases` (a cron tick, the CLI and an admin click all take it; an
expired lease from a killed function is taken over and any job the interrupted
run left `running` is requeued, never deleted or marked done) and the existing
per-batch lease/`range_key` uniqueness. A failed unit stops the run, reports a
safe diagnostic plus the backoff window, and leaves untouched jobs pending.

**No CLI or terminal is required for routine operation.** Admin → Backups is the
supported control surface. `GET/POST /api/backup/worker` keeps its bearer-token
protection for scheduled runs, and the CLI remains for restore/offline work.

Every action is re-checked in the database (`has_permission('manage_backups')`
inside `SECURITY DEFINER` functions) and written to `audit_logs` through
`log_audit()`.

**Connect Google Drive is deliberately a plain `<a href>` (not `next/link`).**
The route returns a 307 to `accounts.google.com`; a Next.js `Link` prefetches it
as an RSC request (`?_rsc=…`) and then attempts to follow that cross-origin
redirect client-side, which fails CORS. A native anchor performs a top-level
document GET, so the browser follows the server redirect to Google directly.
`tests/backup-oauth-navigation.test.js` guards this. Do not "simplify" it back
to `LinkButton`, and do not add CORS headers to work around the symptom.

---

## 7. Restoration procedure (tested)

The restore code path is exercised by `npm run backup:verify-restore`, which
encrypts a real snapshot + incremental chain, decrypts them, replays insert /
update / delete tombstones into a target and compares the final state against an
independently computed expected state. **That is an offline fixture**, not a
production upload test.

To restore for real, into a **separate** database:

```bash
# 1. Create a fresh target DB and apply the schema (migrations or bundle).
createdb campus_restore
psql "$BACKUP_RESTORE_DATABASE_URL" -f supabase/bundle/campus-plus-schema.sql

# 2. Obtain the encrypted objects (private Drive folder or local copies).
#    The snapshot is a *.cpbe file; incrementals are the *.cpbe files whose
#    first_change_id is greater than the snapshot watermark.

# 3. Restore + verify (refuses to run without --confirm-restore).
npm run backup:restore -- \
  --from-drive \
  --snapshot <snapshotDriveFileId> \
  --incremental <id1>,<id2>,<id3> \
  --target "$BACKUP_RESTORE_DATABASE_URL" \
  --confirm-restore

# 4. Check the restore against the real downloaded objects, in memory or a DB.
npm run backup:verify-restore -- --from-drive \
  --snapshot <snapshotDriveFileId> --incremental <id1>,<id2>,<id3>
```

`restoreFromBackup()` decrypts and gzip-decompresses each object, validates the
manifest (only `public`, `complete_disaster_recovery: false`), truncates and
re-inserts every manifest table with triggers disabled, replays incremental
changes ascending by id (delete tombstones included), then compares the restored
state against the independently computed expected state **before commit**. A
mismatch rolls back. `--target` equal to `BACKUP_DATABASE_URL` is refused.

Afterwards you must still reprovision Auth users/identities, OAuth provider
settings, secrets, cron and any Storage objects. Until that is done, the
restored database is **not** a working production system.

---

## 8. Failure modes

| Failure | Behaviour |
| --- | --- |
| Drive down / 429 / 5xx / timeout | batch marked `failed`, exponential backoff, events retained, checkpoint unchanged |
| Upload succeeded but verification download mismatches | treated as a failure; a later attempt reuses or re-uploads the deterministic range object; checkpoint unchanged |
| Worker crashes after upload, before `completeBatch` | lease expires, batch reclaimed with the same `range_key`; existing Drive object verified and reused |
| Duplicate completion | `backup_complete_batch()` returns `true` without rewinding the checkpoint |
| Snapshot fails | `backup_fail_snapshot()` records the error; incremental exports continue |
| No verified snapshot exists | retention cutoff is zero; the change log is never pruned |
| Refresh token rotated | worker re-encrypts and persists it through `backup_private_rotate_credentials()` |
| Key missing / wrong | decryption fails loudly; no plaintext is restored and nothing is committed |
| Cron request without a matching bearer token | `401 {"error":"unauthorized"}` **before** any Supabase client or Drive runtime is created; no secret is logged. Vercel only ever sends `CRON_SECRET` |
| Admin click while another run holds the lease | `status: "busy"` — no new job is queued, nothing is overwritten, the in-flight run keeps its result |
| Run interrupted mid-way (function killed) | lease expires; the next run requeues `running` jobs and re-verifies/reuses the deterministic Drive object |
| Unit fails during an admin run | run stops, redacted diagnostic + backoff are shown, already-verified objects stay verified, remaining jobs stay queued |

### 8.1 If `/api/backup/worker` returns 401

The endpoint accepts `Authorization: Bearer <token>` matching **either**
`CRON_SECRET` or `BACKUP_CRON_SECRET`, compared without short-circuiting and
never logged. Work through this order:

1. Vercel → Settings → Environment Variables → **Production** (not Preview)
   must contain `CRON_SECRET`. Vercel Cron injects only that exact name.
2. **Redeploy** — env changes do not apply to an already-built deployment, so
   editing a variable and re-running cron still validates against the old
   value inside the running function.
3. If both names exist they must be identical, or cron's value (the one Vercel
   sends) must be the one you intend. A stray trailing space or newline is
   tolerated by trimming, but a *different value* under `CRON_SECRET` is the
   usual cause.
4. An **empty/whitespace** value makes `cronAuthorized()` reject everything —
   check that the variable is actually set for Production, not just defined in
   the schema.
5. Confirm without exposing anything: `curl -s -o /dev/null -w '%{http_code}'
   -X POST https://pccoe.in/api/backup/worker` must be `401`, and with
   `-H "Authorization: Bearer $CRON_SECRET"` it must be `200`. Never paste the
   token into a shared terminal history or the browser.
6. Independent of all of the above, **Admin → Backups → Run incremental now**
   processes the queue through the authenticated admin action path, which does
   not use the cron secret at all.

---

## 9. Acceptance checklist before claiming production success

1. `npm run verify` (lint + migrations + SQL suites + audit + unit tests) passes.
2. `npm run db:bundle -- --check` passes (bundle matches migrations 027 + 028).
3. `npm run check:env` passes with real values in the deployment environment, and
   reports `CRON_SECRET` as set for **Production**.
4. `npm run verify:security` passes against the live project with the public key
   (anonymous probes cannot read the outbox or call worker RPCs).
5. Apply **both** migrations (or the regenerated bundle) to the live project —
   `backup_acquire_run_lease` missing means admin runs report
   `Could not start a backup run`.
6. Super Admin connects Drive and the callback creates a folder with no
   `anyone` permission; Admin → Backups shows `active`.
7. **From the browser** (no terminal): click **Run incremental now**. The page
   must move queued jobs `queued → verified`, show the verified Drive object id +
   SHA-256 prefix, and `queue_depth` must drop. Then confirm the object actually
   exists in the restricted Drive folder (named `campus-plus-incremental-…cpbe`,
   private, only the app's own access) and that its size matches the reported
   byte size.
8. Download that exact Drive object and run `npm run backup:verify-restore --
   --from-drive ...` — decryption, replay and state comparison succeed.
9. Click **Run full snapshot now** (requires `BACKUP_DATABASE_URL`). It must
   return `verified` with a nonzero watermark and a row count; confirm the
   `campus-plus-snapshot-…cpbe` object in the folder. Repeat step 8 with the
   snapshot plus subsequent incremental objects into a fresh database.
10. `curl` the cron endpoint with and without the bearer token: without → `401`,
    with `CRON_SECRET` → `200` (§8.1). The cron path stays protected even though
    the UI no longer depends on it.
11. Only after 6–10 pass should anyone describe the production backup as working.
    **Local verification alone does not make that claim.**
