# Public discovery

> **Public discovery. Private student data. Authenticated participation. Controlled administration.**

Campus+ club and event catalogues are readable without an account. Everything that
identifies a student, changes a record, or exercises a moderation/management
permission still requires an institutional Campus+ session and the existing
scoped permissions. This document is the authoritative description of that
boundary; migration `041_public_discovery.sql` and
`database/tests/21_public_discovery_rls.sql` are its executable form.

---

## 1. Which records are public (the visibility decision)

`communities.visibility` already had four values: `public`, `campus`,
`community`, `private`. Migration 032 imported 35 published club catalogue rows
with `visibility = 'campus'`, meaning "signed-in campus accounts". That value is
also used by study groups and unrelated private communities, **so it was not
safe to make every `campus` row anonymously readable**.

The decision, made explicitly rather than silently:

- The **35 source-roster catalogue entries** seeded by migration 032 (all
  `catalogue_key is not null`, `kind = 'club'`, `status = 'published'`,
  `created_by is null`, `admin_assigned = false`) are moved from `campus` to
  `public`. Their slugs and every other field are unchanged.
- For clubs, `public` now additionally means *listed on the open web*. The club
  settings form already describes exactly that. The anonymous SELECT policy adds
  two further predicates: `kind = 'club'` **and** `status = 'published'`.
- Clubs created by the staff workflow, by an approved club request, or by any
  other path keep their existing `campus` default. A manager must deliberately
  choose "Public on the web" to list one — an auditable choice, not a side
  effect of creation.
- `campus`, `community` and `private` communities, unpublished/archived/removed
  clubs, drafts, rejected/cancelled events, attendee lists, memberships, join
  request messages, moderation logs, private conversations, administrator
  identities and internal admin notes are **not** readable anonymously. A
  signed-in student sees exactly what the pre-existing `can_view_community()`
  and `can_view_post()` policies allowed before this change.

Published events are public by their own status: the anonymous policy is
`status = 'published'`. Event drafts and review queues remain staff/creator-only.
Private registration *records* (`event_registrations`) have no anonymous policy;
only `events.registration_info` and `events.registration_url` — fields migration
009 deliberately defines as public — are rendered. Campus+ is text-first and
stores **no artwork or attachments on events**, so there is no media to expose.

Club announcements are public only when the post itself says so. A public club
does not make its feed public: the anonymous `posts` policy requires the post's
own `visibility = 'public'`, `status = 'published'`, `deleted_at is null` **and**
a published publicly listed parent club. No author identity is projected.

## 2. Route table

| Path | Access | Implementation |
| --- | --- | --- |
| `/clubs` | public | `app/(public)/clubs/page.js` — one directory for guests and students |
| `/c/<slug>` | public | `app/(public)/c/[slug]/page.js` — **canonical** club profile |
| `/campus/events` | public | `app/(public)/campus/events/page.js` |
| `/campus/events/<uuid>` | public | `app/(public)/campus/events/[id]/page.js` |
| `/clubs/<uuid>` | public redirect | 308 → `/c/<slug>` (`app/(public)/clubs/[id]/page.js`) |
| `/campus/clubs`, `/campus/clubs/<uuid>` | public redirect | 308 → `/clubs` or `/c/<slug>` |
| `/clubs/new`, `/clubs/request` | authenticated | `app/(app)/clubs/…` |
| `/clubs/<uuid>/edit`, `/clubs/<uuid>/manage` | authenticated + scoped permission | `app/(app)/clubs/…` |
| `/campus/events/new` | authenticated + `submit_events` | `app/(app)/campus/events/new` |
| `/admin`, `/moderator`, all other app routes | authenticated + permission | `app/(app)/…` |

`ROUTES.club(slug)` returns `/c/${encodeURIComponent(slug)}` using the existing
unique lowercase `communities.slug` column (CHECK `^[a-z0-9-]{3,60}$`). No
second URL column and no club-slugs table were added. `ROUTES.clubLegacy(id)`
exists only to build the compatibility redirect. Every public link — cards,
search results, event pages, notifications, share/copy buttons, management
"view page" links — passes `club.slug`. **All back-end operations still use the
UUID**: membership changes, event associations, permissions, analytics,
management actions and `ROUTES.clubManage(id, view)`.

Canonical pages accept the *exact* slug (`CLUB_SLUG_REGEX`), query
`public.communities`, require `kind = 'club'` and the public-eligible predicate,
return a real 404 for unknown/inaccessible slugs, never look a club up by UUID,
and render without authentication. `generateMetadata` uses **only** the
anonymous projection, so a manager viewing a draft cannot put its name in a
page title or OG card for a URL anyone can open.

`/c/<slug>` is one page for everyone. Guests see the public profile, explicitly
public announcements, published events and a sign-in prompt. A signed-in student
additionally reads the full `communities` row through their own session, where
the existing RLS policy decides what they may see — which preserves
membership-aware workspaces, private clubs for their members and drafts for
their managers. Members, chat, opportunities, RSVP, attendees, review queues
and report controls are fetched **only** when `getCurrentUser()` yields a real
profile.

## 3. The authorization boundary

`proxy.js` now exports `isPublicPath()` with exact matches and single-segment
patterns. `/clubs` is public while `/clubs/new`, `/clubs/request` and
`/clubs/<uuid>/manage` remain protected; `/campus/events` is public while
`/campus/events/new` remains protected. No broad prefix is used, and lookalikes
(`/clubswing`, `/c/<slug>/manage`) are protected.

**Skipping the proxy redirect is not authorization.** Every protected page
still calls `requireUser()`; every mutation is a server action that calls
`getActiveUser()`, checks `can(...)`/scoped permissions and is re-checked by
RLS and the audited RPCs. The public route group has its own lightweight
`PublicFrame` (brand, two discovery links, sign-in entry, independence footer)
and never inherits `app/(app)/layout.js`'s unconditional `requireUser()`.

The global search API (`/api/search`, `global_search()`) stays authenticated: it
spans private tables. Public discovery uses the directory's own search/filter
controls (`/clubs?q=…`, `/campus/events?…`) over the public projections.
`global_search()` club results were re-pointed to `/c/<slug>` (migration 041
rewrites the single URL expression in the current function definition). Two
SQL-generated notification links from migration 031 still use
`/clubs/<uuid>`; that address is now a permanent 308 redirect to the canonical
slug, so old notifications keep working. The `/clubs/<uuid>/manage` and
`/moderator` links in those same functions remain UUID-addressed and protected
by design, and the moderator target helper (`lib/data/moderation.js`) also
uses the compatibility route for club reports.

Guest clicks on protected actions never fail silently. `GuestActionPrompt`
renders a sign-in link built by `returnToHref(path, intent)`, which carries the
current public page plus `?intent=join|rsvp|submit_event|request_club` through
the existing Google OAuth flow. `safeNextPath` validates it; `/auth/callback`
returns to the exact page, and `IntentNotice` tells the student to complete the
original action. No new auth system, no guest accounts.

## 4. Anonymous reads: narrow policies and column grants

Migration 014/018 revoke *all* table privileges and function EXECUTE from
`anon`; migration 041 keeps that posture and adds only:

- `grant select (...)` on **named columns** of `communities`, `events` and
  `posts`. No table-level grant, no `select('*')`, no write column. The public
  projections in `lib/data/public-columns.js` mirror this allow-list exactly.
  Excluded: `created_by`, `approved_by`, `approved_at`, `catalogue_key`,
  `subject/branch/year`, `updated_by`, `discussion_post_id`, `search_vector`,
  `author_id`, `moderated_by`, all moderation fields, `gif`, poll state.
- Three `to anon` **SELECT** policies, each with a real predicate (never
  `USING (true)`): a published publicly listed club, a published event, and an
  explicitly public, undeleted announcement in such a club.
- **No** INSERT/UPDATE/DELETE policies, no write column grants, no function
  EXECUTE grants. The migration's own verification block raises an exception if
  it leaves any unexpected anon policy, table grant, column privilege or RPC
  grant behind.

Views were not used, so there is no `security_invoker` / view-definer bypass to
reason about. The publishable-key clients never hold the service-role secret;
`getAdminClient()` is not imported by any public page.

`lib/supabase/public.js` provides a cookie-free, publishable-key client whose
session is always the `anon` role. Public readers use it inside
`unstable_cache`, so an authenticated response can **never** populate a shared
cache entry and a cache key can never depend on a cookie. Viewer-specific reads
use `getServerClient()` in the page and are never cached.

`scripts/dev/audit.mjs` was widened from "no anon policy at all" to an exact
allow-list of the three policies plus an exact column-privilege allow-list;
anything wider fails the audit.

## 5. Caching and invalidation

`PUBLIC_TAGS` = `public:notices`, `public:events`, `public:clubs`; 60-second
revalidation. `listPublishedEvents()` reads via the anon client with
`PUBLIC_EVENT_COLUMNS`; club catalogue/counts/options/profile/announcements and
event detail are cached under `public:clubs`/`public:events`. Search, filter,
sort, pagination and date filters are all part of the cache key, so they work
with caching. Failures throw out of the cache entry and surface as
`unavailable` instead of being stored as an empty success.

Club mutations (`lib/actions/communities.js`, `club-requests.js`, `campus.js`,
`social.js`, `moderation.js`) invalidate `PUBLIC_TAGS.clubs`, `/clubs`,
`/c/[slug]` and the exact canonical path when a slug is known; event
publication actions invalidate `PUBLIC_TAGS.events`, `/campus/events` and the
event detail path. No membership, attendee, admin or join-request data is ever
placed in a shared entry.

## 6. SEO and sharing

Root metadata gained `metadataBase` from a **server-only** `SITE_URL` setting
(default `https://pccoe.in`, documented in `.env.example`); the root still
defaults to `noindex`. `lib/seo.js#publicMetadata` sets a canonical alternate,
`index/follow`, Open Graph and Twitter summary for indexable public pages;
`noindexMetadata` is used for private/draft records and redirect pages.

`app/robots.js` allows `/clubs`, `/c/`, `/campus/events`, disallows all
management/creation/personal routes, and points to `app/sitemap.js`. The
sitemap contains the two directory URLs, the 35 published public clubs and
published events only — generated from the same anonymous readers, so a private
row cannot leak through a sitemap, a preview or structured metadata.
`ShareButton` builds `${window.location.origin}${relativePath}`, so share/copy
always uses the canonical slug URL and can never be pointed off-site by stored
data.

## 7. Tests and deployment

- `tests/public-discovery.test.js` — routes, proxy edge cases, legacy redirects,
  guest return-to flow, SEO, cache invalidation, migration/bundle/audit contract.
- `tests/public-data.test.js` — behavioural tests of the anonymous data layer
  against a stubbed `anon` client (exact slug, pinned predicates, projections,
  failure semantics).
- `database/tests/21_public_discovery_rls.sql` — real `set role anon` /
  `set role authenticated` assertions for reads, private columns, every write
  path, management RPCs, staff/student boundaries and canonical search URLs.
- Existing suites were updated for the new canonical path and continue to pin
  student, admin, moderator, bundle, cache and navigation behaviour.

`npm run lint`, `npm test`, `npm run build`, `npm run db:bundle` and the SQL
validation script are the checks to run. **No migration has been applied to a
production database and no deployment has been performed.** The operator must
apply `041_public_discovery.sql` (or the regenerated bundle on a fresh project)
and set `SITE_URL` before the public pages go live; until then, the anonymous
client has no `anon` policies and the public directory renders its honest
"unavailable" state rather than exposing anything.
