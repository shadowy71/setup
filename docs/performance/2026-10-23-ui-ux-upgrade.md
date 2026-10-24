# Campus+ — complete UI, UX and mobile-performance upgrade (2026-10-23)

Branch `arena/df5c6bc7-setup`, based on `dd94011`.

---

## A. Executive summary

Six small, targeted passes over the existing application — not a rebuild:

1. **One identity contract.** The shell no longer receives the session object,
   the auth id, the email or the permission set; `lib/identity/shell-user.js`
   derives the five fields it needs, once, on the server.
2. **One unread count.** The existing RLS-scoped query in `app/(app)/layout.js`
   feeds the header bell, the sidebar row and the mobile menu through one
   formatter, so a badge can never disagree with another badge.
3. **Navigation that tells the truth.** A single boundary-aware rule
   (`lib/navigation/active.js`) replaces per-component `startsWith` checks, so
   `/gigs/[id]` lights Gigs and only Gigs, and `/gigstore` lights nothing.
4. **Home in the right order.** On a 390×844 phone the composer moved from
   **1291 px down (1.53 screens)** to **446 px (0.53 screens)**, and the first
   feed card from **1785 px (2.11 screens)** to **1130 px (1.34 screens)** —
   measured in a real browser on the production build, not inferred from CSS.
5. **Explore separated from search.** Browse is now a compact directory of the
   canonical boards; `?q=` renders results only. Pagination reports `hasMore`
   from a page-size + 1 probe, continues by offset, and ignores stale
   responses. Explore's HTML fell from 119,516 B to 80,891 B (−32.3 %).
6. **Route-level CSS.** `home.css`, `login.css`, `timetable.css`,
   `sections.css` and `calendar.css` now ship with the routes that use them.
   Shared CSS on every route fell from **36.5 kB to 27.9 kB gzip (−23.6 %)**,
   verified in the build output and in the served `<link>` tags.

Plus two finishing touches the product was missing: the tab icon is now the
real Campus+ mark (generated from `logo.jpeg`), and the timetable prints
12-hour times ("1:10 PM") while keeping 24-hour strings in the data.

Verification: **33 test files / 436 tests pass**, `npm run lint` clean,
production build clean, **0 serious/critical axe violations** on Home at both
viewports, and the rendered-contrast audit reports **0 failures across 101
pages / 19,962 foreground samples**.

---

## B. Files changed

**New**

| File | Purpose |
|---|---|
| `lib/identity/shell-user.js` | Pure `toShellUser()` adapter: username, display name, division, roles, staff label — or `null` without a profile. |
| `lib/navigation/active.js` | `normalizePath`, `isActivePath`, `resolveActiveHref` — the one active-state rule. |
| `lib/notifications/format.js` | `formatUnread()` / `UNREAD_CAP` — hidden at 0, exact to 99, `99+` above, true count in the accessible name. |
| `app/(app)/home/layout.js` (extended) | Home's route stylesheet **and** the two intro font preloads. |
| `app/(app)/clubs/layout.js`, `app/(app)/gigs/layout.js` | Import `sections.css` for the two card trees. |
| `app/(app)/campus/events/layout.js` | Imports `calendar.css`. |
| `app/icon.png`, `app/apple-icon.png` | 128² and 180² icons generated from `logo.jpeg`. `app/icon.svg` (placeholder plus glyph) removed so only one icon link is emitted. |
| `scripts/dev/brand-icons.mjs` (`npm run brand:icons`) | Regenerates the icons: trims the paper to the ink, squares the crop, rounds the corners, quantises. |
| `scripts/dev/perf/mobile.mjs` | Real-browser mobile measurement (documented in file). |
| `tests/navigation-identity.test.js` | 14 tests for the identity adapter. |
| `tests/navigation-notifications.test.js` | 10 tests for badge formatting and the single-count wiring. |
| `tests/navigation-active.test.js` | 8 tests for the active-state contract. |
| `tests/search-pagination.test.js` | 15 tests for offset/hasMore/merge/URL state. |
| `tests/timetable-clock12.test.js` | 17 tests for the 12-hour reading and the shipped icon. |

**Edited (highlights)**

`app/(app)/layout.js` (adapter + one count), `components/layout/{AppShell,
ShellHeader,Sidebar,MobileMenu,BottomNav,AccountMenu}.js` (shared shell user,
shared badge, five tabs, dead bell branch removed), `app/styles/navigation.css`
(badge anchored to the glyph), `components/home/{HomePulse,HomeFeatureTiles}.js`
and `app/(app)/home/page.js` (hierarchy), `app/styles/home.css` (phone
density), `app/(app)/explore/page.js` + `lib/search/index.js` +
`components/search/SearchResults.js` (browse vs search, pagination),
`app/globals.css` and `app/{login,timetable}/layout.js` (CSS split),
`lib/timetable/{clock,index}.js` + `components/timetable/{TimetableLive,
TimetableViews}.js` (12-hour labels), `package.json` (`brand:icons`),
`tests/{home,sections,timetable,timetable-live}.test.js` (assertions updated to
the new intended behaviour — none weakened or deleted).

---

## C. Bug fixes

| # | Bug | Root cause | Implementation | Test |
|---|---|---|---|---|
| 1 | The unread badge painted **over the bell glyph** on mobile. | The badge was positioned against the 44 px button box, not the icon. | Badge nested inside a `relative flex` wrapper around `<Icon name="bell">`; `right/top: -0.375rem` relative to the glyph. | `navigation-notifications.test.js` (markup contract) + screenshot `perf-results/screens/after-shots/home-phone.png`. |
| 2 | `/gigs/[id]` lit **two** destinations, and `/gigstore` lit Gigs. | Prefix matching (`startsWith`) without a path boundary and without specificity. | `isActivePath` requires `path === href` or `path.startsWith(href + '/')`; `resolveActiveHref` returns the longest match so parents yield to children. | `navigation-active.test.js` 8/8 (`/gigs/abc`→Gigs, `/clubs/abc/edit`→Clubs, `/gigstore`/`/homework`/`/marketplace`→null). |
| 3 | `@undefined` could reach the chrome; the whole session was passed to client components. | Each component normalised `user.profile?.display_name` itself, and the layout spread the session into props. | One pure adapter returns five fields or `null`; layout derives once and passes only that. | `navigation-identity.test.js` 14/14 (student, blank name, no division, staff, null). |
| 4 | Explore mixed browse and search, and "Load more" could duplicate or skip rows. | The page always rendered the search surface; the API had no explicit continuation contract. | Browse mode and `?q=` mode are separate; `global_search` is called with `p_limit = pageSize + 1`, the extra row produces `hasMore`, the client continues by offset, drops duplicate ids on merge, and guards with a monotonic request id. | `search-pagination.test.js` 15/15 + live check (deep link `?q=aarav&scope=people` restored, typing wrote `?q=rob` with **no history entry**, clearing removed `q`). |
| 5 | `home.css` (the largest sheet) shipped on **every** route. | One `@import` in `globals.css`. | Route layouts import their own sheet; five imports removed from globals. | Build output: every route now serves `0b61sv1u3wzsg.css` (148,016 B / 25,770 gz) plus one small route sheet; Home additionally serves `1g7ophxqg20cq.css`. |
| 6 | The tab icon was the placeholder plus glyph. | `app/icon.svg` shipped as a placeholder. | `brand-icons.mjs` crops `logo.jpeg` to the ink, squares it, rounds the corners and writes PNG icons; the SVG was deleted so the route emits one `<link rel="icon">`. | `timetable-clock12.test.js` asserts both PNGs are valid squares and `app/icon.svg` is gone; the served HTML has `icon.png` 128×128 + `apple-touch-icon` 180×180. |
| 7 | The timetable read `09:00`, `13:10`. | Presentation used the raw schedule strings. | `formatClock12` / `formatClockRange12` / `formatPeriodLabel` in `lib/timetable/clock.js`; `periodRange` gained `fromLabel`/`toLabel`/`label12`; free ranges too; the live clock prints an explicit AM/PM. Data stays 24-hour. | `timetable-clock12.test.js` 17/17 + `timetable-live.test.js` updated to assert `Now: WDL · 9:00–11:00 AM.` and `Lunch break until 1:10 PM.` |

Regression caught by the suite during this pass: rewriting `app/(app)/home/
layout.js` to add the route stylesheet silently dropped the two `preload()`
font hints. `tests/intro.test.js` failed immediately; the file now carries both
the preloads and the import.

---

## D. UI improvements

* **Home hierarchy** — greeting → search + actions → stats → composer →
  compact Clubs/Gigs tiles → feed → rail. The hero is shorter, the actions are
  one row on a phone (Explore + a short "Search…" pill), the four real stats
  sit on one strip instead of a 2×2 block with wrapped labels, and the tiles
  use a vertical lock-up with the duplicate descriptions hidden on small
  screens.
* **Navigation** — Gigs and Clubs are first-class in the rail and palette,
  groups have consistent spacing, long names truncate instead of wrapping the
  badge, badges do not resize the dock, and the five mobile tabs are unchanged
  (Home, Explore, Market, Chat, Profile) with ≥44×44 targets and a
  non-colour-only current indicator.
* **Explore** — browse is a directory of the canonical boards plus trending,
  with scope chips as a shortcut into search; search is its own mode, with a
  visible result count for screen readers and an explicit end state.
* **Timetable** — 12-hour times with an explicit meridiem, `9–10 AM` column
  headers (both halves named when a period crosses noon), and a live clock whose
  AM/PM is as legible as the digits.
* **Post cards** — action row wraps instead of clipping at 320 px.

---

## E. Before / after

Measured on the production build with the repository's own harness
(disposable Postgres + Supabase stub at 25 ms RTT). "Median" = median of the
stated runs.

| Metric | Before | After | Δ |
|---|---|---|---|
| Shared CSS, gzip, every route | 36.5 kB | 27.9 kB | **−23.6 %** |
| Home CSS, gzip, `/home` | 36.5 kB | 33.4 kB | −3.1 kB |
| Explore HTML bytes | 119,516 | 80,891 | **−32.3 %** |
| Home HTML bytes | 198,567 | 199,979 | +1,412 B (+0.7 %) |
| Home route JS, gzip | 181.5 kB | 181.9 kB | +0.4 kB (noise) |
| Explore route JS, gzip | 180.3 kB | 171.1 kB | −9.2 kB |
| Home composer, 390×844 | 1291 px (1.53 screens) | **446 px (0.53 screens)** | −845 px |
| First feed card, 390×844 | 1785 px (2.11 screens) | **1130 px (1.34 screens)** | −655 px |
| Home mobile LCP, 390×844, unthrottled (3 runs) | 228 ms | 228 ms | unchanged |
| Home mobile LCP, 320×700 | 220 ms | 272 ms | +52 ms (see risks) |
| CLS, all routes, all viewports | 0.000 | 0.000 | unchanged |
| Horizontal overflow, 6 viewports | 0 | 0 | unchanged |
| Home FCP, 390×844, Slow 4G + 4× CPU | 1594 ms | 1248 ms | −346 ms (spreads overlap) |
| Home LCP, 390×844, Slow 4G + 4× CPU | 3022 ms | 2972 ms | −50 ms (spreads overlap) |
| Server TTFB, Home (single asset probe) | 435.5 ms | 269.2 ms | indicative only, one request |
| Server TTFB, Explore (single asset probe) | 234.1 ms | 163.7 ms | indicative only, one request |

**Not measured:** Lighthouse, field Core Web Vitals (CrUX), INP (not
collectable in this lab run) — reported as "not measured", not estimated.
Server TTFB above is a single request per route from `assets.mjs`, shown for
orientation only; no claim rests on it.

---

## F. Verification (actual command output)

```
npm test           → 33 files / 436 tests passed
npm run lint       → clean (eslint .)
npm run build      → Compiled successfully; 48/48 static pages generated
npm run test:contrast (--suite all)
                   → pageAudits 101, paintAudits 283, foregroundSamples 19,962,
                     iconSamples 4,974, focusStates 29, failures 0
scripts/dev/a11y-check.mjs --url /home
                   → 6/6 checks passed (0 serious/critical axe, depth canvas
                     decorative and untouchable, pointer depth writes a custom
                     property without a React re-render, visible focus ring)
```

Browser checks on the running production build (`scripts/dev/browser.mjs`):

* `/timetable/O`: `<th>` headers `9–10 AM … 5:10–6:10 PM`; rows `9:00 AM`,
  `12:10 PM`, `1:10 PM`; clock `11:14:32 PM`; no horizontal overflow at
  1440×900, 390×844 or 320×700; the rendered `<head>` carries exactly one icon
  link (`/icon.png`, 128×128) plus the Apple touch icon.
* `/explore?q=aarav&scope=people`: input, active chip and result group all
  restored from the URL; typing changed the address with
  `history.replaceState` (history length stayed 2 — no push entry); clearing
  removed `q` and emptied the results.
* Home: composer and first feed card inside the first 1.5 viewport heights at
  375/390/430 px; 320×700 is 1.68 (see risks).

Note for future runs in this sandbox: a build made **without**
`NEXT_PUBLIC_SUPABASE_URL` / `..._PUBLISHABLE_KEY` in the environment inlines
"unconfigured" into the client bundle, and `/login` silently redirects to
`/setup` after hydration. The measurements in this report were taken on a
rebuild with the harness values exported.

---

## G. Screenshots

Committed JSON results: `perf-results/ui-before-assets.json`,
`ui-after-assets.json`, `ui-before-mobile.json`, `ui-after-mobile.json`,
`ui-before-mobile-throttled.json`, `ui-after-mobile-throttled.json`,
`mobile-after-shots.json`. PNGs live beside them (ignored by git, generated by
`node scripts/dev/perf/mobile.mjs --screenshots`):

* `perf-results/screens/before-content/home-phone.png` — baseline Home
  (composer below the "Two ways into campus life" heading).
* `perf-results/screens/after-shots/home-phone.png` — Home after the pass.
* `perf-results/screens/after-shots/{explore,clubs,notifications}-phone.png`.
* `perf-results/screens/after-content/timetable-390.png` — 12-hour timetable.

---

## H. Remaining risks

1. **Mobile LCP did not improve.** At 390×844 it is identical (228 → 228 ms).
   At 320×700 it moved +52 ms (220 → 272 ms); the run-to-run spread at that
   viewport is 232–1036 ms, so this is inside noise, but it is not a win and is
   not claimed as one.
2. **Throttled numbers are bimodal.** Whether the intro overlay paints during a
   run decides between ~1.5 s and ~3 s LCP, so medians of three runs have
   overlapping spreads at every viewport. Only the CSS/JS byte reductions and
   the layout positions are treated as solid results.
3. **320×700 misses the 1.5-viewport feed target** (1.68). The composer is
   inside the first screen there (0.63); the extra height is the hero plus the
   stat strip.
4. **One extra `<link>` per route.** Splitting CSS trades 8.6 kB of shared
   bytes for a second stylesheet on routes with their own sheet. Next emits a
   `preload` for it; on very high-latency connections the second request could
   delay first paint. Revert threshold: any measured FCP regression.
5. **The icons are truecolour PNGs** (8.8 kB / 14.5 kB). `pngjs` cannot write
   paletted PNGs, so the 70-colour artwork stays 24-bit; a palette encoder
   would save a few kilobytes and is not worth a dependency yet.
6. **Timetable header labels are longer** (`11:10 AM – 12:10 PM`). The week
   table keeps its 84 rem minimum width and 8.5 rem columns, so nothing wraps,
   but the grid scrolls slightly further on a phone.
7. **Screenshots are not committed** (they follow the repo's existing
   convention of JSON-only performance artifacts); regenerate with the command
   above.

---

## I. Pull request

Opened from `arena/df5c6bc7-setup` → `main`:
**`fix(ui): improve campus navigation, Home discovery and mobile performance`**
— https://github.com/sitemango/setup/pull/36

`main` was never pushed to.

---

## J. Follow-up (2026-10-24): the weekend opens on Monday

**Request.** "On weekends it should show Monday timetable."

**Before.** Saturday and Sunday had no day of their own, so
`timetableDayFor()` returned `null`, `resolveDaySelection()` returned `null`,
and the page rendered an empty panel: "No classes this weekend".

**After.** The weekend opens on **Monday** — the next day the campus actually
runs — as a labelled preview. Nothing was invented and nothing is claimed:

| Rule | Behaviour |
|---|---|
| First paint | The **server** resolves the fallback (`defaultTimetableDay`) into `initialDay`, so the HTML already contains Monday's rows. No empty panel flashes before hydration. |
| Liveness | `isToday` is `selected === today` and `today` is `null` at the weekend, so there is **no NOW/NEXT badge, no `data-state`, no status line and no "Today" pill** on the previewed Monday. |
| Explanation | The day heading carries "It's the weekend — showing Monday's timetable." |
| Choice | Picking any weekday still pins it (and still shows the weekend note); the "Today" jump button is not rendered, because there is no today to jump to. |
| Rolling over | When the weekend ends, the effect re-resolves to the real weekday, so Monday becomes live at 00:00 without a reload. A pinned day still wins. |
| Data | Untouched: the source timetable is still Monday–Friday, 24-hour, and the week grid is unchanged. |

The old `.tt-weekend` CSS block and its markup were deleted rather than left
dead, and the two weekend assertions in `tests/timetable-live.test.js` were
rewritten to assert the new intended behaviour (Monday's rows present, the
weekend note present, zero NOW/NEXT/status/Today markers) — not removed.

**Verification.** `npm test` **33 files / 438 tests**, `npm run lint` clean,
`npm run build` clean. Browser check on a production build whose clock was
pinned to Saturday 24 Oct 2026, 10:05 IST:

```
clock      Saturday, 24 Oct
heading    Monday
note       It's the weekend — showing Monday's timetable.
rows       WDL-1/ENG-2/WDL-3 · EPH-1/DEL-2/WDL-3 · Lunch · EPH
selected   Monday (aria-pressed=true)
badges     0 now, 0 next, 0 status, 0 today pills
console    no errors
```

Choosing Wednesday then reloading kept `?day=Wednesday` and showed
Wednesday's rows with the same weekend note. On a Friday-pinned build the
weekday path is unchanged (`Now: WDL · 9:00–11:00 AM. Next: EPH at 11:10 AM.`,
one NOW badge, one NEXT badge, a "Friday, today" tab).
