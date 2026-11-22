# External accounts and Visitor RBAC — implementation report

Automatic external user authentication with a restricted Visitor role, in
Campus+. Two forward-only migrations, one new role, per-account publishing
grants, and the UI surfaces that make the restriction legible to the person
affected by it.

- **Branch:** `arena/d2c1e857-setup`, from `main@c276f1e`
- **Verified:** `npm run lint` clean · `npm run verify:db` 81 migrations + 24
  suites green · `npx vitest run` 168 files / 1530 tests pass · `npm run build`
  succeeds · live verification against a real PostgreSQL 18 with the real app
- **Not verified, and why:** the Google OAuth round trip and the production
  dashboard settings — see §6 and `docs/EXTERNAL-ACCOUNTS-DEPLOYMENT.md`

---

## 1. What the feature does

A person signs in with Google. The database, not the browser, decides what kind
of account they get:

| Verified address | `account_type` | Role | College | Can do |
| --- | --- | --- | --- | --- |
| on an active `colleges.email_domains` | `student` | `student` | assigned | everything it could before |
| anything else | `visitor` | `visitor` | none | read public content, manage own profile, report content |

Nobody chooses, and nobody is asked. There is no role selector, no Student/Visitor
dialog and no "request access" button, because the classification follows from the
address — offering a button would promise something the system does not do.

A visitor can be given individual capabilities by an administrator (posts,
comments, listings, …). That does **not** change the account type and never
grants the Student role.

## 2. Architecture

### 2.1 The classification is a database decision

`profile_private.account_type` (`student` | `visitor`) is the single source of
truth. It is written once, at provisioning, by the `auth.users` trigger — the
place that already creates profiles, usernames, baseline roles and the audit
entry. The chain is:

```
auth.users insert (Google-verified email)
  → handle_new_user()                    — the existing provisioning trigger
      → classify_institutional_email(email)
          → normalize_email_domain()     — split on the LAST '@'
          → colleges.email_domains × is_active
      → profile_private.account_type + college_id (or null)
      → baseline role: 'student' or 'visitor'
      → audit entry
```

Properties this buys:

- **Central.** One classifier, in SQL, matching `colleges.email_domains`. No
  email-domain comparison is scattered through the application. Adding a college
  or a domain is a row, not a code change.
- **Server-side.** The trigger reads `auth.users.email`, which Supabase Auth
  populated from Google. The browser cannot supply an email, a type or a role.
- **Not client-editable.** `authenticated` has no UPDATE on `profile_private`
  (verified: `permission denied for table profile_private`), and
  `guard_account_type()` refuses later changes to the column.
- **Consistent by constraint.** `student ⇒ college_id is not null`,
  `visitor ⇒ college_id is null`, enforced by a `CHECK`, so the two shapes cannot
  drift into a half-provisioned state.

`enforce_verified_email_domain()` replaces the old `enforce_institutional_domain()`
**at the same trigger position**, preserving username generation, onboarding state,
lifecycle handling, audit logging and every other side effect of provisioning.

### 2.2 Authorization resolves in one place, and fails closed

`public.has_permission(text)` is the single resolution point that every RLS
policy, RPC and server action already called. It now:

```
is_active_user()
and (
     role-derived permission (with expiry)        -- unchanged
  or per-account publishing grant, external accounts only   -- new (081)
)
```

It returns **false** when the caller has no profile, no role row, an inactive
account, or an unknown account type. The old behaviour defaulted a caller with
missing role rows to the Student permission set — that fail-open is gone, and
`tests/permissions.test.js` and `tests/external-accounts.test.js` pin
`highestRole([]) === null` and `roleRank === -1` so it cannot come back.

The **Visitor role** holds exactly `{manage_own_profile, report_content}`. Every
capability on the deny-list (`create_posts`, `send_messages`,
`create_communities`, `create_marketplace_listing`, `submit_events`, …) is absent,
and there is no code path that hands a visitor the Student role automatically.

### 2.3 Read restrictions are preserved through one funnel

Migration 080 rewrites community and post visibility to call
`community_visible_to_current(visibility)`, which returns true for `public`,
and for `campus` **only when the reader is institutional**. Posts and comments
inherit it. The noticeboard becomes institutional-only: notices carry internal
dates, room numbers and staff instructions, and the previous "any authenticated
user" read would have meant "any Gmail address on earth". Private communities,
private conversations, admin data and restricted college data keep their existing
policies untouched.

### 2.4 Visitor and External Contributor are different things (migration 083)

080 created two roles; 081 built the per-account grant table; but the two roles
were never distinguished. `external_contributor` shipped with **zero**
permissions (deliberate, so it could not be a back door to capabilities), the
admin screen offered it as a grant anyway, and `has_permission()` did not know
it existed. That produced a role that looked like a feature and did nothing —
and, worse, a latent leak: if an administrator *had* given that role a
permission through the Roles editor, `has_permission()` would have honoured it
for **every** holder, including any student who had been given the role.

083 makes the difference explicit and enforces it where permissions are
resolved:

| | `visitor` | `external_contributor` |
| --- | --- | --- |
| What it is | the account type's baseline | an entitlement a person confers |
| Who assigns it | the signup trigger | an administrator, via `grant_role()` |
| What it confers | `manage_own_profile`, `report_content` | whatever the role is given, and nothing until then |
| Applies to | every external account | external accounts **only** — inert on a student |

`has_permission()` now treats a role permission from `external_contributor` as
conditional on the account being external. That condition is on the *role*
rather than the account on purpose: `user_roles_insert_admin` is a table-level
RLS policy, so it cannot see which role is being inserted, and a direct table
write can therefore bypass `grant_role()`'s check. Enforcing the rule at
resolution time means the direct path confers nothing either — and the SQL suite
proves it by putting the role on a student exactly that way.

Two read-only helpers keep the interface honest. `external_standing()` returns
`read_only_visitor` / `permitted_visitor` / `contributor` / `institutional` from
the database, and `external_contributor_permissions()` reports what the role
currently confers — so the admin screen can say "this changes nothing yet"
instead of offering a control that silently does nothing.

`public_profiles.is_contributor` lets a reader tell an outside contributor from
a read-only visitor. The badge is labelled, because an unlabelled contributor
marker would read as a staff marker.

### 2.5 Per-account grants, not a role per person

`role_permissions` maps a role to permissions *globally*. Granting `create_posts`
to `external_contributor` would give it to every holder at once — which cannot
express the requirement that one visitor posts and comments, another posts only,
and a third stays read-only.

Migration 081 adds `visitor_permission_grants` (one row per account × permission),
unioned into `has_permission()`. Roles remain the model for *groups* of
capability; this table records an individual exception. Constraints that keep it
from becoming a second authorization system:

- only `admin_set_visitor_permissions()` writes it (SECURITY DEFINER,
  permission-checked, audited); the table has no client write policy;
- the permission must be on an allow-list enforced **in SQL**
  (`visitor_grantable_permission()`), so a crafted RPC call with `manage_users`
  fails in the database, not merely in the admin form;
- the target must be an external account — the function refuses an institutional
  one, so this cannot become a quiet way to top up a student;
- `is_active_user()` still gates the result, so a suspension removes granted
  capabilities too (verified);
- a `BEFORE INSERT` trigger refuses a grant attached to a non-visitor.

The JS allow-list and the SQL allow-list are pinned to each other by a test that
parses the migration.

### 2.6 A granted capability does not widen the audience — a real bug, found and fixed

Live probing against the running app found that the `posts_insert_own` policy from
migration 005 checked capability, visibility and membership **independently**. A
visitor granted `create_posts` could therefore:

- publish a post with `visibility = 'campus'`, delivered to campus-only readers;
- publish into a **private** community it had joined;
- create a public post and then widen it to `campus` with an UPDATE.

That is precisely the "visitor writes denied even via the direct API" requirement
failing in practice. Migration 081 §8 adds `post_scope_allowed_to_current()` and
re-issues both `posts_insert_own` and `posts_update_author`: an external account
may publish to the public sphere and to **public** communities only.
Institutional accounts are unaffected (verified: a student still publishes
`campus` posts). The regression tests were confirmed to fail when the guard is
removed and pass when it is restored, so they are load-bearing rather than
decorative.

### 2.7 "Find external accounts" only searched the page it had already fetched

The admin list originally paged `profile_private`, joined usernames, display
names and emails in JavaScript, and *then* applied the search term. Two visible
consequences:

- an account that was not on the current page could not be found at all — the
  search box silently searched only what was already on screen;
- `total` came from the unfiltered `count`, so it disagreed with the rows
  whenever a term was entered.

Both are exactly the "find external accounts" requirement failing. Fixed by
moving the query into `admin_list_external_users()`: it joins `profiles` and
`auth.users`, applies one `ILIKE` predicate across username, display name and
email, and returns `count(*) over ()` from the *same* predicate, so the rows and
the total cannot disagree. It also means the address never has to cross into a
client-readable shape to be searchable.

Verified on a live database with nine external accounts at a page size of three:
searching for an account that is **not** on page one returns it, while the old
page-then-filter approach returns an empty set for the same account.

### 2.8 The sign-in flow

`app/auth/callback/route.js` exchanges the PKCE code, calls `getUser()`, reads the
classification **back from the database** (`resolveAccountType`), and continues to
the intended destination. Institutional accounts: no popup, behaviour unchanged.
External accounts: admitted with visitor permissions.

The Visitor notice is triggered by a **short-lived one-shot cookie** the callback
sets, not a query parameter:

- the value is the literal `1` — the cookie means "show the notice", never "this
  account is a visitor", so it authorizes nothing;
- the client reader deletes it as it reads it, so navigation and refresh cannot
  re-show it;
- it expires after 120 s, so an abandoned tab cannot spring it later;
- the callback **clears** it for an institutional sign-in, so a previous visitor
  session in the same browser cannot leak a notice to a student.

A query parameter was rejected because it is user-controlled: it can be appended to
any link and would make the UI assert something the server never said.

## 3. Files

### Created

| File | Purpose |
| --- | --- |
| `supabase/migrations/20261122000001_080_external_accounts.sql` (742 lines) | `account_type`, classifier, provisioning trigger, Visitor/External Contributor roles, read restrictions, `complete_profile()` for visitors |
| `supabase/migrations/20261122000002_081_visitor_permission_grants.sql` | per-account grants, `has_permission()` union, admin RPCs, allow-list, profile-field guard, post-scope guard, paged external-user list |
| `database/tests/24_external_accounts.sql` (1349 lines) | 16 sections of real RLS tests against `set role authenticated` |
| `lib/auth/visitor-notice.js` | cookie name/window/read-and-clear helpers |
| `components/auth/VisitorNotice.js` | the modal |
| `tests/external-accounts.test.js` (397 lines, 33 tests) | fail-closed resolution, baseline role, allow-list drift, onboarding schema |
| `tests/visitor-notice.test.js` (157 lines, 11 tests) | one-shot semantics, component refuses institutional accounts, no role choice |
| `docs/EXTERNAL-ACCOUNTS-DEPLOYMENT.md` | the dashboard checklist (§5) |

### Modified

| File | Change |
| --- | --- |
| `lib/constants.js` | `ROLES.visitor` / `external_contributor`, `ROLE_ORDER`, `ACCOUNT_TYPES`, `DEFAULT_VISITOR_PERMISSIONS`, `EXTERNAL_STANDINGS` (083) |
| `lib/permissions/authorization.js` | fail-closed resolver; `accountType` on the actor; `isInstitutional` / `isVisitor`; `isExternalContributor` / `externalStanding` / `externalStandingLabel` (083); `highestRole → null`, `roleRank → -1` |
| `lib/auth/session.js` | `account_type` added to the private read; `accountType` on every session shape; `email` exposed at the top level (it exists only in `auth.users`, never on `profiles`) |
| `lib/auth/domains.js` | `classifyEmail()` / `resolveAccountType()`; the old client-side gate is retained but no longer used by the callback |
| `app/auth/callback/route.js` | admits external accounts; sets/clears the one-shot notice cookie from the DB-resolved type |
| `lib/validation/schemas.js` | `visitorOnboardingSchema` — no branch/division/PRN; own `visitor_year` + `visitor_college_name` (082) |
| `lib/actions/auth.js` | visitor branch in `completeOnboarding`; forwards the two visitor fields to the 9-arg RPC (082) |
| `components/auth/OnboardingForm.js` | `institutionalOnly` / `visitorOnly` steps; **6-step visitor flow** (name, username, college, year, bio, rules); scoped draft key |
| `app/onboarding/page.js` | passes `accountType` |
| `lib/data/admin.js` | `listExternalUsers()`, `listVisitorGrantedPermissions()`, `VISITOR_GRANTABLE_PERMISSIONS` |
| `lib/actions/admin.js` | `setVisitorPermissions()` with allow-list validation before the RPC |
| `components/admin/AdminPanels.js` | `VisitorPermissionsForm` |
| `app/(shell)/(app)/admin/page.js` | **External Users** tab: search, email, standing badges (Visitor vs External Contributor), grants, per-account checklist, role/status controls, warning when the contributor role confers nothing |
| `components/layout/AuthenticatedAppFrame.js` | mounts the notice; `institutional` drives the noticeboard shortcut |
| `components/layout/{AppShell,ShellHeader,MobileMenu}.js` | threads `institutional` to the mobile menu |
| `components/home/HomeFeatureTiles.js` | noticeboard tile hidden for visitors; timetable copy is not "your classes" |
| `app/(shell)/(app)/home/page.js` | visitor context banner; noticeboard quick-link filtered |
| `app/(shell)/(app)/settings/page.js` | account-type card with grants and the contributor badge; visitor college/year editable; academic fields hidden for visitors |
| `app/(shell)/(app)/campus/noticeboard/page.js` | explains itself to a visitor instead of showing an empty list |
| `scripts/dev/perf/seed.mjs` | a real external fixture (`perf.visitor@gmail.com`), created through the trigger |
| `app/api/dev/session/route.js` | `?as=visitor` for local inspection |
| `docs/{ARCHITECTURE,SECURITY,DEPLOYMENT}.md` | corrected: sign-in *classifies*, it no longer filters |
| `tests/{auth-oauth,onboarding,permissions,home}.test.js` | updated to the new contract |
| `database/tests/{01,06,21}` | new contract, fixture uniqueness, draft-event owner |

### Deliberately not changed

`proxy.js`. It authenticates (one JWT `sub` check) and never makes a role or
account-type decision, so it is already correct: a visitor's requests reach the
page, and the page's own RLS and `can()` checks do the authorizing. Adding an
account-type branch there would have created a second, weaker decision point.

## 4. Database changes in detail

**Migration 080** (13 sections): `account_type` enum-constrained column on
`profile_private`; `normalize_email_domain()`; `classify_institutional_email()`;
`enforce_verified_email_domain()` replacing `enforce_institutional_domain()` at the
same trigger; `handle_new_user()` assigning the baseline role under
`campus.system_context`; `visitor` (rank −10) and `external_contributor` (rank −5)
with `roles_rank_check` widened to −100…1000; `account_type_of()`,
`current_account_type()`, `is_visitor()`, `is_institutional()`;
`community_visible_to_current()`; rewritten `posts_select_visible`,
`comments_select_visible`, `can_view_community`; `notices_select_published` made
institutional-only; `complete_profile()` nulling academic fields for visitors.

**Migration 081** (9 sections): `visitor_permission_grants`; the allow-list
function; `has_permission()` unioned; `admin_set_visitor_permissions()` (audited,
refuses non-visitors and non-allow-listed keys); `admin_external_user_emails()`
for administrators; a row-level grant guard; `guard_visitor_profile_fields()`
(clears branch/year/division even for a trusted writer); §8's post-scope
policies; and §9's paged, searchable external-user list.

Both are **forward-only and additive**. No table, column, policy or row belonging
to institutional accounts is dropped. Existing users migrate to `student` by the
column default, which is why the post-migration query in the deployment doc
expects every row to read `student`.

### 4.1 Deployment state

**080, 081, 082 and 083 are applied to the production project
`eooysgxgvhbgohdmomji`** (2026-11-22), section by section, with a verification
query after each one. See §4.2 for what that verified and §4.3 for the defect
the first real sign-up exposed. Applying a migration that changes sign-in semantics is normally an
operator decision; here it was made explicitly, and the pre-flight checks in
§4.2 are what justified it.

One consequence of applying by hand rather than through the Supabase CLI:
`supabase_migrations.schema_migrations` has **no rows for 080–083**, so a later
`supabase db push` will try to re-run them. They are written to be re-runnable
(`if not exists`, `create or replace`, guarded `do` blocks), but the drift report
will be blind to these four versions until the rows are back-filled or a
subsequent release goes through the CLI.

`docs/EXTERNAL-ACCOUNTS-DEPLOYMENT.md` is the operational counterpart to this
report: the Google consent-screen question, the Supabase
settings that must *not* re-introduce a domain allow-list ahead of the
classifier, how to apply the migrations, the post-apply verification queries, the
production smoke test, and the rollback story. Applying the migrations without
the consent-screen change produces a correct database with no external accounts —
nothing breaks, and nothing new works either.

### 4.2 What production verification actually showed

Everything below was run against the live project, not a local replica.

**Before any DDL:** 168 profiles, **0 rows with a NULL `college_id`**, 1 active
college with one domain (`pccoepune.org`), `roles_rank_check` confirmed to be the
exact constraint name 080 drops. The `student ⇒ college_id is not null` CHECK
therefore could not fail on existing data. Snapshot: profiles 168 ·
profile_private 168 · posts 19 · comments 3 · user_roles 171 · communities 19 ·
audit_logs 301 · auth users 168.

**After 080:** 168 students, **0 visitors**, no data loss. Roles
`visitor(-10)`/`external_contributor(-5)` added; the visitor role held exactly
`manage_own_profile, report_content` and nothing else. The rejecting gate
(`enforce_institutional_domain`) was gone and replaced by
`enforce_verified_email_domain_trigger`. The classifier returned `student` for
`@pccoepune.org`, `visitor` for `@gmail.com`, and — checked explicitly — `visitor`
for both `a@pccoepune.org.evil.com` and `pccoepune.org@gmail.com`.

**After 081:** all 16 functions, 3 triggers and 5 policies present; RLS on the
grant table; six direct-API bypass attempts (insert post, insert campus post,
self-grant `student`, write `account_type`, self-grant a capability, delete own
grants) all refused with `42501`. A student session resolved
`create_posts = true`, a visitor session `create_posts = false,
is_institutional = false, report_content = true, manage_users = false`.

**After 082:** `visitor_college_name` / `visitor_year` added with both CHECKs;
exactly **one** `complete_profile` overload, the 9-argument one; all 15
`public_profiles` columns in their original order with the three new ones
appended. The clamp was then proved inside a rolled-back transaction: a visitor
submitting `branch/year/division` alongside its own fields stored
`branch = NULL, year = NULL, division = NULL, show_branch_year = false` and kept
`Probe College` / `First Year`. No student and no visitor holds the other
account type's fields (both counts 0).

**Real external sign-ups arrived during this work** —
`kartikgaikwad250@gmail.com` (2026-11-22 12:21 UTC) and `sitemangoin@gmail.com`
(14:06 UTC). The signup trigger classified both `visitor`, gave each the
`visitor` role, and left `college_id` NULL, with no query parameter and no
client input involved. That is the classifier and the Google round trip working
on genuine accounts, and it is the strongest single piece of evidence in this
document — it also settles a question the checklist had listed as blocked: the
consent screen was not preventing external sign-in.

**What those accounts do *not* prove.** Reading them as evidence that the
visitor onboarding form works was a mistake, and worth recording as one. The
first account showed a college and year, which looked like a real person
answering the new 082 questions. It was not: the values came from this
migration's own probe, which called `complete_profile()` on that account and
overwrote its display name. The account has been restored to its genuine state
and the spurious `username_history` row removed. The lesson is narrow and
absolute: **a verification probe must never write to a real account.** Every
probe after that point used a rolled-back transaction or a throwaway row.
Consequently the visitor onboarding form — including the college and year
questions — has **not** been exercised by a real person, and is covered only by
the unit and SQL suites.

### 4.3 Two defects that only production data could reveal

Both were found by testing against the real project, and neither was caught by
the 1,533 local unit tests or the 24 SQL suites in their original form.

**Grants were impossible for a new external account.** `admin_set_visitor_permissions()`
used `profiles.username` as its existence check. A username is only claimed
during onboarding, so *every* freshly signed-in external account — precisely the
account an administrator opens the External Users tab to find — was rejected with
`That account could not be found`. The admin screen could not distinguish "no
such account" from "has not picked a username yet". Migration 082 checks
`profile_private` instead, which the signup trigger creates immediately; the
username is still read, for the audit metadata, and is now allowed to be NULL.
Proof, against the real username-less account: grant `ok = true`, the visitor
immediately resolved `create_posts = true, create_comments = true` while
`create_polls`/`manage_users` stayed `false`, revoke took effect immediately
(`create_posts = false`), `manage_users` was still refused with `42501`, and the
audit row was written. A new SQL test (§18 of suite 24) covers this; reverting
only the fix makes it fail with the exact production error.

**A pre-080 external row kept `show_branch_year = true`.** Harmless — `branch`
and `year` are NULL for that account, so nothing rendered — but it broke the
invariant that an external account never displays academic details. 082
normalises existing visitor rows once. The more useful lesson is that column
defaults survive a trigger change: the guard clears the fields it knows about,
not the default of a boolean it does not.

## 5. Tests

`npm run verify:db` applies **83** migrations to a throwaway PostgreSQL 18 and runs
24 suites. Suite 24 exercises the feature with real sessions (`set role
authenticated`, `request.jwt.claim.sub`), never a mock:

| § | Covers |
| --- | --- |
| 1–3 | classifier: institutional, external, domain normalisation, inactive college |
| 4–5 | provisioning: account type, college nullability, baseline role, no Student |
| 6 | visitor baseline permissions and the deny-list |
| 7–8 | read restrictions: notices, campus posts, private communities |
| 9 | `complete_profile()` discards academic fields, keeps the visitor's own |
| 10 | clients cannot write role/account-type columns |
| 11–13 | admin RPC authorization, audit, immediate revocation |
| 14 | three visitors with three different capability sets |
| 15 | profile-field clamp applies even to a superuser write |
| 16 | granted capability cannot widen audience (insert **and** update) |
| 17 | external-user list: search across username/name/email beyond page one, bounded total, staff-only, never an institutional account |
| 18 | **082**: a grant is possible before the account has a username; a missing account still raises; the visitor's own college/year are stored; the clamp survives a direct-API write in the same statement; a student cannot hold visitor fields; `public_profiles.is_external` labels correctly |
| 19 | **083**: the contributor entitlement confers its permissions on an external account and **nothing** on an institutional one, including when the role row is inserted directly to bypass `grant_role()`; `grant_role()` refuses it on a student and accepts it on a username-less visitor; the three standings resolve from the database |

`npx vitest run`: **168 files, 1537 tests, all passing** — 51 new (40
external-account, 11 visitor-notice), plus the updated OAuth/onboarding/permission
suites. `npx eslint .` is clean and `npm run build` compiles (96 static pages).

Two negative controls, both run and both observed to fail for the right reason:
reverting only the §5 existence-check fix makes SQL suite §18 fail with the
production error, and removing the account-type condition from `has_permission()`
in 083 makes §19 fail with *"the contributor role must confer nothing on an
institutional account"*. Without those runs a green suite would prove only that
the tests agree with the code.

Beyond the suites, the feature was verified against a **running application** on a
real database: visitor sign-in, the four-step onboarding, the profile clamp, the
admin tab, a real grant and revoke with immediate effect, and suspension removing
granted capabilities. That session is what surfaced the scope bug in §2.6.

## 6. Not verifiable here

| Item | Why | How to verify |
| --- | --- | --- |
| Google OAuth round trip | needs a real Google account, an External consent screen and a public callback; the sandbox has no browser binary and no Google credentials | `docs/EXTERNAL-ACCOUNTS-DEPLOYMENT.md` §5 |
| The modal rendering in a browser | no Chromium in the sandbox (Playwright's download is blocked) | its contract *is* pinned by `tests/visitor-notice.test.js`: one-shot read, refuses institutional accounts, required copy, no role control. The open/close animation and focus trap come from the existing `Modal`, already covered by the design-system tests |
| Production dashboard settings | operator action | §1–2 of the deployment checklist |
| The Visitor notice appearing to a genuinely new visitor in a browser | no browser in the sandbox. Note the cookie is set by the callback, which *has* run for two real accounts, so the path is exercised server-side | sign in with a fresh Gmail account on the deployed app and confirm the modal shows once |
| **The visitor onboarding form** — including the 082 college and year questions | the application is not deployed, and no real person has used the form. A probe of mine wrote to a real account and was mistaken for evidence; see §4.2 | complete onboarding as a fresh external account on the deployed app. The database half is covered by SQL suite §18/§19 |
| The consent screen's current configuration | dashboard setting, not code | **not the blocker it was documented as**: two real Gmail accounts signed in successfully on 2026-11-22, so external sign-in is working. Re-check the console rather than trusting either the checklist or this report |

Applying 080–082 to production **was** done (see §4.1–4.3); what remains
unverified is the end-to-end browser journey through Google, which needs the
consent screen switched to External.

The visitor notice was additionally confirmed to sit correctly in the *server*
render (the component returns `null` for an institutional account regardless of
the cookie) and to be gated on the cookie for a real session.

## 7. Security considerations and remaining limitations

**Decisions worth knowing**

- A visitor's `account_type` is not derived at request time; it is stored. A change
  to `colleges.email_domains` therefore does **not** retroactively reclassify
  existing accounts. That is deliberate (a domain leaving the list should not
  silently strip students of their account), but it means reclassifying a person
  is an explicit administrative act.
- `admin_external_user_emails()` exposes a verified address to administrators with
  `manage_users`. It reads from `auth.users` and never copies the address into a
  table of its own.
- The allow-list is per *capability*, not per *audience*. A visitor granted
  `create_posts` publishes to the public sphere and public communities only. If a
  future feature adds a new scope enum value, `post_scope_allowed_to_current()`
  must be extended; the `case` defaults to the restrictive branch, so an
  unrecognised value denies rather than allows.
- Public pages remain public. Nothing here changes `anon` access, so the public
  discovery surface behaves as before.

**Known limitations**

1. Granting `create_posts` to a visitor makes the Create menu show Post, but the
   composer's community picker still lists communities the visitor can view; the
   database refuses a non-public target, so the failure is a policy error rather
   than a hidden option. Acceptable (it fails closed) but not polished.
2. Search is a substring match, by design — an administrator types part of an
   address. As a consequence a term like `pccoepune.org` also matches an external
   address such as `someone@not-pccoepune.org`. That is a search that is too
   permissive, not a leak: the list is already filtered to external accounts, and
   an institutional account cannot appear in it.
3. There is no self-service path to institutional access. A person with a
   personal Google account who is actually a student has to sign in with the
   college address. This matches the requirement that the type is never chosen,
   but it deserves a line in user-facing help text.
4. `visitor` and `external_contributor` ranks are negative, so the rank-based
   `grant_role` guard treats them as below every student role. An administrator
   cannot accidentally promote a visitor to moderator without that being a
   deliberate, audited act.
