# Campus+ — Implementation Report

Final state of the application layer. Everything below was executed in this
repository; nothing here is a plan.

Counts re-measured on 2026-10-13 (`ls`/`find` against the working tree and the
build's own route table), which is why several figures differ from earlier
revisions of this report — the schema, the test suites and the route list have all
grown since it was first written.

| Verification | Result (2026-10-13) |
| --- | --- |
| `npm run lint` | ✅ 0 errors, 0 warnings (whole repository) |
| `npm test` | ✅ 15 suites, **193 tests passed** |
| `npm run build` | ✅ compiled; 58 `page.js` routes, 3 route handlers, 22 `loading.js` (+ `ƒ Proxy`); no `/random` route (`random_chat` is retired) |
| `npm run verify:db` | ✅ 24 migrations applied; 10 database suites passed |
| `npm run audit:db` | ✅ **54 passed, 0 warnings, 0 failures** |
| `npm run verify` | ✅ end-to-end (lint + migrations + audit + tests) |
| `npm run check:env` | ⚠️ fails on this checkout by design — `.env.local` points `NEXT_PUBLIC_SUPABASE_URL` at the local harness stub (`http://127.0.0.1:3111`), which the check rejects because it is not `https://<ref>.supabase.co`. All other env checks pass |
| `npm run verify:security` | ⚠️ 1 of the hygiene greps flags the perf harness's deliberate placeholder (`sb_secret_perf_harness_key` in `scripts/dev/perf/*` and one doc command). Every live-probe check passes; see *Genuine blockers* |
| Browser verification (Phase A) | ✅ readability 20/20, interaction 18/18, a11y 6/6, sign-out 28/28, 11/11 visual shots with 0 console errors — full evidence in §12 |
| SQL bundle path | ✅ `npm run db:bundle` applied as one script to a fresh PostgreSQL: 10/10 suites pass |

---

## 1. Completed routes

Every route in the specification exists, renders real data, is responsive, has
loading + empty + error states, respects permissions and mutates through real
server actions.

**Public / shell (7)** — `/`, `/setup`, `/login`, `/login/verify`, `/onboarding`,
`/account-status`, `/rules`. `/` routes to `/login`, `/home` or `/setup`
depending on session and configuration; there is no marketing page.

**Primary (10)** — `/home` (campus feed + composer + official notices + upcoming
events), `/explore` (search + scopes), `/market`, `/communities`, `/campus`,
`/chat`, `/profile`, `/settings` (profile, username, notifications, privacy,
blocked users, account, logout), `/notifications`, `/campus/utilities`.

**Deep links (13)** — `/user/[username]`, `/post/[id]`, `/communities/[slug]`
(plus the specification's `/community/[slug]` alias), `/market/listing/[id]`,
`/market/gigs/[id]`, `/campus/events/[id]`, `/campus/clubs/[id]`,
`/campus/noticeboard/[id]`, `/explore/resources/[id]`,
`/explore/opportunities/[id]`, `/explore/projects/[id]`, `/chat/[id]`.
Random sessions deliberately have **no** URL.

**Create / edit (9)** — `/market/new`, `/market/listing/[id]/edit`,
`/communities/new`, `/explore/{resources,opportunities,projects}/new`,
`/campus/{lost-found,housing,rides,teams}/new`.

**Campus utilities** — `/campus/utilities`: directory, locations, services,
cafeteria, transport, academic calendar, forms and links, help hub — all text, no
map SDK.

**Staff (2)** — `/moderator` (report queue, marketplace moderation, Random
reports, content actions, audit history) and `/admin` (users, roles, permissions,
reports, official content, marketplace, events, settings, feature flags, audit
logs, operational counts).

**Endpoints (2)** — `GET /api/search` (Postgres-only, 11 scopes) and
`GET /api/giphy/search` (server-side key, configured rating, attribution).
`/auth/callback` is a third route handler (the OAuth exchange).

Totals: **58 `page.js` routes**, 22 `loading.js` files, 3 route handlers. (The
build's route table lists 60 non-API rows: the 58 pages plus `/icon.svg` and
`/auth/callback`.)

## 2. Components

* **Feed** — `PostCard`, `PostItem`, `PostComposer` (text + GIF, no uploads),
  `CommentThread`/`CommentComposer`/`CommentItem`/`CommentActions`,
  `ReactionBar` (fixed reaction set), `PostActions`, `PollBlock`, `richText`.
* **Reusable primitives** — `ReportDialog` (user, post, comment, listing,
  community, conversation, Random session, gig, project, opportunity),
  `IdentityLine` (initial, name, `@username`, staff dot — never presence),
  `GifPicker` + `GifAttachment`, `NotificationList`/panel, `MessageButton`,
  `ActionForm` (one form renderer for every create/edit surface), `ContentCard`,
  `ExternalLink`, and the UI kit (`Button`, `Field`, `Input`, `Textarea`,
  `Select`, `Checkbox`, `Card`, `Badge`, `OfficialBadge`, `StaffDot`, `Notice`,
  `EmptyState`, `ErrorState`, `SkeletonList`, `Spinner`, `PageHeader`).
* **Layout** — `AppShell`, `Sidebar`, `BottomNav`, `MobileMenu` (desktop sidebar,
  mobile bottom navigation, one responsive codebase).
* **Chat** — `ChatThread` (username/message/timestamp/Seen, intelligent
  autoscroll, reconnect + error states, private-broadcast realtime, no presence),
  `NewConversation`, `ConversationActions`.
* **Marketplace / campus** — `ListingActions`, `RsvpForm`, `PostActionsRow`,
  `CommunityActions`, `ProfileActions`.
* **Staff** — `ModerationPanels` (`ModerationActions`, `ResolveReportForm`,
  `MarketplaceReviewActions`, `RandomReportActions`) and `AdminPanels`
  (`GrantRoleForm`, `RevokeRoleForm`, `AccountStatusForm`,
  `PlatformSettingForm`, `FeatureFlagToggle`).
* **Random** — `RandomLobby` (queue polling, elapsed timer) and `RandomChat`
  (Next / End / Block / Report, anonymous-to-partner, private topic).

## 3. Data-layer modules

**Reads (`lib/data/`, server-only, RLS-scoped, never throw)** — `feed.js`,
`profiles.js`, `messaging.js`, `campus.js`, `marketplace.js`, `moderation.js`,
`admin.js`. Every list helper returns `{ items, unavailable }` so a page can warn
honestly instead of inventing data.

**Writes (`lib/actions/`, `'use server'`)** — `auth.js`, `social.js`,
`profile.js`, `notifications.js`, `messaging.js`, `communities.js`,
`marketplace.js`, `campus.js`, `random.js`, `moderation.js`, `admin.js`. Each
action validates input, re-checks permission with `can()`, then calls the
database (RPC where one exists: `complete_profile`, `change_username`,
`get_or_create_direct_conversation`, `mark_conversation_read`,
`open_community_chat`, `record_listing_interest`, `mark_listing_completed`,
`join/leave_random_queue`, `random_queue_state`, `random_session_state`,
`send_random_message`, `end_random_session`, `record_mentions`, `notify_user`,
`delete_own_content`, `report_*`, `moderate_content`, `resolve_report`,
`assign_report`, `grant_role`, `revoke_role`, `admin_set_account_status`,
`admin_set_platform_setting`, `consume_rate_limit`).

**Support (`lib/`)** — `auth/` (session, domains, client actions), `permissions/`
(`can`, `toActor`, `highestRole`), `validation/` (primitives + per-domain
schemas), `giphy/`, `search/`, `notifications/`, `mentions.js`, `blocks.js`,
`moderation/audit.js`, `ratelimit.js`, `errors.js`, `forms.js`, `utils.js`,
`constants.js` (single source for limits, routes, enums, permissions, settings
defaults, rate-limit buckets), `config.js` (browser-safe) and
`config.server.js` (secrets, `server-only`).

## 4. Files created / modified

The repository contains **212 source files**: 82 in `app/` (53 pages, 22 loading
states, layouts, 2 route handlers), 41 components, 40 library modules, 19
migrations, 8 database test suites, 6 Vitest suites, 8 operator scripts and 4
documents. Highlights of this phase:

* Created: `app/(app)/admin/{page,loading}.js`,
  `components/admin/AdminPanels.js`,
  `app/community/[slug]/page.js` (canonical deep-link alias),
  `app/(app)/{home,campus,random,settings}/loading.js`, `tests/` (6 suites +
  fixtures + server-only stub), `docs/{ARCHITECTURE,SECURITY,DEPLOYMENT,IMPLEMENTATION-REPORT}.md`.
* Modified: `lib/actions/campus.js` (added `submitOpportunity`, `saveEvent`,
  `saveNotice`, `saveCampusContent`), `lib/data/admin.js` (marketplace/gig/report
  content tables), `lib/data/moderation.js` (defensive target URLs),
  `lib/validation/schemas.js` (`status` validators), `lib/actions/admin.js` and
  `lib/actions/moderation.js` (validator imports), `lib/actions/auth.js`
  (removed a dead reference in onboarding), `lib/utils.js` (idempotent `handle()`),
  `lib/giphy/index.js` (unused catch binding), `README.md` (rewrite).

## 5. Tests added

15 Vitest suites, 193 tests. The first six were written with the original
application layer; the rest arrived with the later slices (auth/OAuth, the
bundle boundary, the contrast + readability guards, discovery, error surfaces,
the launch intro, messaging, sign-out, study posts, and the architecture
guards in `spec.test.js`).

| Suite | Covers |
| --- | --- |
| `tests/permissions.test.js` | `can()` fails closed, inactive accounts lose every permission, roles never imply permissions, `toActor()` mapping, catalogue integrity |
| `tests/validation.test.js` | every schema family: post/comment/message (text or GIF), listing (free/price/condition), event + notice status, opportunities (safe URLs), account status + duration, GIF references |
| `tests/utils.test.js` | usernames/handles, safe external URLs (rejects `javascript:`/`data:`), formatting, mention extraction and segmentation, GIF host validation |
| `tests/data-contract.test.js` | read helpers never throw, never leak raw DB errors, apply visibility filters and paging in the query, Random reports carry no participant identity |
| `tests/moderation.test.js` | moderator target map (deep links, no URL for Random, no `null` links), report/moderation target catalogues, permission keys |
| `tests/spec.test.js` | architecture guards: no AI/vector code, no uploads or images (exactly one GIF surface), no raw HTML, no presence/typing, only public `NEXT_PUBLIC_*`, secrets stay server-only, every spec route exists, loading states present, palette and "no gradients" |

Plus the 10 SQL suites (`database/tests/`) run by `npm run verify:db`.

## 6. Test results

```
tests/spec.test.js            24 passed
tests/contrast.test.js        22 passed
tests/utils.test.js           21 passed
tests/validation.test.js      20 passed
tests/auth-oauth.test.js      18 passed
tests/discovery.test.js       13 passed
tests/data-contract.test.js   12 passed
tests/permissions.test.js     12 passed
tests/intro.test.js           10 passed
tests/signout.test.js          9 passed
tests/study.test.js            9 passed
tests/bundle.test.js           7 passed
tests/moderation.test.js       7 passed
tests/errors.test.js           6 passed
tests/messaging.test.js        3 passed
────────────────────────────────────
Test Files  15 passed · Tests  193 passed
```

Database: `npm run verify:db` → *"All migrations applied cleanly and every test
suite passed."* (24 migrations, 10 suites.) `npm run audit:db` → `54 passed, 0
warnings, 0 failures`.

## 7. Lint result

`npm run lint` → **0 errors, 0 warnings** for the entire repository (app,
components, lib, scripts, tests), including the project rules `no-console`
(except deliberate warnings/errors), `no-unused-vars`, `react/no-danger` and
`react/jsx-key`.

A temporary `no-undef` pass was also run across `app/`, `components/` and `lib/`
(it found and fixed one dead identifier in the onboarding action) and then
removed.

## 8. Build result

`npm run build` → **✓ compiled successfully**: 58 page routes + 3 route handlers
and `ƒ Proxy (Middleware)`; last measured at 736 ms on Next.js 16.3.8.

* static: `/icon.svg` only — every other route is dynamic (`ƒ`), because the
  shell reads the session;
* dynamic (58): every authenticated surface and deep link — home, explore (3
  families + new + detail), market (list, new, listing detail, edit, gig detail),
  communities (list, new, detail + the `/community/[slug]` alias), campus (hub,
  utilities, noticeboard, events, clubs, lost & found, housing, rides, teams,
  study, each with `new` where students create content), chat (list + thread),
  notifications, moderator, admin, onboarding, settings, profile, rules,
  account status, setup, post/user deep links, plus `GET /api/search`,
  `GET /api/giphy/search` and `/auth/callback`.

## 9. Environment variables required

| Variable | Required | Scope |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | browser (RLS-protected) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | browser (RLS-protected) |
| `CAMPUS_ALLOWED_EMAIL_DOMAINS` | yes | server |
| `SUPABASE_SECRET_KEY` | scripts only | server (`check:env`, `seed:dev`, `role:grant`, `role:list`, `verify:security`) |
| `GIPHY_API_KEY` | optional (GIFs) | server |
| `GIPHY_CLIENT_ID`, `GIPHY_CONTENT_RATING` | optional | server |
| `NEXT_PUBLIC_PLATFORM_NAME`, `NEXT_PUBLIC_COLLEGE_NAME` | optional | browser branding |

`.env.example` documents all of them with placeholders; `.env.local` is
git-ignored and the application boots to `/setup` when the public pair is absent.

## 10. Remaining manual configuration

Deliverables 3–10 of the specification are documented in full in
`docs/DEPLOYMENT.md` (Supabase setup, migration steps, auth configuration, GIPHY,
Vercel, dev accounts) and `docs/SECURITY.md` (security checklist). The operator
still has to:

1. Create the Supabase project and set the environment variables (local +
   Vercel).
2. Apply the 24 migrations (`supabase db push`).
3. Configure the Supabase Google provider (client ID + secret), the
   site/redirect URLs (including `/auth/callback`) and the institutional domain.
4. Create the first Super Admin (`npm run role:grant -- --email … --role super_admin`)
   and, optionally, moderator accounts and dev seed accounts.
5. Register a GIPHY key if GIFs are wanted.
6. Run `npm run verify:security` against the live project, then walk the
   `docs/SECURITY.md` checklist.
7. Apply the two deliberate operator-only SQL operations when they are needed
   (role↔permission mapping changes, and approving a community-submitted resource
   or opportunity).

## 11. Genuine blockers

* **No live Supabase project is configured in this checkout.** The authenticated
  surfaces *were* walked in a real browser here (see §12), but against the local
  harness: a disposable PostgreSQL in which the real migrations and RLS policies
  run, behind a PostgREST/Supabase-Auth stub. Two scripts therefore report a
  local-environment condition rather than a product defect:
  * `npm run check:env` fails only the `NEXT_PUBLIC_SUPABASE_URL` shape check,
    because `.env.local` points at `http://127.0.0.1:3111`.
  * `npm run verify:security` passes every live probe, but its repository-hygiene
    grep matches the perf harness's deliberate placeholder secret
    (`sb_secret_perf_harness_key` in `scripts/dev/perf/lib.mjs`,
    `serve.mjs` and one command line in `docs/CONTRAST-AUDIT.md`). The value is
    not a credential — the harness stub issues it — but the grep cannot know that.
    Renaming it would only be worth doing together with the harness keys.
* **Browser verification here is headless Chromium with real CDP input**, not a
  human on a physical device (§12). Touch is synthesised `Input.dispatchTouchEvent`,
  reduced motion is media emulation, and there is no Safari/Firefox pass. Those
  remain the honest gaps in the Phase A evidence.
* **Client roles cannot change role/permission tables by design** (migration 015
  revokes `UPDATE`), and `official_resources`/`opportunities` do not grant client
  `UPDATE` on `status`. The admin UI states this explicitly and points at the
  operator SQL, so nothing silently fails. If in-UI role editing or one-click
  submission approval is required later, it needs a new migration adding
  permission-checked RPCs — not an application-layer change.
* **No AI, uploads, presence or payments exist by design.** Requests for those
  are out of scope of the product specification, not unfinished work.

---

## 12. Phase A — homepage verification pass (2026-10-13)

Scope: finish the existing Home composition — the floating islands over the depth
field, the cartographic light theme — and fix real defects in it. No part of the
composition was redesigned; every change below is either a bug fix or a comment.

Everything in this section ran against a **production build** (`npm run build` →
`next start`) reached through `scripts/dev/preview.mjs` on `:3300`, which signs a
real `@supabase/ssr` session in for `perf.student1@pccoepune.org` against the
disposable harness PostgreSQL (real migrations, real RLS, real server actions —
the composer check below writes a row and reads it back).

### 12.1 Defects found and fixed

| # | Defect | How it was caught | Fix |
| --- | --- | --- | --- |
| 1 | **Pointer depth stayed on where it cannot be felt.** The zeroing rules were a bare `.island`, which loses to the `.island[data-elevation='1'\|'2']` rules that declare the depth — so a 390 px phone still resolved `--island-depth: 2px`, and `prefers-reduced-motion: reduce` did not zero it either. | In-browser measurement: mobile and reduced-motion contexts both read `2px` before, `0px` after; desktop still reads `2px`. | `app/styles/islands.css` — both media blocks now repeat the elevation selectors. |
| 2 | **Decorative bleed grew the document.** At 390 px the layout viewport was 390 px but `documentElement.scrollWidth` was 446 px (56 px of sideways scroll; the bottom nav sat at `right: 434`); at 1440 px the document was 1640 px against a 1440 px window (200 px). The Home aurora is drawn `-20%` a side and the floating nav is inset from a fixed box; nothing bounded them. | A variant matrix (7 candidate rules × {1440, 390}) measured each option. | `app/globals.css` — `overflow-x: clip` on `html` **and** `body`. Each alone measured insufficient (body-only is propagated to the viewport and body's own box goes back to `visible`; root-only still left 200 px on desktop). `hidden` was rejected: it clamps but turns `body` into a scroll container and the sticky header scrolls away (`top: -815`). |
| 3 | **The depth field painted its palette ~15 % darker than the tokens declare.** `--cp-depth-base` in the light theme is `#e9eff8`; the canvas painted `rgb(201, 216, 242)`. Cause: `THREE.Color.setStyle()` converts sRGB→linear (three's colour management is on by default) while the renderer outputs `LinearSRGBColorSpace`, so nothing converted back. The light paper therefore read as a heavier blue-grey than designed, and the composer label on it measured 4.56:1 — passing, but with almost no margin. Softening the contours did not help (4.43 at 0.17, 4.34 at 0.11) because the contours were not the cause. | A layer probe that hid one atmosphere layer at a time and re-sampled the same pixel box: only hiding the depth field restored the neutral paper. | `components/atmosphere/depth/createDepthField.js` — `paintedColor()` converts back to display values. With that, the **original** light treatment (0.26 lines / 0.0105 fog) measures **5.72:1** on the same label, so no tuning was kept. |

The repository's own guard caught a fourth, self-inflicted problem during the
pass: `tests/contrast.test.js` failed because a code comment in
`createDepthField.js` contained a raw hex literal. The comment was rewritten to
name the tokens instead.

### 12.2 What was actually exercised (real browser input, not screenshots)

`node scripts/dev/interaction-check.mjs --url http://127.0.0.1:3300` — 18 checks,
each driving Chromium with real mouse/touch/keyboard events and asserting page
state afterwards: **18 passed, 0 warnings, 0 failures** (105 s).

| Scenario | What was performed | Observed |
| --- | --- | --- |
| Hover sweep | Real `mouse.move` onto a stream card | `::after` animation starts (`entry-sweep`, 746 px hairline); card matches `:hover` |
| Island depth | Real pointer sweeps across the island host | `--pointer-x` moved −0.570 → 0.245 and the island's transform matrix changed |
| Depth off for touch / reduced motion | 390 px touch context; `prefers-reduced-motion` context | `--island-depth` resolves to `0px` (desktop keeps `2px`) |
| Composer | Focus, type, change kind, submit | Counter 53/2000; Discussion exposes a required title and keeps the body; the post appears in the stream and the composer clears |
| Reactions | Click the reaction chip twice | `Like` → `1` with `aria-pressed=true` → back to `Like` |
| Search | Type in the shell field, submit | Lands on `/explore?q=campus` with results |
| Navigation / history | `/home` → `/explore` → Back → Forward | Returns to the same routes, `scrollY` preserved |
| Keyboard | <kbd>Tab</kbd> through the shell | Focus lands on real controls with a visible `2px solid` outline |
| Dark-only enforcement | Legacy light-preference cookie present | Still `data-theme=dark`, `color-scheme: dark`, depth field still WebGL |
| Reduced motion | Media emulation | Island animation `none`, depth `0px`, field still composed |
| Non-WebGL | `webglcontextcreationerror` path | `state=fallback`, 0 canvases, 3 CSS ridges + horizon, islands still composed |
| Touch | CDP `Input.dispatchTouchEvent` tap and 320 px drag | Tap navigated and Back returned; drag scrolled 0 → 305 px without navigating; tap focused the textarea and typed 18 chars |
| Mobile overflow | 390 px: `scrollWidth` vs `clientWidth`, plus a forced `scrollLeft` attempt | Document 390 px, sideways scroll impossible, no offenders |
| Console / network | Whole interactive session | No console errors, no failed requests, no 4xx/5xx |

### 12.3 Evidence produced

| Command | Result | Artifact |
| --- | --- | --- |
| `node scripts/dev/readability-check.mjs --url … --out ../readability-final --frames 2` | **20/20** measured pairs meet their target (10 targets × dark/light; min 4.5, gradient name min 3) | `/home/user/readability-final/` (JSON + 2 PNGs) |
| `node scripts/dev/interaction-check.mjs --url … --out ../interaction-final` | **18/18** passed, 0 warnings, 0 failures | `/home/user/interaction-final/interaction-report.json` |
| `node scripts/dev/visual-check.mjs --url … --out ../shots-final` | **11 shots**, 0 console errors (islands 4, feed 11, canvas 1; 0 canvases in the no-WebGL shot) | `/home/user/shots-final/` |
| `node scripts/dev/a11y-check.mjs --url …` | **6/6** (axe: 0 serious/critical desktop + mobile; the depth canvas is `aria-hidden`, `pointer-events: none`, not focusable) | stdout |
| `node scripts/dev/verify-signout.mjs` | **28/28** (sign-out really ends the session; no cookie or token leaked to logs) | stdout |
| `npm run lint` · `npm test` · `npm run verify` · `npm run verify:db` · `npm run audit:db` | 0 errors/warnings · 15 suites/193 tests · end-to-end pass · 24 migrations/10 suites · 54/0/0 | stdout |

The two harnesses were added in this pass and live in the repository:
`scripts/dev/readability-check.mjs` (declared-vs-painted contrast on Home, light
and dark, `--frames` and `--no-webgl`) and `scripts/dev/interaction-check.mjs`
(the 18 scenarios above). They are development tools; no product code imports
them.

### 12.4 What this does *not* prove

* Headless Chromium only. Touch is synthesised `Input.dispatchTouchEvent`, reduced
  motion is media emulation, and no physical device, Safari or Firefox pass was
  run.
* Nothing here exercises a live Supabase project or the GIPHY integration.
* The screenshots are evidence of layout at fixed viewports, not of interaction —
  the interaction table above is where the behavioural claims come from.

---

## 13. Installable, offline, batch-aware timetable (2026-10-25)

Scope: make the existing public timetable (`/timetable/[division]`, built in the
performance pass) installable per batch and genuinely usable with no network.
No new data source, no second timetable, no new surface: the feature reuses
`TimetableLive`, `lib/timetable/{schedule,clock,meta}`, the UI kit (`Button`,
`Modal`, `Notice`, `Icon`) and the design tokens, and changes no auth, no
authorization and no database behavior. The design rationale and the platform
matrix live in `docs/TIMETABLE-OFFLINE.md`; this section records what was built,
what was measured, and what was found by measuring.

### 13.1 Files

New — 4 507 lines across 17 files, plus four generated icons and one fixture:

| File | Purpose |
| --- | --- |
| `lib/timetable/batch.js` (127) | The one place a batch's identity exists: letter → route, manifest URL, API URL, app id, app/short name, labels, icons, and the scope/path constants. |
| `lib/timetable/offline.js` (379) | The snapshot contract: build from the live view model, validate on write *and* on read, checksum (FNV-1a over a canonical form), freshness windows, the `Saved copy · today 9:41 PM` wording. |
| `lib/timetable/offline-store.js` (463) | IndexedDB `campusplus-timetable-offline` v1, one record per batch, idempotent saves, settings allow-list, quota/unavailable/corruption as codes, `localStorage` fallback, durable-storage request. |
| `lib/timetable/sw-policy.js` (256) | The cache decision as pure data: what may be cached, under which key, in which named versioned cache, what gets pruned, and which URLs a document names. |
| `lib/timetable/sw-entry.mjs` (380) | The worker: precache the shell, network-first documents, cache-first immutable assets, `cp:*` message API, `clients.claim()`, the shell readiness sentinel, the inline last-resort notice. |
| `scripts/build-sw.mjs` (88) | Bundles the entry + policy into `public/timetable/sw.js` with esbuild; `--check` fails a build whose committed worker has drifted. |
| `lib/timetable/offline-install.js` (385) | Platform plumbing: platform/standalone detection, silent `beforeinstallprompt` capture and its outcomes, `appinstalled`, worker registration with scope fallback, the worker round-trip helper, and the chip copy. |
| `components/timetable/TimetableOfflineProvider.js` (556) | The state machine and the only writer: load-local-first, consent-gated refresh, prepare-then-install, controlled update, remove. |
| `components/timetable/TimetableOfflineUi.js` (448) | The card, the header chip and the bottom sheet — plus `primaryAction()`, a DOM-free table of the eight button states. |
| `components/timetable/TimetableOfflineShell.js` (215) | The offline app shell: the same `TimetableLive` view rebuilt from IndexedDB, saved-batch switcher, plain anchors. |
| `app/timetable/offline/page.js` (32) | That shell as a static route. |
| `app/timetable/manifest/[division]/route.js` (95) | One manifest per batch (18), `dynamicParams = false`, no session, no database. |
| `app/api/timetable/[division]/route.js` (60) | The snapshot endpoint, public like the page, ETag = checksum, immutable-asset-friendly caching, never `private`. |
| `scripts/dev/timetable-icons.mjs` (181) | Generates the 192/512 and maskable launcher icons from `logo.jpeg` (no artwork invented). |
| `scripts/dev/timetable-offline-check.mjs` (421) | The browser gate — §13.3. |
| `scripts/dev/timetable-fixture.mjs` (38) | Re-captures the fixture the asset-extraction test asserts against. |
| `tests/fixtures/timetable-document.html` | Real production markup, so `extractAssetUrls` is tested against what Next emits. |

Modified — 8 files, 719 insertions / 30 deletions:

| File | Change |
| --- | --- |
| `app/timetable/[division]/page.js` (+79) | Wraps the page in the provider, passes `offlineSlot`, renders the card and the sheet, and adds per-batch `metadata` (`manifest`, `appleWebApp`, `alternates.canonical`). |
| `components/timetable/TimetableLive.js` (+9) | One new optional `offlineSlot` rendered inside the header, plus trailing `children`. Nothing else moved. |
| `app/styles/timetable.css` (+579) | `.tt-offline*`, `.tt-install*`, `.tt-sheet*`, `.tt-shell*`: glass card, chips, step list, keyframes, safe-area and reduced-motion blocks. Tokens only — no colour literal, no `!important`. |
| `app/timetable/layout.js` (+24) | `viewport` export for the subtree: `viewportFit: 'cover'` and `themeColor` from the shared constant. |
| `components/ui/icons.js` (+8) | Three glyphs: `install`, `shareIos`, `wifiOff`. |
| `next.config.mjs` (+23) | `Service-Worker-Allowed: /` and `no-cache` for `/timetable/sw.js`. `X-Frame-Options: DENY` untouched. |
| `package.json` (+9) | `prebuild`/`sw:bundle`/`sw:check`, `brand:timetable-icons`, `verify:offline`, and `sw:check` added to `verify`. |
| `tests/spec.test.js` (+18) | The colour guard: two blessed chrome-colour files instead of one, and the mirroring of `--cp-bg-page` is now asserted for both. |

### 13.2 Install behaviour, per platform

Chromium's prompt is the only one that can be scripted, so it is the only one
whose *outcome* is asserted; everything else is asserted at the decision layer
and measured in a real browser where a real browser can be driven here.

| Platform | Measured here | Behaviour shipped |
| --- | --- | --- |
| Headless Chromium (production build, clean profile) | worker registered, scope `http://127.0.0.1:3100/`, `activated`, controlling the page; `beforeinstallprompt` **never offered**; `appinstalled` never fired | Button correctly took the guide path — no fake dialog, no false "Added". `verify:offline` asserts exactly this and reports the prompt's absence instead of failing on it. |
| Android Chrome / desktop Chrome / Edge | not reachable from this sandbox | `prompt()` on a deliberate click only, `userChoice` → `Waiting…` → `Added to Home Screen` / `Installation dismissed`, `appinstalled` as the sole evidence. Per-batch icons are separate apps because manifest `id` *and* `start_url` differ per batch. |
| iOS (Safari, and any other browser there) | not reachable from this sandbox | No `beforeinstallprompt` by design; the save is written first, then the browser's own Share → Add to Home Screen sheet naming the batch, with `appleWebApp` metadata (title, status bar, `theme-color`) carrying the batch name. |
| Firefox (any), other browsers | not reachable from this sandbox | `manual` path: the sheet points at the install item in that browser's own menu, or says there is none. Never claims an install. |

**Required platform follow-up:** one pass on a real Android device and one on iOS
Safari against the deployment — the only way to see the native prompt and a
launched icon. Nothing in this repository claims those results.

### 13.3 Verification

| Gate | Result |
| --- | --- |
| `npm run lint` | clean |
| `npx vitest run` | **713 tests / 60 files, all passing** (118 new; the pre-existing timetable, live-render, public-cache and architecture-guard suites untouched and green) |
| `npm run sw:check` | worker current with `lib/timetable/` (15.1 kB) |
| `npm run build` | success, 85 static pages, `/timetable/[division]` × 18 prerendered, `ƒ` for the dynamic metadata |
| Live route probes | `/api/timetable/o` 200, 10 959 B, `public, max-age=300, s-maxage=86400, swr=604800`, ETag `07c0b9b4`; `/timetable/manifest/o` `application/manifest+json` 1 427 B with `id/start_url/scope` as designed; `/timetable/sw.js` 200 with `Service-Worker-Allowed: /` |
| `npm run verify:offline` | **51 / 51** — see below; includes a cold start (every page closed, worker retired, still offline) and a simulated private profile where worker registration is rejected |

The browser gate (`scripts/dev/timetable-offline-check.mjs`, real Chromium against
the production build, clean profile, network toggled with
`context.setOffline`) — the load-bearing results:

| Step | Measured |
| --- | --- |
| First visit | nothing written before the student taps save; button reads `Save timetable for offline use` |
| Save Division O | one IndexedDB record, 30 events, 10 886 bytes, schema v1, checksum `07c0b9b4`; button relabels to `Add Division O (IT) timetable to Home Screen`; chip `Offline copy ready · saved today <time>` |
| Cache hygiene | `campusplus-timetable-{core,assets,documents}-v1` only; `/timetable/o` cached, `/timetable/j` not; `/home`, `/login`, `/admin`, `/api/messages/sync`, `/api/timetable/o` **all absent** |
| Offline reload | `Division O · 7 rows`, first row `WDL-1/ENG-2/WDL-3`; five weekday tabs walked (7,6,7,8,7 rows); chip `Saved copy · today <time>`; today-marker and NOW/NEXT agree with the campus calendar (Sunday → no marker, no invented class); zero page errors |
| Back online | same rows; the refresh did not empty or reorder anything |
| Unsaved batch, offline | `Nothing saved for this timetable yet · Division B (Mech)` — not a blank page, not an error boundary |
| Second batch, then **both documents deleted from CacheStorage** | shell rebuilds `Division J · 8 rows` from IndexedDB at `/timetable/j`, while `Division O` still renders as itself; checksums independent (`J:bd7262ab`, `O:07c0b9b4`) |
| Cold start (every page closed, so the worker is retired, still offline) | a new page in the same profile renders `Division O · 7 rows` from disk, a cold worker takes control, the chip still reports the age, no page errors |
| Worker registration blocked (`NotAllowedError`, as in a private profile) | the save still lands in IndexedDB, the page still renders, the action is not stuck, and the chip says "this browser would not keep the page files" |
| Placement | `/timetable` index and `/login` carry no pill and no card |
| Keyboard / motion | Tab reaches real controls; Enter opens the sheet naming the batch; Escape closes it; reduced motion resolves the pill transition to 0.001 ms and the spinner animation to `none`; the card keeps 20 px bottom padding for a notched phone |
| Storage | 1 703 kB used for the whole feature on the device (two batches plus shell and chunks); durable grant reported as not granted — the browser's call, stated as such |

### 13.4 Defects found by testing the real app

Four of the bugs below are invisible to any unit test, and all four were caught
only by driving the built app:

| # | Defect | Caught by | Fix |
| --- | --- | --- | --- |
| 1 | **The worker never registered**, so nothing was cached and *every* offline symptom downstream looked like "offline is broken". `workerAllowed(env = process.env)` read an empty object: Next inlines only literal `process.env.X` references, so a bare `process.env` in a browser bundle is `{}`. | `caches` empty + `registration: null` in the first browser probe | Read `process.env.NODE_ENV` once at module scope in the provider and pass the boolean (`workerAllowed(production)`). Also satisfies the `react-hooks` purity rules that a per-render read violated. |
| 2 | **An offline reload rendered nothing.** The document was cached, its lazily-imported chunk was not: `ChunkLoadError: Failed to load chunk /_next/static/chunks/0-wioiv3vk8my.js`, shown as an error boundary — a blank page where an honest notice belongs. | Forced offline reload of the just-saved page (`items: []`, `pill: NONE`) | Three changes: a document is cached *with* every build asset its own markup names (`extractAssetUrls`, re-read each save — never a hand-written list); the worker `clients.claim()`s so the installing tab's later chunk loads are cache-first; and the shell fallback is gated on a readiness sentinel, so an incomplete shell yields text instead of a blank screen. |
| 3 | **The hidden-iframe warm-up trick does not work here.** Campus+ sends `X-Frame-Options: DENY` on every production route, so the frame was refused. | The probe's console (`Refused to display … in a frame`) | The header was *not* weakened. The worker fetches the shell itself instead (`cp:precache-shell`). |
| 4 | **Two honesty bugs in the copy.** `Intl` with `hourCycle: 'h12'` plus a manual AM/PM printed `9:07 AM` for 21:07; and a mount-time refresh wrote a saved record (with a "last synced" time) for anybody who merely opened the public page. | Live probe output, and the consent-gating review | `hourMinute12` takes `h23` and converts; the first write now requires the explicit action (`savedRef` gate in `refresh()`), asserted in the browser gate as "nothing was written to the device before the student asked". |

A fifth hardening came from review rather than measurement, and is now an
asserted invariant: every cache touch in the worker goes through `openCache` /
`listCaches`, each of which swallows a rejection. A profile with `CacheStorage`
denied (private browsing, site data blocked) therefore degrades to "nothing was
cached" instead of turning a navigation that would have succeeded online into a
failed one — `tests/timetable-offline-ui.test.js` pins that `caches.open` appears
exactly once in the worker source, and `verify:offline` §6 exercises the case.

The sixth, found by the unit suite rather than the browser: `buildSnapshot` threw
`RangeError: Invalid time value` on an unparseable upstream `generatedAt` — a
malformed API payload could have failed the whole save. Timestamps now go
through `isoOrNull`, and the snapshot test pins the degradation ("build time
now, checksum unchanged").

Two design rules the repository already enforced turned out to be load-bearing
here, and both were extended rather than bypassed: the contrast/spec guards
forbid a colour literal in any page, so the PWA colour became one shared constant
that `tests/spec.test.js` now *asserts* mirrors `--cp-bg-page` (the pre-existing
`app/layout.js` literal had never been checked against the token — it now is);
and `PUBLIC_PATHS` prefix-matching on `/timetable` is what let the worker, its
manifests and its offline shell be public without touching proxy auth at all.

### 13.5 Known limits (stated, not fixed)

* No device verification of the native prompt or a launched icon (§13.2).
* The offline copy is as permanent as the browser's storage: no durable grant can
  be promised, and an uninstalled iOS web app's storage can be evicted. The UI
  says "saved", never "guaranteed", and always shows the save time.
* `X-Frame-Options` remains `DENY` (unchanged); the shell is warmed by the
  worker, not by a frame.
* The Vercel `CRON_SECRET` item in §10 of `docs/DEPLOYMENT.md` is a **backup**
  follow-up and is untouched by this work; `/api/messages/sync`'s separate 503
  issue is likewise untouched and unmasked.
* No database, migration, RLS or permission change was needed or made: the
  timetable is public, and it stayed exactly as public as it was.

### 13.6 Cross-browser install copy (same day, after review)

The guide shipped with three sentences that only made sense in one browser: the
primary button on iOS said `Add to Home Screen from Safari`, the first iOS step said
`Open this page in Safari itself`, and desktop WebKit was told to use
*File → Add to Dock* on macOS. The behaviour underneath was already cross-browser;
the copy was not. What changed, and what deliberately did not:

| Changed | To | Why it is still true |
| --- | --- | --- |
| `primaryAction` for `installPath === 'ios'` | the iOS branch is gone; iOS now falls through to the same guide label as every manual path | the button already opened instructions rather than calling an API, so the label had no platform fact in it |
| first step of the iOS guide | `Open this page in the browser app itself — a link tapped inside another app usually lands in a view with no Share button.` | the fact worth telling is about in-app web views, not about Safari |
| `STEPS.safari` (macOS *File → Add to Dock*) | deleted; desktop WebKit now shares `STEPS.other` | a group whose only content is one vendor's menu is a support page, not guidance |
| `STEPS.other` | *look for the install item, every browser names it differently, some offer no such item; and if there is none the offline copy is already on this device* | states the variability instead of denying it, and ends with what the user has already got |
| `detectPlatform` labels on mobile | `Safari on iPhone or iPad` → `iPhone or iPad`, `Chrome on Android` → `Android` | those labels are printed in the status sheet; on iOS every browser is WebKit with the OS Share sheet, so naming one was wrong as often as it was right |
| `stepsFor` | exported, and the `safari-desktop` case removed | so the copy is asserted per platform rather than eyeballed |

Kept, because it is compatibility code and not copy: the whole of `detectPlatform`
including the iPad-reports-as-Mac case, `isStandalone`'s `navigator.standalone` check
beside `display-mode`, the `ios`/`native`/`manual` install-path mapping, the
`unsupported` outcome when `beforeinstallprompt` was never offered (which is what makes
the no-prompt path a guide instead of a dead button), the wide-scope-then-`/timetable/`
service worker registration fallback with its `Service-Worker-Allowed` header — whose
comment still says Safari ignores that header, because that is the reason the fallback
exists — and every `-webkit-*` / `@supports not (backdrop-filter)` rule in
`app/styles/timetable.css`.

Two mentions of a browser are left on purpose. `Safari on desktop` is still a
*detection result* shown in the status sheet: on desktop the user-agent test really does
single the browser out (it is the last branch, after Chrome/Edge/Opera/Firefox), and the
name there is the platform, not an instruction. And `components/auth/LoginForm.js` plus
`lib/auth/sign-in.js` still describe the iPhone-WebKit callback-race they work around;
that is auth code, outside this task, and the comment is the workaround's rationale.

The Chromium group's glyph hint became `(⋮ or ≡)` for the same reason: `kind: 'android'`
shares that group with desktop Chromium, and Firefox on Android opens its menu from the
other icon.

Pins: `tests/timetable-install-plumbing.test.js` now asserts a guide may name only the
browser it is written for, that no group contains `Safari`, `File →` or
`Add to Dock`, that every platform gets at least two non-empty steps, that
`safari-desktop` and `unknown` share one group, and that no button label names a browser
at all. `scripts/dev/timetable-offline-check.mjs` asserts the same two properties against
the rendered dialog in a real browser. The copy change was verified in headless Chromium
against the production build, which is the only browser reachable from this sandbox: the
sheet's text and the button label were read from the DOM, not from the source file. A
physical iPhone, iPad and a real Firefox/Edge pass remain unverified — and no gate here
can prove a tap a page cannot make.

### 13.7 The prompt itself, made to work on phones (2026-10-26)

The brief was not "redesign the button": it was to find out why an install prompt was
not working on mobile and fix the handling. Four defects were found, and the button's
design was not one of them.

**1. The capture could simply miss.** `watchInstallPrompt` was attached in a mount
effect, and Chrome fires `beforeinstallprompt` when *it* decides — after it has a
fetched service worker and a parsed manifest, at any point in or after load. There was
no buffer, so an early event was gone: the card then had `hasPrompt: false`, and an
Android Chrome user was handed the manual guide (or nothing) instead of the native
action. Fix: `parkInstallPrompt(window)` runs at **module scope** in
`components/timetable/TimetableOfflineProvider.js`. That listener prevents the default
(the strategy, below), counts the event on `window.__cpInstallPromptSeen` and parks the
event object; `watchInstallPrompt` drains the park on attach and clears it before
delivering, so one native event is delivered exactly once however many listeners come
and go. An inline `<script>` in `app/timetable/layout.js` would be marginally earlier
and was rejected: `eslint.config.mjs` sets `react/no-danger: 'error'` site-wide
(`tests/spec.test.js` re-asserts it), and this project does not carve an exception out
of that rule for one convenience — and it does not need to, because Chrome cannot fire
the event before this page's own script has registered a worker.

**2. The worker was registered too late to help.** Registration sat behind the
IndexedDB/settings read in the same effect, so the very condition Chrome checks for its
own promotion was the last thing to happen. Registration now happens in the first
effect, next to the capture; the storage read stays where it belongs. There is still
exactly one `registerTimetableWorker` call site and one install-listener site, and the
architecture guard in `tests/timetable-offline-ui.test.js` is what keeps it that way —
it failed loudly while a comment in the provider spelled the event name out, which is
the guard working.

**3. Nothing on a phone ever reached the card.** The card lives below a week of
timetable, so `installOfferDecision` (pure, unit-tested) was added and the offer sheet
now opens itself once per page view on a phone-shaped device, and refuses to on every
other one: installed, recently accepted (180 days), recently declined (30 days), sheet
open, preparing, offline with nothing saved, still hydrating, no batch. `isMobileFormFactor`
asks for a coarse pointer or a touch-capable narrow viewport, so a 412 px desktop window
is not interrupted. `TimetableInstallOffer` is the existing `Modal` with the existing
`Button`, so there is one install action per screen and no second dialog; the sign-in
state is never consulted, and the timetable behind it stays interactive once it is
dismissed.

**4. The install assets were behind the auth proxy — found by fetching, not reading.**
The manifest named `/brand/timetable-*.png` and `/apple-icon.png`; against the built
app, signed out, every one of those returned `307 → /login?next=…`. Chrome that cannot
read its icons does not offer an install, and iOS puts a screenshot on the home screen.
`tests/timetable-offline-identity.test.js` had a test called "is served under the
public `/timetable` prefix, so no proxy change is needed" and it passed — because it
only ever looked at the manifest, never at what the manifest points at. The fix follows
that test's own rule instead of weakening it: `public/timetable/install/*.png` (via
`npm run brand:timetable-icons`), plus segment metadata `app/timetable/icon.png` and
`app/timetable/apple-icon.png` (via `npm run brand:icons`), all inside the already
public prefix; `proxy.js` was not touched, and the `tests/contrast.test.js` pin that
forbids `/brand/` in the public list still holds. The manifest `id`, `scope`,
`start_url` and per-division names are unchanged, so installs already on phones are not
orphaned; the service worker precache list moved with the files and `SW_CACHE_VERSION`
was deliberately not bumped, for the reason written next to that list.

**The strategy, in one sentence: capture the event, suppress Chrome's own promotion, and
expose the native dialog through one clearly labelled action.** `preventDefault` in the
capture is what stops the infobar/badge and the custom sheet from competing; the cost is
the address-bar install button, so the guide names the browser's own menu item as the
alternative. `prompt()` is called from one place, `showInstallPrompt(event)`, reached
only from a click inside the sheet or the card — never on load, never from a timer,
never from the capture — and the event is dropped as soon as it is spent. Nothing
promises a dialog it cannot open: `offerAction` labels the button `Install app` only
when a captured event exists, otherwise `Show installation steps`, and `offerSummary`
says which of the two worlds this is. iOS gets the Share-sheet path with no claim of a
web API, Firefox on Android gets its own menu wording, and no group of instructions is
written for a browser the user was not detected in.

Pins, and the parts a unit test cannot reach: `tests/timetable-install-offer.test.js`
(12 assertions) evaluates the real route handler — the served manifest must carry
`id`/`name`/`short_name`/`standalone`/`start_url`-in-`scope`, 192 and 512 PNG icons plus
maskable variants, a 404 for an unknown division, and each named file must exist on disk
at the size its IHDR claims; the worker's message names must be sent *and* handled;
`SETTING_KEYS` must list `installOfferDismissedAt` and `installAcceptedAt`, or the
dismissal silently never persists. `tests/timetable-install-plumbing.test.js` grew 12
more: park adoption and its once-only delivery, `isMobileFormFactor`'s six shapes,
`installOfferDecision`'s every deny path including a clock that went backwards and a
corrupt stamp, and `offerAction`/`offerSummary` refusing to over-promise.

`npm run verify:offline` grew from 51 checks to 97, and section 9 is a real Chromium
driving the phone flow against the production build: the offer opens itself and is the
only surface on screen; its action saves the week (asserted in IndexedDB, division `O`)
and then swaps to the steps in the same dialog; closing the steps is not a refusal, so
the offer returns after a reload, while "Not now" is honoured across a reload
(`data-offer: dismissed-recently`); an emulated installed iOS app is never asked; a
dispatched cancelable `beforeinstallprompt` is `preventDefault`ed, adopted without a
reload, changes the wording to the Chrome one, and `window.__promptCalls` is `0` before
the click and `1` after it — with the acceptance closing the sheet, the card flipping to
"Added to Home Screen" + disabled, and the next visit reading `installed-recently`.
Finally every icon is fetched with `redirect: 'manual'` and must answer `200 image/png`
signed out — the check that failed on the `/brand/` paths and is the regression test for
this whole class of bug. 97/97, exit 0; `npx vitest run` 829/829; `npm run lint` clean;
`npm run sw:check` current after regeneration.

What is still not proven here, and is not claimed anywhere in the UI: that a real
Android Chrome *decides* to offer this install. This sandbox has no display server and
`scripts/dev/browser.mjs` forces `headless: true`; headless Chromium never fires the
event on its own, so the event is dispatched by the test — which proves the page's half
(capture, suppression, single click, spent event, persisted answers) and nothing about
Chrome's judgement. `appinstalled` is likewise answered by the test, not by a launcher.
Real iPhone/iPad Safari, iPadOS-as-Mac, Firefox on Android and a physical Pixel install
remain post-deploy checks; the copy for each is what the built app renders, verified per
user-agent in §13.6, and no gate can verify a tap the page cannot make.

## 14. Feed refresh and instant post visibility (2026-10-25)

Scope: a post that saved successfully did not appear in the feed that was already on
screen — not for its author, and not for anybody else — until the student reloaded or
navigated back. The fix had to be the cause, not a reload button. No second post
system, no new cache library, no widened database permissions, no service-role key
in the browser, and no moderation or RLS bypass anywhere in this change.

### 14.1 Root cause, in the order it mattered

The whole pipeline was read before anything was changed: composer → server action →
insert → feed read → cache → live layer. Five independent defects were found, and all
five were real:

1. **A dead seam, and nothing else was left.** `HomeFeedClient` passed
   `onCreated={() => void refresh(true)}` to `PostComposer`; `PostComposer` never
   declared an `onCreated` prop and never called it. Home's feed lives in client
   state, fetched from `/api/home/feed`, so the only mechanism that could have
   updated it was wired at one end only. `router.refresh()` — which is what the
   shared `useFormAction` calls after any successful action — re-runs a server
   component that holds no feed data, so it could not help either.
2. **Nothing to insert even if something had asked.** `createPost` returned
   `{ ok: true, id }`. A surface that wants to show the post immediately needs the
   canonical record; with only an id, the alternative was a client-built stub, which
   `StreamItem` renders as `null` (`if (!post) return null`) — a card that appears
   empty and then vanishes. That is why "optimistic UI" was not an option here in
   its usual form.
3. **A remembered page that was allowed to be wrong.** `homeFeedCache` serves Home's
   last page for 15 s after a remount. Nothing in the write path patched or
   invalidated it, so a client navigation back onto Home could serve a snapshot that
   predated the post with no network request at all.
4. **Nobody could hear about anybody else's post.** `public.posts` was not a member
   of the `supabase_realtime` publication — migration 014 added only `messages`,
   `conversations`, `message_reads` and `notifications` — and no client subscribed to
   post changes at all. Postgres only streams tables in that publication, so no
   amount of client code could have received a new-post event. Separately, a private
   channel on a `feed:<id>` topic had no branch in the `realtime.messages` read
   policy, whose `case` ends in `else false`, so such a channel could not even be
   joined.
5. **Invalidation that stopped at two doors.** `revalidateFeed()` covered `/home` and
   `/explore` only. Community boards, club boards, profile post lists and the
   permalink are server-rendered and were relying on the client's router state.
   And `getCampusFeed` ignored the `currentProfileId` that `app/api/home/feed`
   already passed it, so a Home card could never show the viewer's own reaction or
   poll vote — one more way an instantly-shown post looked different from a loaded
   one.

So: the write was never a publication *signal*, the client had no record to show, the
cache had no invalidation, the database had no delivery, and the invalidation that
did exist covered two of seven surfaces.

### 14.2 What was built

New — one shared rule module, one realtime module, one shell provider, one board
bridge, one migration, one SQL suite, one browser harness check:

| File | Purpose |
| --- | --- |
| `lib/social/feed-state.js` (242) | The feed's state transitions as pure data: sort key (`sortAt` → `createdAt`, which is what keeps a pinned notice above a new post), canonical-`post:<id>` dedup across every delivery path, placement, removal, `reconcileFeed`, `isCampusFeedEligible` (published **and** not community-scoped — the two predicates `campus_feed()` applies), and `createFeedDeduper`. Client-safe, no I/O. |
| `lib/social/realtime.js` (92) | One private channel per signed-in student (`feed:<profile id>`, `config: { private: true }`), three `postgres_changes` bindings on `public.posts` only, and an auth hand-off. It hands the surface `{ eventType, postId, status }` — never the row. |
| `components/layout/LiveFeedProvider.js` (235) | Shell-scoped: owns the one channel, batches events (450 ms), exposes `subscribe`, `invalidate(reason, ids)` and a `revision()` counter. Holds no post data. A 20 s gap-recovery tick runs **only while the channel is not live**. |
| `components/social/LiveFeedSync.js` (76) | Renders `null`. For a server-rendered board, turns a feed change into one `router.refresh()` (4 s throttle; immediate for `local`/`reconcile`/`reconnect`). |
| `supabase/migrations/20261026000001_029_feed_realtime_delivery.sql` (112) | Adds `public.posts` to the publication and re-creates `campus_channels_read` with a `feed` branch. Guarded, idempotent, no trigger, no outbox, no grant or revoke. |
| `database/tests/15_feed_realtime_delivery.sql` (292) | Publication membership and scope; channel authorization (own `feed:` channel joinable, another student's empty, broadcast denied, existing topics unaffected); and the visibility rules the client mirrors — published vs pending/hidden/community/blocked, plus "the author can still read their own unpublished row". |
| `scripts/dev/feed-refresh-check.mjs` (379) | The production-build browser gate — §14.4. |

Modified — 15 files, 464 insertions / 77 deletions, plus the regenerated
`supabase/bundle/campus-plus-schema.sql`. The important ones:

| File | Change |
| --- | --- |
| `lib/actions/social.js` | `createPost` now reads its row back with `POST_COLUMNS` and runs it through `hydratePosts`, returns `{ ok, id, status, published, pending, post }`, and mints the id server-side so a write is never reported as failed because an endpoint returned no representation. `revalidateFeed({ postId })` invalidates `/home`, `/explore`, `/profile`, the three dynamic board patterns and the permalink — **after** the write, and never on a failed one. Delete and restore revalidate the same set. |
| `components/home/HomeFeedClient.js` | `applyCreatedPost` places the canonical row (eligibility-guarded), patches the remembered page under the same dedup/order rules, holds the entry for at most 30 s so a slow revalidation cannot flicker it out, and then invalidates once. Live events re-read through the same path; a `removed` announcement is applied to the window and released from the hold. |
| `components/home/homeFeedCache.js` | Writes and patches carry the shell's live `revision`; a page may only be served while that revision still matches, which is what makes a page stale the instant a post lands — including while Home is unmounted. TTL unchanged (15 s). |
| `components/posts/PostComposer.js` | Accepts `onCreated`, and clears body/GIF/options/`form.reset()` only in the success callback, so a failed write keeps the draft. A `pending`/`hidden` result shows a bounded "sent for review" notice instead of pretending publication. `loading={pending}` + `canSubmit` keep a double submit out. |
| `components/posts/PostActions.js` | Announces `removed`/`local` through the provider instead of threading callbacks up from every card. |
| `lib/data/feed.js` | `POST_COLUMNS` exported; `getCampusFeed` honours `currentProfileId`. |
| `components/layout/AppShell.js`, `app/(app)/layout.js` | `feedUserId` (the profile id) into `LiveFeedProvider`, keyed by it, inside `MessagingProvider`. |
| five board pages | `<LiveFeedSync />` mounted on Explore, profile, community, club and public-profile pages. |

Semantics kept, not approximated: an insert is not a publication. Public feeds filter
on `status = 'published'`, `deleted_at is null`, the audience rule, and the
block/mute/inactive author rules — the same predicates `campus_feed()` applies, and
`isCampusFeedEligible` refuses to place anything the shared read path would not
return. Realtime payloads are treated as signals and re-hydrated through
`lib/data/feed.js`, so an instant post and a loaded post are produced by one code
path.

### 14.3 What was found by running it, not by reading it

The first real-browser pass against the production build failed with
`The post could not be read back after saving.` The insert had succeeded — the post
was in the database — but the write endpoint answered `201` with an empty body, so
`.select(...).single()` gave nothing back. A real PostgREST returns the representation;
a fronted or proxy-configured one may not, and in that situation the honest answer is
not "your post failed". `createPost` now mints the id in the action, reads with
`maybeSingle`, and re-reads the row by that id if no representation came back — one
canonical record, one source, no client-built placeholder. Unit-tested, and the
browser pass passes.

### 14.4 Verification

| Gate | Result |
| --- | --- |
| `npm run lint` | clean |
| `npx vitest run` | **794 tests, 64 files** — 80 of them new (`post-create-feed`, `feed-live-state`, `feed-realtime`, `feed-instant-update`) |
| `npm run verify:db` | 29 migrations applied cleanly; **all 15 SQL suites pass**, including `15_feed_realtime_delivery.sql` |
| `npm run audit:db` | 66 passed, 0 warnings, 0 failures |
| `npm run db:bundle -- --check` | bundle current (29 migrations) |
| `npm run sw:check`, `npm run build` | clean; every route compiled |
| `node scripts/dev/feed-refresh-check.mjs` | 14 checks passed against `next start` + the harness database — see below |

The browser gate runs the production build with two signed-in Chromium contexts and a
real PostgreSQL behind real RLS. Observed on this machine:

```
ok  author: post appears with no reload or navigation    one copy in 2.5s · no reload · view kept at 0px
ok  author: the card is a complete post, not a placeholder  “Aarav Patil @aarav_p · just now …”
ok  author: composer cleared only after the server confirmed
ok  viewer: discovers the post with no manual reload     one copy in 32.1s · no reload
ok  viewer: one copy survives repeated invalidation
ok  moderation: a hidden post leaves both open feeds     36.1s / 0.0s
ok  moderation: a pending post never enters an open feed
ok  community board: appears on the open page without a reload (server-rendered)
ok  community post is never placed on the campus feed
ok  failure: no false success, draft preserved, retry works
ok  no polling: an idle open feed stops reading          ≤1 read in 24s
```

"No reload" is measured, not asserted: each page carries a document marker that a
reload destroys and `router.refresh()` cannot, and the scroll offset is compared
before and after placement. Duplicate delivery is checked by firing extra
invalidations (focus, repeated re-reads) and requiring one copy.

### 14.5 What this run could not prove

* **Live websocket delivery.** The harness stub implements PostgREST and the auth
  endpoints but no Realtime websocket, so the cross-user numbers above are the
  *degraded* path (gap recovery, ≤ 20 s + a coalesced read) — deliberately, since a
  feed must still converge when Realtime is unavailable. The half that Realtime itself
  depends on — publication membership, and who may join a `feed:` channel — is
  verified against real SQL in suite 15, and the client's bindings, `private: true`,
  cleanup and reconnect behaviour are unit-tested against a fake channel.
* **Production itself.** Nothing here was run against the deployed project; the
  migration and the bundle still have to be applied (Supabase SQL editor, or
  `supabase db push`). On hosted Supabase the publication already exists and the role
  applying migrations owns `public.posts`, so `alter publication … add table` runs;
  where it does not, migration 029 reports that in a `NOTICE` and names the statement
  to run as the table owner instead of failing a deploy over a delivery optimisation.
* One pre-existing, unrelated staleness: `npm run perf:smoke` expects the strings
  `Campus update` / `Events ahead` in `/home`'s server HTML. Neither is in the
  Home components at `main` either (the rail is client-rendered), so that check fails
  before and after this change. `/home` was verified separately: composer,
  skeleton, provider and a 200 `/api/home/feed` with 10 items in the served HTML path.

### 14.6 Files to know about later

`lib/social/feed-state.js` is the only place a feed's ordering, dedup and placement
rules live; `components/layout/LiveFeedProvider.js` is the only owner of a feed
subscription; `scripts/dev/feed-refresh-check.mjs` (`npm run verify:feed`) is the gate
that proves the workflow rather than the mock. A future surface that lists posts
should reuse all three — the reason `LiveFeedSync` renders nothing at all is that any
surface with its own copy of the rules is a surface that can drift from the read path.

## 15. `permission denied for function can_access_random_session` (2026-10-25)

Scope: the production Postgres log was dominated by one error. Nothing about the site
looked broken to a student, which is exactly why it needed a root cause rather than a
grant.

### 15.1 What the log said, and what it was worth

| Measurement | Value |
| --- | --- |
| Entries in the exported window | 815 of 1 000 (81.5 % of the log's content) |
| Message | `42501 permission denied for function can_access_random_session` |
| Cadence | ≈ every 15 s while the site is in use, i.e. ≈ 240 lines per hour per stale client |
| Second symptom, correlated | `08P01 unexpected EOF on standby connection` |
| Cost per authorization attempt, measured locally | 0.23 ms failing vs 0.19 ms clean denial (+0.04 ms, ~23 %) |

That last row is the reason this section does not claim to have fixed slowness. The
failing path is a fraction of a millisecond per attempt at a 15-second cadence, and it
is not on any request path a page takes — see 15.2. What it does cost is observability
(4 of every 5 log lines were this error), a subscription that never succeeds, and a
socket that is torn down and reopened forever.

### 15.2 The caller, traced

`can_access_random_session(p_session, p_user uuid default null)` is defined in migration
010 and referenced by exactly ten things, all found by grepping the whole schema and the
whole app:

* the two `realtime.messages` private-channel policies — `campus_channels_read`
  (migration 014, recreated by 029) and `campus_channels_write` (014) — call it once per
  joined channel, from their `when 'random' then …` branch;
* six SECURITY DEFINER Random RPCs in 010 (`end_random_session`, `random_session_state`,
  `send_random_message`, `report_random_session`, `purge_random_data`,
  `sweep_random_state`) call it as the function owner.

Realtime — not the application — evaluates the first group. So the caller is a client
subscribing to `random:<session uuid>`, and the *why now* is migration 023: Random Chat's
UI was retired, so nothing in the shipped app opens such a channel any more. Verified: the
only three `.channel(` call sites in `app/`, `components/` and `lib/` are `user:`,
`conversation:` and (since 029) `feed:`; there is no `/api/random` route, and
`lib/actions/random.js` is imported by nothing. The requests therefore come from clients
that predate the retirement — a tab left open, a Router/prefetch cache, any long-lived
socket that reconnects to what it had. Realtime re-runs the channel policy on every
(re)subscribe, and the client retries on its own backoff. That is the 15-second clock:
not a poll this repository contains, but a reconnect loop it cannot see.

A `false` from the policy would be a clean denial. An exception is a log line, a failed
subscription and a reconnect — and the exception happened because the role evaluating the
policy does not hold EXECUTE on that function.

### 15.3 Production ACLs versus the repository's history

They disagree, and that is the finding:

* the history *grants* it — migration 018 loops over every function in `public`,
  revoking from `public`/`anon` and granting to `authenticated` + `service_role`, so a
  database built from these files has `authenticated` able to execute the helper;
* no migration after 018 revokes it (019–029 checked; 022 changes view options only, 023
  is one `feature_flags` row);
* production therefore has an ACL that its migration history cannot produce. Migration
  022 documents an earlier live change of exactly that kind — made in the project, not in
  `supabase/migrations/` — so this repository already knows its production schema drifts.

This could not be confirmed from here: there is no route to the production database or the
Realtime logs from this sandbox, only the exported log lines. `supabase/migrations` and
`database/tests` are the source of truth for the schema, and the drift is the reason the
fix below stops *depending* on a grant nobody owns instead of re-asserting it. To compare
the two directly, run this read-only query in the Supabase SQL editor and diff it against
`npm run audit:db`'s four `Realtime` checks:

```sql
select p.oid::regprocedure as function, p.proacl as acl,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('can_access_random_session', 'can_access_own_random_session');
```

### 15.4 The fix

Migration 030, in this order:

1. **A safe predicate.** `public.can_access_own_random_session(p_session uuid)`: one
   argument, no way to ask about anyone but the caller (`rp.user_id =
   public.current_profile_id()` inside), `left_at is null`, `rs.status = 'active'`,
   SECURITY DEFINER with a pinned `search_path` — definer because the base Random tables
   deliberately have no participant policies (022), which is also why it must not leak.
   Granted to `authenticated` + `service_role` explicitly (and to `supabase_realtime`
   only where that role exists), revoked from `public` and `anon`.
2. **Both channel policies re-created** with only the `random` branch substituted. The
   `conversation`, `user` and `feed` branches and the `else false` fallback are carried
   over verbatim, inside the same `to_regclass('realtime.messages')` guard 014 and 029
   use, so a plain-Postgres deploy skips the block with a NOTICE instead of failing.
3. **The oracle closed.** `can_access_random_session(uuid, uuid)` keeps its body and its
   internal callers and loses EXECUTE for `public`, `anon` **and `authenticated`**,
   keeping `service_role`. The optionality of `p_user` made it a session-membership
   oracle — it answers "is this other profile in that private session", and because those
   tables have no participant policies it was the only door. PostgREST exposes every
   executable public function as an RPC, so "not executable by `authenticated`" is what
   makes it internal again. All six callers were checked to be SECURITY DEFINER before the
   revoke was written; the application never called it (010's RPCs pass their own
   `v_me`, and `lib/actions/random.js` only reads the two participant-safe views).

Nothing was deleted: `random_*` tables, views, their moderation access and 023's flag all
stay, as 022 and 023 decided. Messaging, notifications and the feed channels are
unchanged apart from the branch substitution.

### 15.5 What was measured, not assumed

* Reproduced the failure locally by putting the schema into the state production is in —
  the pre-030 policy plus `revoke … from authenticated` — and the query a subscription
  runs raised exactly `42501 permission denied for function can_access_random_session`.
  With 030 applied the same probe returns a clean deny, 0 rows, no error.
* Cost, 200 iterations each on that cluster: 0.14 ms (no channel policy in the way),
  0.19 ms (fixed deny), 0.23 ms (failing), against a 0.12 ms baseline read. So the fix
  removes log volume and failed subscriptions; it does not measurably move query time.
* `database/tests/16_random_channel_authorization.sql` — new suite, 37 assertions:
  participants of an open session see the channel, a student who left does not, a
  stranger does not, a closed session does not, a malformed topic (`null`) is a `no`
  rather than an error; `authenticated` may not call the oracle at all (both directions,
  including "not even about herself"); `anon` executes neither function; a participant can
  still *broadcast* on their own session channel and read their own `user:` channel (so
  the hardening is not a stealth outage); another student's `user:` channel stays closed;
  `random_session_state` still answers for a participant and still returns `null` — not an
  error — for a stranger; and the policy text is read back from `pg_policies` to prove
  which function each branch calls.
* `npm run audit:db` grew four catalog checks, the general one being: **every function a
  `realtime.messages` policy calls must be executable by the role that policy is granted
  to**. Derived from `pg_depend`, not from a list, so it catches the next policy someone
  writes at 3 a.m. Verified to fail on the broken state (it names `campus_channels_read →
  can_access_random_session(uuid,uuid)`) and to pass after.
* `tests/realtime-channel-authorization.test.js` — 9 assertions: the migration's shape
  (one argument, definer, pinned search_path, the exact grants/revokes, both policies
  routed through the safe predicate, nothing dropped that 023 kept) and the client-surface
  contract (no `random:` topic, no import of the retired actions module, every `.channel(`
  call still `private: true`).
* Timing evidence for the latency question, such as it is here: per-attempt cost above;
  and the structural argument that the page path cannot be slowed by this — the function
  is referenced by two Realtime policies and six internal RPCs, and by no query
  `app/`, `components/` or `lib/data` issues. Realtime delivery, when it works, is an
  alternative to polling; it is not in the render path of a page.

### 15.6 What disappears from the log, and what does not

* **Gone, once migration 030 is applied to the project:** every `42501 permission denied
  for function can_access_random_session` line. There is no remaining code path that can
  raise it: the only policy that could call a function `authenticated` cannot execute now
  calls one it can execute, and that one cannot raise for a missing grant. A stale client
  is answered with `false`, which means "not authorized" and nothing more.
* **Expected to follow:** the `08P01 unexpected standby EOF` entries should drop sharply,
  because the reconnect loop that kept opening and abandoning Realtime sockets — including
  one whose replication connection was mid-setup — is the same loop. This is a
  correlation-based prediction from one exported window, not a proof: it needs the
  Realtime server's own connect/disconnect counters to confirm.
* **Not claimed fixed:** any latency. If `/home` or a timetable render is slow, this
  change does not make it faster, and 15.5's numbers are the reason for saying so. The
  `/api/messages/sync` 503 is a separate issue and was not touched, masked, or even
  re-tested here. If the 42501 lines survive deployment, the only remaining explanation
  worth chasing is a second project or a read replica sharing the role definitions — that
  would show up in 15.3's query as a healthy ACL in the project you migrated.
* **Cannot be verified from this sandbox:** the deployment itself, the production ACL
  state, Realtime's reconnect counters, and any client bundle still in somebody's tab.
  What is verified is that the migrated schema denies cleanly where it used to raise.

### 15.7 Files to know about later

`supabase/migrations/20261027000001_030_random_channel_authorization.sql` is the fix and
the explanation. `database/tests/16_random_channel_authorization.sql` is the isolation
proof. `auditRealtimeChannelPolicies` in `scripts/dev/audit.mjs` is the invariant that
would have caught this before a deploy: a policy may only call what its subscribing role
can execute, and a cross-user predicate may never be client-callable.

---

## 16. The first-visit guide at `/guide` (2026-10-26)

**Brief:** give a student who has never seen Campus+ a guide worth two minutes, at a
memorable route, reachable from the public pages and from inside the app, firing once
on a new device and never nagging a returning one — without inventing a feature, a
number, or a database migration to remember the dismissal.

### 16.1 The constraint that shaped everything

The guide is allowed to say only what the app already keeps. So the copy was written
*after* the audit, from the files, and every destination is read back out of
`lib/guide/content.js` by a test that resolves it against the routes Next actually
serves (`app/**/page.js`, route groups stripped, `[segment]` → `:segment`). Nothing
in the guide is typed twice: page titles come from the real `PageHeader`s, the empty
state of `/explore` and `/campus` is described as the code leaves it, the ranking
sentence quotes `TRENDING_FORMULA` and `TRENDING_WINDOW_HOURS` from `lib/constants.js`
rather than paraphrasing them, and the privacy notes are the ones Settings, Legal and
the `show_branch_year` view already enforce — including the things the product would
rather not say (a public username is the opposite of anonymous; moderation is
after-the-fact and by people; no moderation catches everything; deactivation is not
deletion).

Deliberately absent: Random Chat (no UI entry point in the app), reputation
(`reputation_*` is projected but displayed nowhere), and any claim that nothing is
ranked — something *is* ranked, deterministically, and the page says so.

### 16.2 One onboarding, not two

`components/auth/OnboardingIntro.js` used to be a separately-written description of the
same product: three notes and six destinations, each with its own one-line pitch, none
of it checkable against the real pages. It is now a **subset** of the guide — same
headline, a shorter form of the same opening sentence, and the three primary groups
with the guide's own reasons — so the two screens cannot drift apart. The slice keeps
exactly one link, to `/guide`. The other group names are rendered as text on purpose:
every app route redirects a student without a profile straight back to `/onboarding`,
so a link placed there before the form is finished is a dead end with a tab stop on it.

The hand-off is `completeOnboarding` → `redirectTo: '/guide?welcome=1'`. The guide
renders a `welcome` state (profile done, Home one tap, Explore offered beside it) and
an `onboarding` state for a signed-in student who still owes a profile — where the
honest action is "Continue setup", not "Sign in".

### 16.3 The one-time trigger, and why there is no migration

`lib/guide/first-visit.js` is three pure functions over a storage object and one key,
`campusplus:guide-seen`, whose value is an ISO timestamp and nothing else. No column,
no table, no RLS change: "has this device seen the guide" is a device question, and
answering it in the database would mean a write on someone's first scroll, a new
policy to audit, and a cross-device profile of reading habits nobody asked for.

`readGuideSeen` answers `true` / `false` / **`null`**. `null` means storage is unreadable
— private mode, a blocked third-party area, a locked-down WebView that throws on the
*property read*, which is why every caller goes through `deviceStorage()` instead of
touching `window.localStorage`. When it is `null` the offer still appears (that student
may need it most) and the button says "Dismiss for now", because promising a permanent
dismissal the browser cannot keep would be a lie. `markGuideSeen` returns a boolean and
throws nothing into a click handler. Opening `/guide` writes the flag itself, so the
first-visit flow is one click and no button-press-to-stop-the-nag.

The read is a `useSyncExternalStore` with `getServerSnapshot = () => true`: the strip
renders nothing on the server and nothing on the hydration pass, and appears when the
live tree knows the answer. That is also why there is no `setState` in an effect — the
lint rule that made the first draft fail was right, not fussy.

### 16.4 What looking at the running page found

Lint and a green build could not have caught any of these.

* **The offer was unstyled on Home.** Its markup lives in `AppShell`, but the sheet
  that styles it was imported only by `app/guide/layout.js`. Split into
  `app/styles/guide-strip.css`, imported by `app/(app)/layout.js` — the layout that
  renders it — and pinned by a test that reads the import list, because this failure is
  silent: the text is present, correct, and unstyled.
* **A CSS tie made the drawn underline show up where it cannot work.** The headline's
  ink stroke is an absolutely positioned SVG; when the headline wraps (below ~30rem)
  one box cannot follow two lines, so the stroke ran past the last word into empty
  space. The narrow layout now uses the wavy `text-decoration` the onboarding sheet
  already uses, which repeats per line. The first version of that fix did nothing at
  all: `.guide-mark { display: block }` sits later in the sheet and tied on
  specificity, so the override needed `.guide-hero__ink .guide-hero__underline`.
* **`<main>`'s arrival animation made the strip invisible in a throttled renderer.**
  `night.css` animates every direct child of `.shell-main` with `route-arrive … both`,
  which starts at `opacity: 0`. The strip is a direct child, so it became a second
  route wrapper — the same containing-block hazard the island sheet documents — and any
  frozen animation leaves a line of text that cannot be read or dismissed. It opts out
  (`animation: none`) and sits at `z-index: 2` above Home's depth field, which is
  painted by a sibling that comes after it.
* **Short boards stretched their own rows.** Two `.guide-board`s share a grid row, so
  the shorter one's auto rows were stretched to match: 200px of nothing between a
  heading and its first link. `align-content: start` on the board fixed it.
* **The `onboarding` state told a signed-in student to sign in**, because the exit fell
  back to the signed-out copy. `GUIDE_EXIT.onboarding` now exists and a test asserts
  that no signed-in state ever links to `/login`.

Two things that looked like defects and were not, both recorded so the next reader does
not chase them: `ERR_CONNECTION_CLOSED` on Vercel's analytics script (dev) and the
404 on `/_vercel/insights/script.js` (a build served off Vercel) are environmental, and
`Failed to execute 'measure' on 'Performance': the `\u200bAppLayout` mark (Next prefixes that
  name with a zero-width space) cannot have a negative
time stamp` is Next's own dev-only RSC timing — it appears on `/login` too. The check
files them as noise, with the reason in a comment, rather than pretending they are
clean.

### 16.5 Verification

`scripts/dev/guide-check.mjs` drives the real application and prints one line per
claim. It was run against the dev server **and** against `next start` on a production
build (with the harness env baked in — a build without `NEXT_PUBLIC_SUPABASE_URL`
renders `/setup` everywhere, which is what the first production pass showed):
**52/52 checks passed** in both. Covered: 26 destinations swept over HTTP in both
states (no 404/5xx, signed-out guard intact, no signed-in route bouncing to `/login`);
layout at 1440/390/320 (no viewport overflow, no clipped line, one h1 then the five
parts in order, tap targets ≥40px on touch, the underline under the words not past
them); axe at desktop and mobile with zero serious or critical violations; keyboard
focus rings on the first six stops; every in-page jump reaching its section after the
smooth scroll settles; the strip appearing once on Home, the flag being written on
opening the guide, dismissal surviving reload *and* navigation, clearing the key
re-arming it, the account menu and the mobile sheet both carrying the entry point, and
a blocked-`localStorage` context still rendering Home and closing the offer; the
`welcome=1` landing; the setup guard still bouncing a profile-less student from `/home`
to `/onboarding`. Unit side: `tests/guide.test.js` (42 tests) plus re-pinned
`tests/onboarding.test.js`; `npm run verify` (lint, `sw:check`, `verify:db`,
`audit:db`, 872 tests) green, and `npm run build` clean with `ƒ /guide` dynamic.

### 16.6 What this run could not prove

No real phone: the tap-target and overflow numbers come from Chromium at 320/390 in
this sandbox, not from an iPhone or an Android WebView. Not deployed: the production
run here is a local `next start` against the perf harness, so the Supabase stub's
timings and the Realtime websocket failing are the harness, not the product. Private
mode was emulated by making `window.localStorage` throw, which is the closest
available stand-in for a real Safari private window. And nothing here can promise the
guide is *understood* — only that it is short, true, and reachable.

### 16.7 Files to know about later

`lib/guide/content.js` is the single source of what Campus+ is: change the copy there
and both the page and the onboarding slice move together. `lib/guide/first-visit.js`
owns the flag and `deviceStorage()`; no caller may touch `window.localStorage`
directly. `components/guide/GuidePage.js` is presentational and takes one prop
(`state`); `app/guide/page.js` decides the state and imports no data.
`app/guide/layout.js` owns the Boldonse display face for this route, which is the
house pattern for a route's display font. `app/styles/guide.css` is the page,
`app/styles/guide-strip.css` is Home's one-line offer, and each is imported by the
layout that renders it. `scripts/dev/guide-check.mjs` is the browser check; if a
sentence in the guide stops matching the app, `tests/guide.test.js` is what fails
first, and it fails because the route or the claim no longer exists.
