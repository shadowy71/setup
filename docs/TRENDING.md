# "Busiest right now" — trending mechanism

The Home rail is a small card with three discussions, their like/comment counters
and a blue activity bar. This note describes what the bar means now and why.

## What was wrong

`HomeFeedClient` built the rail from the first loaded feed page: it sorted those
posts by `reaction_count + comment_count` (lifetime totals) and took the top
three. `lib/social/activity-scale.js` then divided every score by the **largest
score in that set**, so the leader always rendered at 100%. With 2 / 1 / 0 likes
the leader's bar was completely full — the visual claimed "most popular on
campus" when it only meant "most popular among these three rows". The bars also
used stale counters: the shell's Realtime channel deliberately ignores counter
updates, and `revalidatePath('/home')` does not refresh the client-held
`/api/home/feed` snapshot, so a like or a comment often did not move the rail.

There was already a server-side `public.trending_posts(integer, integer)` RPC
(migration 011, used by Explore). It was repaired rather than replaced.

## Data flow now

```
reactions / comments (recent rows)      posts (published, campus-level)
              └──────── public.trending_posts(p_limit, p_hours) ────────┘
                         one SQL aggregation, RLS as invoker
                                    │  id, counters, score, rank
                     /api/home/feed (GET/POST, offset 0 only)
                                    │  payload.trending[]
                     HomeFeedClient → snapshot.trending (cached + live)
                                    │
                     HomeRail → activityBarPercentages(scores, benchmark)
                                    │
                              width: `${progress}%`
```

- The rail is **no longer derived from the loaded feed page**. One extra RPC is
  issued in parallel with the feed/events/notices reads of the newest page only;
  a "Show more" request keeps the rail already in the client snapshot.
- The frontend never recalculates engagement. It only turns the database's
  `score` into a width through one pure helper.
- `reaction_count` / `comment_count` shown beside each title remain the real,
  trigger-maintained lifetime counters.

## Score (migration 040, mirrored in `lib/constants.js`)

```
score = ( Σ likes·decay(age) + 2·Σ comments·decay(age) )
        × ( 0.5 + 0.5·2^(−postAge / 72h) )

decay(t) = (2^(−t/12h) − 2^(−window/12h)) / (1 − 2^(−window/12h))
           for 0 ≤ t ≤ window, else 0
```

| Knob | Default | Where |
| --- | --- | --- |
| `window` | 48 h (`TRENDING_WINDOW_HOURS`, `NEXT_PUBLIC_TRENDING_WINDOW_HOURS`) | `p_hours` passed by the server; 24–48 h intended |
| like weight | 1 | one `reactions` row; `reactions_unique_per_item` makes it one per student |
| comment weight | 2 | `setting_int('trending_comment_weight', 2)` |
| engagement half-life | 12 h | `setting_int('trending_half_life_hours', 12)` |
| post-age half-life / floor | 72 h / 0.5 | `setting_int('trending_post_age_half_life_hours', 72)` |

Only engagement inside the window counts. A hundred old likes with no current
activity score zero; twelve fresh likes can outrank them. A genuinely active old
post is still worth at least half of an equally active new post (the floor), so
"continue receiving engagement" really does keep a thread relevant. The decay
reaches exactly zero at the window edge, so there is no cliff of leftover
weight. No baseline, no random ordering, no fabricated engagement.

Candidates are posts with engagement in the window plus posts published inside
it. If the campus is completely quiet, the newest published campus posts are
returned with `score = 0`. Deleted/hidden, community-scoped and RLS-invisible
rows are excluded. Ordering is `score desc, created_at desc, id asc`, which is
deterministic even when every score is zero.

SQL stays `security invoker`: blocks, mutes, inactive accounts, moderation state
and community visibility are decided by the database, not by this function. Two
partial indexes (`reactions_recent_post_idx`, `comments_recent_published_idx`)
bound the windowed aggregations; the old unbounded `count(distinct commenters)`
scan over all comments is gone. No new table or column was added.

## Bar normalization (`lib/social/activity-scale.js`)

```
progress = clamp(round(100 × ln(1 + score) / ln(1 + benchmark)), 0, 100)
```

`benchmark = TRENDING_FULL_SCALE = 25` like-equivalent points, overridable with
`NEXT_PUBLIC_TRENDING_FULL_SCALE` (see `.env.example`). It is an **absolute**
scale: adding a busier discussion to the set does not rescale the others. A bar
reaches 100% only when `score >= benchmark` — rounding cannot promote a
sub-benchmark score to full. Invalid, negative, infinite or `NaN` scores become
0%; widths are rounded, clamped and cannot exceed the track.

| Score | Bar (benchmark 25) |
| --- | --- |
| 0 | 0% |
| 1 | 21% |
| 2 | 34% |
| 5 | 55% |
| 10 | 74% |
| 20 | 93% |
| 25+ | 100% |

Raise the benchmark as the campus grows; the formula does not change.

## Keeping it in sync

- A confirmed like/unlike (post), comment or comment deletion announces one
  `engagement` invalidation through the existing `LiveFeedProvider` queue
  (450 ms batch). `HomeFeedClient` coalesces that into one forced re-read after
  700 ms; `LiveFeedSync` throttles server-rendered boards to one refresh per
  4 s. A new post already uses the composer's `local` invalidation.
- The cache revision moves with the invalidation, so returning to Home inside
  the 15 s cache window still re-reads authoritative data.
- A failed trending RPC returns `trendingUnavailable: true` and the client keeps
  the last honest rows instead of blanking or inventing a list.
- Counter-only `posts` updates from *other* students are still dropped by the
  Realtime channel (that is what stops a busy campus from making every open tab
  re-query). A visible Home therefore converges once a minute through the same
  coalesced `refresh(false)` path — at most one extra request, gated on
  `visibilityState`, and skipped entirely while the cache is still fresh.
- Focus/visibility re-reads, the 20 s offline fallback and the Realtime
  reconcile all keep working as before.

## Verification

`tests/activity-bar.test.js` pins the absolute log scale; `tests/trending.test.js`
pins the SQL/JS defaults and runs scenarios A–F (2/1/0, 5/10/3, 25/15/8, 100
historical vs 12 recent, all zero, like→unlike); `tests/home-trending-route.test.js`
pins the API seam; `database/tests/20_busiest_trending.sql` exercises the real
SQL with real reaction rows.

## Limitations

- The score uses reaction/comment **rows**, so an unlike deletes the row and
  genuinely removes its weight; a re-like is a new, real recent event.
- Counters next to the title are lifetime totals while the bar measures recent
  activity. That is intentional: an old popular thread should not look busy now.
- Calibration is manual. 25 points is a starting benchmark for this campus;
  `NEXT_PUBLIC_TRENDING_FULL_SCALE` and the `platform_settings` keys above let
  an operator tune it against actual activity. Changing the SQL weights through
  `platform_settings` changes the live score but not the published formula text
  in `lib/constants.js` / the guide — update both together when recalibrating.
- The window is bounded by time, not by a count of posts; a very large campus
  should keep the window at 24–48 h and adjust the benchmark instead.
