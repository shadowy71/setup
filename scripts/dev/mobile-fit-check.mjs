#!/usr/bin/env node
/**
 * Phone-viewport fit check (development tool).
 *
 * Why this exists: a phone browser lays a page out at the device width, then treats
 * the *document's* scrollable overflow as a request for more room. It does not show a
 * scrollbar — it widens the layout viewport and scales the whole page down, which is
 * what "the page glitches out and zooms out to make everything smaller" is. The
 * trigger is often not present at load time: on `/timetable/o` the 84rem week grid
 * lives inside a closed `<details>`, so the page looks fine until "See the full week
 * at a glance" is tapped, and `innerWidth` jumps 390 → 1255. A check that only
 * measured the page as served would have passed it.
 *
 * So this walks every route in a real phone browser, taps every disclosure it finds,
 * and asserts that the layout viewport is still the device width afterwards. Where a
 * route owns a horizontal scroller it also asserts the *opposite* failure — the wide
 * content is still scrollable, still reaches its far end, and still pins its sticky
 * column — because `overflow: hidden` would silence the zoom by throwing the table
 * away, and that is not a fix.
 *
 *   node scripts/dev/mobile-fit-check.mjs [--url http://127.0.0.1:3100]
 *                                         [--only timetable] [--viewport phone,small]
 *                                         [--shots]
 *
 * The app must be running (the development server is fine; a production build is
 * better, and needs the NEXT_PUBLIC_* variables at build time or every page renders
 * /setup). With the perf harness up (`npm run perf:serve`) each route is also walked
 * with a real session, because the signed-in shell adds a header, a nav sheet and a
 * command trigger that the signed-out page never renders.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { launchBrowser } from './browser.mjs';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    only: { type: 'string' },
    viewport: { type: 'string' },
    shots: { type: 'boolean' },
  },
  allowPositionals: true,
});

const BASE = (values.url || process.env.FIT_CHECK_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const OUT = 'node_modules/.cache/mobile-fit';
const INTRO_KEY = 'campus_intro';

/**
 * The widths that have to hold a page. 320 is the narrow end worth keeping honest,
 * because it is where a fixed `min-width` first stops fitting; 390 is the common
 * phone; 1440 catches a desktop that leans on a media query nobody re-checked.
 * `isMobile` is not decoration — it is what makes the layout viewport follow the
 * document's overflow the way a real phone does, which is the bug being measured.
 */
const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  small: { viewport: { width: 320, height: 720 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

/** Routes that answer without a session. `/post` is absent on purpose: it is `/post/[id]`. */
const PUBLIC_ROUTES = [
  '/',
  '/timetable',
  '/timetable/o',
  '/timetable/b',
  '/guide',
  '/onboarding',
  '/login',
  '/rules',
  '/legal',
  '/community',
  '/setup',
];

const APP_ROUTES = [
  '/home',
  '/explore',
  '/campus',
  '/communities',
  '/clubs',
  '/chat',
  '/notifications',
  '/profile',
  '/settings',
  '/market',
  '/gigs',
  '/admin',
  '/moderator',
];

/**
 * Everything the sandbox cannot see or Next only does in development.
 *
 * Each of these has been confirmed as environmental or framework-side, not a defect
 * in the page: the analytics script Vercel only injects on its own host; the router's
 * own cancelled prefetches; the offline stub's websocket; Next's dev-only RSC timing
 * flush; and the "unique key" warning that fires whenever a *server* component passes
 * several children to a client component — the keys are set on the server and dropped
 * by the flight serialization, so no app change silences it, and it is absent from a
 * production build (checked against `next start`). They are still counted and
 * reported as `noise:` so a run says what it could not see.
 */
const NOISE =
  /(favicon|va\.vercel-scripts|_vercel\/insights|ERR_ABORTED|_rsc=|realtime\/v1\/websocket|Failed to fetch|net::ERR_CONNECTION_CLOSED|flushComponentPerformance|cannot have a negative time stamp|unique "key" prop|Check the render method of|Download the React DevTools|MIME type)/i;

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok), detail });
  console.log(`  ${ok ? '\u001b[32mok\u001b[39m  ' : '\u001b[31mFAIL\u001b[39m'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const runRoute = (path) => !values.only || path.includes(values.only);
const ONLY_VIEWPORT = values.viewport ? values.viewport.split(',').map((v) => v.trim()) : null;

/* ------------------------------------------------------------------ session */

let session = null;
const harnessFile = 'node_modules/.cache/perf/harness.json';
if (existsSync(harnessFile)) {
  const harness = JSON.parse(readFileSync(harnessFile, 'utf8'));
  const { createSessionCookie } = await import('./perf/session.mjs');
  try {
    session = await createSessionCookie(harness.stubUrl, harness.student.email);
    console.log(`  session: ${harness.student.email}`);
  } catch (error) {
    console.log(`  session: unavailable (${error.message})`);
  }
} else {
  console.log('  session: no harness.json — signed-in routes skipped');
}

/* ------------------------------------------------------------------ browser */

const browser = await launchBrowser();

async function openPage(viewport, { signedIn = false } = {}) {
  const context = await browser.newContext({ colorScheme: 'dark', reducedMotion: 'reduce', ...viewport });
  // The cinematic intro is a first-visit overlay over Home; it is not part of any
  // page's own layout and would sit over every measurement below it.
  await context.addCookies([{ name: INTRO_KEY, value: '1', url: BASE }]);
  if (signedIn && session) {
    for (const cookie of session.cookies) {
      await context.addCookies([{ name: cookie.name, value: cookie.value, url: BASE, sameSite: 'Lax' }]);
    }
  }
  const page = await context.newPage();
  const problems = [];
  let noise = 0;
  const isNoise = (text, url) => NOISE.test(String(text)) || (url && NOISE.test(String(url)));
  page.on('pageerror', (error) => {
    const message = String(error?.message ?? error);
    if (isNoise(message)) noise += 1;
    else problems.push(`pageerror: ${message}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    let url = '';
    try {
      url = message.location()?.url ?? '';
    } catch {
      url = '';
    }
    if (isNoise(message.text(), url)) noise += 1;
    else problems.push(`console: ${message.text().slice(0, 180)}`);
  });
  return { context, page, problems, noiseCount: () => noise };
}

/**
 * How wide this page wants to be, in the browser's own numbers.
 *
 * `innerWidth` is the layout viewport it actually gave the page: on a phone it equals
 * the device width until the document overflows, at which point it grows to the
 * overflow and the scale drops. `offenders` names the boxes sticking out of the
 * document, skipping anything inside a scroll container — those scroll on purpose.
 */
function readFit(page, deviceWidth) {
  return page.evaluate(`(() => {
    const de = document.documentElement;
    const vv = window.visualViewport;
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('svg,[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.right > de.clientWidth + 1.5 || r.left < -1.5) {
        let inScroller = false;
        for (let a = el.parentElement; a; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') { inScroller = true; break; }
        }
        if (inScroller) continue;
        const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/)[0] : '';
        offenders.push(el.tagName.toLowerCase() + cls);
      }
    }
    const meta = document.querySelector('meta[name="viewport"]');
    return {
      innerWidth: window.innerWidth,
      deviceWidth: ${deviceWidth},
      docClientWidth: de.clientWidth,
      docScrollWidth: de.scrollWidth,
      scale: vv ? Number(vv.scale.toFixed(3)) : null,
      viewportContent: meta ? meta.getAttribute('content') : null,
      detailsTotal: document.querySelectorAll('details').length,
      detailsOpen: document.querySelectorAll('details[open]').length,
      offenders: Array.from(new Set(offenders)).slice(0, 6),
    };
  })()`);
}

/**
 * A route that redirects (bare `/setup` sends a configured device to `/home`) tears
 * the execution context down mid-measurement. That is the page answering, not the
 * page failing, so the measurement is taken again once the navigation has landed.
 */
async function safeFit(page, width) {
  try {
    return await readFit(page, width);
  } catch (error) {
    if (!/Execution context was destroyed|navigation/i.test(String(error?.message ?? error))) throw error;
    await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(600);
    return readFit(page, width);
  }
}

const fitFailed = (m) => m.docScrollWidth > m.docClientWidth + 1 || m.innerWidth > m.deviceWidth + 1 || m.offenders.length > 0;

/** Tap every disclosure on the page — the gesture the user made, not a property write. */
async function openDisclosures(page) {
  const count = await page.evaluate(`document.querySelectorAll('details').length`);
  for (let i = 0; i < count; i += 1) {
    const summary = page.locator('details').nth(i).locator('> summary');
    if (await summary.count()) {
      await summary.click({ force: true, timeout: 3_000 }).catch(async () => {
        await page.evaluate(`(() => { const d = document.querySelectorAll('details')[${i}]; d.open = true; })()`);
      });
    } else {
      await page.evaluate(`(() => { document.querySelectorAll('details')[${i}].open = true; })()`);
    }
  }
  await page.waitForTimeout(400);
  return count;
}

/**
 * The scroller's own contract, measured rather than assumed: the wide table has to
 * stay reachable and the sticky Day column has to stay pinned to the left edge while
 * it scrolls. This is what separates `contain: paint` from `overflow: hidden`.
 */
function readScroller(page) {
  return page.evaluate(`(() => {
    const scroller = document.querySelector('.tt-scroll');
    if (!scroller) return null;
    const box = scroller.getBoundingClientRect();
    // Sticky cells pin to the padding edge, so the 1px border belongs to neither side
    // of these comparisons. The 10px scrollbar gutter that scrollbar-gutter:stable
    // reserves is why scrollWidth - clientWidth is not the real maximum, so the end of
    // the run is measured where it matters: against the last cell's own edge.
    const left = box.left + scroller.clientLeft;
    const dayCell = scroller.querySelector('tbody th[scope="row"]');
    const table = scroller.querySelector('table');
    const jump = (value) => scroller.scrollTo({ left: value, behavior: 'instant' });
    // behavior:'instant' is not a detail: globals.css can set scroll-behavior:smooth,
    // and then a bare scroller.scrollLeft = n animates and reads back the old value.
    jump(0);
    const atRest = Math.round(dayCell.getBoundingClientRect().left - left);
    const tableRightAtRest = table.getBoundingClientRect().right;
    jump(1e6);
    const reached = Math.round(scroller.scrollLeft);
    const pinned = Math.round(dayCell.getBoundingClientRect().left - left);
    // How far the table travelled must be how far the box scrolled — measured on the
    // content rather than on scrollWidth arithmetic, because scrollbar-gutter:stable
    // makes scrollWidth - clientWidth disagree with the real end of the range by the
    // width of the reserved gutter.
    const moved = Math.round(tableRightAtRest - table.getBoundingClientRect().right);
    const lastCellVisibleAtEnd = Math.abs(moved - reached) <= 2;
    jump(0);
    return {
      width: Math.round(box.width),
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      needsScroll: scroller.scrollWidth > scroller.clientWidth + 1,
      scrolls: reached > 20,
      reached,
      moved,
      lastCellVisibleAtEnd,
      atRest,
      pinned,
      dayColumnPinned: atRest === 0 && pinned === 0,
    };
  })()`);
}

const SHOT_ROUTES = ['/timetable/o', '/onboarding', '/guide'];

/* ---------------------------------------------------------------------- runs */

const ROUTES = [
  ...PUBLIC_ROUTES.map((path) => ({ path, signedIn: false })),
  ...(session ? APP_ROUTES.map((path) => ({ path, signedIn: true })) : []),
].filter((route) => runRoute(route.path));

if (values.shots) mkdirSync(OUT, { recursive: true });

for (const [name, contextOptions] of Object.entries(VIEWPORTS)) {
  if (ONLY_VIEWPORT && !ONLY_VIEWPORT.includes(name)) continue;
  const width = contextOptions.viewport.width;
  console.log(`\n\u001b[1m${name} · ${width}px\u001b[22m`);
  for (const { path, signedIn } of ROUTES) {
    const label = `${path}${signedIn ? ' (signed in)' : ''}`;
    const { context, page, problems, noiseCount } = await openPage(contextOptions, { signedIn });
    try {
      const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(900);
      const asServed = await safeFit(page, width);

      const shots = values.shots && SHOT_ROUTES.includes(path);
      if (shots) await page.screenshot({ path: `${OUT}/${name}${path.replace(/[^a-z0-9]+/gi, '-')}.png` });

      const total = await openDisclosures(page);
      const expanded = await safeFit(page, width);
      if (shots) {
        await page.waitForTimeout(200);
        await page.screenshot({
          path: `${OUT}/${name}${path.replace(/[^a-z0-9]+/gi, '-')}-open.png`,
        });
      }

      const scroller = await readScroller(page);
      const noise = noiseCount();
      const detail =
        `viewport ${expanded.innerWidth}/${expanded.deviceWidth}px · doc ${expanded.docScrollWidth} vs ${expanded.docClientWidth}` +
        ` · scale ${expanded.scale} · disclosures ${total}` +
        (problems.length ? ` · ${problems.length} console error(s): ${problems[0]}` : '') +
        (noise ? ` · noise: ${noise}` : '');

      check(`${label} · served page fits ${width}px`, !fitFailed(asServed), `scrollW ${asServed.docScrollWidth}${asServed.offenders.length ? ` · out: ${asServed.offenders.join(', ')}` : ''}`);
      check(`${label} · still fits ${width}px with every disclosure open`, !fitFailed(expanded), detail);
      if (scroller) {
        // Either it fits (nothing to scroll at this width, which is not a failure),
        // or it scrolls the whole way and the sticky Day column rides along.
        check(
          `${label} · week grid scrolls the whole way and pins its Day column`,
          (!scroller.needsScroll || (scroller.scrolls && scroller.lastCellVisibleAtEnd)) && scroller.dayColumnPinned,
          `${scroller.needsScroll ? `scrolls ${scroller.reached}px` : 'fits at this width'} · ${JSON.stringify(scroller)}`,
        );
      }
      check(`${label} · no console errors`, !problems.length, problems.slice(0, 3).join(' | '));

      // A page that cannot be pinched back is a worse page when something on it
      // does overflow, so the meta tag is read for both halves: the width the
      // layout starts from, and whether the reader can get their scale back.
      const meta = asServed.viewportContent || '';
      const capped = /maximum-scale=([1-4])(?:\.0*)?(?!\d)/.exec(meta);
      check(
        `${label} · viewport meta is device-width and still zoomable`,
        /width=device-width/.test(meta) && /initial-scale=1\b/.test(meta) && !/user-scalable=no/.test(meta) && !capped,
        `content="${asServed.viewportContent}"${capped ? ` — zoom capped at ${capped[1]}×` : ''}`,
      );
      const landed = new URL(page.url()).pathname;
      check(
        `${label} · answered`,
        response && response.status() < 500,
        `HTTP ${response?.status()}${landed !== path ? ` · lands on ${landed}` : ''}`,
      );
    } catch (error) {
      check(`${label} · loaded`, false, error.message);
    } finally {
      await context.close();
    }
  }
}

await browser.close();

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed · report: ${OUT}/report.json`);
if (failed.length) {
  console.log('failed:');
  for (const f of failed) console.log(`  · ${f.label}${f.detail ? ` — ${f.detail}` : ''}`);
}
if (values.shots) console.log(`screenshots: ${OUT}/`);
process.exit(failed.length ? 1 : 0);
