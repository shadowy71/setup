#!/usr/bin/env node
/**
 * First-visit guide check (development tool).
 *
 * `/guide` is a page whose whole job is to be true and to be reachable, so the
 * things worth looking at are not the ones a screenshot answers: does every
 * destination it names actually answer, does it behave when the reader has no
 * session, does the one-time offer fire once and stay fired, and does the sheet
 * hold together at 320px. This runs those against the real application in a real
 * browser and prints one line per check, exiting non-zero on any failure.
 *
 *   node scripts/dev/guide-check.mjs [--url http://127.0.0.1:3100] [--headed-look]
 *
 * Needs the app running (development server is fine) and, for the signed-in and
 * first-visit runs, the perf harness (`npm run perf:serve`) so a real session can
 * be minted. Without `node_modules/.cache/perf/harness.json` the signed-out half
 * still runs and the rest is reported as skipped rather than passing quietly.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { launchBrowser } from './browser.mjs';

const require = createRequire(import.meta.url);
const { values } = parseArgs({
  options: { url: { type: 'string' }, only: { type: 'string' }, out: { type: 'string' } },
  allowPositionals: true,
});

const BASE = (values.url || process.env.GUIDE_CHECK_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const OUT = values.out || 'node_modules/.cache/guide-check';
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SEEN_KEY = 'campusplus:guide-seen';
const INTRO_KEY = 'campus_intro';

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok), detail });
  console.log(`  ${ok ? '\u001b[32mok\u001b[39m  ' : '\u001b[31mFAIL\u001b[39m'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const note = (text) => console.log(`       ${text}`);
const run = (name) => !values.only || name.includes(values.only);

/**
 * Every app route the rendered page links to.
 *
 * Harvested from the live HTML rather than imported from `lib/guide/content.js`:
 * that module speaks in `@/` aliases, which only the bundler understands, and a
 * check that read the source would happily approve an href the page never
 * rendered. In-page jumps are excluded — those are checked against the sections.
 */
async function guideHrefs(page) {
  return page.evaluate(() =>
    Array.from(new Set(Array.from(document.querySelectorAll('.guide a[href]'))
      .map((el) => el.getAttribute('href'))
      .filter((href) => href && href.startsWith('/') && !href.startsWith('#'))))
      .sort(),
  );
}

/**
 * Optional session, minted the same way the other dev checks do it.
 */
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
  console.log('  session: no harness.json — signed-in checks will be skipped');
}

const sessionHeader = session ? session.cookies.map((c) => `${c.name}=${c.value}`).join('; ') : null;

async function statusOf(path, { cookie = false, redirect = 'follow' } = {}) {
  const headers = cookie && sessionHeader ? { cookie: sessionHeader } : {};
  const response = await fetch(`${BASE}${path}`, { headers, redirect });
  return { status: response.status, location: response.headers.get('location'), url: response.url };
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
  small: { width: 320, height: 720 },
};

const browser = await launchBrowser();

/** A page with the console wired to a list, so a crash cannot pass a check. */
async function open(contextOptions = {}) {
  const context = await browser.newContext({ colorScheme: 'dark', ...contextOptions });
  // The shell's cinematic intro is a first-visit overlay over Home; the guide is
  // not behind it, and this check is about the guide.
  await context.addCookies([{ name: INTRO_KEY, value: '1', url: BASE }]);
  if (session) {
    for (const cookie of session.cookies) {
      await context.addCookies([{ name: cookie.name, value: cookie.value, url: BASE, sameSite: 'Lax' }]);
    }
  }
  const page = await context.newPage();
  const problems = [];
  const external = [];
  /*
   * Only same-origin failures are the page's business. The sandbox has no route
   * to Vercel's dev analytics script, so `/guide` — like `/rules` and every other
   * page — logs a blocked third-party request; counting that as a defect would
   * teach the next reader to ignore the check. It is still reported, once, so the
   * run says what it could not see.
   */
  const sameOrigin = (url) => {
    try {
      return new URL(url).origin === new URL(BASE).origin;
    } catch {
      return true;
    }
  };
  /*
   * Two known sources of noise against this harness: the app opens a Realtime
   * websocket, which the Supabase stub does not implement, and the dev server's
   * third-party analytics script, which the sandbox cannot reach. Neither has
   * anything to do with the guide, so they are counted separately and reported —
   * a check that cried wolf here would be switched off within a week. The third
   * pattern is Next's own dev-only server-component timing (`flushComponent
   * Performance` throwing on a negative stamp): it was seen on /login as well as
   * here, which is why it is treated as the framework's dev noise and not as a
   * defect of this page. Production builds do not carry that instrumentation.
   */
  const harnessNoise = (text) =>
    /realtime\/v1\/websocket|va\.vercel-scripts|_vercel\/insights|ERR_CONNECTION_CLOSED|ERR_ABORTED|_rsc=|flushComponentPerformance|cannot have a negative time stamp/.test(
      text,
    );
  page.on('pageerror', (error) => {
    const line = `pageerror: ${error.message} ${(error.stack || '').split('\n').slice(0, 3).join(' ')}`;
    (harnessNoise(line) ? external : problems).push(line);
  });
  page.on('requestfailed', (request) => {
    const line = `request: ${request.url().slice(0, 90)} — ${request.failure()?.errorText}`;
    (sameOrigin(request.url()) && !harnessNoise(line) ? problems : external).push(line);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location() || {};
    const line = `console: ${message.text().slice(0, 140)}${location.url ? ` @ ${location.url.slice(0, 70)}` : ''}`;
    (location.url && (!sameOrigin(location.url) || harnessNoise(line)) ? external : problems).push(line);
  });
  // Data requests only: assets, source maps and HMR are not "the server".
  const requests = [];
  page.on('request', (request) => {
    if (!['fetch', 'xhr'].includes(request.resourceType())) return;
    if (!sameOrigin(request.url())) return;
    if (/_next|hot-update|__nextjs/.test(request.url())) return;
    requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  page.problems = problems;
  page.external = external;
  page.requests = requests;
  return { context, page, problems, external, requests };
}

/*
 * The shell mounts a cinematic first-visit intro over the whole document, held in
 * memory only (see components/layout/GalacticIntro.js), so it is up on every fresh
 * page load in a new context. It is dismissed the way a student dismisses it, then
 * Home is waited on properly: the guide offer appears just after hydration, which
 * is by design — no JavaScript, no interruption — so "is it there" has to be a
 * question with a deadline rather than a glance.
 */
async function enterApp(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 90_000 });
  const skip = page.getByRole('button', { name: 'Skip intro' });
  if (await skip.count()) {
    // `force`, because the intro animates continuously and Playwright's stability
    // check would wait forever for a still button; a dismiss is not something this
    // page is testing, it is the price of looking at the page underneath.
    await skip.first().click({ force: true, timeout: 3_000 }).catch(() => {});
    await page
      .waitForSelector('[class*="GalacticIntro-module__stage"]', { state: 'detached', timeout: 4_000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
}

/** Presence, with patience. */
async function present(page, selector, timeout = 8_000) {
  return page
    .waitForSelector(selector, { timeout, state: 'attached' })
    .then(() => true)
    .catch(() => false);
}

/** Facts about layout that only a live renderer can answer. */
const measure = () =>
  ({
    overflow: (() => {
      const offenders = Array.from(document.querySelectorAll('.guide *, .guide'))
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 40 && box.right > document.documentElement.clientWidth + 1;
        })
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
      return { offenders, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
    })(),
    // Cut text, not decorative overhang. Two shapes matter: a line the box cannot
    // show (vertical clipping, which is what a hard `overflow: hidden` does to a
    // paragraph) and content that has escaped the surface that paints it. The ink
    // underline and the tape are placed to hang a few pixels past their text on
    // purpose, so absolutely positioned marks are not offenders.
    clipped: Array.from(document.querySelectorAll('.guide p, .guide h1, .guide h2, .guide h3, .guide li, .guide dd, .guide dt'))
      .filter((el) => {
        if (el.clientWidth <= 0 || el.offsetHeight <= 0) return false;
        // Clipping needs a clip: an element whose own overflow is `visible` can
        // report a taller scrollHeight than its box (a decorative underline drawn
        // below the baseline does exactly that) without a single word being cut.
        const own = getComputedStyle(el);
        if (['hidden', 'clip'].includes(own.overflowY) && el.scrollHeight > el.clientHeight + 2) return true;
        const box = el.getBoundingClientRect();
        const surface = el.closest('.guide-card, .guide-board, .guide-quiet, .guide-step, .guide-exit, .guide-hero');
        if (!surface) return false;
        const edge = surface.getBoundingClientRect();
        return box.right > edge.right + 1.5 || box.left < edge.left - 1.5;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}: ${el.textContent.trim().slice(0, 36)}`),
    headings: Array.from(document.querySelectorAll('.guide h1, .guide h2')).map((el) => el.textContent.trim().slice(0, 46)),
    // Two groups, because they are two different promises. The controls a student
    // uses to move around must be pressable with a thumb everywhere; the footer's
    // text links are a list of references, sized like the app's other footers, and
    // only have to be comfortable where a finger is the input.
    targets: Array.from(document.querySelectorAll('.guide-jump a, .guide-link, .guide-row, .guide-exit a, .guide .btn'))
      .map((el) => {
        const box = el.getBoundingClientRect();
        return { group: 'control', text: el.textContent.trim().slice(0, 28), height: Math.round(box.height) };
      })
      .concat(
        Array.from(document.querySelectorAll('.guide-footer a')).map((el) => {
          const box = el.getBoundingClientRect();
          return { group: 'text', text: el.textContent.trim().slice(0, 28), height: Math.round(box.height) };
        }),
      ),
    ink: (() => {
      const ink = document.querySelector('.guide-hero__ink');
      const stroke = document.querySelector('.guide-hero__underline');
      const title = document.querySelector('.guide-hero__title').getBoundingClientRect();
      const drawn = stroke && getComputedStyle(stroke).display !== 'none';
      // Whichever mechanism the width calls for, the mark has to be under the
      // words: a drawn stroke below the title's box, or a real text decoration on
      // the span (a stroke that runs past a wrapped line reads as a bug, which is
      // why the narrow layout uses the decoration instead).
      if (drawn) {
        const box = stroke.getBoundingClientRect();
        const inkBox = ink.getBoundingClientRect();
        return { kind: 'drawn', top: Math.round(box.top), bottom: Math.round(box.bottom), titleBottom: Math.round(title.bottom), right: Math.round(box.right), inkRight: Math.round(inkBox.right) };
      }
      const cs = getComputedStyle(ink);
      return { kind: 'wavy', line: cs.textDecorationLine, style: cs.textDecorationStyle };
    })(),
  });

// ---------------------------------------------------------------- 1. reachability
let HREFS = [];
if (run('reach')) {
  console.log('\n\u001b[1mreachability\u001b[0m');
  const { context, page, problems } = await open({ viewport: VIEWPORTS.desktop });
  const answer = await page.goto(`${BASE}/guide`, { waitUntil: 'load', timeout: 90_000 });
  check('GET /guide answers without a session', answer?.status() === 200, `HTTP ${answer?.status()}`);
  HREFS = await guideHrefs(page);
  const inPage = await page.evaluate(() => document.querySelectorAll('.guide a[href^="#"]').length);
  check('the page carries both kinds of link', HREFS.length >= 15 && inPage >= 4, `${HREFS.length} destinations, ${inPage} in-page jumps`);
  check('the guide renders signed out without errors', problems.length === 0, problems[0] || 'clean');
  await context.close();

  /*
   * A guide link is right when it answers. Two shapes count as answering, and
   * they differ by state — `/legal` is public, so it must NOT bounce a signed-out
   * reader to /login; `/login` is the one place that does bounce a signed-in
   * reader (to Home), which is the app's own guard, not a broken link.
   * What is never acceptable: a 404/5xx (an invented destination), or a signed-in
   * student being pushed to sign in by a link that promised them a page.
   */
  const sweep = async ({ cookie }) => {
    const bad = [];
    const answers = new Set([200, 302, 307]);
    for (const href of HREFS) {
      const result = await statusOf(href, { cookie, redirect: 'manual' });
      if (!answers.has(result.status)) {
        bad.push(`${href} → HTTP ${result.status}`);
        continue;
      }
      if (cookie && String(result.location).startsWith('/login')) bad.push(`${href} → ${result.location} (signed in)`);
      if (href === '/login' && !cookie) continue;
      if (!cookie && (result.status === 302 || result.status === 307) && !String(result.location).startsWith('/login')) {
        bad.push(`${href} → ${result.location} (signed out: expected the login guard)`);
      }
    }
    return bad;
  };

  // Signed out: the public pages answer, everything else meets the app's own
  // guard. A 404 here would be an invented destination; a 200 on /home would be
  // a guard that got loosened to make a link look good.
  const out = await sweep({ cookie: false });
  check('signed out: every name is a page or the login guard', out.length === 0, out.join(', ') || `${HREFS.length} hrefs, none 404/5xx`);

  if (session) {
    const inIn = await sweep({ cookie: true });
    check('signed in: every name answers as a page', inIn.length === 0, inIn.join(', ') || `${HREFS.length} hrefs, all 200`);
  } else {
    check('signed-in sweep needs a harness session', false, 'skipped: no session');
  }

  const welcome = await statusOf('/guide?welcome=1');
  check('the post-setup hand-off renders', welcome.status === 200, `HTTP ${welcome.status}`);
}

// ------------------------------------------------------ 2. the page in a browser
for (const [view, size] of Object.entries(VIEWPORTS)) {
  if (!run(`layout-${view}`)) continue;
  console.log(`\n\u001b[1mthe guide at ${view} (${size.width}×${size.height})\u001b[0m`);
  const { context, page, problems } = await open({ viewport: size, isMobile: view !== 'desktop', hasTouch: view !== 'desktop' });
  await page.goto(`${BASE}/guide`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForTimeout(700);

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/guide-${view}.png`, fullPage: view === 'mobile' });
  const facts = await page.evaluate(measure);
  check(`${view}: nothing overflows the viewport`, facts.overflow.offenders.length === 0 && facts.overflow.scrollWidth <= facts.overflow.clientWidth + 1, facts.overflow.offenders.join(', ') || `scrollWidth ${facts.overflow.scrollWidth} ≤ ${facts.overflow.clientWidth}`);
  check(`${view}: no clipped line of text`, facts.clipped.length === 0, facts.clipped.join(' | ') || 'none');
  // one h1 plus the four numbered parts plus the way out, in that order
  check(`${view}: one h1, then the five parts in order`, facts.headings.length === 6 && facts.headings[0].startsWith('Your campus') && /Where everything is/.test(facts.headings[1]) && /Three things/.test(facts.headings[2]) && /Who sees what/.test(facts.headings[3]) && /Why it is built/.test(facts.headings[4]) && /Start with|Back to campus|profile exists|Two fields/.test(facts.headings[5]), facts.headings.join(' · '));
  // 40px on touch, 28 with a pointer; the destination rows are measured too, so
  // this is about the page's real controls rather than every inline text link.
  const floor = view === 'desktop' ? 28 : 40;
  const smallest = facts.targets.filter(
    (target) => (target.group === 'control' || view !== 'desktop') && target.height < floor,
  );
  check(`${view}: primary targets are big enough to press (${floor}px)`, smallest.length === 0, smallest.map((t) => `${t.text} ${t.height}px`).join(', ') || `${facts.targets.length} targets, min ${Math.min(...facts.targets.map((t) => t.height))}px`);
  const inkOk = facts.ink && (facts.ink.kind === 'drawn'
    ? facts.ink.top >= facts.ink.titleBottom - 14 && facts.ink.right <= facts.ink.inkRight + 14
    : facts.ink.line === 'underline' && facts.ink.style === 'wavy');
  check(`${view}: the headline is underlined under the words, not past them`, inkOk, JSON.stringify(facts.ink));
  check(`${view}: the page renders without console errors`, problems.length === 0, problems.slice(0, 2).join(' | ') || 'clean');

  if (view === 'desktop') {
    // In-page navigation must land on the part it promised.
    const jump = page.locator('.guide-jump a');
    const count = await jump.count();
    const missed = [];
    for (let index = 0; index < count; index += 1) {
      const link = jump.nth(index);
      const href = await link.getAttribute('href');
      await link.click();
      // The page scrolls smoothly, so "did it arrive" has to be polled; a fixed
      // wait would report the section as missing simply because the animation was
      // still running. No back-navigation either: a jump changes no document, and
      // going back only disturbs the measurement of the next one.
      // A truthy string is not a signal: `waitForFunction` resolves on any truthy
      // value, so the predicate answers true/false and the position is read after
      // the settle. The scroll itself is animated, which is why "still 800px away"
      // a moment after a click means nothing.
      const settled = await page
        .waitForFunction((id) => document.querySelector(id)?.getBoundingClientRect().top <= 8, href, {
          timeout: 6_000,
          polling: 150,
        })
        .then(() => 'visible')
        .catch(() => 'never arrived');
      const where = await page.evaluate((id) => {
        const el = document.querySelector(id);
        return el ? Math.round(el.getBoundingClientRect().top) : null;
      }, href);
      if (settled !== 'visible' || where === null) missed.push(`${href}: ${settled}${where === null ? '' : ` (top ${where}px)`}`);
    }
    check('every jump link in the hero reaches its part', count >= 4 && missed.length === 0, missed.join(', ') || `${count} jumps`);
    const sameDocument = await page.evaluate(() => document.querySelectorAll('.guide nav a[href^="#"]').length);
    check('the guide has one navigation and it is in-page', sameDocument === count, `${sameDocument} in-page links, no second app menu`);
  }

  if (view === 'mobile') {
    await page.addScriptTag({ content: AXE });
    const axe = await page.evaluate(async () => {
      const outcome = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return outcome.violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length}) @ ${v.nodes[0]?.target?.join(' ')}`);
    });
    const serious = await page.evaluate(async () => {
      const outcome = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return outcome.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} (${v.impact})`);
    });
    check('mobile: no serious axe violations on the guide', serious.length === 0, serious.join(', ') || `${axe.length} total, none serious`);
    if (axe.length) note(axe.join('; '));

    // Keyboard: the first tab stops have to be the page's own actions.
    const stops = [];
    await page.keyboard.press('Tab');
    for (let index = 0; index < 6; index += 1) {
      stops.push(await page.evaluate(() => {
        const el = document.activeElement;
        const style = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.getAttribute('href') || el.textContent || '').trim().slice(0, 24),
          ring: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
        };
      }));
      await page.keyboard.press('Tab');
    }
    check('keyboard focus is visible on every early stop', stops.every((stop) => stop.ring), stops.map((s) => `${s.tag}:${s.text}${s.ring ? '' : ' (no ring)'}`).join(', '));
  }
  await context.close();
}

// --------------------------------------------------- 3. motion, deliberately off
if (run('motion')) {
  console.log('\n\u001b[1mreduced motion\u001b[0m');
  const { context, page } = await open({ viewport: VIEWPORTS.desktop, reducedMotion: 'reduce' });
  await page.goto(`${BASE}/guide`, { waitUntil: 'load', timeout: 90_000 });
  const styles = await page.evaluate(() => {
    const pick = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const computed = getComputedStyle(el);
      return `${computed.transitionDuration}/${computed.animationName}`;
    };
    return { card: pick('.guide-card'), link: pick('.guide-link'), page: pick('.guide') };
  });
  // Read as seconds, not as text: a stylesheet is free to write `0s`, `0.000s` or
  // the sub-millisecond value the shared button rule happens to compute to, and
  // anything under a millisecond is not a motion a student can perceive.
  const still = Object.values(styles)
    .filter(Boolean)
    .every((value) => {
      const [seconds, animation] = value.split('/');
      return Number.parseFloat(seconds) < 0.001 && animation === 'none';
    });
  check('nothing animates when motion is reduced', still, Object.entries(styles).map(([k, v]) => `${k} ${v}`).join(', ') || 'no animated elements found');
  await context.close();
}

// ------------------------------------------------------------ 4. first-visit flow
if (run('first-visit')) {
  console.log('\n\u001b[1mthe first-visit offer\u001b[0m');
  if (!session) {
    check('first-visit flow requires a harness session', false, 'skipped: no session');
  } else {
    const { context, page, problems } = await open({ viewport: VIEWPORTS.mobile, isMobile: true, hasTouch: true });
    await enterApp(page, `${BASE}/home`);

    const strip = page.locator('.guide-strip');
    check('Home offers the guide on a device that has not seen it', await present(page, '.guide-strip'), 'waiting for the strip after hydration');
    check('the offer is a line, not a wall', await strip.evaluate((el) => el.getBoundingClientRect().height < 200 && !document.querySelector('[role="dialog"]')), 'no dialog, strip height under 200px');

    // Reading the guide is enough to stop the offer.
    await page.locator('.guide-strip__link').click();
    await page.waitForURL('**/guide', { timeout: 20_000 });
    // The record is written after hydration, not in the HTML, so it has to be
    // waited for rather than sampled the instant the URL changes.
    const stamp = await page
      .waitForFunction((key) => localStorage.getItem(key), SEEN_KEY, { timeout: 8_000, polling: 150 })
      .then((handle) => handle.jsonValue())
      .catch(() => null);
    check('opening the guide records the visit on the device', typeof stamp === 'string' && !Number.isNaN(Date.parse(stamp)), String(stamp));

    await enterApp(page, `${BASE}/home`);
    await page.waitForTimeout(900);
    check('…and Home stops offering it, without a dismissal click', (await page.locator('.guide-strip').count()) === 0);

    // Revisit path: the account menu is the documented way back.
    // The shell renders the mark twice — a header for a pointer and a header for a
    // thumb, one of them hidden by CSS — so the visible one is the button.
    await page.locator('button[aria-label="Account menu"]:visible').first().click();
    await page.waitForTimeout(300);
    const menuLink = page.locator('a[href="/guide"]');
    check('the guide is reachable again from the account menu', (await menuLink.count()) > 0, `${await menuLink.count()} link(s) in the open menu`);
    await page.screenshot({ path: `${OUT}/home-offer-and-menu.png` });
    if (await menuLink.count()) {
      await menuLink.first().click();
      await page.waitForURL('**/guide', { timeout: 20_000 });
      check('and it opens, still a guide and not a gate', page.url().includes('/guide'));
    }

    // The sheet on a phone.
    await enterApp(page, `${BASE}/home`);
    await page.waitForTimeout(900);
    let sheetLink = 0;
    for (const button of await page.locator('.shell-header__bar button').all()) {
      await button.click().catch(() => {});
      await page.waitForTimeout(250);
      sheetLink = await page.locator('.reka-portal, [role="dialog"]').locator('a[href="/guide"]').count();
      if (sheetLink) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
    }
    check('the mobile sheet carries the same entry point', sheetLink > 0, `${sheetLink} link(s) in the sheet`);

    // A returning device is not re-armed by navigating around.
    await page.goto(`${BASE}/explore`, { waitUntil: 'load', timeout: 90_000 });
    // `:visible`, because the shell hides one of its two headers at this width.
    await page.locator('a[href="/home"]:visible').first().click();
    await page.waitForTimeout(900);
    check('the offer stays dismissed across navigation', (await page.locator('.guide-strip').count()) === 0, `problems: ${problems.length ? problems[0] : 'none'}`);

    // Dismissing by button works when the reader never opens the page.
    await page.evaluate((key) => localStorage.removeItem(key), SEEN_KEY);
    await page.reload({ waitUntil: 'load' });
    check('clearing the device flag re-arms the offer', await present(page, '.guide-strip'));
    const requestsBeforeDismiss = page.requests.length;
    await page.locator('.guide-strip__dismiss').click();
    await page.waitForTimeout(200);
    const goneNow = (await page.locator('.guide-strip').count()) === 0;
    const stampAfterDismiss = await page.evaluate((key) => localStorage.getItem(key), SEEN_KEY);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(900);
    check('dismissing closes it now and keeps it closed', goneNow && (await page.locator('.guide-strip').count()) === 0, `stamp ${stampAfterDismiss}`);
    /*
     * The privacy claim in miniature: pressing "don't show this again" writes one
     * key on the device and sends nothing. Home polls its own feed in the
     * background, so that is the one line allowed in this window; anything else —
     * a beacon, an upsert, a `POST /api/guide-seen` — would mean the dismissal
     * became a server concern, which is exactly what the flag is designed to avoid.
     */
    // Prefetches are GETs of links the browser can already see (Home's own feed
    // poll included), so the claim has to be about what the *click* sends: a
    // dismissal is device-local when it writes nothing anywhere.
    const duringDismiss = page.requests
      .slice(requestsBeforeDismiss)
      .filter((line) => /^(POST|PATCH|PUT|DELETE) /.test(line));
    check('dismissing sends nothing to the server', duringDismiss.length === 0, duringDismiss.slice(0, 3).join(', ') || 'only GETs, and those are the link prefetcher');
    await context.close();

    // A device that cannot keep the answer.
    const blocked = await open({ viewport: VIEWPORTS.mobile, isMobile: true, hasTouch: true });
    await blocked.context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('The operation is insecure.');
        },
      });
    });
    await enterApp(blocked.page, `${BASE}/home`);
    const blockedStrip = blocked.page.locator('.guide-strip');
    const shown = await present(blocked.page, '.guide-strip');
    check('a browser with blocked storage still renders Home', shown && blocked.problems.length === 0, blocked.problems[0] || '');
    const label = (await blockedStrip.locator('button').count()) ? await blockedStrip.locator('button').first().textContent() : '';
    check('and the offer promises only what it can do', /for now/i.test(String(label)), `dismiss label: ${label}`);
    await blockedStrip.locator('button').first().click();
    await blocked.page.waitForTimeout(250);
    check('clicking it closes it even when nothing can be stored', (await blocked.page.locator('.guide-strip').count()) === 0);
    await blocked.context.close();
  }
}

// ----------------------------------------- 5. onboarding hand-off, with the guard
if (run('handoff')) {
  console.log('\n\u001b[1mafter profile setup\u001b[0m');
  if (!session) {
    check('hand-off requires a harness session', false, 'skipped: no session');
  } else {
    // Point the guide at an account that still owes a profile, so the state the
    // onboarding form hands off to can be seen for real rather than asserted only.
    const { default: pg } = await import('pg');
    const { DATABASE_URL } = await import('./perf/lib.mjs');
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    const email = 'perf.student2@pccoepune.org';
    const { createSessionCookie } = await import('./perf/session.mjs');
    const fresh = await createSessionCookie(JSON.parse(readFileSync(harnessFile, 'utf8')).stubUrl, email);
    try {
      // `profile_completed` lives in profile_private, the table RLS hides from other
      // students — this is a fixture edit as the schema owner, and it is undone in
      // the `finally` below so a later run of any other check sees the seeded state.
      await client.query('update public.profile_private set profile_completed = false where auth_user_id = (select id from auth.users where email = $1)', [email]);
      const context = await browser.newContext({ viewport: VIEWPORTS.mobile, colorScheme: 'dark', isMobile: true, hasTouch: true });
      await context.addCookies([{ name: INTRO_KEY, value: '1', url: BASE }]);
      for (const cookie of fresh.cookies) {
        await context.addCookies([{ name: cookie.name, value: cookie.value, url: BASE, sameSite: 'Lax' }]);
      }
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (error) => problems.push(error.message));

      await page.goto(`${BASE}/guide`, { waitUntil: 'load', timeout: 90_000 });
      await page.waitForTimeout(500);
      const body = await page.locator('.guide').innerText();
      check('a student mid-profile is not told to sign in', !/Sign in with Google/.test(body) && /Back to your profile/i.test(body), body.match(/Back to your profile[^\n]*/)?.[0] || 'exit CTA missing');

      // The guard itself: the app still refuses to skip the step. A redirect that
      // happens while the server is streaming the shell arrives as a client-side
      // replacement, not an HTTP one, so the browser has to be allowed to settle.
      await page.goto(`${BASE}/home`, { waitUntil: 'load', timeout: 90_000 });
      const bounced = await page
        .waitForURL(/\/onboarding/, { timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      check('the guide does not weaken the setup guard', bounced, `landing: ${new URL(page.url()).pathname}`);

      // And the onboarding page's slice: one link, and it is the guide.
      // `section[aria-labelledby=...]` rather than a class name: a production build
      // hashes CSS-module classes, and an accessible name does not change.
      const slice = page.locator('section[aria-labelledby="onboarding-heading"]');
      const sliceHtml = (await slice.count()) ? await slice.first().innerHTML() : '';
      const sliceHrefs = (sliceHtml.match(/href="([^"]+)"/g) || []).map((text) => text.slice(6, -1));
      check('the onboarding slice links only to the guide', sliceHrefs.length === 1 && sliceHrefs[0] === '/guide', sliceHrefs.join(', ') || 'no slice found');
      const links = await page.locator('a').evaluateAll((els) => els.map((el) => el.getAttribute('href')).filter(Boolean));
      check('the slice does not duplicate the guide’s map', /Find information|Find your people/.test(sliceHtml) && (await page.locator('h1').count()) === 1, `${links.length} links on the page`);

      await page.goto(`${BASE}/onboarding`, { waitUntil: 'load', timeout: 90_000 });
      const formBefore = await page.evaluate(() => {
        const form = document.querySelector('form');
        const intro = document.querySelector('section[aria-labelledby="onboarding-heading"]');
        return Boolean(form && intro) && form.compareDocumentPosition(intro) === Node.DOCUMENT_POSITION_FOLLOWING;
      });
      check('the form still comes first', formBefore, 'profile form precedes the note');
      check('and the page renders without errors', problems.length === 0, problems.join(' | ') || 'clean');
      await context.close();
    } finally {
      await client.query('update public.profile_private set profile_completed = true where auth_user_id = (select id from auth.users where email = $1)', [email]);
      await client.end();
    }
  }
}

// ----------------------------------------------------------- 6. welcome=1 in situ
if (run('welcome')) {
  console.log('\n\u001b[1mthe hand-off landing\u001b[0m');
  if (!session) {
    check('welcome landing requires a harness session', false, 'skipped: no session');
  } else {
    const { context, page } = await open({ viewport: VIEWPORTS.mobile, isMobile: true, hasTouch: true });
    await page.goto(`${BASE}/guide?welcome=1`, { waitUntil: 'load', timeout: 90_000 });
    await page.waitForTimeout(400);
    const text = await page.locator('.guide').innerText();
    check('the welcome line reads as a completion, not a tutorial', /Profile done/.test(text), text.split('\n').find((line) => /Profile done/.test(line)) || 'missing');
    const homeCta = page.locator('.guide-exit a[href="/home"]');
    check('and Home is the first thing it offers', (await homeCta.count()) > 0);
    // A second visit to the page must not resurrect onboarding.
    await page.goto(`${BASE}/guide?welcome=1`, { waitUntil: 'load', timeout: 90_000 });
    await page.waitForTimeout(300);
    check('reloading the landing does not reopen setup', !/Finish your profile|complete onboarding/i.test(await page.locator('.guide').innerText()), `url ${new URL(page.url()).pathname}`);
    await context.close();
  }
}

await browser.close();

const failed = results.filter((result) => !result.ok);
console.log(`\n\u001b[1m${results.length - failed.length}/${results.length} checks passed\u001b[0m`);
if (failed.length) {
  console.log(failed.map((f) => `  · ${f.label}${f.detail ? ` — ${f.detail}` : ''}`).join('\n'));
}
console.log(`report: ${OUT}/report.json`);
await import('node:fs').then(({ mkdirSync, writeFileSync }) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2)}\n`);
});
process.exit(failed.length ? 1 : 0);
