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

### 2.4 Per-account grants, not a role per person

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

### 2.5 A granted capability does not widen the audience — a real bug, found and fixed

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

### 2.6 "Find external accounts" only searched the page it had already fetched

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

### 2.7 The sign-in flow

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
| `lib/constants.js` | `ROLES.visitor` / `external_contributor`, `ROLE_ORDER`, `ACCOUNT_TYPES`, `DEFAULT_VISITOR_PERMISSIONS` |
| `lib/permissions/authorization.js` | fail-closed resolver; `accountType` on the actor; `isInstitutional` / `isVisitor`; `highestRole → null`, `roleRank → -1` |
| `lib/auth/session.js` | `account_type` added to the private read; `accountType` on every session shape; `email` exposed at the top level (it exists only in `auth.users`, never on `profiles`) |
| `lib/auth/domains.js` | `classifyEmail()` / `resolveAccountType()`; the old client-side gate is retained but no longer used by the callback |
| `app/auth/callback/route.js` | admits external accounts; sets/clears the one-shot notice cookie from the DB-resolved type |
| `lib/validation/schemas.js` | `visitorOnboardingSchema` — no branch/year/division/PRN |
| `lib/actions/auth.js` | visitor branch in `completeOnboarding` |
| `components/auth/OnboardingForm.js` | `institutionalOnly` steps; 4-step visitor flow; scoped draft key; audience-neutral copy |
| `app/onboarding/page.js` | passes `accountType` |
| `lib/data/admin.js` | `listExternalUsers()`, `listVisitorGrantedPermissions()`, `VISITOR_GRANTABLE_PERMISSIONS` |
| `lib/actions/admin.js` | `setVisitorPermissions()` with allow-list validation before the RPC |
| `components/admin/AdminPanels.js` | `VisitorPermissionsForm` |
| `app/(shell)/(app)/admin/page.js` | **External Users** tab: search, email, role, grants, per-account checklist, role/status controls |
| `components/layout/AuthenticatedAppFrame.js` | mounts the notice; `institutional` drives the noticeboard shortcut |
| `components/layout/{AppShell,ShellHeader,MobileMenu}.js` | threads `institutional` to the mobile menu |
| `components/home/HomeFeatureTiles.js` | noticeboard tile hidden for visitors; timetable copy is not "your classes" |
| `app/(shell)/(app)/home/page.js` | visitor context banner; noticeboard quick-link filtered |
| `app/(shell)/(app)/settings/page.js` | account-type card with grants; academic fields hidden for visitors |
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

The migrations are **committed but not applied to the production project**. That
is deliberate: the task asks for a checklist rather than a push, and applying a
migration that changes sign-in semantics is an operator decision made against
real data.

`docs/EXTERNAL-ACCOUNTS-DEPLOYMENT.md` is the operational counterpart to this
report: the Google consent-screen switch (External, In production), the Supabase
settings that must *not* re-introduce a domain allow-list ahead of the
classifier, how to apply the migrations, the post-apply verification queries, the
production smoke test, and the rollback story. Applying the migrations without
the consent-screen change produces a correct database with no external accounts —
nothing breaks, and nothing new works either.

## 5. Tests

`npm run verify:db` applies 81 migrations to a throwaway PostgreSQL 18 and runs 24
suites. Suite 24 exercises the feature with real sessions (`set role
authenticated`, `request.jwt.claim.sub`), never a mock:

| § | Covers |
| --- | --- |
| 1–3 | classifier: institutional, external, domain normalisation, inactive college |
| 4–5 | provisioning: account type, college nullability, baseline role, no Student |
| 6 | visitor baseline permissions and the deny-list |
| 7–8 | read restrictions: notices, campus posts, private communities |
| 9 | `complete_profile()` discards academic fields |
| 10 | clients cannot write role/account-type columns |
| 11–13 | admin RPC authorization, audit, immediate revocation |
| 14 | three visitors with three different capability sets |
| 15 | profile-field clamp applies even to a superuser write |
| 16 | granted capability cannot widen audience (insert **and** update) |
| 17 | external-user list: search across username/name/email beyond page one, bounded total, staff-only, never an institutional account |

`npx vitest run`: **168 files, 1530 tests, all passing** — 44 new (33
external-account, 11 visitor-notice), plus the updated OAuth/onboarding/permission
suites.

Beyond the suites, the feature was verified against a **running application** on a
real database: visitor sign-in, the four-step onboarding, the profile clamp, the
admin tab, a real grant and revoke with immediate effect, and suspension removing
granted capabilities. That session is what surfaced the scope bug in §2.5.

## 6. Not verifiable here

| Item | Why | How to verify |
| --- | --- | --- |
| Google OAuth round trip | needs a real Google account, an External consent screen and a public callback; the sandbox has no browser binary and no Google credentials | `docs/EXTERNAL-ACCOUNTS-DEPLOYMENT.md` §5 |
| The modal rendering in a browser | no Chromium in the sandbox (Playwright's download is blocked) | its contract *is* pinned by `tests/visitor-notice.test.js`: one-shot read, refuses institutional accounts, required copy, no role control. The open/close animation and focus trap come from the existing `Modal`, already covered by the design-system tests |
| Production dashboard settings | operator action | §1–2 of the deployment checklist |
| Applying to the production project | **deliberately not done** — the task asks for a checklist, not a push | §3 |

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
