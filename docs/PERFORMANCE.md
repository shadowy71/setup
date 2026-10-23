# Campus+ performance report — measured, not inspected

This document records the **measured** before/after of the performance pass over
Campus+. Nothing here is a claim from reading code: every number comes from the
local measurement harness in `scripts/dev/perf/`, which boots a real PostgreSQL
(migration 001 → 020), applies the real RLS policies, serves PostgREST/Auth
shapes through a stub with a **25 ms round trip per request**, and renders the
real production build of the app.

Raw evidence: `perf-results/before-*.json` and `perf-results/after-*.json`.

> A later pass (2026-10-23) audited the client payload as well and is recorded in
> [`docs/performance/2026-10-23-audit.md`](performance/2026-10-23-audit.md), including
> what could not be measured (no browser, no live deployment URL) and the ranked
> findings that were deliberately left for a future pass.

---

## 1. Headline numbers

Median of 3 runs per page, 25 ms simulated RTT per database/auth round trip.
`req` = Supabase requests made while rendering the page (server side).

### Student surfaces

| Page | before | after | change | req before → after |
| --- | ---: | ---: | ---: | ---: |
| Home (feed) | 306 ms | **243 ms** | −21 % | 14 → 9 |
| Campus hub | 197 ms | **147 ms** | −25 % | 15 → 13 |
| Noticeboard | 176 ms | **117 ms** | −34 % | 6 → 4 |
| Explore | 335 ms | **198 ms** | −41 % | 18 → 13 |
| Communities | 195 ms | **140 ms** | −28 % | 9 → 7 |
| Marketplace | 262 ms | **172 ms** | −34 % | 12 → 10 |
| Notifications | 169 ms | **105 ms** | −38 % | 6 → 4 |
| Chat list (DMs) | 391 ms | **193 ms** | −51 % | 10 → 7 |
| Chat thread | 284 ms | **210 ms** | −26 % | 11 → 9 |
| Profile (own) | 276 ms | **169 ms** | −39 % | 14 → 11 |
| Settings | 196 ms | **103 ms** | −47 % | 7 → 4 |
| Public profile | 245 ms | **175 ms** | −28 % | 15 → 13 |
| Post detail | 265 ms | **196 ms** | −26 % | 14 → 9 |
| **Total (13 pages)** | **3296 ms** | **2168 ms** | **−34 %** | **151 → 113** |

### Admin surfaces

| Page | before | after | change | req before → after |
| --- | ---: | ---: | ---: | ---: |
| Admin · users | 231 ms | **166 ms** | −28 % | 9 → 7 |
| Admin · roles | 190 ms | **130 ms** | −31 % | 7 → 5 |
| Admin · permissions | 193 ms | **138 ms** | −29 % | 7 → 5 |
| Admin · reports | 224 ms | **177 ms** | −21 % | 8 → 6 |
| Admin · content | 174 ms | **112 ms** | −36 % | 6 → 4 |
| Admin · marketplace | 169 ms | **107 ms** | −37 % | 6 → 4 |
| Admin · events | 162 ms | **102 ms** | −37 % | 6 → 4 |
| Admin · settings | 163 ms | **106 ms** | −35 % | 6 → 4 |
| Admin · flags | 163 ms | **106 ms** | −35 % | 6 → 4 |
| Admin · audit | 205 ms | **158 ms** | −23 % | 7 → 5 |
| Admin · counts | 374 ms | **287 ms** | −23 % | 21 → 19 |
| Moderation | 262 ms | **201 ms** | −23 % | 12 → 10 |
| **Total (12 pages)** | **2511 ms** | **1791 ms** | **−29 %** | **101 → 77** |

Time to first byte stayed ~10–20 ms throughout (the shells already stream), so
these figures are the time until the page's data has all arrived.

Payload sizes for the two worst offenders:

| Request | before | after |
| --- | ---: | ---: |
| `/chat` inbox read | 68 751 B (`messages`, 300 rows) | **4 109 B** (`rpc/conversation_inbox`, 10 rows) |
| `/settings` fixed reads | 7 requests (2× auth, 2× profiles, 2× roles, 2× settings) | 4 requests (1× auth, 1× embedded identity read, 1× settings, 1× badge) |

---

## 2. How it was measured

```bash
# terminal 1 — disposable PostgreSQL + migrations + fixtures + PostgREST/Auth stub
npm run perf:serve                 # http://127.0.0.1:3111, 25 ms RTT per request

# terminal 2 — production build pointed at that backend, then measure
npm run build && npx next start -p 3100
npm run perf:measure -- --label after-student --user student --runs 3
npm run perf:measure -- --label after-admin   --user admin   --runs 3
npm run perf:smoke                 # functional pass over every surface
```

* **Identical fixture, identical backend, both code versions.** The "before"
  numbers were produced by `git stash`-ing this change set, rebuilding and
  measuring, then restoring it and measuring again — so the comparison is not
  confounded by data drift, cache state or stub behaviour.
* Requests are counted from the stub's JSONL trace (`/__perf/trace`), not
  estimated; `Σ` in the raw JSON is the aggregate database/auth time the page
  burned (parallel requests overlap on the wall clock).
* The harness runs the **real** migrations, so every read in the measurements
  passes through the same RLS policies as production. Nothing in the harness
  disables RLS.

---

## 3. What was changed, and the bottleneck it removes

Every item below is the smallest change that removes a measured cost. No product
behaviour, route, permission or schema rule was changed.

1. **Session resolution: 4 sequential round trips → 2** (`lib/auth/session.js`).
   Every page awaited `auth.getUser()` → `profile_private` → `profiles` →
   `user_roles` one after another. The three identity reads are now one
   embed-ed read (`profile_private` with `profiles(...)` and
   `user_roles!user_roles_user_id_fkey(roles(...))`), flattened back into the
   exact same object shape. This is the fixed per-page cost: ~55 ms saved on
   *every* authenticated route (and 2 requests per route).
2. **React request-level dedupe for the shared reads** (`lib/supabase/server.js`,
   `lib/data/profiles.js`, `app/(app)/user/[username]/page.js`). `getServerClient`
   and `getPublicProfile` are wrapped in React `cache`, and the profile page's
   `generateMetadata` and body now pass the same normalised username, so the
   header and the body share one read instead of two.
3. **Own-profile double read removed** (`app/(app)/profile/page.js`,
   `app/(app)/settings/page.js`). Both pages re-selected the viewer's own profile
   row that the session load had already read; they now use it.
4. **Explore: two serial waves folded into the fan-out**
   (`app/(app)/explore/page.js`). `rpc/trending_posts` (~100–150 ms in the
   harness) and discussion hydration used to run strictly *after* the seven
   module queries. They now start with them. Explore: 335 → 198 ms, 18 → 13
   requests.
5. **Chat inbox: one RLS-scoped read model instead of a message window**
   (`supabase/migrations/20261005000020_020_chat_inbox.sql`,
   `lib/data/messaging.js`). The list fetched the newest 30 messages of every
   conversation — bodies and all — to render one preview line and an unread
   badge. `conversation_inbox()` returns exactly that (newest message + unread
   count in the same 30-message window) for the conversations the viewer can
   already see. It is `security invoker`, so RLS still decides every row; the
   SQL suite asserts that a non-member gets zero rows. Chat list: 391 → 193 ms,
   payload 68 751 → 4 109 B.
6. **Marketplace: category/summary/list fetch is one fan-out**
   (`app/(app)/market/page.js`). The tab's list and the seller identities now
   run in parallel with the summary counts instead of behind them.
7. **Payload trims on list reads** (`lib/data/feed.js`). Post lists no longer
   select `visibility`/`pinned` (neither is rendered — they are query filters),
   and `hydratePosts` skips the poll lookups when a list contains no polls,
   which removes three empty requests from `/home`, `/profile` and `/campus`
   renders (the inbox message window is gone entirely, see 5).

The database-side index review (129 indexes, feed/notification/message index
coverage verified with `EXPLAIN (ANALYZE, BUFFERS)`) found no missing index on
any hot read path; no new index was added, because none was justified by a real
query plan.

---

## 4. What was deliberately *not* changed

* **RLS stayed exactly as it was.** No policy was dropped, weakened or bypassed,
  and the new function runs as the caller (`security invoker`). Authorization is
  still decided by the database.
* **The auth decision is still `auth.getUser()`** — the network-verified read.
  The JWT is not trusted from the cookie alone, which would have been a security
  change rather than a performance one.
* **No cross-request caching of user-visible data.** Pages stay
  `force-dynamic`; nothing user-specific is cached where another user could
  receive it. `unstable_cache`/`revalidate` were not applied to
  RLS-scoped reads.
* **No product change.** Same routes, same components, same copy, same features,
  same pagination sizes, same admin workflows (notice publishing, role grants,
  moderation).

The only schema change is **additive**: migration 020 adds one read-only
function plus its grants (via the existing default-privileges rule) and one new
assertion block in `database/tests/03_messaging_privacy.sql`. `npm run db:bundle`
was re-run so `supabase/bundle/campus-plus-schema.sql` matches the migrations.

---

## 5. Remaining measured hotspots (left as-is, on purpose)

| Hotspot | Measurement | Why it is still there |
| --- | --- | --- |
| Admin · counts | 287 ms, 19 requests, slowest single count 170 ms | The 12 counts are `count(*)` over whole tables, so RLS evaluates its per-row predicate (`can_view_post`/`has_permission`/block checks) for every row: ~45 µs/row on this fixture (posts 11 ms / 240 rows, comments 41 ms / 720 rows, messages 43 ms / 420 rows). Making it faster means weakening RLS or caching counts across viewers — both out of scope. The session change alone took the page from 374 ms and 21 requests to 287 ms and 19. |
| `trending_posts` (Explore) | 95–150 ms | It aggregates comment participation across the 72-hour window with RLS applied per row; the score cannot be computed from an index. Explore is still 41 % faster because the call no longer blocks the rest of the page. |
| Profile / public profile HTML (168 kB) | flight payload 75 kB for 20 posts | The cost is the rendered card tree for 20 posts (poll cards dominate on this fixture), not the data. Reducing it means changing how many posts a profile lists — a product decision, not a safe refactor. |
| `campus_feed` on Home | ~56 ms, 9.6 kB | Five-branch `union all` with per-branch feature-flag predicates; it is the single Home request that starts the second wave. Its payload is already the minimum the cards need. |

---

## 6. Verification (all green)

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run test` (vitest) | 106 tests / 8 files passed (incl. the SQL-bundle contract test) |
| `npm run verify:db` | 20 migrations applied cleanly, 8/8 SQL suites passed — including the new `conversation_inbox` assertions (member sees their own row and the correct unread count; non-member sees zero rows) |
| `npm run build` | production build succeeds |
| `npm run perf:smoke` | 20/20: anonymous `/home` still redirects (307), every signed-in surface renders its data (feed posts, notices, events, trending, communities, marketplace listings, notifications, DM previews, thread, profile posts, post + comments, random lobby, settings), admin tabs render for staff, `/admin` shows no console for a plain student |

Manual product flows (notice publish/pin, role grants, moderation actions,
marketplace contact, Random, logout) were not re-driven through the browser in
this environment — there is no browser here — but none of their code paths were
touched, and the database-level guarantees behind them are covered by the eight
SQL suites, which still pass unchanged.
