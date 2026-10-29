# Campus+ repository-wide performance audit and optimization — 2026-10-29

## Outcome

This was a measurement-and-implementation pass on branch `arena/2eb78a36-setup`, starting from `dca3351fdf77aaa65a344302ab4525bf65ea927f`. Four small optimization groups were accepted only after baseline and candidate measurements:

1. a display-sized Campus+ mark, with high priority only at the measured Login LCP placement;
2. removal of Home/root prefetch from the primary navigation boundaries that were downloading Home-only CSS and display fonts on other routes;
3. a bounded, member-only unread-count lookup; and
4. a bounded, member-only inbox/latest-preview lookup.

No production data or production deployment was changed. The two migrations are non-destructive `CREATE OR REPLACE FUNCTION` changes. Private/personalized responses were not made publicly cacheable, no RLS policy was broadened, and no dependencies, third-party scripts, polling, retries, speculative indexes, or blanket memo/lazy-loading changes were added.

**Top three measured improvements (synthetic lab evidence, not field data):**

| Improvement | Identical-condition result | Evidence |
|---|---:|---|
| Login cold Slow-4G LCP | **2540 → 1296 ms** (−1244 ms, −49.0%); transfer **580,456 → 481,551 B** (−98,905 B) | `baseline-login-lcp-r3` / `optimized-brand-login-lcp-r3` |
| Explore cold transfer | **620,000 → 370,370 B** (−249,630 B, −40.3%); fonts **192,168 → 50,276 B** (−73.8%) | `baseline-explore-prefetch-r3` / `optimized-home-prefetch-explore-r3` |
| Chat list server total | **201.96 → 166.50 ms** (−35.46 ms, −17.6%), eight requests in both runs; Chat thread **242.63 → 215.74 ms** (−11.1%) | five-run baseline/final extended artifacts |

The final preview is available at **https://3100-irbhxdwo9vzscszvn49gy.e2b.app** while the sandbox process is running.

## Method and comparability

- The application was measured as a **production `next start` build**, not a development server. Installed Next resolved to 16.4.3.
- The existing performance harness supplied PostgreSQL 18.4 with the Supabase-shaped SQL/REST/auth stub, the same seeded fixture, and **25 ms upstream RTT** before and after. Migrations 033/034 were applied to that same fixture only after candidate benchmarks and fresh-database validation.
- Server route runs were warmed and repeated **five times**. Reports use medians and retain min/max spreads, response bytes, request counts, cumulative upstream time, and every exact upstream trace. The derived comparison is [`2026-10-29-final-same-fixture-comparison.json`](../../perf-results/2026-10-29-final-same-fixture-comparison.json).
- SQL candidates used **30 alternating samples**, `EXPLAIN ANALYZE`, and rolled-back temporary functions. Row equality was checked before a candidate was accepted.
- Chromium mobile measurements used a 390 × 844, DPR 3 phone profile. The throttled profile used 150 ms latency, 209,715.2 B/s download, 96,000 B/s upload, and 4× CPU slowdown. Cold was compared with cold; repeat visits were reported separately.
- Real-browser layout inspection also covered 320, 390, and 1440 px. Final hands-on screenshots and checks are under `perf-results/screens/2026-10-29-optimized-final-browser/` and [`2026-10-29-optimized-final-browser.json`](../../perf-results/2026-10-29-optimized-final-browser.json).
- Historical reports were used only as leads. Every numeric before/after claim here comes from new 2026-10-29 artifacts.

These are controlled synthetic measurements. They are **not** production timings, Core Web Vitals field data, real-user monitoring, physical-device results, or proof of real Supabase Realtime behavior.

## Ranked bottleneck register and disposition

| Rank | Baseline evidence | Decision and final evidence |
|---:|---|---|
| 1 | Login's 1024 × 1024, 104,896 B source JPEG was the LCP image despite a 44 CSS px placement. | **Implemented.** Reproducible 256 × 256, 5,626 B WebP derivative; eager/high priority only on Login. Cold LCP fell 49.0%; the final LCP element is text rather than the logo. Original artwork remains the icon source. |
| 2 | Dock/sidebar/brand prefetch of Home pulled Home route CSS plus Syne and Space Grotesk into non-Home visits. Explore cold transferred 620,000 B, including 192,168 B of fonts. | **Implemented narrowly.** Only Home/root links in `BrandLockup`, primary `Sidebar`, and `BottomNav` stopped prefetching; other warmups remain. Explore transferred 249,630 fewer bytes and requested no Home RSC/Syne/Space assets. Fourteen other RSC requests remained. |
| 3 | `messaging_unread_counts()` re-entered conversation/member/message RLS for each message. It also sits in the signed-in shell, so the cost was not confined to Chat. | **Implemented in migration 033.** Explicit verified-JWT profile, active membership, published conversation, incoming-after-read-position boundary; no arbitrary conversation input or message projection. SQL execution median **18.052 → 1.4435 ms** over 30 alternating samples, with identical rows. |
| 4 | `conversation_inbox()` repeated equivalent RLS work in unread aggregates and latest-message lookups. | **Implemented in migration 034.** Same fields, predicates, ordering, limit behavior, read position, mute state, exact unread counts, and latest previews. SQL execution median **23.8565 → 1.7465 ms**; all seven complete rows matched. Chat list and thread request counts stayed at eight and ten. |
| 5 | Trending SQL was a visible Explore cost and a possible lateral-join candidate. | **Rejected.** Thirty alternating samples produced identical rows/order, but median execution was about **4.13 ms current vs 5.10 ms candidate**. No migration was added. |
| 6 | A broader message-policy rewrite offered a small SQL gain. | **Rejected.** About **2.16 ms** median benefit did not justify security-sensitive policy churn. The bounded functions were measured instead. |
| 7 | Admin counts remained the largest admin server surface: 20 requests and 1591 ms cumulative upstream time at baseline. | **Not replaced with estimates or removed.** Exact counts are a product contract. Final median was **384.37 → 300.34 ms**, with 20 requests and 1319 ms cumulative upstream time; this remains the next-best optimization target. |
| 8 | Marketplace/gig fan-out and an apparently unused published-gig count were found. | **No speculative removal.** No separately measured end-to-end optimization was accepted in this pass; request/filter/count behavior remains unchanged. |

## Same-fixture final server results

Five-run medians below are directly from:

- [`2026-10-29-baseline-v2-student-extended-r5.json`](../../perf-results/2026-10-29-baseline-v2-student-extended-r5.json)
- [`2026-10-29-optimized-final-v2-student-extended-r5.json`](../../perf-results/2026-10-29-optimized-final-v2-student-extended-r5.json)
- [`2026-10-29-baseline-v2-admin-extended-r5.json`](../../perf-results/2026-10-29-baseline-v2-admin-extended-r5.json)
- [`2026-10-29-optimized-final-v2-admin-extended-r5.json`](../../perf-results/2026-10-29-optimized-final-v2-admin-extended-r5.json)

| Surface | Baseline total | Final total | Delta | Requests before → after |
|---|---:|---:|---:|---:|
| Admin counts | 384.37 ms | 300.34 ms | −84.03 ms / −21.9% | 20 → 20 |
| Chat list | 201.96 ms | 166.50 ms | −35.46 ms / −17.6% | 8 → 8 |
| Chat thread | 242.63 ms | 215.74 ms | −26.89 ms / −11.1% | 10 → 10 |
| Explore | 202.79 ms | 171.25 ms | −31.55 ms / −15.6% | 5 → 5 |
| Moderation | 234.75 ms | 202.21 ms | −32.54 ms / −13.9% | 11 → 11 |
| Gigs | 174.24 ms | 155.95 ms | −18.28 ms / −10.5% | 12 → 12 |
| Marketplace | 185.89 ms | 169.00 ms | −16.89 ms / −9.1% | 11 → 11 |
| Own profile | 199.75 ms | 176.99 ms | −22.76 ms / −11.4% | 12 → 12 |
| Public profile | 206.32 ms | 178.63 ms | −27.69 ms / −13.4% | 14 → 14 |
| Home shell | 142.95 ms | 119.57 ms | −23.39 ms / −16.4% | 4 → 4 |
| Home feed API | 206.45 ms | 199.29 ms | −7.16 ms / −3.5% | 8 → 8 |
| Club management | 223.67 ms | 214.40 ms | −9.26 ms / −4.1% | 20 → 20 |

The shared unread lookup can affect every signed-in shell, and non-target routes also vary between runs. Therefore the broad table is a same-fixture before/after result, **not** a claim that each route received a route-specific optimization or that every millisecond was caused by one change. Spreads and all five traces per route are in the raw artifacts.

## Frontend, asset, and React findings

### Brand and route assets

- `scripts/dev/brand-mark.mjs` deterministically generates `public/brand/campus-mark.webp`; `npm run brand:mark` reproduces it. The original `logo.jpeg` is retained.
- Non-LCP marks remain lazy/low priority. Login alone opts into eager/high priority. Width/height and the existing layout box are unchanged; cold CLS and horizontal overflow were zero in the dedicated Login comparison.
- The final browser pass decoded the served derivative at **256 × 256** and visually checked Login, Explore, and Chat at desktop and phone sizes.
- The signed-in route asset graph lost **410 gzip bytes of JS per route**, with no route CSS gzip change. Login's JS/CSS graph was unchanged. These small build-graph deltas are not presented as a major user-facing win. See [`2026-10-29-baseline-assets.json`](../../perf-results/2026-10-29-baseline-assets.json) and [`2026-10-29-optimized-final-assets.json`](../../perf-results/2026-10-29-optimized-final-assets.json).

### Prefetch and providers

The non-Home font requests were traced to Next's Home RSC prefetch and its route CSS, not to a global font import. The fix therefore targets only the responsible links. A real cold click from Explore to Home with prefetch disabled completed successfully; the trade-off is that Home assets now download on demand for that navigation.

The shell providers and fallback/reconnect paths were inspected. No new polling, arbitrary timeout, retry, broad client cache, or provider-wide memoization was introduced. Public-only caching conventions and private/no-store response boundaries were left intact.

### Measured mobile confirmation

The final three-run mobile artifact is [`2026-10-29-optimized-final-mobile-r3.json`](../../perf-results/2026-10-29-optimized-final-mobile-r3.json). Under Slow-4G/4× CPU it recorded, among other routes:

- Login FCP/LCP **1176/1176 ms** in the final run set;
- Explore FCP/LCP **984/984 ms**;
- Home FCP/LCP **1384/1448 ms**, CLS **0.088**.

All eight measured routes had zero horizontal overflow in both mobile profiles. Home CLS was lower than the earlier 0.258 sample but is **not eliminated**, and this was not a controlled enough comparison to claim a CLS optimization. Login repeat-visit total task time also had a noisy 2690 ms median in the dedicated brand run versus 1311 ms earlier; no repeat-task-time improvement is claimed.

## Surface coverage

| Area | Audit and verification performed |
|---|---|
| Home/feed | Server shell and API traces, Chromium mobile/cold-repeat checks, paged-feed browser check through 30 entries, fresh-post prepend, no-websocket discovery/deduplication and idle-no-polling checks. |
| Explore | Trending SQL/EXPLAIN candidate, server traces, asset/font request tracing, cold/repeat transfer, desktop/mobile inspection. |
| Communities, clubs, management | List/detail/management server traces, smoke/viewport checks, database suites; existing 35-organization and club authorization contracts were not changed. |
| Gigs and Marketplace | List/detail server traces, exact-count/fan-out inspection, mobile/smoke coverage; filters, counts, and ordering retained. |
| Campus, events, notices, resources, opportunities, projects | Extended server traces, smoke and viewport coverage; no unmeasured route-specific rewrite. |
| Timetable/offline | Server/static payload inspection and full offline browser suite, including reconnect rows, cold restart, blocked worker, install fallbacks, and private/API cache exclusions. |
| Messaging | SQL plans and 30-sample candidates, exact-row comparison, Chat list/thread server runs, desktop/mobile inbox rendering, unread/read-receipt/non-member SQL suites. |
| Notifications, profiles, settings | Extended server traces and smoke/mobile coverage; shared-shell change measured without changing visibility or personalization. |
| Admin/moderation | All admin tabs, counts, moderation, club management and backup surfaces measured; exact counts and permission checks retained. |
| Shared shell, RLS, caching, deployment | Asset graph, providers/realtime, private headers, SQL grants/definer hygiene, migration bundle, service worker, production build/start, anonymous security probes. No live deployment was performed. |

## Rejected or deferred work

- **Trending lateral lookup:** slower despite identical output; removed after the rolled-back benchmark.
- **Broad message-policy rewrite:** small gain, rejected to avoid unnecessary authorization churn.
- **Admin count removal/estimation:** rejected because exact counts must remain exact.
- **Speculative indexes, arbitrary timeouts/retries/polling, indiscriminate lazy loading/memoization, new dependencies/scripts:** not used.
- **Private cross-user caching:** not used. Home remains viewer-specific and no-store at the HTTP boundary.

## Verification and residual findings

| Check | Result |
|---|---|
| Unit tests | **71 files, 908 tests passed**. |
| Lint, production build, `sw:check` | Passed. Final app is running from the optimized production build. |
| Migration validation | All **17 SQL suites** passed after migration 033 and again after 034; fresh ordered validation covers 34 migrations. |
| SQL bundle | Regenerated: **34 migrations, 562.0 KB**; seven bundle-focused tests passed. |
| Database audit | **67 passes, 3 existing failures**: five club functions retain PUBLIC execute grants; `club_creation_requests` is absent from the backup snapshot catalogue and transactional capture-trigger coverage. These are not migrations 033/034 failures. |
| Security verification | All anonymous probes and browser-bundle secret scan passed. The sole failure is the deliberate `sb_secret_perf_harness_key` placeholder hygiene grep in harness/docs. |
| Home feed depth | Passed: paging 10 → 20 → 30, ordering/tail retention, and a 31st fresh post prepended without evicting the loaded tail. |
| Feed quick, corrected probe | **12/13 passed.** Author publication caused no reload or viewport jump. The remaining failure is described below. |
| Mobile fit | **327/366 passed.** Every layout/overflow/disclosure check passed at 320/390/1440 px; 39 failures are generic resource-404 console assertions repeated over 13 signed-in routes and three viewports. |
| Timetable offline | **97/97 passed** after correcting the probe to restore the actual captured weekday rather than hard-coding Monday. |
| Smoke | Only the known Home SSR-marker check fails because feed cards hydrate client-side; the real-browser hydrated feed-depth check passes. The fixture had no foreign conversation for the HTTP privacy probe. SQL non-member invisibility tests still pass. |
| Hands-on final browser | Brand decode, non-Home prefetch/fonts, desktop Chat, five-item phone dock, cold Home click, public Login, and uncaught-page-error checks all passed. |

### Unresolved feed correctness issue

On the degraded no-websocket path, a post hidden directly in the database remained in the viewer's open Home feed after 45 seconds. Viewer discovery of a new post did converge (24.1 seconds in the final quick run), and pending posts stayed invisible.

The cause is in code untouched by these optimizations: `HomeFeedClient` merges a freshly fetched head with the entire cached feed, which can reintroduce a hidden cached head row. Removing every absent cached row is **not** a safe fix because new posts can legitimately push previous rows to page two. A correct fix needs a tombstone or loaded-window reconciliation contract with pagination tests. This pass therefore does not claim full feed freshness/moderation signoff, and it does not mislabel the failure as timing noise.

The first author-scroll failure was a probe error: Playwright scrolled the off-screen composer into view after the baseline scroll position was captured. The corrected probe places/fills the controls first and passes at 476 px before and after publication. The timetable weekday failure was likewise a probe correction, not an application bypass.

### Environment noise and unperformed checks

- Browser traces include expected harness/environment 404s for Vercel analytics/speed-insights, favicon, and Realtime websocket endpoints. Console output is not claimed to be clean.
- Real websocket delivery was not measured. The feed fallback path was measured instead.
- No production Supabase, live deployment, physical phone, low-end real device, real-user data, or field Core Web Vitals were available.
- Two cold/repeat passes are preserved in [`2026-10-29-optimized-final-repeat-r2.json`](../../perf-results/2026-10-29-optimized-final-repeat-r2.json); two samples are not presented as robust medians. Streaming RSC `loadingFinished` can be null when the probe closes, so those fields are not complete transfer evidence.
- The HTTP foreign-thread privacy probe was not possible with the single-pair fixture; this is not replaced by a claim that the probe ran.

## Trade-offs and next work

1. **Correctness first:** design and test tombstone-aware Home reconciliation so moderation converges without dropping legitimately paged rows.
2. **Next-best optimization:** prototype one exact Admin-count batch/read under the existing admin authorization boundary. The target is the remaining 20-request, 300 ms counts surface. Accept only if exact counts, permissions, ordering, and 30-sample/end-to-end measurements improve; do not estimate or hide counts.
3. **Then:** revisit the remaining high-fan-out club management, profile, Marketplace, and Home feed API traces using the same fixture and request-level evidence.
4. **Validate outside the lab:** run real Supabase Realtime, production, and physical-device/RUM measurements before extrapolating these results.

Home prefetch removal intentionally shifts Home's unique assets to navigation time. The new SQL functions are privileged code and therefore keep pinned `search_path`, explicit JWT/membership/published-conversation predicates, anonymous/PUBLIC revocation, and exact authorization/read-receipt tests. The display derivative adds a small versioned asset while avoiding transfer of the much larger source image at every visible brand placement.

---

## Follow-up — 2026-10-29: feed correctness, resource 404s, and exact Admin batching

This follow-up supersedes the unresolved feed/mobile findings and the Admin “next work” item above. Historical evidence and the original report remain unchanged. Work was done in the required order: correctness first, URL-level 404 diagnosis second, and only then further optimization and comparable reruns. The follow-up preview is the same Arena port-3100 URL above, running the final production build while the sandbox process remains alive.

### Outcome and changed contracts

| Area | Resolution | Evidence |
|---|---|---|
| Home moderation/cache reconciliation | **Fixed in migration 035 and the Home route/client.** A fresh head page no longer blindly reinserts an ineligible cached row, while absence from one page is still not treated as deletion. | `2026-10-29-followup-final-feed.log`; `2026-10-29-followup-final-home-depth.log` |
| Mobile resource 404 assertions | **Fully diagnosed and fixed at the product boundary.** Only the two Vercel-hosted telemetry scripts were missing on the non-Vercel server. No console/resource class was suppressed. | `2026-10-29-mobile-404-fit-resource-failures.json`; `2026-10-29-followup-final-viewport.log` |
| Exact Admin counts | **Batched in migration 036.** One authorized, security-invoker RPC replaces sixteen count requests; the whole page falls from twenty upstream requests to five. | `2026-10-29-admin-final-batch-r15.json`; `2026-10-29-admin-counts-browser-contract-r2.json` |
| Prior optimizations | **Rerun under controlled conditions.** Headline server, SQL, transfer, and mobile gains survive. Smaller bundle deltas and run-to-run variance are reported below rather than hidden. | [`2026-10-29-followup-final-comparison.json`](../../perf-results/2026-10-29-followup-final-comparison.json) |

### 1. Feed correctness closure

**Cause.** The newest-page refresh was merged with the complete cached tail. A post that had become hidden, deleted, blocked, community-scoped, or otherwise ineligible could therefore be reintroduced from cache even though the server had correctly omitted it from page one. Deleting every row absent from page one would have been equally wrong: legitimate older pages and accepted writes are not tombstones.

**Server-authoritative fix.** `campus_feed_post_visibility(uuid[])` is a security-invoker, IDs-only visibility oracle. It accepts at most 510 canonical post IDs, retains caller RLS, and independently requires campus/non-community, published, not-deleted, feed-enabled rows. PUBLIC/anon execution is revoked. It returns no body, author-private record, or moderation-status detail. The Home POST route returns the normal newest page plus `checkedPostIds`, `visiblePostIds`, and `unavailable`; a failed visibility check checks nothing rather than implying deletion.

**Client guarantees.** Only the difference between requested/checked and visible IDs is removed. Removals apply to the fresh head, cached older pages, and matching accepted-write holds. Unchecked or visible older rows survive, deduplication and ordering are retained, and request-version guards prevent stale overlapping responses from winning. The existing 450 ms event batch and disconnected-only 20-second fallback remain; no frequent polling was added.

The bound is explicit: reconciliation covers the **newest 510 loaded post IDs per pass**. Accepted writes sort into that window. IDs beyond the bound are unchecked and retained; they are neither inferred deleted nor claimed reconciled by that pass. This is bounded coverage, not an assumption that accepted writes cannot grow the cache.

**Observed verification.** The final full workflow passed all 14 functional checks plus harness validation. An already-loaded older-page hidden row disappeared in 24.1 seconds with one bounded feed read; its valid older neighbor and the accepted new head survived exactly once. A separate hidden head left both author and viewer feeds, pending content stayed invisible, retry preserved the draft, and an idle feed did not poll. The separate depth probe passed all 11 checks through 10 → 20 → 30 entries and a fresh 31st entry without tail eviction. Earlier targeted coverage also passed seven files/102 tests, and the final complete unit run includes those tests.

The harness has no Realtime websocket. These browser results prove disconnected fallback convergence, **not** healthy realtime delivery. Realtime publication/channel predicates and healthy-event client behavior remain covered by SQL suite 15 and unit tests; no real-Realtime measurement is claimed.

### 2. The 39 mobile console assertions, by URL

Instrumentation now records response URL, status, and resource type in both browser tools. The diagnostic run found **78 HTTP 404 responses** producing the original **39 unclassified assertions**:

| URL | Count | Disposition |
|---|---:|---|
| `/_vercel/insights/script.js` | 39 = 13 signed-in routes × 3 viewports | Optional Vercel Analytics host endpoint requested on a non-Vercel production server. |
| `/_vercel/speed-insights/script.js` | 39 = 13 signed-in routes × 3 viewports | Optional Vercel Speed Insights host endpoint requested on the same server. |

The other 39 responses appeared as already-classified script/MIME noise. On Login, authentication rewrites turned the same missing script paths into HTML script responses. There were **no** Campus+ chunk, CSS, font, image, favicon, source-map, or API 404s in this matrix.

`app/layout.js` now renders both telemetry components only when Vercel reports `VERCEL=1`; hosted Vercel telemetry remains configured, while local/container/self-hosted servers no longer make two guaranteed missing-script requests per page. Console collection remains enabled, response failures remain visible, and no broad 404 exclusion was added. Final results: **366/366 viewport checks**, **zero HTTP resource failures**, and zero horizontal overflow. The only remaining mobile-console item is the explicitly unavailable harness websocket.

### 3. Exact, authorized Admin batching

The counts tab formerly made twelve operational and four overview exact-count requests after the existing auth/shell reads. Migration 036 adds `campus_admin_dashboard_counts()` with these constraints:

- explicit `view_admin_overview` permission check inside the database function as well as the existing page gate;
- **security invoker**, so every count remains under caller RLS and no unauthorized aggregate is exposed;
- the same sixteen `count(*)` definitions and predicates, not estimates or `reltuples`;
- `activeUsers24h` remains an explicit null because Campus+ has no presence/analytics source;
- the adapter restores the original twelve-card order regardless of JSON/JSONB key serialization;
- the original exact queries remain a no-throw compatibility fallback if the additive RPC is unavailable.

SQL suite 18 compares the RPC with all sixteen original queries in the same admin/RLS context, verifies the null and key counts, checks invoker/execute privileges, and denies a signed-in student. A live client check also matched every value and returned `42501` to the student. Chromium showed the same twelve labels/order and exact queue-health values with no page errors.

The directly comparable same-fixture A/B is:

| Admin counts page | Before | After | Result |
|---|---:|---:|---:|
| Median total | 286.844 ms (7 runs) | 224.594 ms (15 runs) | **−62.250 ms / −21.7%** |
| Upstream requests | 20 | 5 | **16 count reads → 1 RPC** |
| HTML bytes | 64,007 | 64,007 | Unchanged after restoring counter order |

An intermediate run against the stub's stale function catalog returned RPC 404, exercised the fallback, and made 21 requests; it is preserved as compatibility evidence, not presented as candidate performance. The final deterministic full-route comparison also improves Admin counts from the original 384.372 ms/20 requests to 217.539 ms/5 requests.

### 4. Comparable performance reruns

The final production build used Next 16.3.8, PostgreSQL 18.4, the deterministic 12-account/240-post/420-message seed, and 25 ms simulated upstream RTT. Server figures below are original-baseline → follow-up medians. Except for Explore's noted 15-run confirmation, route medians use five warmed runs. Full traces and spreads are in the derived comparison.

| Route | Original baseline | Follow-up | Delta | Requests |
|---|---:|---:|---:|---:|
| Home | 142.955 ms | 109.201 ms | −23.61% | 4 → 4 |
| Explore | 202.795 ms | 181.569 ms | −10.47% | 5 → 5 |
| Home feed API | 206.447 ms | 179.434 ms | −13.08% | 8 → 8 |
| Chat list | 201.957 ms | 169.542 ms | −16.05% | 8 → 8 |
| Chat thread | 242.632 ms | 225.981 ms | −6.86% | 10 → 10 |
| Marketplace | 185.891 ms | 172.516 ms | −7.20% | 11 → 11 |
| Gigs | 174.235 ms | 154.975 ms | −11.05% | 12 → 12 |
| Clubs | 165.345 ms | 132.335 ms | −19.96% | 8 → 8 |
| Admin counts | 384.372 ms | 217.539 ms | −43.40% | 20 → 5 |

Explore's first follow-up five-run window was 232.188 ms and is retained in the raw artifact. A separate 15-run confirmation produced 181.569 ms; that confirmation is used above rather than calling the first window meaningless. Campus, community, detail, resource, opportunity, project, timetable, moderation, club-management, and backup routes were also rerun and remain in the raw extended reports. High-fan-out surfaces such as club management were not rewritten speculatively.

**SQL A/B, thirty alternating samples per function on the same fixture:** temporary copies of the pre-033/034 invoker functions were compared with the current functions and dropped afterward. Outputs matched exactly (seven rows each):

- unread counts: **16.8705 → 1.0110 ms** median execution;
- inbox/latest preview: **17.9760 → 1.1210 ms** median execution.

**Cold browser transfer:** Login remained **580,456 → 464,395 bytes** from the original baseline; Slow-4G LCP was **2540 → 1556 ms** (follow-up spread 1184–1560 ms), so the direction survives without claiming the earlier 1296 ms sample as a new record. Explore remained **620,000 → 374,464 bytes**, with fonts **192,168 → 50,276 bytes**. The final 16-result fast/Slow-4G mobile matrix has zero overflow; Slow-4G medians include Login LCP 1208 ms and Explore 1008 ms. Home CLS was 0.088 in that matrix and is not claimed eliminated.

The corrected static inventory excludes Next's `noModule` legacy polyfill, which modern Chromium does not fetch. Signed-in static JS is about **1.4–1.6 KB gzip above** the earlier final build because of shared corrective code; the earlier exact 410-byte graph delta is therefore not claimed to survive verbatim. Live browser transfer and the large font/image/prefetch wins remain intact. The first over-counting asset artifact and all diagnostic iterations are preserved.

### 5. Final verification and hands-on preview

| Check | Final result |
|---|---|
| ESLint / service worker / production build | Passed; `sw:check` current at 15.2 KB. |
| Unit tests | **75 files, 922 tests passed.** |
| Fresh database | **36 migrations, 18/18 SQL suites passed.** |
| SQL bundle | Regenerated: **36 migrations, 567.8 KB**. |
| Feed / depth | **14 functional checks + harness passed; 11/11 depth checks passed.** |
| Viewport / mobile browser | **366/366; zero HTTP resource failures. Sixteen fast/Slow-4G results; zero overflow.** |
| Desktop and phone moderation preview | Real PostgreSQL `published → hidden` transition passed without reload or focus nudge. Desktop converged in **14.1 s**/two bounded reads; phone in **23.1 s**/one bounded read. Each retained nine existing neighbors exactly once and backfilled one eligible post, staying at ten entries; zero overflow, failed HTTP resources, or page errors. |
| Evidence for the hands-on transition | `2026-10-29-followup-final-preview-moderation-r4.json`; screenshots under `perf-results/screens/final-preview-r4/`. Earlier probe-assertion mistakes are retained, not deleted. |
| Smoke | All checks passed except the known Home SSR-marker assertion for client-hydrated cards. The real-browser feed/depth checks pass. The fixture still cannot run the foreign-thread HTTP privacy probe; SQL non-member tests pass. |
| Database audit | **67 passes, three pre-existing failures**, classified below. |
| Security verification | All anonymous probes and the browser-bundle secret scan passed; only the deliberate harness-placeholder hygiene grep remains red. |

### 6. Residual findings and blockers

| Finding | Evidence-based severity and disposition |
|---|---|
| Five club trigger functions retain PUBLIC execute grants | **Low-severity hardening debt; no anonymous write demonstrated.** All five return `trigger`; direct anonymous calls fail with PostgreSQL `0A000` before the body. A dedicated follow-up should revoke PUBLIC/anon and retain only required trigger execution semantics, with SQL regression tests. It was not folded into this performance/correctness patch. |
| `club_creation_requests` omitted from backup catalogue and change capture | **Medium data-durability follow-up.** The table is absent from both mechanisms, so this is not dismissed as a grep artifact. It predates migrations 033–036 and needs an additive backup migration plus snapshot/restore verification, not an untested drive-by change here. |
| `sb_secret_perf_harness_key` hygiene grep | **Informational/deliberate harness placeholder, not a leaked credential.** All live anonymous probes and the built-browser secret scan pass. The assertion was not disabled. |
| Realtime and deployment coverage | The stub still has no websocket. No production Supabase, live deployment, real-user/RUM, physical phone, low-end physical device, or healthy-realtime measurement was available or fabricated. |
| Smoke/foreign-thread coverage | Home SSR markers remain a known client-hydration limitation, not evidence of missing hydrated cards. The HTTP foreign-thread case remains unrun on this fixture and is not claimed. |

Primary follow-up evidence is indexed in [`2026-10-29-followup-final-comparison.json`](../../perf-results/2026-10-29-followup-final-comparison.json). Raw logs, failed diagnostic iterations, response traces, SQL samples, and screenshots remain under `perf-results/`; none were reset or overwritten to produce this report.
