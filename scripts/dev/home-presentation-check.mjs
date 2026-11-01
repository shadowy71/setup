#!/usr/bin/env node
/**
 * Read-only browser regression check for the Home refinement.
 * Uses the real signed-in app and existing sandbox browser helper; no auth
 * bypass, writes, or alternate mock page. Run with the local fixture preview:
 *
 *   node scripts/dev/home-presentation-check.mjs --url http://127.0.0.1:3300
 *   node scripts/dev/home-presentation-check.mjs --shots
 *
 * Reports and optional screenshots stay in the ignored perf-results/screens/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { launchBrowser } from './browser.mjs';

const { values } = parseArgs({ options: { url: { type: 'string' }, shots: { type: 'boolean' } } });
const BASE = (values.url || 'http://127.0.0.1:3300').replace(/\/$/, '');
const OUT = 'perf-results/screens/home-refinement';
const results = [];
const errors = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), ...(detail ? { detail } : {}) });
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const cases = [
  ...[320, 375, 390, 768, 900, 1024, 1280, 1440, 1920].map((width) => ({ width, theme: 'dark' })),
  { width: 390, theme: 'light' },
  { width: 1440, theme: 'light', reducedMotion: true },
];

for (const { width, theme, reducedMotion = false } of cases) {
  const label = `${width}px ${theme}${reducedMotion ? ' reduced-motion' : ''}`;
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 1000 },
    isMobile: width < 600,
    hasTouch: width < 600,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  await context.addInitScript((savedTheme) => {
    localStorage.setItem('campusplus:guide-seen', '1');
    localStorage.setItem('campusplus:navigation-tour-v1', 'dismissed:visual-check');
    localStorage.setItem('campusplus:theme-v1', savedTheme);
  }, theme);
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    // Known React/Next development performance-marker noise, not app code.
    if (!/flushComponentPerformance|negative time stamp/i.test(error.message)) errors.push(error.message);
  });
  await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const skip = page.getByRole('button', { name: 'Skip intro', exact: true });
  if (await skip.count()) await skip.click({ timeout: 3000 }).catch(() => {});
  await page.locator('[aria-label="Campus+ intro"]').waitFor({ state: 'hidden' });
  await page.locator('.home-pulse__stats').waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Feed counts and rail cards mount after the shell. Wait for their kept
  // one-shot entrances too, not just the greeting's earlier animation.
  await page.waitForFunction(() => document.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .every((animation) => ['finished', 'idle'].includes(animation.playState)));
  await page.mouse.move(0, 0);

  const metrics = await page.evaluate(() => {
    const el = (selector) => document.querySelector(selector);
    const rect = (selector) => {
      const { x, y, width, height } = el(selector).getBoundingClientRect();
      return { x, y, width, height, right: x + width, bottom: y + height };
    };
    const resolved = (token) => {
      // A fresh probe avoids sampling the start of the global reduced-motion
      // transition when changing the same element's color twice in one frame.
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const tokenInk = resolved('--color-ink');
    const tokenPaper = resolved('--color-paper');
    const name = getComputedStyle(el('.home-pulse__name'));
    const tileHeights = [...document.querySelectorAll('.feature-tile')].map((tile) => tile.getBoundingClientRect().height);
    return {
      name: rect('.home-pulse__name-text'),
      hand: rect('.home-pulse__wave'),
      greet: rect('.home-pulse__greet'),
      intro: rect('.home-pulse__intro'),
      features: rect('.home-features'),
      main: rect('.home-body__main'),
      rail: rect('.home-body__rail'),
      actions: rect('.home-pulse__actions'),
      button: rect('.home-pulse__actions > a'),
      search: rect('.home-pulse__search'),
      stats: rect('.home-pulse__stats'),
      font: { size: parseFloat(name.fontSize), weight: name.fontWeight, family: name.fontFamily },
      nameInk: name.color,
      tokenInk,
      stagePaper: getComputedStyle(el('.home-stage')).backgroundColor,
      tokenPaper,
      tileHeights,
      overflow: document.documentElement.scrollWidth > innerWidth,
      theme: document.documentElement.dataset.theme,
      bodyFont: getComputedStyle(el('.home-pulse__lead')).fontFamily,
      animationDuration: getComputedStyle(el('.home-pulse__wave-art')).animationDuration,
    };
  });
  const m = metrics;
  check(`${label}: no horizontal overflow`, !m.overflow);
  check(`${label}: bold, dominant interface-family name`, m.font.size >= 52 && m.font.weight === '700' && m.font.family === m.bodyFont);
  check(`${label}: separate greeting`, m.greet.bottom <= m.name.y);
  check(`${label}: centered adjacent hand`, Math.abs(m.name.y + m.name.height / 2 - m.hand.y - m.hand.height / 2) < 1
    && m.hand.x > m.name.right && m.hand.x - m.name.right <= 24);
  check(`${label}: name and hand stay inside intro`, m.hand.right <= m.intro.right + 1);
  check(`${label}: accessible hand target`, m.hand.width >= 44 && m.hand.height >= 44);
  check(`${label}: equal control heights`, Math.abs(m.button.height - m.search.height) < 1);
  check(`${label}: controls fit`, m.button.right <= m.actions.right + 1 && m.search.right <= m.actions.right + 1);
  check(`${label}: equal navigation cards`, Math.max(...m.tileHeights) - Math.min(...m.tileHeights) < 1);
  check(`${label}: saved appearance respected`, m.theme === theme);
  check(`${label}: existing theme roles preserved`, m.nameInk === m.tokenInk && m.stagePaper === m.tokenPaper);
  if (m.features.y < m.intro.bottom && m.features.x > m.intro.x) {
    check(`${label}: hero and feed columns align`, Math.abs(m.features.x - m.rail.x) < 1 && Math.abs(m.intro.width - m.main.width) < 1);
  }
  if (reducedMotion) check(`${label}: reduced-motion hand`, parseFloat(m.animationDuration) < 0.01);

  // A long identity must never strand the hand on a separate line. This changes
  // DOM text only, not a profile, network payload, or fixture database.
  const longNameFits = await page.evaluate(() => {
    const name = document.querySelector('.home-pulse__name-text');
    const original = name.textContent;
    name.textContent = 'Chandrasekharan';
    const a = name.getBoundingClientRect();
    const b = document.querySelector('.home-pulse__wave').getBoundingClientRect();
    const c = document.querySelector('.home-pulse__intro').getBoundingClientRect();
    const fits = b.right <= c.right + 1 && Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 1;
    name.textContent = original;
    return fits;
  });
  check(`${label}: long-name layout`, longNameFits);

  // Exercise the fourth-stat responsive rule even when the real feed currently
  // returns only three counts. Restore the exact DOM before taking a screenshot.
  const fourStatsFit = await page.evaluate(() => {
    const stats = document.querySelector('.home-pulse__stats');
    const originalStyle = stats.getAttribute('style');
    const extras = [];
    while (stats.children.length < 4) {
      const clone = stats.firstElementChild.cloneNode(true);
      stats.append(clone);
      extras.push(clone);
    }
    stats.style.setProperty('--home-stat-count', 4);
    const boxes = [...stats.children].map((stat) => stat.getBoundingClientRect());
    const bound = stats.getBoundingClientRect();
    const columns = innerWidth <= 640 ? 2 : 4;
    const fits = boxes.every((box) => box.right <= bound.right && box.left >= bound.left)
      && new Set(boxes.map((box) => box.x)).size === columns;
    extras.forEach((node) => node.remove());
    stats.setAttribute('style', originalStyle);
    return fits;
  });
  check(`${label}: four-stat responsive layout`, fourStatsFit);

  if (values.shots && [390, 768, 1440].includes(width)) {
    await page.screenshot({ path: `${OUT}/home-${width}-${theme}.png`, fullPage: false });
    if (width === 1440 && theme === 'dark') await page.screenshot({ path: `${OUT}/home-desktop-full.png`, fullPage: true });
  }

  if (width === 1440 && theme === 'dark') {
    // Pointer and keyboard both replay just the existing small artwork.
    const art = await page.locator('.home-pulse__wave-art').elementHandle();
    await page.getByRole('button', { name: 'Wave hello' }).click();
    check('pointer wave replays', await art.evaluate((node) => !node.isConnected));
    const nextArt = await page.locator('.home-pulse__wave-art').elementHandle();
    await page.getByRole('button', { name: 'Wave hello' }).press('Enter');
    check('keyboard wave replays', await nextArt.evaluate((node) => !node.isConnected));

    await page.getByRole('tab', { name: 'Poll', exact: true }).click();
    check('composer poll controls retained', await page.getByLabel('Option 1', { exact: true }).isVisible());
    await page.getByRole('tab', { name: 'Discussion', exact: true }).click();
    check('composer discussion controls retained', await page.getByLabel('Discussion title').isVisible());
    await page.getByRole('tab', { name: 'Post', exact: true }).click();

    const input = page.locator('.home-pulse__search input');
    await input.fill('library');
    await input.press('Escape');
    check('search Escape clears query', await input.inputValue() === '');
    await input.fill('library');
    await input.press('Enter');
    await page.waitForURL('**/explore?q=library');
    check('search uses existing Explore route', page.url().endsWith('/explore?q=library'));
    await page.goBack();
    await page.locator('.home-pulse__stats').waitFor();
    await page.locator('.home-pulse__actions > a').click();
    await page.waitForURL('**/explore');
    check('Explore campus link navigates', page.url().endsWith('/explore'));
  }
  await context.close();
  console.log(`checked ${label}`);
}
await browser.close();
check('no application page errors', errors.length === 0, errors);
writeFileSync(`${OUT}/report.json`, JSON.stringify({ base: BASE, results }, null, 2));
const failures = results.filter((result) => !result.ok);
for (const failure of failures) console.error('FAIL', failure.name, failure.detail || '');
console.log(`${results.length - failures.length}/${results.length} checks passed. Report: ${OUT}/report.json`);
process.exitCode = failures.length ? 1 : 0;
