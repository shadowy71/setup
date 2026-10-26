# Campus+ — Security

Campus+ runs on student data inside an institutional context, so the security
model is deliberately conservative: **the database decides, the application only
asks.** This document describes what is protected, how, and what to check before
and after every deployment.

---

## 1. Threat model

| Asset | Threat | Control |
| --- | --- | --- |
| Student email addresses | harvesting, enumeration | email is never rendered; public identity is `@username`; `profile_private` holds contact/status columns and is staff-only |
| Anonymous Random identity | deanonymisation by a partner or by a curious student | identities live in `random_sessions` / `random_messages`, are exposed only through participant-checked views, and staff need the separate `view_random_sessions` permission (every access audited) |
| Moderation evidence | deletion by the reported student | soft delete only (`status` column); `delete_own_content()` never removes moderation rows |
| Audit trail | tampering, forgery | `notifications` and `audit_logs` have no client INSERT policy; audit rows are written only from inside `SECURITY DEFINER` functions |
| Service credentials | leakage into the browser bundle | only two `NEXT_PUBLIC_*` values exist (Supabase URL + publishable key); secrets are behind `import 'server-only'` |
| Abuse (spam, flooding) | scripted posting/DMs | database-side rate limiting via `consume_rate_limit()` with named buckets |
| Cross-site scripting | stored HTML/JS in posts, bios, messages | React text rendering only, `no dangerouslySetInnerHTML` (lint + test), external URLs restricted to `http(s)` |
| Privilege escalation | a student granting themselves a role | `user_roles`/`roles`/`role_permissions` UPDATE revoked from client roles; `grant_role`/`revoke_role` are `SECURITY DEFINER` with `assign_roles` checks and audit |
| Encrypted backups / OAuth refresh tokens | reading private row images or stealing a Drive refresh token from the browser | outbox row images are service-role only; credentials are AES-256-GCM encrypted in `backup_private` (no API-role grants); worker RPCs are `service_role` only; admin RPCs re-check `manage_backups` |
| Primary database availability | a Drive outage slowing or breaking student writes | Drive is called only by the cron worker/CLI; the trigger inserts one outbox row in the SAME transaction and makes no HTTP call |

---

## 2. Authentication

* **Google OAuth only (`@pccoepune.org`).** No passwords and no one-time codes
  are stored, sent or typed anywhere, and no PRN or roll number is used as an
  identifier.
* Sessions are created in exactly one place: `app/auth/callback/route.js`, after
  a server-side PKCE code exchange (`exchangeCodeForSession`). The browser only
  starts the round trip; it can never mint a session of its own.
* The institutional domain is enforced **server-side three times**: the callback
  re-checks the Google-verified address (`lib/auth/domains.js`), the database
  rejects other domains at signup (`enforce_institutional_domain` trigger,
  `allowed_email_domain()`, `colleges.email_domains`, plus
  `platform_settings.allowed_email_domains`), and Supabase Auth's provider
  configuration is the third layer. A callback whose address fails the check is
  signed out again before the browser is sent anywhere.
* A missing `CAMPUS_ALLOWED_EMAIL_DOMAINS` falls back to the seeded `pccoepune.org`;
  an empty allow-list never means "allow everyone".
* Sign-in needs no app-side rate limit: it sends no mail and issues no code (so
  it can be neither an email relay nor a guessable secret), and Supabase Auth
  and Google rate-limit the authorization endpoint themselves. The old
  `otp_request` / `otp_verify` buckets were removed with the one-time-code flow.
* Account states — `pending`, `active`, `suspended`, `banned`, `deactivated`,
  `deleted` — are enforced by `is_active_profile()` in RLS and re-checked by
  `can()` in the UI. A suspended student sees `/account-status`, not the app.
* Session cookies are refreshed by `proxy.js` with `@supabase/ssr`, so tokens are
  never stored in `localStorage`.

## 3. Authorization

* Four roles (Student, Moderator, Admin, Super Admin) and 56 permissions are
  **database rows**, never hardcoded email lists. `manage_backups` is granted to
  `super_admin` only: `moderate_all` does not open the Backups tab.
* Two enforcement points, always both:
  1. `can(actor, permission)` in the server action/page — the *offer*;
  2. RLS policies, `has_permission()` inside `SECURITY DEFINER` functions, and
     column-level `GRANT` statements — the *decision*.
* Unknown permission keys fail closed.
* `roles`, `role_permissions`, `platform_settings`, `feature_flags`,
  `user_roles` and `reserved_usernames` are read-only for client roles
  (migration 015). Platform settings change through
  `admin_set_platform_setting()`; roles change through `grant_role()` /
  `revoke_role()`; anything else is an operator migration (see DEPLOYMENT.md).
* A **third** surface exists: Realtime's private channels are gated by policies on
  `realtime.messages`, evaluated as the *subscribing* role. Two rules follow from that,
  both audited. (1) A policy may only call functions that role can execute — otherwise a
  subscription does not get denied, it gets an error, and the client retries:
  `42501 permission denied for function can_access_random_session` filled 815 of 1 000
  exported log lines at one per 15 s (migration 030). (2) A function that can answer a
  question about *another* profile must not be executable by a client role, because
  PostgREST exposes every executable public function as an RPC. `can_access_random_session
  (p_session, p_user)` is therefore `service_role`-only and the policies call the
  one-argument `can_access_own_random_session(p_session)`, which reads
  `current_profile_id()` and cannot be pointed at anybody else.
* Deeper coverage: `npm run audit:db` asserts that every exposed table has RLS
  enabled with explicit policies, that `public_profiles` never exposes private
  columns, and that moderation access to messages requires an open report.

## 4. Input handling

* Every write validates against a schema in `lib/validation/schemas.js`
  (lengths, enums, UUIDs, dates, URLs, GIF references) using
  `lib/validation/primitives.js`. The database `CHECK` constraints are the second
  line of defence, never the only one.
* Text is cleaned (control characters stripped, whitespace collapsed) but never
  "trusted": it is rendered as text, so markup is inert.
* External links must be `http(s)://`. `javascript:`, `data:` and
  protocol-relative URLs are rejected in validation **and** by
  `isSafeExternalUrl()` at render time.
* GIF references must name the GIPHY provider, carry a valid id, and use a URL on
  the approved host list. Nothing else can enter a message, post or comment.
* Raw Postgres errors never reach a student: `fromPostgresError()` maps them to
  human messages and the original is logged server-side only.

## 5. Privacy by construction

* No photos, no uploads, no file storage, no presence, no typing indicators, no
  read receipts beyond `Sent`/`Seen`.
* Public profile = `@username`, display name, bio, branch/year (if the student
  allows it), and staff marker. Email, account status, suspension reason and
  moderation history are never public.
* Blocking is central (`lib/blocks.js` + `is_blocked()`): blocked pairs disappear
  from feeds, chat, search, notifications, marketplace and mentions, and a blocked
  student cannot start a conversation or record interest in a listing.
* Search results, notification deep links and mention resolution all respect
  blocks, visibility and permissions.
* Random sessions retain identity server-side for moderation, are never exposed
  to the partner, are never shareable, and expire after
  `platform_settings.random_session_max_minutes`. Reported sessions are exempt
  from `purge_random_data()`.
* Campus+ stores no analytics, no tracking pixels and no third-party scripts.

## 6. Rate limits

Buckets are defined once in `lib/constants.js` and consumed inside the database,
so they cannot be bypassed by calling the API directly:

| Bucket | Applies to |
| --- | --- |
| `post_create`, `comment_create`, `reaction_toggle` | feed activity |
| `message_send` | direct messages and Random messages |
| `listing_create`, `community_create`, `project_create` | creation surfaces |
| `report_create` | reports (anti-brigading) |
| `random_queue_join`, `random_message` | Random |
| `username_change` | username changes (plus the cooldown setting) |
| `gif_search` | the GIPHY proxy, protecting the shared provider quota |
| `admin_action` | administrative mutations |

Sign-in itself has no bucket — see §2 for why Google OAuth does not need one.

## 7. Secrets

| Variable | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser | public by design, protected by RLS |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser | publishable/anon key; the security boundary is RLS |
| `SUPABASE_SECRET_KEY` | server only | maintenance scripts; never set as `NEXT_PUBLIC_*` |
| `GIPHY_API_KEY` | server only | used by `/api/giphy/search` |
| `GIPHY_CONTENT_RATING` | server only | `g` / `pg` / `pg-13` / `r`, default `pg-13` |
| `CAMPUS_ALLOWED_EMAIL_DOMAINS` | server only | deployment default for the domain gate |
| `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` | server only | existing Drive-only OAuth client; separate from the Supabase Google provider used for student sign-in |
| `BACKUP_ENCRYPTION_KEYS` / `BACKUP_ENCRYPTION_KEY_ID` | server only | 32-byte AES-GCM key ring; losing it makes backups unrecoverable |
| `BACKUP_DATABASE_URL` / `BACKUP_RESTORE_DATABASE_URL` | server only | direct Postgres connection for snapshots / disposable restore target |
| `CRON_SECRET` (or the `BACKUP_CRON_SECRET` alias) | server only | bearer token protecting the worker and snapshot cron routes. Vercel Cron can only send `CRON_SECRET`, so that is the name that must exist in Production; both are accepted and neither is ever logged |

`.env.local` is git-ignored; `.env.example` contains placeholders only
(`YOUR_…`). `npm run check:env` fails if a secret-looking value appears in a
`NEXT_PUBLIC_*` variable or if `.env.local` is tracked by git.

## 8. Response headers

### 7a. Encrypted Drive backup isolation

Migration 027 adds a transactional outbox, worker state and an admin-only Drive
connection. The rules are:

* **No Drive call in a student request.** The `AFTER ROW` trigger inserts one
  `backup_change_log` row in the application's own transaction and makes no HTTP
  call (`pg_net`/webhooks are forbidden). Only `/api/backup/worker`,
  `/api/backup/snapshot`, the OAuth routes and `scripts/backup/*` import the
  Drive client or service-role runtime. `tests/backup-request-path.test.js`
  enforces that import boundary.
* **Outbox row images are worker-only.** `authenticated` can select only
  `id, schema_name, table_name, operation, transaction_ref, occurred_at,
  created_at` from `backup_change_log`; `row_pk` and `row_data` (full row images,
  including private messages) are service-role only. Every public `backup_*`
  table has RLS enabled with an explicit `manage_backups` SELECT policy.
* **Refresh tokens never leave the server.** PKCE state is stored as a SHA-256
  hash and the verifier/credential are AES-256-GCM encrypted in
  `backup_private`, a schema with no `anon`/`authenticated` grants. The admin UI
  shows configuration **presence only**, never a value. `backup_status()`
  returns aggregates, never credentials.
* **Private folder only.** The OAuth callback creates a folder with no
  `permissions.create` call and refuses it if Drive reports `shared = true` or
  any `anyone` permission. Scope is `drive.file`, not full Drive access.
* **Separate OAuth client.** The exact production callback
  `https://pccoe.in/api/backup/drive/callback` belongs to the existing Drive-only
  Google Cloud client. Student Supabase Auth configuration and
  `/auth/callback` are untouched.
* **Verification before checkpoint.** A worker batch advances the durable
  checkpoint only after re-downloading the uploaded object and matching its
  SHA-256. Failures retain events with exponential backoff. Retention cannot
  prune above the verified checkpoint or the oldest retained verified snapshot.
* **Limited recovery scope.** Snapshots contain schema `public` only. Auth,
  Storage, Realtime, secrets, roles/grants and cron configuration are not
  restored; see `docs/BACKUPS.md`.

`next.config.mjs` sets `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` and
`Permissions-Policy: camera=(), microphone=(), geolocation=()` on every path.

## 9. Pre-deployment checklist

```bash
npm run lint                 # no dead code, no raw HTML, no console.log
npm test                     # architecture guards + validation + authorization
npm run verify:db            # migrations apply, database suites pass
npm run audit:db             # RLS/policy/grant/backup audit
npm run db:bundle -- --check # committed SQL bundle matches migrations
npm run backup:verify-restore # offline snapshot + incremental restore test
npm run build                # every route compiles
npm run check:env            # no secret in a NEXT_PUBLIC_* variable
npm run verify:security      # live probe: anonymous access denied everywhere
```

Manual checks the operator performs once per environment:

- [ ] Anonymous visitors cannot read `profiles`, `messages`, `profile_private`,
      `reports`, `audit_logs`, `random_sessions`, `notifications`.
- [ ] A suspended account is locked out of mutations (`/account-status`).
- [ ] Moderator sees the queue; a student opening `/moderator` gets the lock
      notice and no data.
- [ ] Admin actions appear in the audit log, including the actor.
- [ ] A blocked pair cannot message, mention or search each other.
- [ ] Random sessions are invisible to a third student, and staff access to
      identities is recorded.
- [ ] The browser bundle contains no secret (search the built output for
      `SUPABASE_SECRET_KEY`, `service_role`, `GIPHY_API_KEY`,
      `GOOGLE_DRIVE_CLIENT_SECRET`, `BACKUP_ENCRYPTION_KEYS`).
- [ ] Anonymous probes cannot read `backup_change_log` or call
      `backup_claim_batch` / `backup_private_get_credentials` / `backup_status`
      (`npm run verify:security`).
- [ ] Admin → Backups is visible only to `super_admin`; a student sees neither
      the tab nor any outbox row image.
- [ ] A verified Drive upload and a real restore test both succeeded before
      anyone claims production backup success (see `docs/BACKUPS.md` §9).

## 10. Reporting and handling

Moderation is human and audited: reports are triaged in `/moderator`, every action
writes an `audit_logs` row with actor, target, reason and visibility, and content
is soft-deleted so evidence survives. Reported Random sessions retain their
messages and participants for review; unreported sessions expire.
