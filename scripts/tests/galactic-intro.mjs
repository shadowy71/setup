/** Run against a configured or unconfigured Next server:
 * INTRO_BASE_URL=http://127.0.0.1:3000 node scripts/tests/galactic-intro.mjs
 * Optional CHROMIUM_EXECUTABLE_PATH for a sandbox browser installation.
 *
 * Two layers:
 *
 *   1. Route scoping — always runs. The landing animation may only exist on the
 *      home page (`/home`, reached directly or through the `/` redirect), and
 *      every other route must ship no overlay, no `inert` wrapper, no intro
 *      font requests and no console/hydration errors.
 *
 *   2. The choreography itself — runs only when `/home` actually renders for
 *      this deployment (a signed-in session). Unauthenticated deployments are
 *      redirected to `/login`, where the animation is *supposed* to be absent,
 *      so those checks are skipped with an explicit message instead of failing
 *      or pretending they ran.
 *
 * The suite covers Chromium. Microsoft Edge is not installed in this sandbox;
 * see docs/GALACTIC-INTRO.md for the manual Edge checklist that runs the same
 * checks against an actual Edge installation. (Edge shares Chromium's engine,
 * but that is not a substitute for testing the real browser.)
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.INTRO_BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
const consoleErrors = [];
let fontRequests = [];

page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const location = message.location();
  consoleErrors.push({ text: message.text(), url: location?.url || '' });
});
page.on('request', (request) => {
  const pathname = new URL(request.url()).pathname;
  if (pathname.startsWith('/fonts/')) {
    fontRequests.push({ from: page.url(), pathname });
  }
});

const splash = page.getByRole('region', { name: 'Campus+ intro' });
const skipButton = page.getByRole('button', { name: 'Skip intro' });
const goto = (path) =>
  page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });

const resetFontRequests = () => {
  fontRequests = [];
};

function assertNoUnexpectedErrors(context) {
  assert.deepEqual(pageErrors, [], `${context}: page errors`);
  const unexpected = consoleErrors.filter(
    (error) =>
      !error.url.includes('/fonts/') &&
      !/Failed to load resource/i.test(error.text),
  );
  assert.deepEqual(unexpected, [], `${context}: console errors`);
}

async function assertRouteIsQuiet(path, { expectIntro = false } = {}) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  if (expectIntro) {
    assert.equal(await splash.count(), 1, `${path}: expected the intro`);
  } else {
    assert.equal(await splash.count(), 0, `${path}: intro must not appear`);
    assert.equal(
      await page.locator('[inert]').count(),
      0,
      `${path}: content must not be inert`,
    );
    const overflow = await page.evaluate(
      () => getComputedStyle(document.body).overflow,
    );
    assert.notEqual(overflow, 'hidden', `${path}: body scroll must not be locked`);
  }
  assertNoUnexpectedErrors(path);
}

async function readIntro() {
  return page.evaluate(() => {
    const stage = document.querySelector('section[data-phase]');
    if (!stage) return null;
    const [campus, plus] = stage.querySelectorAll('svg text');
    const campusBox = campus.getBBox();
    const plusBox = plus.getBBox();
    return {
      phase: stage.dataset.phase,
      typography: stage.dataset.typography ?? null,
      fonts: [
        getComputedStyle(campus).fontFamily,
        getComputedStyle(plus).fontFamily,
        getComputedStyle(stage.querySelector('[class*="tagline"]')).fontFamily,
      ],
      x: [Number(campus.getAttribute('x')), Number(plus.getAttribute('x'))],
      gap: plusBox.x - (campusBox.x + campusBox.width),
      left: campusBox.x,
      right: plusBox.x + plusBox.width,
      overflow: document.documentElement.scrollWidth > innerWidth,
      checkSyne: document.fonts.check(
        '800 84px "Campus Galactic Syne"',
        'CAMPUS+',
      ),
    };
  });
}

function assertLockup(state, context) {
  assert.equal(state.overflow, false, `${context}: horizontal overflow`);
  assert.ok(state.left >= 0, `${context}: left edge ${state.left}`);
  assert.ok(state.right <= 760, `${context}: right edge ${state.right}`);
  assert.ok(
    Math.abs(state.gap - 24) < 1,
    `${context}: expected the 24-unit gap, got ${state.gap}`,
  );
}

try {
  // ==========================================================================
  // 1. Route scoping — the fix. These run everywhere, with or without a session.
  // ==========================================================================

  // Server-rendered markup: only /home may contain the overlay. `/` is a
  // redirect-only route and must not paint the intro before it sends the
  // visitor on to the home page.
  for (const path of [
    '/',
    '/login',
    '/setup',
    '/rules',
    '/profile',
    '/settings',
    '/communities',
    '/market',
    '/chat',
    '/campus',
    '/explore',
    '/notifications',
    '/onboarding',
  ]) {
    const html = await page.request
      .get(`${base}${path}`, { maxRedirects: 0 })
      .then((response) => response.text());
    assert.ok(
      !html.includes('Campus+ intro'),
      `${path}: server HTML must not contain the intro`,
    );
  }
  const homeHtml = await page.request
    .get(`${base}/home`, { maxRedirects: 0 })
    .then((response) => response.text());
  assert.ok(
    homeHtml.includes('Campus+ intro'),
    '/home: server HTML must contain the intro',
  );
  assert.ok(
    homeHtml.includes('/fonts/Syne.ttf'),
    '/home: the intro font must be preloaded on the only route that shows it',
  );
  console.log('PASS server HTML: intro exists only on /home');

  // Browser: no overlay, no inert wrapper, no scroll lock, no font work.
  resetFontRequests();
  for (const path of ['/login', '/setup', '/rules']) {
    await assertRouteIsQuiet(path);
  }
  const quietFontRequests = fontRequests.filter(
    (request) => request.from.includes('/login') || request.from.includes('/setup'),
  );
  assert.deepEqual(
    quietFontRequests,
    [],
    'routes that cannot show the intro must not fetch its fonts',
  );
  console.log(
    'PASS /login, /setup, /rules: no overlay, no inert, no scroll lock, no font requests',
  );

  // Opening `/` must never paint the intro on the way to its destination.
  resetFontRequests();
  await goto('/');
  await page.waitForTimeout(1200);
  assert.equal(await splash.count(), 0, 'the `/` redirect must not paint the intro');
  console.log('PASS `/` redirect destination has no intro overlay');

  // ==========================================================================
  // 2. Is the animation reachable in this deployment?
  // ==========================================================================
  await goto('/home');
  await page.waitForTimeout(1500);
  const homePath = new URL(page.url()).pathname;
  const animationAvailable = homePath === '/home';

  if (!animationAvailable) {
    console.log(
      `SKIP choreography checks: /home redirects to ${homePath} for an unauthenticated visitor. ` +
        'Run this suite against a deployment with a signed-in session to exercise the animation itself.',
    );
  } else {
    // ========================================================================
    // 3. The animation, unchanged, on the home page.
    // ========================================================================
    await splash.waitFor({ timeout: 6000 });
    await page.waitForFunction(() =>
      document.querySelector('[data-phase="playing"]'),
    );
    const firstFrame = await readIntro();
    assert.equal(firstFrame.typography, 'loaded');
    assert.equal(firstFrame.checkSyne, true);
    assert.match(firstFrame.fonts[0], /Campus Galactic Syne/);
    assert.match(firstFrame.fonts[2], /Campus Galactic Space/);
    assertLockup(firstFrame, 'direct /home');
    console.log('PASS direct /home: custom faces measured before playback');

    const preloads = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="preload"][as="font"]')].map(
        (link) => new URL(link.href).pathname,
      ),
    );
    for (const pathname of ['/fonts/Syne.ttf', '/fonts/SpaceGrotesk.ttf']) {
      assert.ok(preloads.includes(pathname), `missing preload ${pathname}`);
    }

    // No shift while the sequence runs.
    await page.waitForTimeout(1500);
    const steady = await readIntro();
    assert.deepEqual(steady.x, firstFrame.x, 'the logo shifted mid-animation');
    assert.equal(steady.typography, firstFrame.typography);

    // CSS choreography delays still match the phase-relative JS timeline.
    const animations = await page.evaluate(() => {
      const stage = document.querySelector('section[data-phase]');
      const texts = [...stage.querySelectorAll('svg text')];
      const describe = (element) => {
        const style = getComputedStyle(element);
        return {
          delay: style.animationDelay,
          duration: style.animationDuration,
        };
      };
      return {
        campus: describe(texts[0]),
        plus: describe(texts[1]),
        tagline: describe(stage.querySelector('[class*="tagline"]')),
        logo: describe(stage.querySelector('svg')),
      };
    });
    const parts = (value) => value.split(',').map((part) => part.trim());
    assert.deepEqual(parts(animations.campus.delay), ['0.55s', '1.65s']);
    assert.deepEqual(parts(animations.plus.delay), ['1.3s', '1.7s']);
    assert.deepEqual(parts(animations.tagline.delay), ['2.25s']);
    assert.deepEqual(parts(animations.logo.delay), ['2.5s']);
    console.log('PASS refined choreography delays aligned');

    // Completion, then no replay in this document.
    await splash.waitFor({ state: 'detached', timeout: 9000 });
    assert.equal(await page.locator('[inert]').count(), 0);
    await page.waitForTimeout(300);
    const homeLink = page.locator('a[href="/rules"]').first();
    if (await homeLink.count()) {
      await homeLink.click();
      await page.waitForURL('**/rules');
      assert.equal(await splash.count(), 0, 'intro appeared on another route');
      await page.goBack();
      await page.waitForURL('**/home');
      await page.waitForTimeout(1200);
      assert.equal(await splash.count(), 0, 'intro replays after navigation');
      console.log('PASS leaving and returning to /home does not replay');
    }

    // Skip and Escape.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await splash.waitFor({ timeout: 6000 });
    await skipButton.click();
    await splash.waitFor({ state: 'detached' });
    const urlAfterSkip = page.url();
    await page.waitForTimeout(6000);
    assert.equal(await splash.count(), 0, 'skip resurrected on a pending timer');
    assert.equal(page.url(), urlAfterSkip);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await splash.waitFor({ timeout: 6000 });
    await page.keyboard.press('Escape');
    await splash.waitFor({ state: 'detached' });
    console.log('PASS skip, escape and no stale timers');

    // Reduced motion.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await splash.waitFor({ state: 'detached', timeout: 3000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    console.log('PASS reduced motion reveals the home page immediately');

    // Slow, timed-out and failed font requests still behave.
    await page.route('**/fonts/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await splash.waitFor({ timeout: 6000 });
    await page.waitForFunction(() =>
      document.querySelector('[data-phase="playing"]'),
    );
    const delayed = await readIntro();
    assert.equal(delayed.typography, 'loaded');
    assert.deepEqual(delayed.x, firstFrame.x, 'slow fonts moved the logo');
    await page.unroute('**/fonts/**');
    console.log('PASS a 900 ms font delay waits and keeps custom metrics');

    await page.route('**/fonts/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4500));
      await route.continue();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await splash.waitFor({ timeout: 6000 });
    await page.waitForFunction(() =>
      document.querySelector('[data-phase="playing"]'),
    );
    const timeoutState = await readIntro();
    assert.equal(timeoutState.typography, 'fallback');
    await page.waitForTimeout(2000);
    const afterLate = await readIntro();
    assert.equal(afterLate.typography, 'fallback', 'late font changed typography');
    assert.deepEqual(afterLate.x, timeoutState.x, 'late font moved the logo');
    await page.unroute('**/fonts/**');
    console.log('PASS the 3 s timeout falls back and ignores a late face');

    await page.route('**/fonts/**', (route) => route.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await splash.waitFor({ timeout: 6000 });
    await page.waitForFunction(() =>
      document.querySelector('[data-phase="playing"]'),
    );
    assert.equal((await readIntro()).typography, 'fallback');
    await splash.waitFor({ state: 'detached', timeout: 9000 });
    assert.equal(await page.locator('[inert]').count(), 0);
    await page.unroute('**/fonts/**');
    console.log('PASS failed font requests fall back and still complete');

    // Desktop, mobile and landscape bounds.
    for (const viewport of [
      { width: 320, height: 844 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await splash.waitFor({ timeout: 6000 });
      await page.waitForFunction(() =>
        document.querySelector('[data-phase="playing"]'),
      );
      assertLockup(
        await readIntro(),
        `${viewport.width}x${viewport.height}`,
      );
      await skipButton.click();
      await splash.waitFor({ state: 'detached' });
    }
    console.log('PASS desktop/mobile/landscape lockup bounds');
  }

  assertNoUnexpectedErrors('suite');
  console.log(
    animationAvailable
      ? 'PASS no page or console errors'
      : 'PASS no page or console errors (route scoping only)',
  );
} finally {
  await browser.close();
}
