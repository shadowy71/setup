# The installable, offline timetable

A first-year student opens `pccoe.in/timetable/o` on a phone in a block with no
signal, adds it to the Home Screen, and the icon keeps working — the real week,
the right division, today marked, NOW and NEXT ticking, with nothing sent to a
server. That is the whole feature. Everything below exists to make that claim
true rather than decorative.

This document covers four things the code cannot say by itself: what
"batch-specific install" means on each platform, what is stored where, what the
service worker is allowed to cache and why, and what remains genuinely
impossible because a browser will not do it.

* Code: `lib/timetable/{batch,offline,offline-store,offline-install,sw-policy}.js`,
  `lib/timetable/sw-entry.mjs`, `components/timetable/TimetableOffline*.js`,
  `components/timetable/TimetableOfflineUi.js`, `app/timetable/**`,
  `app/api/timetable/[division]/route.js`, `public/timetable/sw.js`.
* Tests: `tests/timetable-offline-{identity,store,ui}.test.js`,
  `tests/timetable-sw-policy.test.js`, `tests/timetable-install-plumbing.test.js`,
  and the browser gate `scripts/dev/timetable-offline-check.mjs`
  (`npm run verify:offline`, 51 assertions).
* It reuses `components/timetable/TimetableLive.js` and `lib/timetable/{schedule,clock,meta}.js`
  for rendering. There is no second timetable implementation.

---

## 1. One batch, one identity

The batch is the division letter — the only stable identifier the source
timetable has. Every identity the platform needs is derived from it, in one
place (`lib/timetable/batch.js`):

| Concern | Value for Division O |
| --- | --- |
| Canonical route (the launch target) | `/timetable/o` |
| Manifest | `/timetable/manifest/o` |
| Data | `/api/timetable/o` |
| Manifest `id` / app id | `campusplus-timetable-o` |
| `name` / `short_name` | `Division O (IT · Information Technology) timetable — Campus+` / `O · IT` |
| Stored record key | `batches` store, keyPath `division` = `O` |

Consequences that are asserted, not hoped for:

* `start_url` is a path, never a query parameter, and it is inside `scope`
  (`/timetable/`) — an install whose start URL escaped its scope would be
  refused by the browser.
* `short_name` differs for all eighteen divisions even where the branch label
  does not (`O · IT` vs `P · IT`), because a launcher deduplicates by name.
* Nothing is keyed on a display label. Renaming "Division O (IT)" to something
  else in the source document changes the button text, not the app's identity —
  an existing icon keeps launching the same batch, and the same stored record.
* An unknown letter resolves to `null` (`describeBatch('S') === null`), so a
  typo can never silently render somebody else's timetable. The routes 404 and
  `dynamicParams = false` keeps the build honest about the eighteen letters it
  knows.

## 2. What "install" means on each platform

There is no single web API for "put an icon on a home screen". The button
therefore says one of three true things, chosen from what the browser actually
offered (`installPathFor`), and never a fourth thing.

| Platform | What happens | What the UI says |
| --- | --- | --- |
| Android Chrome / Edge | `beforeinstallprompt` is captured silently at page load (with `preventDefault`, so no unsolicited infobar). A deliberate click on the action calls `prompt()` and the outcome is read back from `userChoice`; `appinstalled` is the only event that turns the label into "Added to Home Screen". Each batch installs as its own app, because the manifest `id` and `start_url` differ. | `Add Division O (IT) timetable to Home Screen` → `Waiting for installation confirmation…` → `Added to Home Screen` / `Installation dismissed` |
| iOS Safari (iPhone, iPad, and an iPad reporting as Mac) | No prompt API exists. The action opens a small sheet with the Share → Add to Home Screen steps, naming the batch. The offline copy is written **before** the instructions appear, because the OS gives the app its own data store the moment it is added and the save must already be in it. Each saved page becomes its own icon, and its own app, naturally. | `Add to Home Screen from Safari`, then the numbered guide |
| Desktop Chrome / Edge / Firefox | Chromium behaves as above (the prompt is available on desktop too, and "Install" appears in the address-bar or menu). Firefox has no prompt API at all: the sheet explains the browser's own "Pin tab" / bookmark route. | native where available, otherwise `manual` guide |
| Anything else, or a browser that declined the prompt | No dialog is invented, no success is claimed. The button remains a guide, and offline saving still works — those are tracked as separate states on purpose. | `Add this timetable to Home Screen` as a guide |

Two rules keep this honest in code:

* **Install evidence is never inferred from a click.** `installOutcome` moves to
  `accepted` only from `appinstalled` or a `display-mode: standalone` /
  `navigator.standalone` match. Dismissing the prompt says `Installation
  dismissed`, which is a different state from failure.
* **Offline readiness and installation are separate counters.** A student who
  refuses the icon still gets the offline copy, and the pill says so. A student
  whose install succeeded but whose storage is full is not told everything is
  fine.

What could not be verified in this environment, and is not claimed anywhere:
the native prompt itself. Headless Chromium never fires
`beforeinstallprompt` (`npm run verify:offline` reports
`offered: no (headless Chromium never fires it)`), so the guide path is what the
browser gate exercises. Real-device installs need the same gate run on those
devices.

## 3. What is stored where

Three stores, with three different jobs and three different failure modes.

**IndexedDB — the timetable itself.** Database
`campusplus-timetable-offline`, version 1, store `batches` keyed by division,
plus a `settings` store limited to an allow-list of key names. One record per
batch: `{ division, schemaVersion: 1, checksum, eventCount, bytes, savedAt,
snapshot }`. The snapshot is the page's own view model — five weekday entries,
each event with its lines (subject, faculty, room, batch-practical slash
groups), start/end in both `HH:MM` and minutes, kind, accent, the free-period
ranges, plus the source stamp and the upstream `generatedAt`. `TimetableViews`
never sees it: it renders the same component it renders online with.

* `validateSnapshot` runs **before** anything is written and again on read. A
  payload that is a day short, has an event ending before it starts, carries a
  Saturday, or whose self-declared checksum does not match is refused, not
  repaired. A stored record that no longer validates is dropped whole and
  reported as `dropped: 'schema'` — the UI then says "not saved", which is the
  truth, rather than rendering half a week.
* Writes are checksum-idempotent: re-saving an unchanged week does not touch
  `savedAt`, so "last synced" never drifts on a page nobody refreshed.
* `requestPersistence()` asks for the durable-storage grant once, before the
  first save, and never nags after a no. Without the grant the copy can still be
  evicted by the browser under storage pressure; the wording says "saved", not
  "guaranteed".
* Storage failures are codes, not exceptions: `quota`, `storage-unavailable`,
  `storage-error`. A device without IndexedDB (some private modes) falls back to
  a `localStorage` record, and the pill says "Stored in this browser's local
  storage". A device with neither keeps the live page and reports
  `Offline copy not saved`.

**`/api/timetable/[division]` — the only data route.** Public, like the page it
mirrors; `Cache-Control: public, max-age=300, s-maxage=86400,
stale-while-revalidate=604800`; the ETag *is* the snapshot checksum, so an
unchanged week is a 304. It reads the same `getDivisionTimetable` the server
component uses and touches no session, no Supabase client, no cookies — verified
in the placement test.

**Service worker — the page, not the data.** See §4.

Nothing in any of the three holds a token, a cookie, a session, a key or a
user id. There is nothing to hold: the timetable is public, the route is
unauthenticated, and the client never sends credentials on this path. The
offline test suite asserts the stored JSON contains no JWT-shaped string and no
secret-looking key names, and that no client module reads anything but
`process.env.NODE_ENV`.

## 4. Cache policy, in one table

`lib/timetable/sw-policy.js` is the whole decision; the shipped
`public/timetable/sw.js` is generated from it by `scripts/build-sw.mjs`
(`npm run sw:check` fails a build whose worker has drifted, and
`npm run verify` runs that check).

| Request | Decision | Cache |
| --- | --- | --- |
| Navigation to `/timetable…` (any batch, the offline shell) | network first, cache as fallback | `…-documents-v1` |
| `/_next/static/**` **when the referring document is under `/timetable/`** | cache first (content-hashed, so nothing can go stale) | `…-assets-v1` |
| `/brand/**`, `/fonts/**`, small images under `/timetable/` | cache first | `…-assets-v1` |
| The offline shell and the four launcher icons | precached at install | `…-core-v1` |
| `/api/**`, including this feature's own snapshot route | **bypassed** | — |
| `/home`, `/login`, `/logout`, `/auth/*`, `/admin`, `/moderator`, `/settings`, `/account-status`, `/onboarding`, `/setup`, anything signed-in | **bypassed** | — |
| Any non-GET, any cross-origin, any route payload / RSC fetch, `sw.js` itself, the shell's readiness marker | **bypassed** | — |

Why the JSON is not in CacheStorage: caching `/api/timetable/o` would put a
second, separately-versioned copy of the same data in a store this feature
cannot prune per batch and cannot validate. IndexedDB is the single source for
data; the worker's only job is the *document and its scripts*, which is exactly
what a browser refuses to load offline.

Ceilings, so a long-lived cache never becomes a liability: 24 documents,
220 assets, 256 kB per response. Beyond the ceiling the oldest entries are
dropped — never the offline shell, which is the last-resort document. Activation
deletes caches whose name this feature owns and no others (`isOwnedCache`), so
another offline app on the origin is untouched; `caches.clear()` is not
anywhere in this code, and `unregister()` is called only after checking that the
registration's `scriptURL` ends with `/timetable/sw.js`.

Cache keys are **pathnames only**, so `?day=tue`, `?v=bust#x` and the canonical
URL all address one entry.

## 5. Reading order, and the one bug that shaped it

Render order, always: **local first → refresh in the background → replace only
after a validated response → on failure keep the saved copy.**

1. On mount, `loadBatch(division)` reads IndexedDB. No network, no skeleton:
   if the student saved it, the page is already there.
2. A refresh is issued only for a batch that was saved at least once
   (`savedRef`). Opening a public timetable page must not create a record or
   write a "last synced" timestamp for somebody who never asked to save.
3. A response is accepted only if `validateSnapshot` passes and the division
   matches. Then, and not before, the cache is replaced. A 500, a timeout, a
   captive portal's HTML page, or a payload for another division all mean *keep
   what you have* and set `refreshFailed`, which turns the chip into
   `Saved copy · today 9:41 PM`.
4. If the document cannot load at all, the worker serves the cached copy
   (labelled `X-Campus-Plus-Offline: stale`); failing that, the offline shell —
   which reads IndexedDB and rebuilds the same view — but only when its
   readiness marker exists; failing that, a plain HTML notice.

The readiness marker is not paranoia, it is the record of a bug: a cached React
document whose lazily-imported chunk is missing paints *nothing* and throws
`ChunkLoadError` at the error boundary — worse than an honest notice. So a
document is cached together with every build asset its own markup names
(`extractAssetUrls`, re-read per save rather than hard-coded, because the names
are content-hashed and change every deploy), the worker `clients.claim()`s so
the installing tab's later chunk loads are cache-first, and the shell is served
only after a previous run stored it with zero failures. If the shell is not
known-complete, the student gets text.

**Updates.** A new build must not strand the page on half-new, half-old code:
the worker is registered with the *wide* scope (`Service-Worker-Allowed: /`, set
in `next.config.mjs` for `/timetable/sw.js`, which is also `no-cache`) so it
survives the route boundary, a new worker installs and goes to `waiting`, the
page shows "Update available", and only a deliberate tap posts
`cp:skip-waiting` and reloads. Cache names carry an explicit version; bumping
`SW_CACHE_VERSION` retires every old entry on activation. Nothing about the
timetable can change silently under a student's finger mid-class.

## 6. The action, and its states

One premium card (`TimetableInstallCard`) between the flagged-notice row and the
week table, plus a compact status chip in the header (`TimetableOfflinePill`)
that is the only always-visible element. No banner, no popup, no prompt on
arrival, nothing re-asked on the next visit: the card reads the device state and
renders accordingly. The copy lives in `primaryAction()` /
`offlineStateCopy()`, both DOM-free and unit-tested.

| State | Button | Chip |
| --- | --- | --- |
| Nothing saved yet | `Save timetable for offline use` | `Checking this device` → `Offline copy not saved` |
| Saving | `Preparing offline timetable…` (disabled) | `Saving offline copy…` with four named steps |
| Saved, install still offered | `Add Division O (IT) timetable to Home Screen` | `Offline copy ready · saved today 9:40 PM` |
| Prompt shown | `Waiting for installation confirmation…` | unchanged |
| Confirmed by the platform | `Added to Home Screen` | `Offline copy ready` |
| Prompt dismissed | `Installation dismissed` + the guide | unchanged |
| Prepare failed | `Could not prepare offline copy — Retry` | `Could not prepare offline copy`, detail names the reason |
| Refresh failed | unchanged | `Saved copy · yesterday 7:35 AM` |

The sheet holds the platform instructions, a "saved batches on this device"
list that switches between them (plain links, so it also works with the radio
off), the last-synced facts, and a `Remove` action that means it: the record
goes, and for "remove all", this feature's caches are dropped by name and its
own worker unregisters — after checking the script URL.

Presentation rules that are tested rather than promised: 40–44 px minimum
targets; `env(safe-area-inset-*)` padding, with `viewport-fit=cover` declared on
the `/timetable` layout (without it the bottom action sits under a home
indicator); every colour from the shared tokens, so the card is correct in
whatever theme the design system ships; `prefers-reduced-motion` disabling the
pill transition and the step pulse; the header chip never overlapping the
current/next indicator (it is a sibling inside the header, and a guard forbids
fixed full-viewport positioning or a huge `z-index` in this feature's CSS); and
the whole card rendered server-side so it does not flash.

## 7. Offline behaviour that is *not* a screenshot

Available with no network at all, from the saved copy alone: the five weekday
tabs and week navigation; the current-day marker; ongoing/next highlighting
computed from the device clock against the stored minutes; subject, room,
faculty and times, including the slash form of batch practicals and the
lunch/special kinds; switching to any other batch previously saved on the device
(one record each, independent checksums); the "no more classes today" /
free-period states, which are computed from the data rather than faked with an
arbitrary class.

Not offered, and not claimed anywhere: live changes, room re-assignments,
substitutions announced after the last save. The chip always carries the save
time, so a student knows how old the copy is — and the sheet says "the last week
we stored", never "the current week".

## 8. Verifying it

```bash
npm run sw:bundle && npm run sw:check   # the worker is generated; fail if it drifted
npm run lint && npx vitest run          # 116 new assertions across 5 files
npm run build && npm start              # a production build, no dev server
npm run verify:offline                  # 42 browser assertions in real Chromium
```

The last command is the only one that can honestly answer "does it work".
Its result, on the build shipped here (`node scripts/dev/timetable-offline-check.mjs`,
51/51, exit 0):

| Step | Checks | Result |
| --- | --- | --- |
| Worker registered at the wide scope, nothing saved before consent | 6 | ✓ |
| Save one batch: real week, versioned, checksummed, cache hygiene | 10 | ✓ — 30 events, 10 886 bytes, `/login` `/home` `/admin` `/api/**` all uncached |
| Offline reload of the saved page: rows, day switching, chip, calendar agreement | 9 | ✓ — `Division O · 7 rows`, five tabs walked |
| Unsaved batch, offline | 1 | ✓ — "Nothing saved for this timetable yet", not a blank page |
| Second batch, then both documents deleted from CacheStorage | 7 | ✓ — shell rebuilt `Division J · 8 rows` from IndexedDB while `Division O` still rendered as itself |
| Cold start with every page closed (worker retired, storage only) | 4 | ✓ |
| Placement (index and sign-in carry no action), keyboard, sheet, reduced motion, safe area | 9 | ✓ |
| Private-profile simulation (`serviceWorker.register` rejected) | 5 | ✓ — the save still landed, the page still rendered, and the chip said "this browser would not keep the page files" rather than over-promising |
| Platform honesty (no prompt in headless Chromium ⇒ guide path, no fake success) | 2 | ✓ |

Page errors during every offline step: zero. Storage measured for two batches:
1 702 kB, including the app shell and its chunks.

## 9. What remains impossible

* **A guarantee that a browser will offer an icon.** The prompt is the browser's
  to grant. The code captures, requests, and reports it — it cannot force it,
  and the label never implies otherwise.
* **Protection against the OS emptying storage.** An uninstalled web app on iOS,
  or a device under storage pressure with no durable grant, can lose IndexedDB.
  The feature asks for persistence once, keeps the payload ~11 kB per batch, and
  says "saved" rather than "permanent". Reopening the page online refreshes it.
* **iOS reading the manifest.** Safari's Add-to-Home-Screen uses the *page URL*
  and `apple-mobile-web-app-*` metadata, not `start_url`/`scope`. The metadata is
  emitted per batch (title carries the division name, `statusBarStyle`,
  `theme-color`), so the icon is named and coloured correctly — but the icon is
  the page's own artwork, not a manifest-controlled launcher icon, and iOS
  decides.
* **Multiple installs in one Firefox / one desktop browser tab strip.** Firefox
  has no install prompt for web apps on Android and no `beforeinstallprompt`
  anywhere; on desktop the honest substitute is pinning the tab or a bookmark,
  which the sheet says. No claim of "one icon per batch" is made there.
* **A service worker in `next dev`.** Deliberately not registered (it would pin
  a stale bundle between reloads). The chip states that offline caching is not
  active in development.
* **Frames.** Campus+ answers every production route with
  `X-Frame-Options: DENY`. That header was not touched; it is the reason the
  offline shell is warmed by the worker fetching it directly (`cp:precache-shell`)
  instead of the usual hidden-iframe trick.

## 10. Deployment

Nothing to configure. The worker, the manifests and the offline shell are static
files or public route handlers under `/timetable`, already covered by the proxy's
public prefix; no environment variable, no secret, no migration, no new
external service, no dashboard switch. `Service-Worker-Allowed: /` and the
worker's `no-cache` header are in `next.config.mjs` and travel with the build, so
`/timetable/sw.js` is served with the right headers on Vercel without any
`vercel.json` entry. Icons are emitted by `npm run brand:timetable-icons` from
`logo.jpeg` and committed, so a deploy cannot regress them.

The two platform preconditions are the ordinary ones: the site must be served
over HTTPS (it is), and a batch must have been opened online once — the flow
that the browser gate in §8 tests from a clean profile every run.
