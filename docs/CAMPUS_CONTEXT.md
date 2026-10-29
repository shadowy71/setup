# Campus+ — Project Context

> Onboarding snapshot taken **2026-10-09** on branch `arena/bf13e6de-setup` (base `main` @ `c1e52b4`).
> This is a **map**, not a specification. Re-open the source files named here before changing anything; the code moves faster than this document.

**Legend:** ✅ verified by running a command · 🔎 verified by reading source only · ⚠️ discrepancy or stale claim · ❌ missing or not working · ❓ needs a decision or a live check

---

## 1. Overview and verified stack

**What it is.** Campus+ is an unofficial, text-first campus layer for PCCOE students: feed, communities, direct messages, marketplace, events, notices, study and team finders, and campus information. There is no AI, no photo or file upload (GIFs from GIPHY are the only media), no presence indicator, human-only moderation, and permissions stored as database rows. Sources: `README.md`, `docs/ARCHITECTURE.md`.

**Repository.** ✅ The workspace `origin` is `aminotkartik/setup`. `sitemango/setup` `main` (`cb16110`, merge of PR #8 from `aminotkartik/main`) has a **file tree identical** to this workspace's `main` (`c1e52b4`). The merge replaced the previous sitemango `main` (`a2db7ac`), which differed by 40 study-finder and discovery files that already exist here. No file was dropped. Merged sitemango PRs: #1 application layer, #2 Google OAuth replacing email OTP, #4 Random Chat removal, #5–#7 UI revamp, intro and contrast. This workspace is current with `sitemango/setup` `main`.

**Size.** 356 tracked files, about 75k text lines excluding `package-lock.json` (about 83k including it). Largest groups: `supabase/` (about 18k, including the 9.3k-line generated bundle), `perf-results/` (about 14k of JSON), `app/` (about 12.5k), `components/` (about 8k), `lib/` (about 7.7k).

| Concern | Verified value | Source |
|---|---|---|
| Framework | Next.js **16.3.8**, App Router, Turbopack build | `package.json`; `npm run build` ✅ |
| UI runtime | React and react-dom **19.3.0** | installed packages ✅ |
| Language | JavaScript only (no TypeScript); `@/*` alias | `jsconfig.json` |
| Styling | Tailwind CSS **4.3.3** via `@tailwindcss/postcss`; tokens in `app/globals.css`, component CSS in `app/styles/*.css`; permanently dark single theme (`data-theme="dark"` hard-coded in the root layout) | `postcss.config.mjs`, `app/layout.js` |
| Backend | Supabase: Postgres with RLS, `SECURITY DEFINER` RPCs, Auth (Google OAuth only), Realtime (`postgres_changes` on a private channel) | `supabase/`, `lib/supabase/` |
| Supabase clients | `@supabase/ssr` **0.12.7**, `@supabase/supabase-js` **2.117.2** | installed packages ✅ |
| Lint | ESLint **9.39.5** with `eslint-config-next` | `eslint.config.mjs` |
| Tests | Vitest **5.0.3**; Playwright **1.64.0** and `@axe-core/playwright` (dev contrast and perf scripts) | `vitest.config.mjs`, `scripts/dev/` |
| Node | `>=20.9.0`; verified on v22.22.3 | `package.json` |
| Hosting | Vercel (documented). No Dockerfile. **No CI workflow** in the repo. | `docs/DEPLOYMENT.md`; `.github/` absent |

---

## 2. Directory and route map

### 2.1 Top-level layout

| Path | Purpose |
|---|---|
| `app/` | App Router pages, layouts, 22 `loading.js` files, 3 route handlers |
| `app/(app)/` | Authenticated group. `layout.js` calls `requireUser()`, builds the Create menu and palette actions on the server, and renders `AppShell` |
| `app/auth/callback/route.js` | The only place a session is created (OAuth code exchange) |
| `app/api/search/route.js`, `app/api/giphy/search/route.js` | The only two JSON endpoints |
| `components/` | Presentation and client interaction only. Subfolders: `ui/`, `layout/`, `posts/`, `chat/`, `campus/`, `marketplace/`, `communities/`, `moderation/`, `admin/`, `search/`, `study/`, `auth/`, `media/`, `profile/`, `social/`, `notifications/`, `identity/`, `content/`, `forms/`, `atmosphere/`, `brand/` |
| `lib/actions/*.js` | `'use server'` writes: validate, authorise, then RPC or RLS (11 modules) |
| `lib/data/*.js` | `server-only` reads, RLS-scoped (7 modules) |
| `lib/auth/`, `lib/permissions/`, `lib/validation/`, `lib/supabase/`, `lib/giphy/`, `lib/search/`, `lib/notifications/`, `lib/moderation/` | Support modules |
| `lib/constants.js` | Routes, 55 permissions, 27 feature flags, 14 rate-limit buckets, limits, enums, default settings |
| `lib/config.js` / `lib/config.server.js` | Browser-safe configuration / server-only secrets |
| `proxy.js` | Next 16 proxy (the former middleware): session refresh, sign-in gate, legacy redirects |
| `supabase/migrations/` | 24 ordered migrations. The schema source of truth |
| `supabase/bundle/campus-plus-schema.sql` | Generated single-file copy (`npm run db:bundle`), tracked on purpose |
| `supabase/config.toml` | Supabase CLI local config (⚠️ §8.4) |
| `database/tests/` | 10 SQL test suites (run by `verify:db`) |
| `tests/` | 14 Vitest files, including architecture guards in `spec.test.js` |
| `scripts/` | Operator tools (`check-env`, `seed-dev`, `grant-role`, `list-roles`, `verify-security`, `build-sql-bundle`) and `scripts/dev/` (harness, audit, perf, contrast) |
| `docs/` | `ARCHITECTURE`, `SECURITY`, `DEPLOYMENT`, `IMPLEMENTATION-REPORT`, `PERFORMANCE`, `CONTRAST-AUDIT`, `UI-REVAMP`, and `contrast-evidence/` (PNG screenshots) |
| `perf-results/` | Committed JSON performance snapshots (generated) |

### 2.2 Routes (58 page files; 🔎 files, ✅ build output)

| Area | Routes | Notes |
|---|---|---|
| Entry and auth | `/` · `/login` · `/login/verify` · `/setup` · `/onboarding` · `/account-status` · `/rules` | `/` redirects by state. `/login/verify` → `/login?notice=google`. `/rules` is proxy-gated (⚠️ §8.2-7) |
| Home | `/home` | Feed and composer. `app/(app)/home/layout.js` mounts the one-time launch intro |
| Explore | `/explore` · `/explore/resources[/new, /[id]]` · `/explore/opportunities[/new, /[id]]` · `/explore/projects[/new, /[id]]` · `/explore/collections/[subject]` | Search hub, resources, opportunities, projects |
| Market | `/market` · `/market/new` · `/market/listing/[id]` · `/market/listing/[id]/edit` | Listings only; gigs moved to `/gigs` |
| Gigs | `/gigs` · `/gigs/new` · `/gigs/[id]` · `/gigs/[id]/edit` | Old `/market?tab=gigs`, `/market/new?type=gig` and `/market/gigs/[id]` redirect here. Retired from the primary navigation and from the campus feed header (Clubs, Timetable, Events, Noticeboard); the board, its data and its deep links are untouched |
| Clubs | `/clubs` · `/clubs/new` · `/clubs/[id]` · `/clubs/[id]/edit` | Clubs are `communities` rows with `kind='club'`; old `/campus/clubs[/[id]]` redirect here |
| Communities | `/communities` · `/communities/new` · `/communities/[slug]` · `/community/[slug]` (alias) | Study groups and general communities (clubs have their own section) |
| Campus | `/campus` · `/campus/events[/new, /[id]]` · `/campus/noticeboard[/[id]]` · `/campus/lost-found[/new, /[id]]` · `/campus/housing[/new]` · `/campus/rides[/new]` · `/campus/teams[/new]` · `/campus/study[/new, /[id]]` · `/campus/utilities` | Team finder is `/campus/teams`; study finder is `/campus/study` |
| Messages | `/chat` · `/chat/[id]` | No Random route |
| Account | `/profile` · `/settings` · `/user/[username]` · `/notifications` | |
| Content | `/post/[id]` | |
| Staff | `/moderator` · `/admin` | Tabs are permission-gated. Students see a lock notice |
| Missing | `/random` (retired) · `/campus/help` (linked from `/account-status`, no page ❌) | |

Route handlers: `GET /api/search` (401 when signed out ✅), `GET /api/giphy/search` (500 instead of 401 ❌ §8.2-8), `GET /auth/callback`.

Legacy redirects in `proxy.js` ✅: `/explore/team-finder`, `/explore/teamfinder`, `/explore/teams` → `/campus/teams`; `/explore/lost-found` → `/campus/lost-found`; `/login/verify` → `/login?notice=google`.

---

## 3. Feature → file map

Status: ✅ present and statically consistent (no live database, so runtime is not exercised). ⚠️ gap, listed in §8. Paths are repository-relative. Action names are exports of `lib/actions/<module>.js`.

| Feature | UI | Server actions | Reads (`lib/data/`) | Database (migration) | Status |
|---|---|---|---|---|---|
| Sign-in | `app/login/page.js`, `components/auth/LoginForm.js` | `auth.js`: `startGoogleSignIn` | `lib/auth/oauth.js`, `lib/auth/domains.js` | 012 (auth hooks) | ✅ |
| Callback and domain gate | `app/auth/callback/route.js` | none | `lib/auth/domains.js` | 012 `enforce_institutional_domain` | ✅ |
| Onboarding and username | `app/onboarding/page.js`, `components/auth/OnboardingForm.js` | `auth.js`: `completeOnboarding`; `profile.js`: `changeUsername` | `lib/auth/session.js` | 002, 012 (`complete_profile`, `change_username`) | ✅ (⚠️ `accept_rules` not stored) |
| Feed, posts, comments, reactions, polls | `app/(app)/home/page.js`, `app/(app)/post/[id]/page.js`, `components/posts/*` | `social.js`: `createPost`, `createComment`, `toggleReaction`, `votePoll`, `deletePost`, `restorePost`, `reportContent` | `feed.js`: `getCampusFeed`, `getPostDetail`, `getTrendingPosts` | 005 | ✅ (⚠️ poll creation not transactional) |
| Discussions | Composer with `?kind=discussion` | `social.js`: `createPost` (`kind='discussion'`) | `feed.js` | 005 | ✅ |
| Communities and group chat | `app/(app)/communities/**`, `app/community/[slug]/page.js`, `components/communities/CommunityActions.js` | `communities.js`: `createCommunity`, `joinCommunity`, `leaveCommunity`, `decideJoinRequest`, `openCommunityChat` | `campus.js` (communities) | 004, 007 (`open_community_chat`) | ✅ |
| Direct messages | `app/(app)/chat/**`, `components/chat/ChatThread.js` (realtime), `components/chat/NewConversation.js`, `components/social/MessageButton.js` | `messaging.js`: `startConversation`, `sendMessage`, `editMessage`, `deleteMessage`, `markConversationRead`, `toggleMuteConversation` | `messaging.js` | 003, 007, 014 (realtime), 020 (inbox) | ✅ (⚠️ realtime mechanism differs from docs) |
| Marketplace listings | `app/(app)/market/**`, `components/marketplace/ListingActions.js` | `marketplace.js`: `createListing`, `updateListing`, `setListingStatus`, `deleteListing`, `expressInterest`, `markListingSold`, `rateCounterparty` | `marketplace.js` | 008, 015, 016, 017, 021 | ⚠️ moderation integrity (§8.1) |
| Gigs | `app/(app)/gigs/**`, `components/gigs/*` | `marketplace.js`: `createGig`, `updateGig`, `setGigState`, `closeGig`, `deleteGig`, `applyToGig`, `withdrawGigApplication`, `decideGigApplication` | `marketplace.js` (`listGigs`, `getGig`, `listGigApplications`) | 008, 025 (skills/payment/deadline/state, `gig_applications`) | ✅ |
| Campus deals | `app/(app)/market/page.js` | `campus.js`: `saveCampusContent` (`campus_deals`, `manage_deals`) | `marketplace.js` (`listDeals`) | 008 | ✅ |
| Events and RSVPs | `app/(app)/campus/events/**`, `components/campus/RsvpForm.js`, `EventCalendar.js`, `EventSubmissionActions.js` | `campus.js`: `setRsvp`, `saveEvent`, `submitEvent`, `publishEventSubmission`, `rejectEventSubmission`, `withdrawEventSubmission` | `campus.js` (`listEvents`, `getEvent`, `listEventSubmissions`) | 009, 024 (student events are drafts only) | ⚠️ moderation no-op (§8.1-4) |
| Noticeboard (official) | `app/(app)/campus/noticeboard/**` | `campus.js`: `saveNotice` | `campus.js` (`listNotices`, `getNotice`) | 009; 005 (official-post gate) | ✅ |
| Clubs | `app/(app)/clubs/**`, `components/clubs/*` | `communities.js`: `createClub`, `updateClub`, `setCommunityMemberRole`, `removeCommunityMember` (+ join/leave/chat) | `campus.js`: `listCommunities({ kind: 'club', category })`, `countClubsByCategory` | 004 (clubs are `communities` rows), 025 (`club_category`) | ✅ |
| Team finder | `app/(app)/campus/teams/**` | `campus.js`: `createTeamPost` | `campus.js` (`listTeamPosts`, `listTeamRequests`) | 009 (`team_posts`, `team_post_requests`) | ⚠️ owner status update (§8.1-3) |
| Study partner finder | `app/(app)/campus/study/**`, `components/study/*` | `campus.js`: `createStudyPost`, `closeStudyPost`, `reopenStudyPost` | `campus.js` (`listStudyPosts`, `getStudyPost`) | 024 | ✅ (unit tests: `tests/study.test.js`) |
| Resources | `app/(app)/explore/resources/**` | `campus.js`: `submitResource` | `campus.js` (`listResources`, `getResource`) | 009 | ⚠️ approval is SQL only (§8.2-10) |
| Opportunities | `app/(app)/explore/opportunities/**` | `campus.js`: `submitOpportunity` | `campus.js` (`listOpportunities`, `getOpportunity`) | 009 | ⚠️ approval is SQL only |
| Projects | `app/(app)/explore/projects/**` | `campus.js`: `createProject` | `campus.js` (`listProjects`, `getProject`) | 009 | ⚠️ owner restore (§8.1-3) |
| Lost and found | `app/(app)/campus/lost-found/**` | `campus.js`: `createLostFound`, `resolveLostFound` | `campus.js` (`listLostFound`, `getLostFound`) | 009 | ⚠️ owner restore (§8.1-3) |
| Housing and rides | `app/(app)/campus/housing/**`, `app/(app)/campus/rides/**` | `campus.js`: `createHousingPost`, `createRidePost` | `campus.js` (`listHousingPosts`, `listRidePosts`) | 009 | ⚠️ owner restore (§8.1-3) |
| Campus utilities | `app/(app)/campus/utilities/page.js`, `app/(app)/campus/page.js` | `campus.js`: `saveCampusContent` (staff) | `campus.js` (`listUtility`, `getCampusSummary`) | 009 (locations, services, cafeteria, transport, calendar, links, help contacts) | ✅ |
| Search | `app/api/search/route.js`, `components/search/*`, `components/layout/ShellSearch.js`, `components/ui/SearchField.js` | none (read only) | `lib/search/index.js` (`globalSearch`) | 011, 024 (`global_search()`, invoker) | ⚠️ no account-status check on the API (§8.1-5) |
| Notifications | `app/(app)/notifications/page.js`, `components/notifications/NotificationList.js` | `notifications.js`: `markNotificationRead`, `markAllNotificationsRead`, `clearNotification` | `lib/notifications/index.js` (`notify`, `notifyConversation`) | 006 (`notify_user`); 014 | ✅ |
| Reports | `components/social/ReportDialog.js` | `social.js`: `reportContent` | none | 006 (`reports`) | ✅ |
| Moderation queue | `app/(app)/moderator/page.js`, `components/moderation/ModerationPanels.js` | `moderation.js`: `moderateContent`, `resolveReport`, `assignReport`, `moderateListing`, `reviewRandomReport` | `lib/data/moderation.js` (`listReports`, `listMarketplaceQueue`, `listModerationHistory`) | 006, 016 (`moderate_content`, `resolve_report`), 019 | ⚠️ no-op actions (§8.1-4) |
| Administration | `app/(app)/admin/page.js`, `components/admin/AdminPanels.js` | `admin.js`: `grantRole`, `revokeRole`, `setAccountStatus`, `setPlatformSetting`, `setFeatureFlag` | `lib/data/admin.js` (`listUsers`, `listAuditLogs`, `getOperationalCounts`, …) | 002, 011, 015, 016 | ✅ roles and permissions are read-only in the UI by design |
| Profile, settings, blocks | `app/(app)/profile/page.js`, `app/(app)/settings/page.js`, `app/(app)/user/[username]/page.js`, `components/profile/*` | `profile.js`: `updateProfile`, `blockProfile`, `unblockProfile`, `deactivateAccount`, `reactivateAccount` | `lib/data/profiles.js`; `lib/blocks.js` | 002, 003, 012 | ✅ |
| GIFs | `components/media/GifPicker.js` (also exports `GifAttachment`) | none | `lib/giphy/index.js`; `app/api/giphy/search/route.js` | 005, 007 (validated GIF references) | ❓ not exercised (no key) |
| Achievements and reputation | none (no UI reads achievements) | none | `profiles.js` (reputation counters) | 008 (`ratings`), 009 (`achievements`), 012 (`evaluate_achievements`) | ❌ backend only; definitions in `lib/constants.js` |
| Random Chat | none (no route, nav or components) | `lib/actions/random.js`, **no importers** | `lib/data/moderation.js` (`listRandomReports`) | 010, 022, 023 (kept for review) | ❌ retired |
| Launch intro, atmosphere | `app/(app)/home/layout.js`, `components/layout/HomeLaunchGate.js`, `components/ui/CampusIntroLoader.js`, `components/atmosphere/DepthField.js` (Home environment), `components/atmosphere/NightSky.js` (shell sky) | none | `lib/intro.js` | none | ✅ honours `prefers-reduced-motion` 🔎 |

---

## 4. Database

**Migrations.** 24 files, `20261005000001` to `20261005000024`, applied in order. ✅ The bundle check reports 24 migrations and 395.1 KB, and the bundle is current.

| # | Concern | # | Concern |
|---|---|---|---|
| 001 | extensions, enums | 013 | reference data (roles, permissions, flags, settings) |
| 002 | identity, roles, permissions | 014 | realtime publication and grants |
| 003 | blocks, mutes | 015 | column privileges (client UPDATE narrowed) |
| 004 | communities | 016 | staff actions (`moderate_content`, `grant_role`, …) |
| 005 | social (posts, comments, reactions, polls) | 017 | marketplace hardening |
| 006 | moderation core, notifications, audit | 018 | final function grants |
| 007 | messaging | 019 | staff visibility |
| 008 | marketplace, gigs, deals, ratings | 020 | chat inbox |
| 009 | campus (events, notices, lost and found, team, housing, rides, projects, utilities) | 021 | marketplace and security fixes |
| 010 | random (retired) | 022 | random views |
| 011 | platform settings, feature flags, rate limits, search | 023 | Random flag retired |
| 012 | auth hooks, profile completion, usernames | 024 | study partners and discovery |

**Tables.** 64 tables, all with `ENABLE ROW LEVEL SECURITY`, and 245 policies. The only table without a client policy is `rate_limits`, which is deny-all and used by `consume_rate_limit()`.

| Domain | Tables | Key relationships |
|---|---|---|
| Identity | `colleges`, `profiles` (public), `profile_private` (self and staff), `username_history` | `profile_private.auth_user_id` → `auth.users`; `profile_private.profile_id` → `profiles` (1:1) |
| Roles | `roles`, `permissions`, `role_permissions`, `user_roles` | `user_roles` → role → permissions |
| Blocks | `blocks`, `mutes` | `is_blocked()` filters reads across the app |
| Communities | `communities`, `community_members`, `community_join_requests` | membership-scoped RLS; `guard_community_role_change` trigger |
| Social | `posts`, `comments`, `reactions`, `poll_options`, `poll_votes`, `mentions` | posts own comments, reactions and polls |
| Moderation | `reports`, `moderation_actions`, `audit_logs`, `notifications` | audit and notifications are written only by definer functions |
| Messaging | `conversations`, `conversation_members`, `messages`, `message_reads`, `message_edits` | `direct_key` gives one DM thread per pair |
| Marketplace | `marketplace_categories`, `marketplace_listings`, `marketplace_interactions`, `gigs`, `campus_deals`, `ratings` | approval trigger on insert |
| Campus | `events`, `event_registrations`, `notices`, `official_resources`, `opportunities`, `projects`, `lost_found`, `housing_posts`, `ride_posts`, `team_posts`, `team_post_requests`, `campus_locations`, `campus_services`, `transport_information`, `cafeteria_information`, `academic_calendar`, `official_links`, `help_contacts`, `achievements`, `user_achievements` | |
| Random (retired) | `random_queue`, `random_sessions`, `random_session_participants`, `random_messages`, `random_reports` | kept for moderation review |
| Platform | `platform_settings` (16 rows, `is_public` flag), `feature_flags` (27), `rate_limits` | |
| Other | `reserved_usernames` (012), `study_partner_posts` (024) | |

✅ **Migration facts:** 109 function names (including trigger functions), 58 triggers, 4 views. Realtime publication: `messages`, `conversations`, `message_reads`, `notifications`. The role-to-permission defaults in `lib/constants.js` match the seeds in 013 and 024 **exactly** for all four roles: 26, 39, 53 and 55 keys, 173 `role_permissions` rows in total.

**Security-critical helpers.** All are `SECURITY DEFINER` with a pinned `search_path`: `current_profile_id()`, `is_active_user()`, `is_active_profile(uuid)`, `has_permission(text)` (checks active account and role expiry), `is_blocked()`, `can_access_conversation()`, `consume_rate_limit()`, `allowed_email_domain()`, `enforce_institutional_domain()` (before insert on `auth.users`), `moderate_content()`, `resolve_report()`, `restore_own_content()`, `delete_own_content()`, `grant_role()`, `revoke_role()`, `admin_set_account_status()`, `admin_set_platform_setting()`, `complete_profile()`, `change_username()`, `get_or_create_direct_conversation()`, `open_community_chat()`. `global_search()` is `SECURITY INVOKER`.

**Views.** `public_profiles` and `listing_interests_view` use `security_invoker = true`. `random_session_view` and `random_messages_view` run as their owner on purpose (migration 022). That is a deliberate RLS bypass for a retired feature, so review it before any revival.

**Column privileges (015).** Clients can update only listed columns. For example, `profiles` allows display name, bio, branch, year, division, show-branch flag and DM preference. Marketplace contact details are not selectable by clients; they are released by `record_listing_interest()` and `get_listing_contact_note()`. Roles, permissions, platform settings and feature flags are read-only to clients.

**Install paths.** `supabase db push`, or paste `supabase/bundle/campus-plus-schema.sql` into the SQL editor (`docs/DEPLOYMENT.md` §3). `tests/bundle.test.js` fails if the bundle drifts from the migrations ✅.

---

## 5. Authentication and authorisation

**Sign-in flow** (🔎 read; runtime not tested):
1. `/login` → `LoginForm` calls the server action `startGoogleSignIn`. It creates no session. It returns the Google authorisation URL, built from the request origin. The `next` value passes `safeNextPath()`.
2. Browser → Google → Supabase → `GET /auth/callback?code=…`.
3. The callback exchanges the code (PKCE, verifier cookie), then calls `checkInstitutionalEmail()` on the Google-verified address. On failure it signs out and redirects to `/login?error=domain`.
4. Success redirects to `next` or `/home`. A user without a profile goes to `/onboarding` (from `requireUser`).

**Layers.**

| Layer | Mechanism | File |
|---|---|---|
| Edge | Cookie refresh (`getClaims`) and sign-in gate. Public paths: `/`, `/login`, `/login/verify`, `/auth`, `/setup` | `proxy.js` |
| Page or layout | `requireUser()`: no session → `/login`; blocked status → `/account-status`; no profile → `/onboarding`. `requireStaff()` exists but has no importers | `lib/auth/session.js` |
| Action | `getActiveUser()` → `enforceRateLimit()` → `validate()` → RPC or RLS | `lib/actions/*.js` |
| UI offer | `can(actor, permission)`: fails closed for unknown keys, false for non-active accounts | `lib/permissions/authorization.js` |
| Database | RLS policies, `has_permission()`, column grants, guard triggers, definer functions | `supabase/migrations/*` |

**Account states:** `pending`, `active`, `suspended`, `banned`, `deactivated`, `deleted`. `BLOCKED_STATUSES` in `lib/auth/session.js` gates the app, and `/account-status` explains why. ⚠️ Read access is not gated (§8.1-5).

**Roles and permissions.** Four roles (`student`, `moderator`, `admin`, `super_admin`) and 55 permissions, all stored as rows. Students never see a role badge. Staff see a red `StaffDot`. There are no presence dots.

**Supabase clients:**

| Client | File | Key | Used by |
|---|---|---|---|
| Server (RLS, cookies) | `lib/supabase/server.js` (`server-only`) | publishable | pages, actions, route handlers |
| Browser | `lib/supabase/client.js` | publishable | `ChatThread` realtime; `useSignOut` |
| Admin (service role) | `lib/supabase/admin.js` (`server-only`) | **secret** | **no importers**, so unused ❌ (§8.3) |

**Domain gate, three layers:** application (`lib/auth/domains.js`, reads `platform_settings.allowed_email_domains`, falls back to `CAMPUS_ALLOWED_EMAIL_DOMAINS`) → database (`enforce_institutional_domain`, before insert on `auth.users`) → Supabase Auth provider settings (operator). The default is `pccoepune.org`.

**Configuration drift ❓.** `supabase/config.toml` enables email signup and describes OTP as the only method. It has no Google provider block. `docs/DEPLOYMENT.md` says to switch Email **off** on the hosted project. The hosted project was not inspected.

**Rate limits.** 14 buckets in `RATE_LIMITS` (`lib/constants.js`), enforced by `consume_rate_limit()`. ⚠️ `lib/ratelimit.js` **fails open** when the RPC errors: it logs and allows the request. ⚠️ The `auth_probe` bucket is defined but never used (§8.3).

---

## 6. Shared components and reusable patterns

- **Write pattern** (`lib/actions/*`): `'use server'` → `getActiveUser()` → `enforceRateLimit()` with a named bucket → `validate(payload, schema)` → RLS insert or `supabase.rpc(…)` → `revalidatePath` → return `{ ok, … }` or `toActionError()`.
- **Read pattern** (`lib/data/*`): `server-only`, request-scoped client (RLS applies), returns `{ items, unavailable }`, never throws. Empty and error states belong to the UI.
- **Errors** (`lib/errors.js`): `AppError` with codes. `fromPostgresError()` maps SQLSTATE codes to safe messages; messages with errcode `22023` and `42901` are shown verbatim by design. `toActionError()` serves actions; `toHttpResponse()` serves route handlers (misused in the GIPHY route, §8.2-8).
- **Forms:** `lib/forms.js` `useFormAction(action, opts)` returns `{ run, pending, error, fieldErrors }`. `components/forms/ActionForm.js` renders create and edit forms.
- **Validation:** `lib/validation/primitives.js` (`vString`, `vEnum`, `vUrl`, `vUuid`, `vDate`, …) and `lib/validation/schemas.js` (one schema per domain, `gifRefValidator`).
- **UI kit:** `components/ui/index.js`: `Button`, `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Card`, `Badge`, `Notice`, `EmptyState`, `ErrorState`, `SkeletonList`, `Spinner`, `Modal`, `Sheet`, `Dropdown`, `MenuItem`, `MenuLink`, `Toast`, `PageHeader`, `SectionHeader`, `SearchField`, `GlassSurface`, `OfficialBadge`, `StaffDot`, `IdentityMark`, and others.
- **Layout:** `AppShell` (sidebar, header, bottom nav, command palette). Components: `Sidebar`, `ShellHeader`, `BottomNav`, `MobileMenu`, `CreateMenu`, `AccountMenu`, `ShellSearch`. Navigation and the Create menu come from `can()` results in `app/(app)/layout.js`.
- **Identity and content:** `IdentityLine` and `RoleLabel` show `@username` only, never email. `ContentCard`, `ExternalLink` (`http(s)` only), `OfficialBadge` for official content.
- **Safety UI:** `components/social/ReportDialog.js` (one report flow for every target type), `components/moderation/ModerationPanels.js`.
- **Chat:** `ChatThread` subscribes to the private `conversation:<id>` channel. The only receipt is Sent or Seen.
- **Media:** GIFs go through `/api/giphy/search`. The browser never calls GIPHY directly.
- **Constants:** `lib/constants.js` is the single source for `ROUTES`, `PRIMARY_NAV`, `MOBILE_NAV`, enums, limits, permissions, flags and default settings. The DB seeds mirror it.
- **Styling:** `app/globals.css` tokens; `app/styles/*.css` by concern; one permanent dark theme; the root layout always renders `data-theme="dark"`.

---

## 7. Commands

| Command | Status | Notes |
|---|---|---|
| `npm ci` | ✅ 407 packages, about 14 s (run with `--ignore-scripts`) | Lockfile v3. Skipping install scripts avoids binary downloads outside the allowed registry |
| `npm run dev` | ❌ not run | `next.config.mjs` allows `*.e2b.app` dev origins |
| `npm run build` | ✅ compiled; 58 pages, 3 route handlers, `/icon.svg`, `/_not-found`, Proxy | Builds without Supabase env (pages then show the setup state) |
| `npm run start` | ✅ used with placeholder values, localhost only, for runtime checks | Production security headers verified |
| `npm run lint` | ✅ exit 0, no findings | ESLint flat config |
| `npm test` | ✅ 14 files, 181 tests passed | Includes the bundle-drift test |
| `npm run db:bundle -- --check` | ✅ up to date | Read-only |
| `npm run check:env` | ✅ runs; exit 1 here (no `.env.local`) | Expected in this sandbox |
| `npm run verify`, `verify:db`, `audit:db`, `db:test` | ❌ not run | These apply every migration to a throwaway Postgres. They need `npm install --no-save embedded-postgres`, which is not in `package.json`. Skipped because onboarding forbids running migrations |
| `npm run verify:security` | ❌ not run | Live probe. No live project is configured |
| `npm run seed:dev -- --confirm` | ❌ not run | Writes data. Refuses production (`NODE_ENV`, `VERCEL_ENV`) |
| `npm run role:grant`, `role:list` | ❌ not run | Need `SUPABASE_SECRET_KEY` and a database |
| `npm run db:migrate`, `db:reset` | ❌ not run | Supabase CLI. Would change a database |
| `npm run test:contrast`, `perf:*` | ❌ not run | Need Playwright browsers or a local Postgres |

**Environment variable names** (values are never recorded here): `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the only two `NEXT_PUBLIC_*` values, both public by design), `SUPABASE_SECRET_KEY` (scripts and `lib/supabase/admin.js` only), `CAMPUS_ALLOWED_EMAIL_DOMAINS`, `GIPHY_API_KEY`, `GIPHY_CLIENT_ID`, `GIPHY_CONTENT_RATING`, `NEXT_PUBLIC_PLATFORM_NAME`, `NEXT_PUBLIC_COLLEGE_NAME`. `NODE_ENV` and `VERCEL_ENV` drive guards. ✅ Only `.env.example` is tracked, and its values are placeholders.

---

## 8. Verified gaps, blockers and technical debt

**P1** items need a decision and a database test before any change. Items are from static reading unless marked ✅ (runtime).

### 8.1 Integrity and security

1. **P1: Owners can undo a moderator's removal of a marketplace listing.** `moderate_content()` sets `marketplace_listings.status = 'removed'` and records `moderated_by`. The seller can then restore it in two ways: `restore_own_content('marketplace_listing')` matches on `status = 'removed'` and owner only, with no moderation check; or a direct `UPDATE status = 'active'`, which the column grant (015) allows and `guard_listing_update` (021) permits because it never checks the previous state. Files: `supabase/migrations/20261005000016_016_staff_actions.sql`, `…015_015_column_privileges.sql`, `…021_021_marketplace_and_security_fixes.sql`. No test covers it: `database/tests/09_marketplace_lifecycle.sql` covers self-removal only.
2. **P1: Pre-moderation bypass.** In `pre_moderation` mode a listing is inserted as `pending`. The same owner `UPDATE status = 'active'` path moves it to active without staff approval. Same files as item 1.
3. **P1: Owner re-publishes moderated content.** Owner UPDATE policies on `lost_found`, `housing_posts`, `ride_posts`, `projects` and `team_posts` have no status condition, and `status` is client-writable on all five. No guard trigger exists. Two paths reach this: a direct `UPDATE status` (all five), and `restore_own_content()`, which sets `published` on `lost_found`, `housing_post`, `ride_post`, `project` and `gig` without checking the prior status (`gig` is reachable only through the RPC, because its grant excludes `status`). Posts and comments are safe: restore requires `status = 'deleted'`, and staff use `removed` or `hidden`. Files: `supabase/migrations/20261005000009_009_campus.sql` (policies), `…015_015_column_privileges.sql` (grants), `…016_016_staff_actions.sql` (restore).
4. **P2: Silent no-op moderation.** Reports can target `event`, `resource`, `opportunity` and `deal`, and the moderator queue shows hide, remove and restore for them. `moderate_content()` only writes an audit row for `notice`, `event`, `resource`, `opportunity` and `deal` (a placeholder `update audit_logs set id = id where false`). Staff see success while the content stays visible. Files: `…016` (`moderate_content`), `app/(app)/moderator/page.js` (around line 135).
5. **P2: Suspended and banned accounts keep read access.** The post, listing and profile SELECT policies check the author's status, not the viewer's. A suspended student with a valid session can still read published, non-blocked content through RLS. The app layout blocks the UI, but `/api/search` does not. Product decision needed: `/account-status` says the account is "read-only or unavailable".
6. **P2: Anonymous read of non-public settings.** `setting(text, jsonb)` is `SECURITY DEFINER` and ignores `platform_settings.is_public`. Migration `…018_018_function_grants.sql` grants it to `anon`, and its comment calls it "harmless". Non-public keys include `allowed_email_domains`, `marketplace_approval_mode`, `community_creation_open` and the `random_*` settings. Sensitivity is low, but it is an RLS bypass. Confirm with `verify:security` on a live project ❓.

### 8.2 Functional bugs

7. ✅ **`/rules` sends signed-out visitors to `/login?next=%2Frules`** (HTTP 307). The login page links to `/rules`, but `/rules` is not in `proxy.js` `PUBLIC_PATHS`.
8. ✅ **`/api/giphy/search` returns HTTP 500 for signed-out users** (should be 401). Its `catch` calls `toHttpResponse(fromPostgresError(error) || error)`. `fromPostgresError` never returns a falsy value, so every error becomes `internal` and is logged as one. File: `app/api/giphy/search/route.js`.
9. ❌ **Broken link:** `app/account-status/page.js` links to `/campus/help`, which has no route.
10. ❌ **No in-app approval** for student-submitted resources and opportunities. `official_resources` and `opportunities` grant no client UPDATE on `status`, so approval needs operator SQL (`docs/DEPLOYMENT.md` §8). The admin page says so.
11. ⚠️ **Rules acceptance is validated but not stored.** `accept_rules` passes `onboardingSchema`, but `complete_profile()` has no parameter for it (`lib/actions/auth.js`, `lib/validation/schemas.js`).
12. ⚠️ `configurationStatus()` reports the publishable key as configured when only the secret key is set (`lib/config.server.js`).
13. ✅ ⚠️ `/` returns HTTP 200 with a meta-refresh to `/login` for signed-out visitors, not a 3xx. Not a security issue, but it affects crawlers and proxies.
14. ⚠️ Poll creation makes two writes (`posts`, then `poll_options` with a compensating delete). It is not transactional (`lib/actions/social.js`).
15. ⚠️ Rate limiting fails open on RPC errors (`lib/ratelimit.js`). This is deliberate. Decide whether it is acceptable for `message_send` and `post_create`.
16. ⚠️ `/api/search` returns results to any signed-in profile, including suspended accounts (see 8.1-5).

### 8.3 Dead, retired or unused code

- **Random Chat:** retired from the UI (no `/random`, no nav, no components; migration 023 and the `lib/constants.js` comment). `lib/actions/random.js` has no importers. Tables, RPCs, views and the Random-reports moderation tab remain on purpose.
- **`lib/supabase/admin.js`:** `getAdminClient` and `requireAdminClient` have no importers. Its comment cites `lib/moderation/actions.js`, which does not exist.
- **Unused exports:** `requireStaff()` (`lib/auth/session.js`), `useRealtimeAuth()` (`lib/auth/client-actions.js`), `broadcastSchema` (`lib/validation/schemas.js`).
- **Unused rate-limit bucket:** `auth_probe` in `RATE_LIMITS`, despite the comment saying sign-in has no bucket.
- **`touch_last_seen()`** is granted to `authenticated` but never called by the app. `profile_private.last_seen` is set during onboarding (`complete_profile`), stored, and never displayed. ⚠️ The admin page says the product "stores no analytics or presence data".
- **Placeholder moderation branch** for notice, event, resource, opportunity and deal (see 8.1-4).

### 8.4 Stale documentation (do not trust these claims)

| Document | Claim | Verified reality |
|---|---|---|
| `README.md` (lines 69, 96–97) | 19 migrations; 8 database suites | 24 migrations; 10 SQL suites (the harness runs every file in `database/tests/`) |
| `docs/DEPLOYMENT.md` §3 | 19 migrations; bundle about 349 KB; install report shows 53 permissions and 165 `role_permissions` | 24 migrations; bundle 395.1 KB; 55 permissions; 173 `role_permissions` (static count) |
| `docs/ARCHITECTURE.md` §2 | "Email one-time-code only" | Google OAuth only (`lib/auth/oauth.js`, `app/auth/callback/route.js`) |
| `docs/ARCHITECTURE.md` §3 | `/random` route; `/onboarding` and `/rules` public | `/random` removed; `/onboarding` needs a session; `/rules` is gated (✅) |
| `docs/ARCHITECTURE.md` §7 | "Exactly one mechanism: private broadcast" | `ChatThread` uses `postgres_changes` on a private channel |
| `README.md`, `docs/ARCHITECTURE.md` §10 | "No gradients, no glass, warm off-white palette" | Permanent dark theme, blue particle sky, glass tiers (`docs/UI-REVAMP.md`, `tests/spec.test.js`). ❓ product direction |
| `docs/SECURITY.md` §3; `docs/DEPLOYMENT.md` §3 | 53 permissions, 4 roles | 55 permissions in code and in the DB ✅; 4 roles ✅ |
| `docs/IMPLEMENTATION-REPORT.md` (top table; §1, §4, §5, §8, §10) | 53 page routes; 6 suites and 81 tests; 19 migrations; 8 database suites | 58 page files; 14 suites and 181 tests ✅; 24 migrations; 10 SQL suites |
| `docs/DEPLOYMENT.md` §4 | Turn Email **off** | Local `config.toml` has it on. Hosted state not inspected ❓ |
| `supabase/config.toml` | "The only auth method is an email OTP" | Conflicts with Google-only. No Google block |
| Migration 002 header | "Institutional email OTP" | Historical comment. The code is Google-only |
| `docs/SECURITY.md` §9 | `audit:db`: 54 assertions | Not re-run (it applies migrations) |

### 8.5 Technical debt

- Staff role keys are hard-coded in `requireStaff()` and in `components/layout/AppShell.js`. The `staffLabel` in `app/(app)/layout.js` only checks `admin`.
- Multi-step writes without transactions: poll creation, and onboarding side effects.
- Large files: `components/ui/CampusIntroLoader.js` (954 lines), `lib/actions/campus.js` (860), `app/(app)/admin/page.js` (658), `app/styles/controls.css` (1,295).
- **Secret-shaped literal in Git.** `scripts/dev/perf/lib.mjs` defines a value shaped like a Supabase secret key. `scripts/dev/perf/serve.mjs` prints it, and `docs/CONTRAST-AUDIT.md` shows an export example with the same shape. It appears to be a local stub used against `127.0.0.1` (🔎), so it is probably not a live key. Confirm that, then rotate or replace it if it ever matched a real project. The value is deliberately not reproduced here.
- Generated or heavy artefacts in Git: `perf-results/*.json` (about 14k lines), PNG screenshots in `docs/contrast-evidence/` (38 binary files under `docs/`), `supabase/bundle/` (deliberate), and `package-lock.json`.
- No CI workflow. The database suites and the policy audit do not run automatically.
- `package.json` has no `"type": "module"`, so Node prints a reparse warning when it loads `lib/constants.js` directly. Harmless for Next and Vitest.
- npm reports `eslint@9.39.5` as deprecated.

### 8.6 Not verified and blockers

- **No live Supabase project** in this sandbox. Google OAuth, runtime RLS, RPCs, Realtime and GIFs are unverified.
- Database suites, `audit:db`, `verify:security` and the Playwright contrast and perf checks were not run (§7).
- No authenticated browser session, so the UI was not exercised end to end.
- Repository identity: `origin` is `aminotkartik/setup`. The URL you gave is `sitemango/setup`, whose `main` has the same tree. Confirm which repository future PRs should target.

---

## 9. Requirements vs implementation

| Requirement | Status | Evidence and gap |
|---|---|---|
| Institutional verification with `@pccoepune.org` | ✅ code; ⚠️ hosted config | Google OAuth plus the three-layer domain gate. Confirm the Email provider is off and the production domain list is correct |
| Unique usernames; no PRN or passwords in the normal experience | ✅ | Case-insensitive unique index; `^[a-z0-9_]{3,24}$`; reserved names; change cooldown. No PRN field or table. No password flow. The settings copy mentions "your PRN" only as a privacy statement |
| Direct messages with read and seen receipts; no presence | ✅ | `messages` and `message_reads`; Sent and Seen only; no presence or typing. ⚠️ `last_seen` is stored but not displayed |
| Marketplace subject to moderator or admin review and moderation | ⚠️ | Default `post_moderation` publishes immediately and relies on reports. `pre_moderation` exists. Integrity gaps 8.1-1 and 8.1-2. ❓ Decide the default |
| Official notices, events and official content controlled by admins | ✅ / ⚠️ | Permission-gated (`manage_notices`, `manage_events`, `manage_official_content`, `manage_deals`). Gaps: resource and opportunity approval (8.2-10), moderation no-op (8.1-4) |
| Clear distinction between student and verified official content | ✅ 🔎 | `is_official` columns. RLS stops students from setting official flags on posts, listings and events. `OfficialBadge` in the UI |
| Consistent authentication, authorisation and database security | ⚠️ | Layered, with strong RLS and column grants. Gaps 8.1-1 to 8.1-6 and 8.2 |
| No AI features | ✅ | No AI SDK in `package.json`. `tests/spec.test.js` guards it |

---

## 10. Files to read before changing common areas

| Area | Read first |
|---|---|
| Routing, public paths, legacy redirects | `proxy.js`, `lib/constants.js` (`ROUTES`) |
| Shell, navigation, Create menu, palette | `app/(app)/layout.js`, `components/layout/AppShell.js`, `components/layout/CreateMenu.js` |
| Sessions and account gates | `lib/auth/session.js`, `lib/auth/oauth.js`, `app/auth/callback/route.js` |
| Permissions | `lib/permissions/authorization.js`, `lib/constants.js` (`PERMISSIONS`, defaults), seeds in `supabase/migrations/…013` and `…024` |
| Writes | `lib/actions/<module>.js`, `lib/validation/schemas.js`, `lib/errors.js`, `lib/ratelimit.js` |
| Reads | `lib/data/<module>.js` |
| Schema and security | `supabase/migrations/` (add a new numbered file; never edit applied ones). `…015` column grants, `…016` moderation and restore functions, `…021` listing guard |
| Generated bundle | Regenerate with `npm run db:bundle`. Never hand-edit `supabase/bundle/campus-plus-schema.sql` |
| Database behaviour tests | `database/tests/*.sql` (run by `verify:db`) |
| Architecture guards | `tests/spec.test.js`, `tests/bundle.test.js`, `tests/permissions.test.js` |
| UI kit and tokens | `components/ui/index.js`, `app/globals.css`, `app/styles/*.css`, `docs/UI-REVAMP.md` |
| Next configuration and headers | `next.config.mjs` |

---

## 11. Change-safety checklist

1. Re-open the current source of every file you will touch. This document may be stale.
2. Search for an existing implementation first (`ROUTES`, the §3 table). Do not add a parallel route, table, action or component.
3. Enforce authorisation twice: `can()` in the action or page, and RLS, `has_permission()` or a column grant in the database. Hiding a button grants nothing.
4. Writes: validate with `lib/validation`, check the permission, rate-limit with a named bucket, then RPC or RLS. Return `{ ok, error }` through `toActionError`. Never show raw database errors.
5. New table: RLS on, explicit policies, column grants for UPDATE, indexes, realtime only when needed. Add a new migration file, regenerate the bundle, and add a database test.
6. New permission or flag: add it to `lib/constants.js` and to the seeds in a new migration. Keep the role defaults in step. The parity check in §4 passed.
7. Official content: keep `is_official` writes behind the `manage_*` permission and the database policy.
8. UI: loading, empty and error states on every surface. No raw HTML, no presence or typing indicators, no AI, no uploads. Secrets stay server-side.
9. Before reporting: `npm run lint`, `npm test`, `npm run build`. For migrations or policies, also run `npm run verify:db` and `npm run audit:db` against a throwaway database. Report anything you could not run.
10. Do not hand-edit `package-lock.json`, generated bundles or `.env*` values.

---

## 12. Verification log (2026-10-09)

| Check | Result |
|---|---|
| `git status`, branch, log, remotes; `ls-remote` and `gh repo view` on both repositories | ✅ Clean. `origin` is `aminotkartik/setup`. `sitemango/setup` `main` has an identical tree |
| `npm ci --ignore-scripts` | ✅ 407 packages |
| `npm run lint` | ✅ exit 0 |
| `npm test` | ✅ 14 files, 181 tests |
| `npm run db:bundle -- --check` | ✅ up to date (24 migrations, 395.1 KB) |
| `npm run check:env` | Exit 1: no `.env.local` (expected) |
| `npm run build` | ✅ compiled. 58 page routes, 3 route handlers, Proxy |
| Runtime probe: production build with placeholder Supabase values, localhost only | `/rules` → 307 to login (bug 8.2-7). `/login` 200. `/home` → login 307. `/explore/team-finder` → `/campus/teams` 307. `/login/verify` → `/login?notice=google` 307. `/api/search` 401. `/api/giphy/search` 500 (8.2-8). Security headers present: `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions policy |
| Static parity: permission catalogue and role defaults vs migration seeds | ✅ exact match |
| Not run | `verify`, `verify:db`, `audit:db`, `verify:security`, `seed:dev`, `role:*`, `db:migrate`, `db:reset`, `db:test`, `dev`, `test:contrast`, `perf:*`, Playwright |

The probe build and server were removed afterwards. Only this document was added to the repository.

---

## 13. Not inspected

- Not read line by line: most of `components/`, `app/styles/*.css`, `scripts/dev/*` (perf, contrast, audit), `perf-results/`, `docs/contrast-evidence/`. Migrations 009, 011 and 016 were sampled, not read in full.
- No database was queried. RLS behaviour was reasoned from policies, not run as real users.
- No calls were made to Google, GIPHY or any Supabase project. The runtime probe used the placeholder host `example.invalid`, which does not resolve.
