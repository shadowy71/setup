# Campus+ — Architecture

Campus+ is an unofficial, text-first digital layer for PCCOE campus life, built as
a single Next.js (App Router) application on Supabase (Postgres + Auth +
Realtime). It contains **no AI, no uploads, no images, no payments and no extra
infrastructure**: one codebase, one database, one realtime provider.

The guiding constraint is that the database is the source of truth for *what is
allowed*, and the application is the source of truth for *what is offered*. Every
authorization decision therefore happens twice: once in the UI (`can()`) and once
in Postgres (RLS policies, `has_permission()` and `SECURITY DEFINER` functions).

---

## 1. Layers

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ app/                     routing, layouts, server components, route handlers │
│   (app)/…                authenticated surface, wrapped in <AppShell>        │
│   api/{search,giphy}     the only two JSON endpoints                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ components/              presentation + client interaction (no data access)  │
│   ui/                    Button, Field, Card, Notice, EmptyState, …          │
│   layout/                Sidebar, BottomNav, AppShell, MobileMenu            │
│   posts|chat|marketplace|campus|moderation|admin|…                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ lib/actions/*.js         'use server' mutations: validate → authorize → RPC  │
│ lib/data/*.js            'server-only' reads: RLS-scoped queries, no writes  │
├──────────────────────────────────────────────────────────────────────────────┤
│ lib/auth, lib/permissions, lib/validation, lib/giphy, lib/search,            │
│ lib/notifications, lib/blocks, lib/mentions, lib/ratelimit, lib/errors       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Supabase: Postgres (+RLS, RPCs, triggers), Auth (Google OAuth), Realtime      │
│           (private broadcast only)                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Rules the code follows

| Rule | Where it is enforced |
| --- | --- |
| Never read or write data in a component | components receive props only |
| Every write is validated server-side | `lib/validation/schemas.js` + `validate()` |
| Every write re-checks permission | `can()` in the action **and** RLS/RPC in Postgres |
| Reads are scoped by RLS, never by the caller | `lib/data/*` runs as the signed-in user |
| No raw database error reaches a student | `lib/errors.js` (`fromPostgresError`, `toActionError`) |
| Never render user HTML | React text nodes only; no `dangerouslySetInnerHTML` |
| Loading / empty / error on every surface | `loading.js`, `EmptyState`, `Notice`/`ErrorState` |

---

## 2. Request lifecycle

1. **Proxy** (`proxy.js`, Next 16's renamed middleware) refreshes the Supabase
   session cookie and gates unauthenticated navigation. It is plumbing, not the
   authorization layer.
2. **Layout** `app/(app)/layout.js` calls `requireUser()`, resolves the actor
   (profile, roles, permission set) and renders `AppShell` with the unread
   notification count.
3. **Page** (server component) calls `requireUser()` again, asks
   `lib/data/*` for data, and renders. `notFound()` is used for missing or
   invisible rows, so a hidden post and a deleted post look identical.
4. **Client interaction** — forms post to a server action through
   `useFormAction()`; every action returns `{ ok, error, details }` so field-level
   errors and success notices are handled identically everywhere.

### Authentication

Email one-time-code only (Supabase Auth). There are no passwords and no PRN
anywhere. The institutional domain is checked **server-side** in the action
(`lib/auth/domains.js`) and again in the database
(`enforce_institutional_domain` trigger + `allowed_email_domain()`), so a client
cannot bypass it. The public identity is always `@username`; the email address is
never rendered.

---

## 3. Routing surface

| Group | Routes |
| --- | --- |
| Public shell | `/`, `/setup`, `/login`, `/login/verify`, `/onboarding`, `/rules` |
| Account state | `/account-status` |
| Primary | `/home`, `/explore`, `/market`, `/gigs`, `/clubs`, `/communities`, `/campus`, `/chat`, `/random`, `/profile`, `/settings`, `/notifications` |
| Deep links | `/user/[username]`, `/post/[id]`, `/communities/[slug]` (+ `/community/[slug]` alias), `/market/listing/[id]`, `/gigs/[id]`, `/clubs/[id]`, `/campus/events/[id]`, `/campus/noticeboard/[id]`, `/explore/{resources,opportunities,projects}/[id]`, `/chat/[id]` |
| Create/edit | `/market/new`, `/market/listing/[id]/edit`, `/gigs/new`, `/gigs/[id]/edit`, `/clubs/new`, `/clubs/[id]/edit`, `/communities/new`, `/explore/*/new`, `/campus/{lost-found,housing,rides,teams}/new` |
| Staff | `/moderator`, `/admin` |
| Public, no session | `/timetable`, `/timetable/[division]` (one per division letter), `/timetable/offline` (the offline shell), `/timetable/manifest/[division]` (one web app manifest per batch) |
| Endpoints | `GET /api/search`, `GET /api/giphy/search`, `GET /api/timetable/[division]` (the offline snapshot, public like the page it mirrors) |

`/` decides at request time: unauthenticated → `/login`, authenticated → `/home`,
missing configuration → `/setup`. There is no marketing page.

**Random sessions never get a URL.** `/random` holds the session in client state
and the partner identity is only available through the audited participant view.

---

## 4. Data access

`lib/data/*` contains read helpers only. They use the *request-scoped* Supabase
client so RLS applies, and they return `{ items, unavailable }` instead of
throwing: a page shows an honest warning and the rest of the screen keeps
working. An empty database therefore produces empty states, never invented
content.

| Module | Responsibility |
| --- | --- |
| `feed.js` | campus feed, posts, comments hydration, `getHomeFeed` |
| `profiles.js` | public profiles, own profile, directory |
| `messaging.js` | conversations, messages, reads (Seen) |
| `campus.js` | events, notices, communities, lost & found, housing, rides, teams, resources, opportunities, projects, utilities |
| `marketplace.js` | listings, gigs, deals, categories, summary |
| `moderation.js` | report queue, marketplace queue, Random reports, history, counts |
| `admin.js` | users, roles, permissions, settings, flags, audit logs, official content, counters |

Writes live in `lib/actions/*` as `'use server'` functions. The pattern is always:

```js
const user = await getActiveUser();            // 1. who
if (!user) throw errors.unauthenticated();
if (!can(toActor(user), 'permission')) …       // 2. may they
const checked = validate(payload, schema);     // 3. is the input valid
const { error } = await supabase.rpc('…');     // 4. let the database decide
return { ok: true, … };                        //    or { ok: false, error, details }
```

Rate limiting uses `consume_rate_limit()` with named buckets (`post_create`,
`comment_create`, `reaction_toggle`, `message_send`, `report_create`,
`listing_create`, `community_create`, …) defined in `lib/constants.js`.

---

## 5. Permissions

Four roles — Student, Moderator, Admin, Super Admin — are **rows**, not code.
`roles`, `permissions`, `role_permissions` and `user_roles` are seeded by
migration and read at sign-in into the actor's permission set. `can(actor, key)`
fails closed for unknown keys and returns `false` for a non-active account.
Students get no badge; staff get a subtle red dot (`StaffDot`), never a green
presence dot.

Permission families: social, messaging, communities, marketplace, campus,
safety, moderation, official content, administration, platform.

---

## 6. Moderation

Human only. One report system (`reports`), one queue (`/moderator`), one audit
trail (`audit_logs`, written by `log_audit()` from inside the RPCs).

* Student reports are created through `createReport` → `reports` row.
* Staff actions go through `moderate_content()` (hide/remove/restore/approve/reject),
  `resolve_report()` (close + optional content action + reporter notification) and
  `assign_report()` (claim).
* Content stays soft-deleted: `status` changes, the row remains for evidence.
* Random reports live in `random_reports` and are only reachable with
  `moderate_random`; participant identity requires the separate
  `view_random_sessions` permission and each access is audited.
* Marketplace approval mode is a platform setting
  (`marketplace_requires_approval`), defaulting to immediate publish with
  post-moderation.

---

## 7. Realtime

Exactly one mechanism: Supabase Realtime **private broadcast**.

* Conversations: topic `conversation:<uuid>`; membership is checked by RLS on
  `realtime.messages`, so a student cannot subscribe to someone else's thread.
* Random: topic `random:<uuid>`; only the two participants (and staff, through
  the audited path) can read it.
* No presence, no typing indicators, no custom websockets. Message delivery
  state is `Sent`/`Seen` derived from `message_reads`.

Polling is used in exactly one place — the Random queue (`random_queue_state`
every 4 s while waiting) — because queue matching is not a broadcast.

---

## 8. Search

Postgres-native only: `global_search()` over generated `tsvector` columns with 11
scopes. No external index, no embeddings, no ranking service. Results respect
blocks, visibility and permissions, and the endpoint returns relative URLs only.

## 9. Media

GIFs from GIPHY are the single media exception. The browser talks to
`/api/giphy/search`, the key stays server-side, the rating is configured by
`GIPHY_CONTENT_RATING`, attribution is rendered, and the stored reference is
validated against the provider host list before it ever reaches the database.

## 10. Styling

Tailwind CSS v4 with tokens defined once in `app/globals.css`: warm off-white
`#F8F7F4`, ink `#171717`, muted `#737373`, border `#E5E5E5`, accent `#F97316`.
Typography-first, no gradients, no neon, no glassmorphism, no hero sections. One
responsive codebase: desktop sidebar, mobile bottom navigation.

## 11. Testing

* `npm test` — Vitest suites in `tests/`: authorization, validation, helpers,
  data-layer contracts, moderation map and architecture guards (no AI, no
  uploads, no raw HTML, no presence, no secrets in the browser bundle, route
  coverage).
* `npm run verify:db` — spins up a throwaway Postgres and applies all migrations
  plus the database test suites.
* `npm run audit:db` — static audit of migrations (tables, policies, grants).
* `npm run verify:security` — live probe against a configured project: anonymous
  access must be denied everywhere.
* `npm run sw:check` — the committed service worker must match the policy module
  it is bundled from (`scripts/build-sw.mjs`), so a shipped worker can never
  drift from the code the unit tests describe.
* `npm run verify:offline` — 42 assertions driven in a real browser against a
  production build: save a batch, cut the network, reload, and check the rows are
  still there, the other batch is still itself, and nothing sensitive was cached.
* `npm run build` — production build, must cover every route.

---

## 12. Offline and installable surfaces

One surface in the product is designed to be used with no connection: the
division timetable. It is the pattern to follow if another ever is, and the
three rules that make it work are architectural rather than local:

* **Data and documents are cached by different mechanisms, on purpose.** The
  timetable itself is a validated snapshot in IndexedDB, one record per batch —
  never in `CacheStorage`, which cannot be pruned per batch or validated. The
  *document* and the build assets its own markup names are the worker's, and only
  under `/timetable`.
* **A client capability never reads the environment.** `lib/timetable/sw-policy.js`
  and its helpers are imported by the browser, the route handlers and the worker
  bundle alike; `process.env` is read at module scope in exactly one place
  (`NODE_ENV`), because Next inlines literal references only.
* **The worker is scoped by need, not by convenience.** It lives at
  `/timetable/sw.js` with `Service-Worker-Allowed: /` — a root-scoped worker for a
  feature this small would have been the larger mistake, since it would then own
  every other surface's navigation.

`docs/TIMETABLE-OFFLINE.md` is the reference for the cache table, the platform
matrix and the failure modes.
