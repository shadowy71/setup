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
