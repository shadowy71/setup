# Galactic document intro

## Route scoping (home page only)

The animation used to be mounted in `app/layout.js` as `<GalacticIntro>{children}</GalacticIntro>`, so **every** document load — `/login`, `/setup`, `/profile`, `/market`, `/communities`, `/chat`, `/settings`, `/campus`, any deep link — shipped the overlay and the `inert` boundary, and the full choreography played (or half-played) before the visitor could use the page. Because the root layout survives client navigation, a sequence that had not finished could also stay on screen across a route change.

The fix is a route gate, not a redesign: `components/layout/GalacticIntro.js` now exports `LandingIntro`, and that is the only place the animation is mounted.

- **Where it plays:** the home page, `/home`. `/` is a redirect-only route (`app/page.js` paints nothing), so a document opened at `/` counts as a landing at the home page and the intro keeps playing when the redirect lands on `/home`.
- **Where it never plays:** every other path. `shouldShowLandingIntro()` requires `pathname === '/home'` *and* a document entry path of `/` or `/home`, so `/login`, `/setup`, `/profile`, `/settings`, `/communities`, `/market`, `/chat`, `/campus/*`, `/explore`, `/notifications`, `/rules`, `/moderator`, `/admin`, `/onboarding` and non-existent paths such as `/dashboard` or `/marketplace` render their children directly.
- **No replay:** a client-side navigation to `/home` from any other page does not start it (the document did not enter at the home page), and returning to `/home` after the intro finished does not start it again (the existing document-memory `completed` flag). Leaving `/home` unmounts the overlay, which runs the effect cleanup and clears every timer, frame request and listener.
- **No flash, no hydration mismatch:** the gate is a pure function of the route, so the server and the hydration render agree. `window.location.pathname` is read once, outside React, at bundle evaluation — before any Next client navigation can rewrite the URL — and the server uses the request pathname, which is the same value. The root layout still renders the same wrapper element in every case, so children never remount when the answer changes.
- **No work when it cannot show:** `GalacticIntro` takes an `enabled` prop; when the gate is closed the effect returns immediately, so no fonts are loaded, no timers are scheduled and no overlay is rendered. The font preload hints that used to sit in the root layout now live in `app/(app)/home/layout.js`, so routes that cannot show the intro no longer preload ~280 KB of fonts they never paint (and browsers no longer warn about unused preloads).

Because `/home` requires a session, an unauthenticated visitor who opens `/home` is redirected by the proxy/app before the overlay ever paints; the intro is therefore only seen by signed-in students on the home page. The route gate leaves the animation implementation in place; there is no GSAP in this repository (the effects are CSS keyframes driven by the phase attribute plus the JS startup/teardown timers), so there was no animation-library lifecycle to change. Unmount cleanup is the existing effect teardown.

## Root cause of the Edge/browser inconsistency

The intro used two independent startup paths: `document.fonts.load(...).then(start)` and an unconditional `later(start, 400)`. On a cold font cache — the normal first visit in Microsoft Edge, and any slow deployment — the 400 ms timer won. `start()` then called `document.fonts.check(...)`, which returned false while the request was still in flight, and permanently set `font-family: sans-serif` on only the two SVG `<text>` elements. The wordmark was measured and played in the fallback face (428 units instead of Syne's 659 at 84 px/800), while the tagline and Skip intro control could still swap to the custom faces when they arrived. That produced the late font, the different logo position and the mixed typography.

Three smaller problems made it engine-dependent:

- `FontFaceSet.check()` reports `true` for a family that has no matching `@font-face` because a fallback is always available, so it cannot be used alone as proof that a custom face exists.
- Measurement could run in the same task that resolved the load promise, before `document.fonts.ready`/layout had applied the new face. Chromium and Edge can differ in that timing.
- The Syne `@font-face` claimed `font-weight: 700 800` although the variable file's actual axis is 400–800. The face is valid at 800, but the descriptor did not describe the file.

## Integration

- `components/layout/GalacticIntro.js` and its CSS module implement the supplied galactic SVG choreography, including the 760×110 stage, 24-unit plus gap, stroke/fill timing, flare, stars, nebula, tagline and breathing glow.
- `app/layout.js` renders `<LandingIntro>{children}</LandingIntro>`: the route gate, not the animation. Only the home page (`/home`, plus the `/` redirect that leads there) mounts the overlay; children elsewhere are rendered directly, never inert.
- `app/(app)/home/layout.js` carries the two critical intro font preloads, because it is the only route that can show the animation. The obsolete readiness signal is still absent from `home/page.js`.
- Removed superseded `HomeLaunchGate.js`, `CampusIntroLoader.js`, `lib/intro.js`, and `app/styles/intro.css`, plus its global import. Existing old intro cookies are ignored, not read or modified.
- `public/fonts/` contains self-hosted Syne and Space Grotesk with their OFL licenses. No dependency manifest changes, external font CDN or new runtime service.
- `tests/intro.test.js` guards the architecture and font descriptors. `scripts/tests/galactic-intro.mjs` adds executable Playwright checks, including delayed and failed font requests.

## Fonts

Both self-hosted files are **variable** fonts, not static weight files:

| File | Family name in CSS | Real `fvar` axis | Used by intro |
| --- | --- | --- | --- |
| `public/fonts/Syne.ttf` | `Campus Galactic Syne` | `wght 400–800` | CAMPUS+, weight 800 |
| `public/fonts/SpaceGrotesk.ttf` | `Campus Galactic Space` | `wght 300–700` | tagline and Skip intro, weight 400 |

`GalacticIntro.module.css` now declares the actual ranges (`font-weight: 400 800` and `300 700`). The CSS family descriptors match the strings passed to `document.fonts.load()` and `document.fonts.check()`. The files' internal names do not matter; Space Grotesk internally calls itself "Space Grotesk Light", while its CSS family here remains `Campus Galactic Space`.

Syne uses `font-display: block` because the wordmark is hidden until the guarded startup completes, so it can never flash a fallback before the deliberate decision. Space Grotesk uses `swap` so the visible Skip intro control is readable from the first paint. Once the guarded startup begins playback, neither setting can change the intro's typography; the fallback path removes every reference to the custom families.

`app/layout.js` preloads exactly the two files the intro needs, with `as="font"`, `type="font/ttf"` and `crossOrigin="anonymous"` (font CORS mode). Each file is one variable face, so no unused static weights are preloaded. Both are served from `/fonts/` with HTTP 200 and `Content-Type: font/ttf`; the Playwright suite asserts those responses and that the preload links are present.

## Startup and fallback

There is one guarded startup sequence:

1. `introFontsReady()` loads the exact families, weights and glyph strings the intro paints:
   - `800 84px "Campus Galactic Syne"` with `CAMPUS+`
   - `400 13px "Campus Galactic Space"` with `THE PCCOE FORUMSkip intro`
2. It verifies that each `load()` returned at least one matching face whose `status` is `loaded`. This is stronger than `check()`, which can succeed on a system fallback. It then awaits `document.fonts.ready` and confirms both `check()` calls.
3. A 3,000 ms bounded timer is the only fallback trigger. A rejected request (network/parse error) falls back immediately; a request that never settles is caught by the timer. Both paths converge on one `settle()` guarded by `settled`/`started`/`finished`/`completed`, so the font callback, timeout and reduced-motion paths cannot start playback twice.
4. The startup locks `data-typography="loaded"` or `"fallback"` **before** measuring. The fallback rule removes all four custom-family references (logo, plus, tagline, Skip intro) so a late response cannot swap any glyph or move the wordmark. Two animation frames then let style/layout settle; a 250 ms bound covers throttled frames so startup can never stall on `requestAnimationFrame` alone.
5. `positionLockup()` measures both SVG texts in one pass with `getComputedTextLength()` (with a `getBBox()` defensive fallback), computes `(760 − campus − 24 − plus) / 2`, applies both `x` attributes, and only then commits `data-phase="playing"`. The 24-unit gap is therefore measured against the exact face that will animate.

The SVG `viewBox`, centred lockup, 24-unit gap and the stroke/fill formation concept are unchanged, so converting CAMPUS+ to generated SVG paths was deliberately not done: that would bypass `letter-spacing`/`dominant-baseline` styling, replace the dash units the draw animation depends on, and add commit weight for a problem already solved by measuring a verified face. The `getBBox()` fallback covers engines that refuse text metrics while the stage is `visibility: hidden`.

Playback timing remains phase-relative: flare 0.1 s, CAMPUS draw 0.55 s / fill 1.65 s, plus draw 1.3 s / fill 1.7 s, tagline 2.25 s, breathing 2.5 s, fade at 3.1 s and removal at 3.5 s. The plus now joins the final part of the word draw and fills alongside it. The compact mobile sequence still finishes in 1.7 s. The JS safety deadline is 7.05 s from mount (3.0 s maximum font wait + 3.5 s playback + 0.55 s slack), and the CSS stage has an independent 7.35 s visibility deadline derived from the same constant. The font wait is separate from playback, so a slow font request can extend the total time. Neither depends on animation events or SVG APIs.

A fallback now looks the same everywhere: all intro text uses `Arial, Helvetica, sans-serif`, the pair is centred with the same 24-unit gap, and the sequence still starts, fades and finishes on the normal timeline.

## Lifecycle

The root layout persists across Next client navigation. The route gate decides whether the animation exists at all; component state controls playback; a document-memory completion flag additionally protects against subsequent remounts. A full document load resets that memory, which is why refreshing the home page replays it while navigating back to it does not. No route mutations, cookies, local storage, or session storage are used.

Skip intro and Escape remove the overlay immediately without changing the URL. Focus returns to the content boundary when Skip held focus. Reduced motion reveals the application after approximately 100 ms without waiting for fonts or running the choreography. Timers, frame requests and listeners are cleaned up, including during Strict Mode effect replay. Only the fixed overlay clips overflow; document scroll styles are never changed. CSS is module-scoped.

Authentication, proxy protection, OAuth/PKCE processing, authorization, sign-out implementation and database schema are unchanged. The OAuth server route does not render the root layout or wait for the animation. Existing server redirects still apply; the intro never overrides their destinations.

## Route-scoping verification (2026-10-21)

Commands and results for this change:

- `npm run lint`: passed.
- `npm test`: 19 files / 231 tests passed, including the new pure route-gate matrix (`shouldShowLandingIntro` for `/`, `/home`, `/login`, `/setup`, `/profile`, `/settings`, `/communities`, `/market`, `/chat`, `/campus/events`, `/dashboard`, `/marketplace`, `/events`, and the client-navigation and document-memory cases).
- `npm run build`: passed.
- Server-rendered HTML of the production build (unauthenticated, `curl`): `/home` contains the intro markup and the Syne preload; `/`, `/login`, `/setup`, `/onboarding`, `/rules`, `/profile`, `/settings`, `/communities`, `/market`, `/chat`, `/campus`, `/notifications`, `/explore`, `/moderator`, `/admin` contain neither.
- `INTRO_BASE_URL=http://127.0.0.1:3000 node scripts/tests/galactic-intro.mjs`: passed — server HTML check, `/login`/`/setup`/`/rules` quiet (no overlay, no `inert`, no scroll lock, no intro font requests), the `/` redirect destination quiet, and no page/console errors. The choreography block prints an explicit **SKIP** because `/home` redirects to `/setup` for an unauthenticated visitor.

Because the signed-in home page cannot be reached in this sandbox (no Supabase credentials, no Google session), the animation-bearing path was verified in a **temporary local stub build** (a throwaway replacement of `app/(app)/layout.js`, `app/(app)/home/page.js`, `app/page.js` and one temporary link on `/rules`, all reverted before committing; the repository contains none of it). Against that build, all eight browser scenarios passed:

1. direct `/home` → intro appears over the real `AppShell` (z-index 99999, full viewport, sidebar and header covered), custom Syne face measured, no console/hydration errors;
2. `/home` → `/rules` → back to `/home` → no intro, no replay, no `inert` left behind;
3. `/` (redirecting to `/home`) → intro plays once the redirect lands, with no overlay painted on `/` itself;
4. direct loads of `/login`, `/setup`, `/rules`, `/profile`, `/settings`, `/communities`, `/market`, `/chat`, `/campus`, `/notifications`, `/explore` → no intro, no `inert`, no scroll lock, no intro font requests from those routes;
5. landing on `/rules` and client-navigating to `/home` (real Next `<Link>`, verified same document) → no intro;
6. refreshing `/home` replays; Skip removes the overlay immediately;
7. `prefers-reduced-motion: reduce` on `/home` reveals the page immediately;
8. leaving `/home` while the sequence is playing removes the overlay and stops every timer (nothing appears later).

Not verified: a real signed-in `/home` in this sandbox, Microsoft Edge, WebKit, and physical devices.

## Executed verification (2026-10-20)

Commands run in this sandbox:

- `npm run lint`: passed.
- `npm test`: 19 files / 229 tests passed.
- `npm run build`: passed (Next.js 16.4.2 production build).
- `git diff --check`: passed.
- `INTRO_BASE_URL=http://127.0.0.1:3000 node scripts/tests/galactic-intro.mjs` against the production build: all checks passed:
  - custom faces verified before the first animated frame; both preloads present; font responses HTTP 200 / `font/ttf`;
  - CSS flare/draw/fill/tagline/breathe delays match the phase-relative JS timing;
  - before the timing refinement, fade was recorded at 5.25 s and completion at 5.65 s after `playing`; the current targets are 3.1 s and 3.5 s;
  - no measured or typographic change while the sequence runs;
  - an artificial 900 ms font delay made playback wait and still measured the custom face, with positions identical to the no-delay run;
  - the 3,000 ms timeout produced a whole-intro fallback at ~3,000 ms, and a face arriving during playback did not change the font or the measured position;
  - aborted font requests produced the same fallback, completed, and left no `inert` or body scroll lock;
  - immediate Skip, query preservation, stale-timer replay, refresh replay, Tab/Escape focus reveal, client navigation, and reduced motion;
  - 320×844, 360×800, 390×844, 844×390 landscape, 1024×768 and 1440×900: no overflow, tagline/Skip inside the viewport, 24-unit gap;
  - no page errors, console errors or hydration warnings.
- HTTP smoke requests under the existing unconfigured deployment behavior: `/home`, `/market`, `/user/student`, `/setup` and `/rules` returned 200; `/`, `/login` and `/onboarding` returned their existing 307 to `/setup`. Missing-code `/auth/callback` returned its existing 307 to `/login?error=missing_code`, with no Set-Cookie header. `/fonts/Syne.ttf` (146,980 bytes) and `/fonts/SpaceGrotesk.ttf` (136,676 bytes) both returned 200 with `Content-Type: font/ttf` — no font 404s in the production build.
- `/user/student` logs one server-side `generateMetadata` TypeError (`Cannot read properties of null (reading 'from')`) because Supabase is unconfigured, while still answering 200. The same error and digest reproduce on the pre-change commit `6f1a371`, so it is pre-existing and outside this change; it is not a browser console or hydration error.

Browser used: Chromium 153 headless shell, supplied by a temporary, untracked `@sparticuz/chromium` npm installation (browser binaries and tooling are not in Git). Command:

```sh
LD_LIBRARY_PATH=/tmp/al2023/lib \
CHROMIUM_EXECUTABLE_PATH=/tmp/chromium \
INTRO_BASE_URL=http://127.0.0.1:3000 \
node scripts/tests/galactic-intro.mjs
```

## Microsoft Edge limitations and manual checklist

No Microsoft Edge executable or Windows environment is available in this sandbox, so **Edge itself was not tested**. Edge shares Chromium's rendering engine, but the Chromium results are not a claim of Edge verification. WebKit and real iOS/Android devices were also unavailable; the viewport tests are Chromium viewport emulation, not physical devices.

Run this checklist in current Microsoft Edge on Windows before shipping:

1. **Cold load.** Open an InPrivate window, DevTools → Network → Font, and load the deployment. Confirm `/fonts/Syne.ttf` and `/fonts/SpaceGrotesk.ttf` both return 200 and the preload links are used once each. The wordmark should appear already in Syne with no fallback flash; `document.querySelector('section[data-phase]')?.dataset.typography` should read `loaded` once `data-phase="playing"`.
2. **Slow network.** Throttle to Slow 3G (or use DevTools request throttling on `/fonts/*`) and reload. The intro must wait (up to 3 s) rather than start in a system font; if the budget expires, the whole intro switches to the fallback face and the logo, tagline and Skip intro control remain consistent.
3. **Alignment and no shift.** At 320, 390, 844×390 landscape and 1440 widths, inspect the SVG texts. In DevTools, `document.querySelectorAll('svg[viewBox="0 0 760 110"] text')` and `getBBox()` should show a 24-unit gap, a centred pair, and the same `x` attributes from the first `playing` frame through the fade.
4. **Late font.** Block `/fonts/*` in DevTools, reload, wait for playback to start in fallback, then unblock and reload the face into the cache. The running intro must not swap fonts or move. Repeat with the requests set to a long delay instead of blocked.
5. **Sequence.** Confirm flare, letter outlines, white fill/glow, tagline, breathing, fade (about 3.1 s) and removal (about 3.5 s) play in order. Escape and Skip must dismiss immediately without a URL change or replay; refresh must replay.
6. **Reduced motion.** DevTools Rendering → Emulate `prefers-reduced-motion: reduce`; reload and confirm the application is revealed without the choreography, and no console errors or hydration warnings appear.

## Other limitations

No live Supabase credentials/accounts were available. Login and protected routes use the existing unconfigured redirect to setup, so signed-in refresh, incomplete onboarding, sign-out and a real Google OAuth/PKCE round trip were not browser-verified. Existing auth and sign-out unit suites passed but do not replace those integration checks. Replay after completion is intentionally omitted; a full refresh starts a new document and replays.
