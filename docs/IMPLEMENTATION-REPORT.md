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
| iOS Safari | not reachable from this sandbox | No `beforeinstallprompt` by design; the save is written first, then the Share → Add to Home Screen sheet naming the batch, with `appleWebApp` metadata (title, status bar, `theme-color`) carrying the batch name. |
| Firefox (any), other browsers | not reachable from this sandbox | `manual` path: the sheet explains pin/bookmark. Never claims an install. |

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
