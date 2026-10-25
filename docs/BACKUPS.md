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
| `BACKUP_CRON_SECRET` | cron endpoints | ≥24 random characters; `CRON_SECRET` also works (Vercel sends it) |
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

1. Apply migrations (`supabase db push`) or paste the regenerated bundle
   `supabase/bundle/campus-plus-schema.sql` into the SQL Editor. Migration 027
   adds the outbox, worker state, `backup_private`, the `manage_backups`
   permission (Super Admin only) and capture triggers on every public table.
2. **Do not expose `backup_private` through PostgREST.** Keep
   `supabase/config.toml` → `[api] schemas = ["public"]`. Encrypted credentials
   are only reachable through worker-only `SECURITY DEFINER` RPCs.
3. Supabase → Connect → **Session pooler / direct connection** → copy the URI
   into `BACKUP_DATABASE_URL` (add `?sslmode=require` if absent). It must be able
   to hold one `REPEATABLE READ` transaction while reading all tables.
4. Vercel: `vercel.json` declares two **once-daily** cron jobs — worker at
   01:00 UTC, full snapshot at 02:00 UTC. Vercel automatically sends
   `Authorization: Bearer <CRON_SECRET>`; set `BACKUP_CRON_SECRET` (or
   `CRON_SECRET`) to the same value. **Why daily:** Vercel's Hobby plan rejects
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
* failed batch count, pending jobs, recent errors and an **Authorize retry**
  button;
* backup history (verified/failed batches) and full-snapshot history;
* **Connect Google Drive**, **Run incremental now**, **Request full snapshot**,
  **Disconnect** — all audited, all enqueue-only (no Drive call from the button);
* presence-only server configuration report and the exact callback URL;
* the explicit disaster-recovery limitation notice.

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

---

## 9. Acceptance checklist before claiming production success

1. `npm run verify` (lint + migrations + SQL suites + audit + unit tests) passes.
2. `npm run db:bundle -- --check` passes (bundle matches migration 027).
3. `npm run check:env` passes with real values in the deployment environment.
4. `npm run verify:security` passes against the live project with the public key
   (anonymous probes cannot read the outbox or call worker RPCs).
5. Super Admin connects Drive and the callback creates a folder with no
   `anyone` permission; Admin → Backups shows `active`.
6. `npm run backup:worker` returns `status: "verified"` and the admin page shows
   a new last successful export and a decreased queue depth.
7. Download that exact Drive object and run `npm run backup:verify-restore --
   --from-drive ...` — decryption, replay and state comparison succeed.
8. `npm run backup:snapshot` returns `verified` with a nonzero watermark; repeat
   step 7 with the snapshot plus subsequent incremental objects into a fresh
   database.
9. Only after 5–8 pass should anyone describe the production backup as working.
   **This change does not make that claim.**
