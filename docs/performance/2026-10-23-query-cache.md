# Campus+ — query and cache audit (2026-10-23)

A small, targeted pass over the data layer: remove reads that answered the same
question twice, stop paying for count queries whose number was already in hand,
and cache the one category of data whose visibility is genuinely the same for
every student.

Everything here was measured against the repository's own harness — a disposable
PostgreSQL with the real migrations and RLS, fronted by the Supabase stub at
**25 ms simulated RTT per request**, running a production `next start` build.
No production deployment URL exists in this repository, no browser binary is
available in the audit environment, and `pccoe.in` answers TLS with
`ERR_SSL_UNRECOGNIZED_NAME_ALERT`, so **none of this is a Core Web Vitals or
Lighthouse result**. It is request counts and server-side latency only.

---

## 1. What was actually repeated

Traced per request with `/__perf/reset` + `/__perf/trace` (exact upstream calls,
not estimates):

| Surface | Duplicate / wasted reads found |
|---|---|
| `/post/[id]` | `public_profiles` **twice** (post authors, then comment authors) and `reactions` **twice** (post targets, then comment targets) — four reads where two answer the same question, and they ran in a second, sequential wave. |
| `/communities` | **Three** `head: true` count queries (`kind = community`, `study_group`, `club`) on every visit, each a separate round trip for one number each. |
| `/campus` | A **`HEAD /events` count** and a **`HEAD /communities` count** issued immediately after list queries with *identical filters*; the list response already carries `count: exact`. |
| `/campus/noticeboard` | The published notice list re-read on every visit, although the rows are identical for every student. |
| `/campus`, `/campus/events`, `/clubs/[id]` | Same for the published events list. |
| `/profile`, `/user/[username]`, notice/event detail | Metadata and page body resolve the same row twice when Next's request-level fetch memoization does not apply (e.g. after an options object changes identity). |

Measured before the change (`npm run perf:measure -- --label before --runs 3`),
the 13 audited pages issued **113 upstream requests** in total.

---

## 2. What changed

### 2.1 Repeated reads inside one request

* **`getPostDetail`** now reads the post and its comments in parallel, then one
  `public_profiles` read covering the post author *and* every comment author,
  plus one `reactions` read covering post and comment targets (split by
  `target_type` afterwards). Three waves became two; four reads became two.
  `hydratePosts` accepts the already-read rows instead of re-fetching them.
* **`getNotice`, `getEvent`, `getProfileCounts`, `isBlockingProfile`,
  `getOwnProfile`** are wrapped in React `cache()`. They take primitive arguments
  (plus the request-scoped client, which is itself cached), so the cache key is
  exact. This is request-scoped deduplication only — no cross-request reuse, no
  mutations cached, no per-user leakage. `getPublicProfile` already did this.

### 2.2 Count queries

* **`/communities`** uses a new `countCommunitiesByKind()`: one capped read
  (`select kind … limit 1000`) tallied in memory, following the existing
  `countClubsByCategory()` precedent. Three round trips became one.
* **`/campus`** asks `listEvents(..., { withCount: true })` and
  `listCommunities(..., { withCount: true })` for `count: 'exact'` on the same
  request, and `getCampusSummary` skips those two counts. Two round trips
  removed, with the numbers proven identical (§4.3).

### 2.3 Public cache (the only cache introduced)

`lib/data/public-cache.js`, built on `unstable_cache` (the supported data-cache
API in Next 16; `'use cache'` would require enabling `cacheComponents`
app-wide):

| Boundary | Tag | Revalidation | Why it is safe |
|---|---|---|---|
| `listPublishedNotices()` | `public:notices` | **60 s** | RLS `notices_select_published` = `status='published' and not expired` — no membership, block or profile term. The reader additionally pins the same filter. |
| `listPublishedEvents()` | `public:events` | **60 s** | RLS `events_select_published` = `status in ('published','completed')`; the reader pins `status='published'`. |

Cache keys are the exact call arguments (limit, offset, filters, window). No
viewer-specific column is ever selected (`reacted_by_me` and RSVP state are read
separately by the page). A failed read throws out of the cache, so an outage is
never remembered as an empty list; the caller still renders the usual
`unavailable` warning.

**Invalidation** — `revalidateTag` in the five writes that can change a published
row: `saveNotice` (notices), `saveEvent`, `publishEventSubmission`,
`rejectEventSubmission`, `withdrawEventSubmission` (events). Nothing else is
invalidated; every other page keeps its existing `revalidatePath` calls.

**Verified end to end** (probe route + page, removed afterwards):

```
1. first read (cold)                  ["Notice 20: fee payment", …]   1 upstream read
2. notice row edited directly in SQL  ["Notice 20: fee payment", …]   0 upstream reads  ← cache hit
3. revalidateTag('public:notices')    ["PROBE EDITED TITLE", …]       1 upstream read   ← fresh
4. fixture restored                   ["Notice 20: fee payment", …]
```

**Identity independence verified**: the cache was warmed by the **admin**
account (which can read drafts through `events_select_staff` / staff notice
policy), then read by a student. Student and admin saw exactly the same ids
(20 notices, 6 events, 3 hub notices), and the student's request issued no
notices read and no public events read.

---

## 3. Deliberately left uncached

| Data | Why |
|---|---|
| `communities` / clubs / study groups | `communities_select_visible` → `can_view_community()`, which allows member-only communities only to their members. Two students legitimately see different sets, so a shared entry would leak or hide rows. |
| Home feed, posts, reactions, polls | Personalised: blocks, community membership, the viewer's own reactions and votes. |
| `profile_private`, account status, roles, permissions | Private and authorization-bearing. |
| Notifications and unread counts | Per-recipient and rapidly changing; the layout's unread `HEAD` stays a fresh read on every page. |
| Conversations, members, messages | Membership- and block-sensitive. |
| Moderation queues, admin tables | Staff-scoped. |
| `/market` summary counts | Three counts over `marketplace_listings` with different filters. Merging them needs one `count(*) filter (…)` query — a new RPC, which this task rules out. Left as is and listed below. |
| `/chat` `conversation_members` (×2) | The second read needs the first read's conversation ids; they are already parallel with the inbox RPC. Not a duplicate. |
| `/explore` `communities` (×2) | Two different result sets (top communities vs top clubs) with per-kind ranking; merging would change what is shown. |
| `/home` notice/event slices | The page's own queries omit the expiry filter, so staff currently see expired notices there. Switching them to the cached reader would change staff-visible content — a behaviour change this task does not make. |
| Route handlers | `unstable_cache` + `cookies()` works in a page render but not in `app/api/*`. Documented in the module; all callers are pages. |

---

## 4. Measurements

### 4.1 Requests per page view

One request each, traced exactly (`perf-results/request-counts.json`).
"Cold" = first view after the data cache was cleared; "warm" = a view within the
60 s window. Baseline counts come from the same harness before the change.

| Page | Before | After (cold) | After (warm) |
|---|---|---|---|
| Home | 9 | 10* | 9 |
| Campus hub | 13 | **11** | **9** |
| Noticeboard | 4 | 4 | **3** |
| Events | 7 | 7 | **6** |
| Communities | 7 | **5** | **5** |
| Post detail | 9 | **7** | **7** |
| Explore | 13 | 13 | 13 |
| Marketplace | 10 | 10 | 10 |
| Notifications | 4 | 4 | 4 |
| Chat list | 7 | 7 | 7 |
| Chat thread | 9 | 9 | 9 |
| Profile (own) | 11 | 11 | 11 |
| Settings | 4 | 4 | 4 |
| Public profile | 13 | 13 | 13 |

\* The first page loaded on a freshly started server also fetches
`/auth/v1/.well-known/jwks.json` once for the process — unrelated to this change.

`npm run perf:measure` over its 13-page sweep: **113 → 104 upstream requests**
(−8 %).

### 4.2 Server response time and database work

Two runs of the unchanged build and two runs of the changed build, same machine,
`--runs 3` per page (median). The **noise band is large**: between the two
identical-code runs, individual pages moved from −30.8 % to +5.3 % and the
13-page total by −7.1 %. Claims below are therefore only made where the request
count changed.

| Page | Requests | Total (median of 2 runs) | Σ upstream time |
|---|---|---|---|
| Campus hub | 13 → 9 | 150 → 122 ms (−19 %) | 612 → **294 ms** (−52 %) |
| Noticeboard | 4 → 3 | 118 → 109 ms (−7 %) | 119 → **85 ms** (−29 %) |
| Communities | 7 → 5 | 144 → 107 ms (−26 %) | 198 → **144 ms** (−27 %) |
| Post detail | 9 → 7 | 205 → **139 ms** (−33 %) | 259 → 203 ms (−22 %) |
| Home (no change) | 9 → 9 | 267 → 262 ms (−2 %) | 322 → 323 ms — unchanged, as expected |

Post detail is the clearest structural win: removing one full serial wave is
worth one round trip (~25 ms at harness RTT) on every visit, before counting the
two reads that disappeared.

The 13-page total moved 2299 → 2121 ms (−7.9 %), which is **not** larger than the
same-code noise (−7.1 %), so it is reported as directional only.

### 4.3 Correctness spot-checks

* `/campus` summary rendered `40 published notices · 6 upcoming events · 2 clubs ·
  24 resources · 18 opportunities · 20 projects · 0 open study requests`, matching
  the database (40 = published and not expired under RLS; 45 exist in total).
* `/communities` rendered `4 communities · 2 study groups · 2 clubs`, matching
  `select kind, count(*) … group by kind` exactly.
* Student and admin renders of the public lists are identical (§2.3).

---

## 5. Files changed

| File | Change |
|---|---|
| `lib/data/public-cache.js` *(new)* | The two cached public readers, tags, 60 s window, failure handling, call-site constraints. |
| `lib/data/campus.js` | `getNotice`/`getEvent` request-cached; `listEvents`/`listCommunities` accept `withCount`; new `countCommunitiesByKind`; `getCampusSummary` can skip counts the caller already has. |
| `lib/data/feed.js` | `getPostDetail` merged into two waves; `hydratePosts` accepts pre-read author/reaction rows. |
| `lib/data/profiles.js` | `getProfileCounts`, `isBlockingProfile`, `getOwnProfile` request-cached. |
| `lib/actions/campus.js` | `revalidateTag` on the five notice/event writes (+ `/campus` path revalidation after a notice change). |
| `app/(app)/campus/page.js` | Cached notices/events; exact counts from the list queries. |
| `app/(app)/campus/noticeboard/page.js` | Cached public notices. |
| `app/(app)/campus/events/page.js` | Cached public events; review queue and own drafts start in parallel with the list. |
| `app/(app)/communities/page.js` | One tallied count read instead of three count queries. |
| `app/(app)/clubs/[id]/page.js` | Cached public events for the club. |
| `tests/data-public-cache.test.js` *(new)* | Published-only filters, failure not cached, tag/expiry values, and a source guard that every notice/event write revalidates its tag. |
| `tests/data-query-counts.test.js` *(new)* | `countCommunitiesByKind` single capped read; `withCount` plumbing; `getPostDetail` one-profile/one-reaction query shape. |

No schema, migration, RLS policy, permission, session or authentication change.
No dependency added. No service-role client introduced.

---

## 6. Checks

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm test` | **372 passed** (28 files; 361 before, +11 new) |
| `npm run build` | pass (Next.js 16.3.8) |
| `npm run perf:smoke` | all checks passed (every route, student + admin) |
| `npm run verify:db` | all migrations applied cleanly, every suite passed |
| `npm run audit:db` | 53 passed, **1 pre-existing failure** |

`audit:db` still reports two trigger functions with `PUBLIC` execute grants
(`guard_community_insert()`, `guard_gig_application_update()`). That failure
predates this branch, no SQL was touched here, and fixing grants is a
security-surface change that needs its own review.

---

## 7. Remaining low-risk opportunities

1. **`/market` summary** — three `HEAD marketplace_listings` counts (active/free/sold)
   could become one `count(*) filter (…)` query. Needs an RPC or a `.rpc()`-free
   SQL change; deliberately out of scope.
2. **`/campus` remaining five counts** (notices, resources, opportunities,
   projects, study) are still separate `head: true` queries. The notices count
   uses a different filter from the list (published vs published-and-unexpired),
   so it cannot reuse the list's count without changing what the page reports.
3. **`/clubs`** counts categories with a capped 500-row read; the same pattern
   could also return the total in one query.
4. **Event filter combinations** each get their own cache entry (calendar months,
   categories, clubs). That is correct but means the cache only pays off for
   repeated views of the same filter within a minute; a longer window (up to
   ~120 s) would raise the hit rate if staleness remains acceptable.
5. **`/chat`** could avoid the second `conversation_members` read if
   `conversation_inbox()` returned member ids — an RPC contract change.
6. **Vercel Speed Insights** (or any real-user monitoring) is still not enabled,
   so LCP/INP/CLS remain unmeasured in production. Adding it is a product/ops
   decision, not part of this task.
