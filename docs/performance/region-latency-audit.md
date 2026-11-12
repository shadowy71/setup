# Database and compute region performance audit

## Executive summary

The Vercel production deployment inspected is READY and reports function region `iad1`; the existing Supabase project reports `ap-northeast-1` (Tokyo). They are geographically far apart. Request waterfalls show multiple dependent auth/data waves, so this mismatch is a credible latency contributor, **not a measured production root cause**. We could not measure Vercel-to-Supabase RTT, India-to-Vercel browser load, production render spans, OAuth login, or regional alternatives from this environment. `createdIn` on the deployment describes build location, not function location; the deployment's `regions` property reports `iad1`.

Recommended next experiment: keep the existing Tokyo Supabase project and test **one Vercel function region `hnd1`** in a controlled preview, then compare against `iad1` from Pune before requesting approval for production. No region or production configuration was changed. Mumbai compute plus Mumbai Supabase may eventually be best for India, but is a separate, higher-risk migration requiring explicit approval and possibly costs; it is not an incremental change to the existing project.

## Architecture and bottlenecks

- `lib/supabase/server.js` creates the cookie-aware publishable-key client for Server Components, Actions and Route Handlers; React `cache()` deduplicates the client within a render. `lib/auth/session.js` also uses request-scoped `cache()`, verifies with `auth.getUser()`, then fetches profile, roles and permissions in one embedded RLS-scoped read. These are dependent: do not replace verified auth with an unverified cookie or cache identity globally.
- `proxy.js` constructs its own SSR client and uses `getClaims()` for routing/session refresh. It can refresh through Supabase, so check middleware separately from origin SSR. Its routing decision is not the authorization layer. The browser client in `lib/supabase/client.js` also talks to Supabase for realtime and interactive features and is distinct from server-origin traffic.
- `lib/supabase/public.js` uses a cookie-free anonymous client for explicitly public projections. `lib/supabase/admin.js` is server-only, privileged and bypasses RLS; backup/maintenance and guarded storage code use it. Do not substitute it for the session client to make reads faster. `lib/backup/runtime.js` also owns a direct server PostgreSQL backup connection; it is separate from page reads.
- `app/(app)/layout.js` resolves the user, then fetches notification and messaging unread states in parallel. Child pages share the request-scoped identity where React permits. `app/page.js`, `app/auth/callback/route.js` and `lib/actions/auth.js` handle entry/auth redirects and OAuth. Server Actions live under `lib/actions/`; their writes and guards must remain ordered where dependent.
- `app/api/home/feed/route.js` separately resolves user/auth after Home HTML; it fans out feed, events, notices, count and trending, then hydrates feed rows. The browser receives that feed after hydration, so HTML completion is not the user's full Home load. `app/api/messages/sync`, notifications and search do their own request/session checks. `app/api/storage/**` route handlers generally delegate to `lib/storage/**` (and have separate authorization and Drive calls). Public club/event image routes and sitemap use the anonymous public data readers. Timetable uses local static data/API rather than Supabase.
- Marketplace's list, categories, three visible exact counts and shell badges fan out after identity. Seller identities depend on the listing result. The unused gigs count was removed in this patch. Exact counts still matter for rendered labels; do not replace them with estimates.
- Messages: `listConversations` loads memberships, then inbox RPC and members, then visible profiles; the inbox is already a bounded, caller-RLS read model. Thread reads have additional dependent hydration. Do not share cached message, membership or unread data across users.
- Explore already runs trending and public discovery in parallel. Cached anonymous events/clubs have bounded queries; event host identities depend on event IDs. Explore itself remains authenticated. Public events/clubs and authenticated published notices use short 60-second tagged caches in `lib/data/public*.js`, with invalidation after writes; notice cache uses a session client and must only contain the intended identical published projection. No new cross-user cache was introduced. Feed, search, private image routes, role/permission data, RSVPs and messages remain viewer-scoped/no-store.
- `app/(public)/campus/events/page.js` previously waited for club options before starting its event list and then waited for RSVP lookup. This patch overlaps independent club/slug/event/submission reads and starts RSVP as soon as event IDs are ready. The RSVP still uses the viewer's client and is not shared.
- Profile and community detail pages show more query waves in the fixture; investigate their dependencies before combining queries. Avoid blanket `Promise.all` of mutations, unbounded joins, shared caching of RLS data, and retries that mask failures. Marketplace galleries can generate additional per-card client requests; the benchmark below does not exercise real Drive media.

## Region comparison (hypotheses, not measured RTTs)

| Configuration | Server ↔ DB | Pune ↔ dynamic compute | Assessment |
| --- | --- | --- | --- |
| `iad1` + Tokyo (current) | Long intercontinental path | Long India–US path | Baseline; verified configuration, no production timings measured here. |
| `hnd1` + Tokyo (A) | Same metro/region likely reduces dependent DB round trips | India–Tokyo still nonlocal | Preferred first experiment: retains existing project/data, one Vercel region. Actual egress paths, auth, proxy, cache and user performance must be measured. |
| `bom1` + Mumbai Supabase (B) | Same metro/region likely short | Potentially shortest India path | Potential long-term option only after a separately approved migration, cost, downtime, security and rollback review. No target project created. |

The Vercel Hobby plan permits one function region; static content is distributed separately, and routing middleware placement may differ from function placement. Verify the region in the deployed response and dashboard rather than assuming middleware follows the function. See [Vercel regions](https://vercel.com/docs/functions/configuring-functions/region) and [configuration](https://vercel.com/docs/project-configuration/vercel-json). [Supabase's region guidance](https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z) says a move requires a new project and migration, not an in-place region toggle. Inventory auth identities and OAuth configuration, RLS/grants, data, storage objects, realtime, external integrations, backup, secrets, URLs and cutover/rollback before any such move. Never assume the repository contains all live data or migration history. Verify plan quotas and eligibility before any trial; no paid infrastructure is authorized.

## Before/after local benchmark

Identical deterministic fixture (12 accounts, 240 posts, 420 messages); disposable PostgreSQL with all 77 local migrations and RLS, fronted by the repository's Supabase-shaped stub, production Next.js build and a **synthetic 100 ms delay per upstream request**. The 100 ms is a stress parameter, not a measured `iad1`↔Tokyo RTT. Three warmed runs per page; medians below. Same fixture/server, rebuilt app; timings naturally vary. Requests include auth plus REST/RPC calls observed by the stub, not just SQL statements; one RPC may run many SQL operations. The stub is not live PostgREST, production data, an actual network or a browser. The baseline was base commit `94d3a44`; after includes this patch. TTFB and complete streamed HTTP response are local client-observed wall time; they are **not** isolated server render spans or browser page-load/paint times. Home's post-hydration feed is measured separately. No per-request tracing of browser-loaded images, realtime or CDN cache was performed. Existing `unstable_cache` entries and background revalidation can change request timings/counts.

| Surface | TTFB before → after (ms) | HTTP response complete before → after (ms) | Upstream requests before → after | Slowest upstream request before → after (ms, last run) |
| --- | ---: | ---: | ---: | ---: |
| Home HTML | 349 → 352 | 356 → 355 | 4 → 4 | 107 → 106 |
| Home feed API | 578 → 569 | 579 → 570 | 10 → 10 | 240 → 204 |
| Explore | 336 → 333 | 464 → 422 | 5 → 5 | 242 → 190 |
| Marketplace | 348 → 378 | 466 → 539 | 11 → 10 | 122 → 128 |
| Messages inbox | 335 → 331 | 545 → 542 | 8 → 8 | 110 → 106 |
| Timetable division | 12 → 14 | 14 → 16 | 0 → 0 | 0 → 0 |
| Campus events (additional target) | 542 → 339 | 546 → 344 | 5 → 5 | 106 → 105 |

The events sample's last-run trace changed from sequential club options → event request → RSVP (starts at +212, +317, +422 ms relative to first upstream request) to overlapping requests (event +211, club +211, RSVP +213 ms). The latter also benefits from the existing warm public-event cache: the events request can be a background revalidation, while the RSVP uses cached IDs. A cold-cache request still needs the event result before its RSVP. The observed 202 ms reduction is specific to this fixture/cache state, not a promised production gain. Marketplace removed one independent gig count; the sample's response time was slower despite fewer requests, so **no marketplace speedup is established**. Small changes elsewhere are noise, not credited to the patch.

Representative individual last-run upstream durations in milliseconds (including the synthetic delay, not pure SQL):

| Request | Before | After |
| --- | ---: | ---: |
| Home auth `/auth/v1/user` | 101 | 102 |
| Home embedded `profile_private` | 105 | 104 |
| Explore `trending_posts` RPC | 242 | 190 |
| Market listing SELECT | 117 | 116 |
| Market seller profiles SELECT | 106 | 104 |
| Events club options SELECT | 103 | 105 |
| Events RSVP SELECT | 104 | 103 |

Anonymous `/login` HTTP GET (five warmed samples, local, no OAuth) had median TTFB / response completion **13.6 / 16.6 ms before**, **14.3 / 18.0 ms after**. It is not an end-to-end Google login benchmark. Per-query data for this simple anonymous GET, isolated server rendering duration, browser total load and real login were **not measured**. A fixture session is generated for authenticated tests; it is not a real user credential. Session tracing excludes session creation itself.

Reproduce with the repository harness: `npm ci`; `npm run perf:serve -- --rtt 100` in one terminal; build and serve with the stub URL and fixture keys printed by the harness; `npm run perf:measure -- --label audit --user student --runs 3 --extended --waterfall --json node_modules/.cache/perf/audit.json`. Compare clean base and changed builds against the same fixture. Raw results are local ignored scratch artifacts, not production user data. The harness emits request paths and fixture details; do not collect real cookies, tokens, user identifiers, query bodies, private content or Drive IDs in shared traces.

## Incremental plan and measurement gates

1. Review and test the code-only patch; deploy via the normal review workflow. No production migration or region change is included. Verify user/guest event lists, RSVP controls, errors, marketplace summary and signed-in access.
2. Obtain consent for a safe comparison deployment, **not a production region change**. Use the same code and safe nonproduction fixtures or strictly read-only synthetic accounts, separate previews configured to one region each, verify `x-vercel-id`/deployment region and preserve the production environment. Avoid mutation, cron, real uploads, or secret output; no extra paid infrastructure. Preview access and region controls must be confirmed for the plan first.
3. From Pune/mobile and desktop, use browser network timing and Vercel Speed Insights for p50/p95 TTFB, LCP and full load; segment login, Home + feed API, Explore, Market, Chat and Timetable, cold/warm cache, repeated sessions and real navigation. Add privacy-safe temporary server spans and upstream call counts/durations with no tokens, IDs, SQL literals or content. Compare same fixture/data volume, build, traffic and sample windows, report error rates and timeouts. Confirm realtime and OAuth separately. Never infer causality from cumulative `pg_stat_statements` alone.
4. If `hnd1` wins and is within the existing plan, present measured findings, rollout/rollback and get explicit approval before changing production settings or `vercel.json`; redeploy and validate region, auth, RLS, messaging/realtime, public pages and error rates. Roll back to the previous deployment/region if metrics or functionality regress.
5. Only if a further Mumbai move is justified, produce an independently approved migration design and restore drill covering all live database and non-database assets, parity, write freeze/replication strategy, cost, data loss budget, cutover and rollback. Do not create, move, replace or delete the project now.

## Validation and limits

`npm run lint`, production build and `npm test` passed (150 files, 1,412 tests). Focused tests exercise event-read overlap, guest isolation and marketplace query count. `npm run perf:smoke` reported two failures: its Home expectations assume server-rendered feed content, whereas this checkout loads it after hydration; its club detail expects 200 although the tested legacy URL redirects 308. Other smoke checks passed. This is not proof those features work end-to-end in a browser. `npm ci` reported 8 moderate dependency advisories; no upgrades were made. No schema, migration, feature flag, realtime, production region, environment, deployment, or real Drive operation was changed.

## Direct client usage inventory

The following is a source-text inventory of direct references to Supabase client constructors/helpers in `app/`, `lib/`, and `proxy.js`; indirect callers through `lib/data`, storage wrappers, `requireUser`, or components may not appear. Re-run `rg -l 'getServerClient|requireServerClient|getAdminClient|requireAdminClient|getPublicClient|createServerClient|createClient\(' app lib proxy.js` after refactors. A listed file is not necessarily a database query on every request.

### Server Components and layouts

- `app/(app)/admin/page.js`
- `app/(app)/campus/events/[id]/edit/page.js`
- `app/(app)/campus/events/new/page.js`
- `app/(app)/campus/housing/[id]/edit/page.js`
- `app/(app)/campus/housing/[id]/page.js`
- `app/(app)/campus/housing/page.js`
- `app/(app)/campus/lost-found/[id]/edit/page.js`
- `app/(app)/campus/lost-found/[id]/page.js`
- `app/(app)/campus/lost-found/page.js`
- `app/(app)/campus/noticeboard/[id]/edit/page.js`
- `app/(app)/campus/noticeboard/[id]/page.js`
- `app/(app)/campus/noticeboard/archive/page.js`
- `app/(app)/campus/noticeboard/manage/page.js`
- `app/(app)/campus/page.js`
- `app/(app)/campus/rides/[id]/edit/page.js`
- `app/(app)/campus/rides/[id]/page.js`
- `app/(app)/campus/rides/page.js`
- `app/(app)/campus/study/[id]/page.js`
- `app/(app)/campus/study/page.js`
- `app/(app)/campus/teams/[id]/edit/page.js`
- `app/(app)/campus/teams/[id]/page.js`
- `app/(app)/campus/teams/new/page.js`
- `app/(app)/campus/teams/page.js`
- `app/(app)/campus/utilities/page.js`
- `app/(app)/chat/[id]/page.js`
- `app/(app)/chat/page.js`
- `app/(app)/clubs/[id]/edit/page.js`
- `app/(app)/clubs/[id]/manage/page.js`
- `app/(app)/clubs/request/page.js`
- `app/(app)/communities/[slug]/manage/page.js`
- `app/(app)/communities/[slug]/page.js`
- `app/(app)/communities/page.js`
- `app/(app)/explore/collections/[subject]/page.js`
- `app/(app)/explore/opportunities/[id]/page.js`
- `app/(app)/explore/opportunities/new/page.js`
- `app/(app)/explore/opportunities/page.js`
- `app/(app)/explore/page.js`
- `app/(app)/explore/projects/[id]/edit/page.js`
- `app/(app)/explore/projects/[id]/page.js`
- `app/(app)/explore/projects/page.js`
- `app/(app)/explore/resources/[id]/page.js`
- `app/(app)/explore/resources/page.js`
- `app/(app)/gigs/[id]/edit/page.js`
- `app/(app)/gigs/[id]/page.js`
- `app/(app)/gigs/new/page.js`
- `app/(app)/gigs/page.js`
- `app/(app)/layout.js`
- `app/(app)/market/listing/[id]/edit/page.js`
- `app/(app)/market/listing/[id]/page.js`
- `app/(app)/market/new/page.js`
- `app/(app)/market/page.js`
- `app/(app)/moderator/page.js`
- `app/(app)/notifications/page.js`
- `app/(app)/post/[id]/page.js`
- `app/(app)/profile/achievements/[id]/edit/page.js`
- `app/(app)/profile/achievements/new/page.js`
- `app/(app)/profile/page.js`
- `app/(app)/settings/page.js`
- `app/(app)/user/[username]/page.js`
- `app/(public)/c/[slug]/page.js`
- `app/(public)/campus/clubs/[id]/page.js`
- `app/(public)/campus/events/[id]/page.js`
- `app/(public)/campus/events/page.js`
- `app/(public)/clubs/[id]/page.js`
- `app/(public)/clubs/page.js`
- `app/community/[slug]/page.js`

### API and auth route handlers

- `app/api/backup/drive/callback/route.js`
- `app/api/backup/drive/connect/route.js`
- `app/api/giphy/search/route.js`
- `app/api/home/feed/route.js`
- `app/api/messages/sync/route.js`
- `app/api/notifications/unread-count/route.js`
- `app/api/search/route.js`
- `app/api/storage/post-drafts/[id]/route.js`
- `app/api/storage/post-upload-availability/route.js`
- `app/api/storage/profile-photo/[username]/route.js`
- `app/api/storage/profile-photo/route.js`
- `app/auth/callback/route.js`

### Server Actions

- `lib/actions/achievements.js`
- `lib/actions/admin.js`
- `lib/actions/auth.js`
- `lib/actions/backup.js`
- `lib/actions/campus-board.js`
- `lib/actions/campus.js`
- `lib/actions/club-requests.js`
- `lib/actions/communities.js`
- `lib/actions/marketplace.js`
- `lib/actions/messaging.js`
- `lib/actions/moderation.js`
- `lib/actions/notifications.js`
- `lib/actions/profile.js`
- `lib/actions/random.js`
- `lib/actions/social.js`

### Other server helpers and client constructors

- `lib/auth/session.js`
- `lib/backup/runtime.js`
- `lib/data/public-cache.js`
- `lib/data/public.js`
- `lib/storage/achievement-attachments.js`
- `lib/storage/event-attachments.js`
- `lib/storage/gig-attachments.js`
- `lib/storage/housing-attachments.js`
- `lib/storage/lost-found-images.js`
- `lib/storage/marketplace-access.js`
- `lib/storage/marketplace-attachments.js`
- `lib/storage/notice-attachments.js`
- `lib/storage/post-access.js`
- `lib/storage/post-attachments.js`
- `lib/storage/profile-photo.js`
- `lib/storage/project-attachments.js`
- `lib/storage/ride-attachments.js`
- `lib/storage/space-attachments.js`
- `lib/storage/team-attachments.js`
- `lib/supabase/admin.js`
- `lib/supabase/public.js`
- `lib/supabase/server.js`

### Proxy

- `proxy.js`
