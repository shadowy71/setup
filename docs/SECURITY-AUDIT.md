# Campus+ — Defensive Security Audit

**Date:** 2026-11-20
**Commit audited:** `c276f1e33dbf0197eeded13ba3af2db1c6c544ec` (`main`)
**Supabase project:** `eooysgxgvhbgohdmomji` (ap-northeast-1, PostgreSQL 17.11, ACTIVE_HEALTHY)
**Method:** source review of `app/`, `components/`, `lib/`, `scripts/` + read-only SQL
against the live database (`pg_policies`, `pg_proc`, `information_schema`,
`aclexplode`). Only `SELECT` statements were issued; **no schema, data, policy or
function was modified, and no application file was changed.**
**Scope:** this repository and its own database. No third-party or offensive testing.

This document is a *point-in-time audit record*, deliberately separate from
`docs/SECURITY.md`, which describes the intended design. Where the two disagree,
the disagreement is a finding.

---

## Summary

The security posture is unusually strong for this class of application. The core
authorization model — "the database decides, the application only asks" — is
actually enforced rather than merely documented, and it survives the standard
bypass attempts:

| Control | Result |
| --- | --- |
| RLS coverage | **107 / 107** tables in `public` have `relrowsecurity = true` |
| Tables with RLS on but **no** policy (deny-all) | 4 — `event_rsvp_capacity`, `rate_limits`, `storage_accounts`, `storage_files` |
| `anon` table grants in `public` | **0** |
| Views | 4 views, **all** `security_invoker=true` (no RLS bypass) |
| `SECURITY DEFINER` functions | 232, **all** pin `search_path` to `public, pg_temp` |
| Privileged RPCs granted to `authenticated` | every one re-checks in its body via `has_permission()` / `is_active_user()` / `can_manage_*()` |
| INSERT/UPDATE policies missing `WITH CHECK` | **none** — all 11 on the audited tables define one |
| `dangerouslySetInnerHTML` | **0** occurrences in `app/`, `components/`, `lib/` |
| Open-redirect surface | `safeNextPath()` rejects `//`, backslashes and control chars |
| Storage IDOR | GET gated by `visibleGig`/`visiblePost`, DELETE requires owner + same-origin |
| Service-role key in client bundle | **not reachable** — `lib/config.server.js` is only imported by server modules |
| Column-level privilege escalation | `profiles` UPDATE is column-scoped; `reputation_score` is **not** writable |

Because of this, **no Critical or High severity issues were found.** The findings
below are one Medium and a cluster of Low/informational items — the kind that
matter for defence in depth and privacy consistency rather than for preventing
a break-in.

---

## Findings

### F-1 · Medium · `profiles` is fully readable by any signed-in student, defeating the privacy rules that `public_profiles` enforces

**Evidence**

`pg_policies` shows a single SELECT policy on `profiles`:

```
profiles_select_authenticated   SELECT  {authenticated}   USING (true)
```

Column privileges (`information_schema.column_privileges`) grant `SELECT` on **all
14** columns to `authenticated`: `id, username, display_name, bio, branch, year,
division, show_branch_year, allow_dms_from_everyone, reputation_score,
reputation_count, marketplace_completed_count, created_at, updated_at`.

The read path the application intends everyone to use is the
`public_profiles` view, which deliberately redacts and filters:

```sql
CASE WHEN show_branch_year THEN branch ELSE NULL::text END AS branch,
CASE WHEN show_branch_year THEN year   ELSE NULL::text END AS year,
...
WHERE username IS NOT NULL AND NOT is_blocked_with_current(id);
```

**Why it matters.** A signed-in student can bypass the view and read the raw
table directly through PostgREST with the public publishable key — no exploit
required, just a `select` with the standard client. That recovers three things
the design says are hidden:

1. `division` — **never** exposed by `public_profiles` at all.
2. `branch` / `year` for students who set `show_branch_year = false`.
3. Rows for blocked pairs and for profiles with a null username, which the view
   filters out via `is_blocked_with_current()`.

`docs/SECURITY.md` §5 states "Public profile = `@username`, display name, bio,
branch/year (if the student allows it)". The view implements exactly that; the
base-table policy does not. This is a privacy-contract violation reachable by any
authenticated user.

**Not currently exploited by the app.** Only three call sites read the raw table
and all are legitimate: `lib/data/profiles.js:69` (`getOwnProfile`, self),
`lib/data/admin.js:15` (`listUsers`, admin), `lib/actions/profile.js:42` (self).
The other 52 reads correctly go through `public_profiles`. The gap is in the
policy, not in the code.

**Suggested fix** (not applied). Replace the `USING (true)` policy with one that
only needs the base table for genuinely privileged reads, and let the view serve
everyone else:

```sql
drop policy profiles_select_authenticated on public.profiles;

-- Students may read only their own row (Settings, profile edit).
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = public.current_profile_id());

-- Staff surfaces keep their existing needs.
create policy profiles_select_staff on public.profiles
  for select to authenticated
  using (public.has_permission('manage_users'));
```

Before shipping, verify every raw-table read still works — in particular the
`HomeFeatureTiles` hero, which consumes `profile.division` from the *own* profile
(`app/(shell)/(app)/home/page.js:47`), and any join that expects to resolve
another user's `display_name` from `profiles` rather than `public_profiles`.
A defensive intermediate step that leaks nothing and is much lower-risk: revoke
the sensitive columns instead of the whole row —

```sql
revoke select (division, branch, year) on public.profiles from authenticated;
```

`division` can be revoked unconditionally (no legitimate cross-user read exists
today); `branch`/`year` would then need to come from the view for peers.

---

### F-2 · Low · PostgREST filter-expression injection in opportunity search

**Evidence** — `lib/data/campus.js:747`

```js
if (q) query = query.or(`title.ilike.%${q}%,organization.ilike.%${q}%`);
```

`q` is the raw `?q=` value from an unauthenticated page
(`app/(shell)/(app)/explore/opportunities/page.js:103`).

This is the **only** one of the seven `.or()` call sites that interpolates
unprocessed user input. The two sibling search paths sanitise explicitly and
even document why — `lib/data/campus.js:363` and `lib/data/public.js:81`:

```js
// PostgREST's `or=` splits on commas; strip the syntax characters from
// the term so user input can never alter the filter expression.
const term = String(q).replace(/[,()*%]/g, ' ').trim().slice(0, 60);
```

**Impact is bounded.** The injected `or()` is ANDed with
`.eq('status', PUBLISHED)`, so no row-set expansion or data disclosure is
possible. The realistic outcome is a malformed PostgREST grammar causing a `400`,
which the caller turns into `unavailable: true` — i.e. search breakage and odd
error states, not a leak.

**Suggested fix:** apply the same sanitiser (ideally the shared helper below).

---

### F-3 · Low · Inconsistent `%`/`_` escaping in `ilike` patterns

Only the rides filters escape LIKE metacharacters:

| Location | Pattern | Escaped? |
| --- | --- | --- |
| `lib/data/campus.js:568-569` | `origin`, `destination` | ✅ `.replace(/[\\%_]/g, '\\$&')` |
| `lib/data/campus.js:624` | `subject` (tutoring) | ❌ |
| `lib/data/campus.js:693` | `subject` (notes) | ❌ |
| `lib/data/admin.js:19` | `username` (admin search) | ❌ |
| `lib/search/index.js:103` | `username` (mention autocomplete) | ❌ |

Unescaped `%` widens the match to "everything"; a query of `%` on the admin user
list returns all users in one page. Low severity (scope is already limited by RLS
and by the surrounding filters), but it is an information-density and
performance concern, and inconsistent with an otherwise careful codebase.

**Suggested fix:** one shared helper used everywhere, e.g. in `lib/data/patterns.js`:

```js
export const escapeLike = (s) => String(s).replace(/[\\%_]/g, '\\$&');
```

---

### F-4 · Low · `sameOrigin()` derives the trusted origin from the request itself

`lib/storage/post-access.js:19`

```js
export function sameOrigin(request) {
  try { return new URL(request.headers.get('origin')).origin === new URL(request.url).origin; }
  catch { return false; }
}
```

Both sides of the comparison come from the incoming request: `request.url` is
built from the `Host` header, and `origin` from the `Origin` header. Behind a
proxy that rewrites `Host`, or in any deployment where an attacker can influence
it, the check can be satisfied by a crafted pair. It fails **closed** on a parse
error, and every one of the ~24 mutating storage routes calls it before acting,
so this is a hardening item rather than a live hole.

**Suggested fix:** compare against a canonical, configured origin
(`serverConfig.siteUrl` / `NEXT_PUBLIC_SITE_URL`) instead of `request.url`, and
reject when the header is absent.

---

### F-5 · Low · No Content-Security-Policy on application routes

`next.config.mjs:35-45` sends `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`, and
`X-Frame-Options: DENY` in production only. There is **no** `Content-Security-Policy`.

Exploitability is low: there is no `dangerouslySetInnerHTML` anywhere, React
escapes by default, `isSafeExternalUrl()` filters `javascript:`/`data:` at render
time, and the app loads no third-party scripts. But a CSP is the layer that keeps
a *future* mistake from becoming an XSS, and the app's shape (no third-party
scripts, no analytics, no tracking pixels — per `docs/SECURITY.md` §5) makes a
strict policy unusually cheap to adopt.

**Suggested fix:** start in report-only and tighten. A realistic first policy:
`default-src 'self'`, `img-src 'self' data: blob: https://*` (KLIPY GIFs),
`style-src 'self' 'unsafe-inline'` (Next.js injects styles), `frame-ancestors 'none'`.

---

### F-6 · Informational · Rate-limit parameters are client-controlled

`public.consume_rate_limit(p_bucket, p_key, p_limit, p_window_seconds)` is
`SECURITY DEFINER` and **is** executable by `authenticated`
(`acl = {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}`).
The definition correctly refuses to let a student use someone else's key:

```sql
if not public.is_trusted_writer()
   and p_key <> coalesce(public.current_profile_id()::text, '') then
  raise exception 'Rate limit key mismatch.' using errcode = '42501';
end if;
```

However `p_limit` and `p_window_seconds` are not validated, and a caller can pass
**any** `p_bucket` string. So an authenticated student calling the RPC directly
can (a) bypass the intended limit by supplying a huge `p_limit`, and (b) mint
unbounded distinct buckets, inflating the `rate_limits` table.

This does not grant access to any data — RLS still governs what they can read or
write — and the app never passes these values from the client. The concern is
that the limits this design advertises ("consumed inside the database, so they
cannot be bypassed by calling the API directly", `docs/SECURITY.md` §6) are in
fact advisory once a user calls the RPC themselves.

**Suggested fix:** in the non-trusted-writer branch, clamp the arguments to the
server-side definition rather than trusting the caller — look up the configured
limit from `platform_settings`/`RATE_LIMITS` by bucket name and ignore
`p_limit`/`p_window_seconds`, or `raise exception` if they disagree.

---

### F-7 · Informational · Two-argument `can_access_*` overloads trust a caller-supplied user id

```sql
can_access_conversation(p_conversation uuid, p_user uuid DEFAULT NULL)
  ... and m.user_id = coalesce(p_user, public.current_profile_id()) ...

can_access_random_session(p_session uuid, p_user uuid DEFAULT NULL)
  ... and p.user_id = coalesce(p_user, public.current_profile_id()) ...
```

A caller can pass *any* `p_user`. The impact is limited to a **boolean oracle**
("is user X a member of conversation Y?") and no row data is returned. Verified
that no RLS policy passes a second argument — every policy uses the
single-argument form, so the default (`current_profile_id()`) is what actually
guards data:

```sql
-- query for policies with a multi-arg call returned 0 rows
qual ~ 'can_access_(conversation|random_session)\([^)]*,'
```

**Suggested fix:** if nothing in the app legitimately calls the 2-arg form from a
client context, drop the overload or restrict it to `service_role`.

---

### F-8 · Informational · `allowed_email_domain()` is executable by `anon`

It is the only `SECURITY DEFINER` function granted to `anon`. It lets an
unauthenticated visitor confirm whether a domain is on the college allow-list,
and infer the college name via `college_for_domain()`. Both are arguably public
information for a public-facing campus app, but it is a free enumeration
primitive for anyone probing the institution.

**Suggested fix:** either accept deliberately and note it in `docs/SECURITY.md`,
or gate it behind sign-in.

---

## Verified-good (worth preserving)

Recording these so a future refactor does not quietly remove them:

- **`safeNextPath()`** (`lib/auth/oauth.js:74-82`) is a correct open-redirect
  defence: rejects anything not starting with `/`, plus `//`, backslashes and
  control characters `0x00-0x1f`/`0x7f`. All guest intents route through it with
  an explicit allow-list (`lib/auth/return-to.js`).
- **The mutation cursor is not injectable.** `lib/data/messaging.js:266`
  interpolates into `.or()`, but `app/api/messages/sync/route.js:48-52` validates
  first — `Date.parse` + `toISOString()` normalisation for `after`, `UUID_REGEX`
  for `after_id` — and checks `can_access_conversation` before querying.
- **`has_permission()`** is derived from `current_profile_id()` (never user
  input), joins through `role_permissions`, and honours `expires_at` plus
  `is_active_user()`. This is the linchpin of every admin RPC, and it is sound.
- **`current_profile_id()`** resolves `auth.uid()` → `profile_private.profile_id`
  in a `SECURITY DEFINER` function with a pinned `search_path`.
- **`is_trusted_writer()`** cannot be spoofed by an ordinary JWT: it requires
  `jwt_role() = 'service_role'`, or a null role *and* null sub *and* a trusted
  `session_user`.
- **Column-scoped UPDATE on `profiles`** — `authenticated` may write only
  `allow_dms_from_everyone, bio, branch, display_name, division, show_branch_year,
  year`. `reputation_score`, `reputation_count` and `marketplace_completed_count`
  are read-only to clients, so the self-service profile form is not an
  escalation path.
- **All 11 INSERT/UPDATE policies** on `profiles`, `profile_private`, `messages`,
  `conversations` and `conversation_members` define a `WITH CHECK`. `messages`
  in particular enforces sender identity, active status, `send_messages`
  permission, `published` status and a not-blocked check on the recipient.
- **Storage responses** set `CSP: default-src 'none'; sandbox` plus `nosniff`, and
  serve PDFs as `Content-Disposition: attachment` — so an uploaded file cannot
  execute in the app's origin.
- **`lib/ratelimit.js`** imports `server-only`, and no `'use client'` module
  reaches `lib/config.server.js` or `lib/supabase/admin.js` (checked by script).
- **Defence in depth is real, not aspirational**: `requireStaff()` carries the
  comment "never the only check (RLS enforces it again)", and `app/(shell)/(app)/layout.js`
  gates the whole authenticated tree with `requireUser()` while each child
  re-checks. `(shell)/layout.js` deliberately does *not* gate, so public
  discovery and `/map` stay reachable — that is by design, and the protected
  children carry their own gate.

---

## Not covered / recommended next

- **Live exploit confirmation was not attempted** (read-only mandate). F-1 is
  inferred from policies and grants, which is sufficient to establish it, but a
  benign reproduction with a throwaway student account would make it airtight.
- **`storage.buckets` reports 0 buckets and `storage.objects` 0 rows** — file
  attachments appear to be inactive in this project (consistent with
  `docs/SECURITY.md` §5 calling photo uploads "default-off"). The storage routes
  were reviewed statically for that reason.
- **Rate limiting on sign-in** is intentionally absent (`docs/SECURITY.md` §2,
  Google OAuth). Worth revisiting only if a password provider is ever added.
- **No CSP-report endpoint** exists; adding one alongside F-5 would give
  early warning of policy drift.

---

## Statement of change

No application code, schema, policy, function or data was modified during this
audit. Every recommendation above is proposed, not applied. The only file added
to the repository is this document.
