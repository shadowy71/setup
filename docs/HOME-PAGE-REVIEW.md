# Home page review — "Busiest right now" rebuild

| | |
| --- | --- |
| **Branch** | `arena/08cbf0a3-setup` |
| **Reviewed** | 2026-11-02, working tree as delivered (not a separate commit) |
| **Scope** | Everything on `/home` affected by the trending rebuild, plus the API/DB seam it depends on |
| **Method** | Diff re-read line by line; pure helpers and rail rendered in Node; real SQL exercised on a disposable PostgreSQL cluster; full JS suite, lint and production build re-run |
| **Verdict** | **Approve.** The bug is fixed at the right layer, with no redesign and no fabricated data. Three actionable follow-ups (one low–medium, two low) plus four informational notes; none blocks shipping. |

---

## 1. What was reviewed

```
app/(app)/home/page.js                 (unchanged — checked for regressions)
components/home/HomeFeedClient.js      rail source, cache, refresh cadence
components/home/HomeRail.js           render, counters, bar widths
lib/social/activity-scale.js          normalization (the original defect)
app/api/home/feed/route.js            payload contract
lib/data/feed.js                      getTrendingPosts
lib/constants.js                      published formula / tuning knobs
supabase/migrations/…040…sql          trending_posts, indexes
app/styles/home.css, lumen.css        bar visuals
components/posts/{ReactionBar,CommentComposer,CommentActions}.js
lib/actions/social.js                 write-side revalidation
tests/*, database/tests/20_*          evidence
```

`app/(app)/home/page.js` itself is untouched: the page still renders its shell
immediately and hands data loading to `HomeFeedClient`. Good — the existing
architecture was preserved rather than replaced.

---

## 2. Data flow, before and after

**Before**

```
/api/home/feed → first 10 feed items (hydrated posts)
              → HomeFeedClient: sort by reaction_count + comment_count, take 3
              → HomeRail: activityScore() = likes + comments (lifetime)
              → activityBarPercentages(): divide by max of the 3 rows
              → 100% for the leader, always
```

**After**

```
reactions / comments rows in the window ┐
posts (published, campus-level)        ┴→ trending_posts() [one SQL aggregation]
                                          → /api/home/feed payload.trending[]
                                          → snapshot.trending (client cache + live refresh)
                                          → HomeRail: log scale vs fixed benchmark
                                          → width
```

The client no longer ranks, no longer sums counters, and no longer recomputes a
scale from whatever three rows happen to be visible. That is the correct place
to fix this bug: the defect was a *calculation*, not a CSS width.

---

## 3. Component-by-component assessment

| File / area | Change | Assessment |
| --- | --- | --- |
| `HomeFeedClient:468` | `trending` now comes from `snapshot?.trending` | ✅ Removes the stale/duplicated derivation. Also removes `postItems`/`posts`, which had no other consumer. |
| `HomeFeedClient:286–290` | Keeps last honest trending rows when the RPC reports `unavailable` | ✅ Correct: a failed read is not a quiet campus. |
| `HomeFeedClient:449–455` | 60 s visibility-gated `refresh(false)` | ✅ Sensible convergence for other students' engagement (Realtime intentionally drops counter-only updates). Coalesced and cache-aware; no polling storm. |
| `HomeFeedClient` (unchanged) | `loadMore` spreads the snapshot | ✅ Older pages keep the rail without a second trending read; `includeTrending = offset === 0` in the route matches this. |
| `HomeRail:27–31` | Bars from `post.score` + `TRENDING_FULL_SCALE` | ✅ One pure helper, absolute scale. Ranking left to SQL. |
| `HomeRail:150` | `data-hot` at 100% only | ✅ Optional distinction implemented subtly, no badge clutter. |
| `HomeRail` counters | `reaction_count` / `comment_count` unchanged | ✅ Preserved as requested; still real lifetime counters. |
| `activity-scale.js` | `Math.log1p` / benchmark; `activityScore` and relative `ceiling` deleted | ✅ Obsolete logic removed, not left behind. Handles `NaN`, `±Infinity`, negatives, invalid benchmark, clamps and rounds. |
| `app/api/home/feed/route.js` | One extra parallel RPC on newest page only | ✅ `page` object unchanged (paging tests still pass). `trendingUnavailable` is explicit. |
| `lib/data/feed.js` | `getTrendingPosts` returns `{ items, unavailable }` | ✅ The old array return could not distinguish failure from emptiness. No other caller existed. |
| `lib/constants.js` | Published formula, mirror, env-driven window/benchmark | ✅ Single documented source; guide renders it directly. |
| Migration 040 | Repaired existing `trending_posts`, same output contract | ✅ Explore and migration 014 grants keep working; `security invoker` keeps RLS authoritative. |
| Interaction components | `feed.invalidate('engagement', …)` on confirmed writes | ✅ Uses the provider's existing 450 ms batch; no new subscription, no per-card listener. |

---

## 4. Visual review of the Home rail

**Card layout, typography, rank numbers, previews, like/comment counters,
spacing and blue gradient bar are unchanged.** Only the measured width, its
transition, the track and a subtle full-scale highlight changed.

Representative rendering (20-character track), 2 / 1 / 0 likes:

```
BEFORE (relative to visible max)          AFTER (log scale, benchmark 25)
 2 ♥  ████████████████████ 100%           2 ♥  ███████░░░░░░░░░░░░  34%
 1 ♥  ██████████░░░░░░░░░  50%           1 ♥  ████░░░░░░░░░░░░░░░  21%
 0 ♥  ░░░░░░░░░░░░░░░░░░░   0%           0 ♥  ░░░░░░░░░░░░░░░░░░░   0%
```

- `transition: width var(--dur-panel) var(--ease-out)` with a
  `prefers-reduced-motion: reduce` guard — animates on engagement changes, not
  on every unrelated render. `max-width: 100%` backs up the JS clamp.
- `.rail-activity__bar` keeps its subtle translucent track; the light-theme
  override that painted the **track** with the accent colour was fixed, so a
  0% row no longer looks full in Lumen.
- `data-hot` slightly brightens only a genuinely full bar.
- Server-render check (`tests/home-rail.test.js`) asserts the literal
  `width:34%` / `width:21%` / `width:0%` markup and that no `width:100%`
  appears for low engagement.

> **Review limitation:** a browser visual pass on the real `/home` was not
> possible — this sandbox has no Supabase credentials, so the page cannot fetch
> live rows. The component-level server render plus the SQL-row tests are the
> evidence in its place.

---

## 5. Behavioural review (scenario evidence)

| Scenario | Before | After (score → bar) | Verdict |
| --- | --- | --- | --- |
| A · 2 / 1 / 0 likes | 100 / 50 / 0 % | 1.986→34 %, 0.993→21 %, 0→0 % | ✅ Fixed |
| B · 5 / 10 / 3 | 50 / 100 / 30 %, wrong order for 5 vs 10 relative scale | ranked B,A,C → 73 / 55 / 42 % | ✅ Monotonic |
| C · 25 / 15 / 8 | 100 / 60 / 32 % | 24.83→99 %, 14.88→85 %, 7.94→67 %; 30 points → 100 % | ✅ Approaches benchmark honestly |
| D · 100 old likes vs 12 recent | old post would lead on lifetime counters | 0.499 vs 11.918 → recent wins, old bar 0 % | ✅ Fixed |
| E · all zero | 0 / 0 / 0 % already (old helper short-circuited a zero ceiling), but rows still came from the loaded feed page | 0 / 0 / 0 %, deterministic `created_at desc, id asc`, real rows from SQL | ✅ Preserved + ranked |
| F · like → unlike | stale until a coincidental focus/visibility re-read; like/unlike triggered no refresh | score, rank and bar move on both writes; DB counter follows; duplicate like rejected | ✅ Fixed |

The SQL side was exercised with real `reactions`/`comments` rows, not just the
JS mirror: deleted posts excluded, distinct recent commenters counted, repeated
reads return identical ordering, no null/negative/infinite scores.

---

## 6. Performance & data integrity review

- One additional RPC per newest-page read, **in parallel** with the existing
  five reads; skipped entirely for `?offset>0`. No N+1, no "fetch all posts to
  rank them" — candidates are windowed by time and backed by two partial
  indexes. The old unbounded `count(distinct commenters)` scan is gone.
- Likes are counted from `reactions` rows; `reactions_unique_per_item` makes
  that one per student. No counter can be inflated by duplicates.
- `security invoker` + `status='published'`, `deleted_at is null`,
  `community_id is null` + RLS: deleted, hidden, blocked and community-scoped
  rows stay out.
- Client cache revision moves with engagement invalidations, so returning to
  Home inside the 15 s TTL still re-reads the truth.
- No new table, column or schema migration object besides the function
  replacement and two indexes.

---

## 7. Findings

### F1 · Low–Medium — `p_hours` is unbounded on the RPC
`trending_posts(integer, integer)` still accepts any positive window
(`greatest(coalesce(p_hours, 48), 1)`, migration 040 line 86). Probing the real
function: `p_hours = 1_000_000` is accepted and removes the effective time bound
from both aggregations (the probe DB has no posts so it returned 0 rows; on a
populated table both CTEs would read every reaction/comment row). Values above
`int32` fail at the driver. The app only ever passes 48, but PostgREST exposes
the RPC to every authenticated student.
**Recommendation:** clamp the window, mirroring `p_limit`'s clamp —
`least(greatest(coalesce(p_hours, 48), 1), 168)`. Add a database assertion for
an oversized `p_hours`.

### F2 · Low — first-load RPC failure hides the card with no state
`HomeFeedClient` correctly keeps the *previous* trending rows when
`trendingUnavailable` is true, but on a first visit there is nothing to keep:
`trending` is `[]` and `HomeRail` omits the whole "Busiest right now" card. That
is honest (no fabricated data) but silent; previously the rail always rendered
something.
**Recommendation:** render the `RailCard` with a one-line "Trending is
temporarily unavailable" state when `snapshot.trendingUnavailable` is set.

### F3 · Low — feed card counters can still disagree with the rail
`ReactionBar` keeps an optimistic `useState({ count, reacted })` seeded once
from props and never resyncs. The rail now follows the authoritative server
snapshot (including the 60 s convergence), so after someone else's like the
rail can show 3 ♥ while that post's card still shows 2 ♥. This is pre-existing
and outside the rail, but the rebuild makes it more visible.
**Recommendation:** derive the displayed count from props plus a local delta, or
key the control by the server count.

### F4 · Info — `participant_count` semantics changed silently
The RPC column used to mean distinct commenters over all time; it now means
distinct commenters inside the window. No in-repo consumer reads it (Explore
ignores it), so there is no user-visible regression, but any external caller of
the RPC sees a quiet change. Worth a line in release notes.

### F5 · Info — calibration has two sources of truth
`NEXT_PUBLIC_TRENDING_FULL_SCALE` / `NEXT_PUBLIC_TRENDING_WINDOW_HOURS` are
build-time values; half-life and comment weight come from `platform_settings`.
Changing the settings changes live scores but **not** the published formula
text in `lib/constants.js` or the guide. Documented in `docs/TRENDING.md`;
operators must update both together.

### F6 · Info — minor payload and accessibility nits
The RPC returns full `body` (up to 2000 chars), author identity and `gif` for
three rows; a server-side projection to the six fields the rail uses would trim
it. The bar remains `aria-hidden` with only `title="reactions"` /
`title="comments"` on counters, so screen readers get no notion of the score —
an `aria-valuenow`/sr-only label could be added without changing the visual
design.

### F7 · Info — the 60 s convergence refreshes the whole snapshot
It re-reads the feed page, not a trending-only endpoint. At most one request per
minute per visible tab, coalesced with live events. Acceptable; a dedicated
lightweight endpoint is a possible later optimisation, not a defect.

---

## 8. Drive-by changes (scope note)

Four unrelated baseline breakages were fixed while validating, and should be
read separately from the trending work:

1. `supabase/bundle/campus-plus-schema.sql` was **stale** at HEAD (migration
   039 missing). Regenerated; this also required
   `tests/poll-vote-policy.test.js` to match the *last* policy definition in
   the bundle rather than the first.
2. `database/tests/02_social_and_communities.sql` wrote `poll_closes_at` as
   `authenticated`, which migration 015 deliberately forbids; the fixture now
   switches to the trusted context. This is why `npm run verify:db` now passes
   all 20 suites.
3. `tests/validation.test.js` used a date-pinned future event (`2026-11-01`)
   that had gone stale; it now computes tomorrow.
4. `app/styles/home.css` gained the missing `@container home-hero (max-width: 21rem)`
   rule that an existing presentation test expected.

None of these change product behaviour; they repair tests/infrastructure that
were already failing on unmodified `HEAD`.

---

## 9. Verification evidence

| Check | Result |
| --- | --- |
| `npm test` | **91 files / 1076 tests passed** (HEAD: 88 files, 85 passed / 3 failed, 4 failing assertions) |
| `npm run lint` | clean |
| `npm run build` | compiled, 87 static pages generated |
| `npm run sw:check` | current |
| `npm run db:bundle -- --check` | up to date, 40 migrations |
| `npm run verify:db` | 40 migrations + **20 SQL suites passed** on disposable PostgreSQL |
| `npm run audit:db` | 67 passed, **3 pre-existing failures** (club-governance PUBLIC grants / `club_creation_requests` backup capture) — reproduced identically on unmodified `HEAD`, unrelated to this change |
| `tests/home-rail.test.js` | server-rendered rail asserts exact widths and `data-hot` |
| `tests/home-trending-route.test.js` | payload contract, failure flag, no re-read on paging |

---

## 10. Verdict

**Approve.** The misleading 100% bar is gone because the normalization is now
absolute and the score behind it is real, recent, time-decayed database
engagement — not because a different percentage was hard-coded. Ranking moved to
the one place that already owned it (`trending_posts`), the Home page kept its
architecture, dark theme, card layout and counters, and the rail now follows
actual writes. Everything requested in the brief is covered.

**Suggested follow-ups, in priority order:** F1 (clamp `p_hours`), F2 (visible
unavailable state), F3 (card counter resync), then F4–F7 as documentation,
payload and accessibility polish. None is a blocker.
