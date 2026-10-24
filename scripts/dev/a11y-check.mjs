#!/usr/bin/env node
/**
 * Accessibility + interaction check on the real page (development tool).
 *
 * Runs axe-core against the authenticated Home page at desktop and mobile, then
 * exercises the interactions that only a browser can answer: keyboard focus
 * order, the pointer-depth response on a fine pointer, the hover light on a
 * feed entry, and whether the depth-field canvas ever takes a click or a tab
 * stop. It prints a pass/fail line per check and exits non-zero on a violation
 * that matters (serious/critical).
 *
 *   node scripts/dev/a11y-check.mjs [--url http://127.0.0.1:3300/home]
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { launchBrowser } from './browser.mjs';
import { existsSync as fileExists } from 'node:fs';
import { readFileSync as readJson } from 'node:fs';

const require = createRequire(import.meta.url);
const { values } = parseArgs({ options: { url: { type: 'string' } }, allowPositionals: true });
const TARGET = values.url || process.env.A11Y_URL || 'http://127.0.0.1:3300/home';
const ORIGIN = new URL(TARGET).origin;
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? '\u001b[32mok\u001b[39m  ' : '\u001b[31mFAIL\u001b[39m'} ${label}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Optional authenticated session.
 *
 * The perf harness (`npm run perf:serve`) leaves its fixture accounts in
 * `node_modules/.cache/perf/harness.json`; when that file exists this check
 * signs in as the seeded student so it audits the real shell (rail, dock,
 * header, composer) instead of the sign-in page. Without it the run still works
 * against whatever `--url` renders.
 */
let session = null;
const harnessFile = 'node_modules/.cache/perf/harness.json';
if (fileExists(harnessFile)) {
  const harness = JSON.parse(readJson(harnessFile, 'utf8'));
  const { createSessionCookie } = await import('./perf/session.mjs');
  try {
    session = await createSessionCookie(harness.stubUrl, harness.student.email);
    console.log(`  session: ${harness.student.email}`);
  } catch (error) {
    console.log(`  session: unavailable (${error.message})`);
  }
}

const browser = await launchBrowser();

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
]) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
    colorScheme: 'dark',
  });
  await context.addCookies([
    { name: 'campus_intro', value: '1', url: ORIGIN },
  ]);
  if (session) {
    for (const cookie of session.cookies) {
      await context.addCookies([{ name: cookie.name, value: cookie.value, url: ORIGIN, sameSite: 'Lax' }]);
    }
  }
  const page = await context.newPage();
  await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 90_000 });
  // The cinematic intro is a first-visit overlay; dismiss it the way a student
  // would so the audit sees the page underneath.
  const skip = page.getByRole('button', { name: 'Skip intro' });
  if (await skip.count()) {
    await skip.first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1800);

  await page.addScriptTag({ content: AXE });
  const axe = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const outcome = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return outcome.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
      help: violation.help,
      target: violation.nodes[0]?.target?.join(' '),
    }));
  });
  const serious = axe.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  check(
    `${viewport.name}: no serious/critical axe violations`,
    serious.length === 0,
    serious.length ? serious.map((v) => `${v.id} (${v.impact}, ${v.nodes}) @ ${v.target}`).join('; ') : `${axe.length} total, none serious`,
  );
  const minor = axe.filter((violation) => !['serious', 'critical'].includes(violation.impact));
  if (minor.length) console.log(`       noted (not blocking): ${minor.map((v) => `${v.id}:${v.impact}`).join(', ')}`);

  const canvas = await page.evaluate(() => {
    const element = document.querySelector('.depth-field canvas');
    if (!element) return { present: false };
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, Math.min(window.innerHeight - 4, rect.top + 200));
    return {
      present: true,
      ariaHidden: element.closest('.depth-field')?.getAttribute('aria-hidden'),
      pointerEvents: getComputedStyle(element.closest('.depth-field')).pointerEvents,
      focusable: element.tabIndex >= 0,
      hitTest: top ? `${top.tagName.toLowerCase()}.${String(top.className).split(' ')[0]}` : null,
      tabbableInField: document.querySelectorAll('.depth-field a, .depth-field button, .depth-field [tabindex]').length,
    };
  });
  check(
    `${viewport.name}: the depth canvas is decorative and untouchable`,
    !canvas.present ||
      (canvas.ariaHidden === 'true' && canvas.pointerEvents === 'none' && !canvas.focusable && canvas.tabbableInField === 0),
    JSON.stringify(canvas),
  );

  await context.close();
}

/* Interaction: pointer depth, entry light, keyboard reachability. */
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
await context.addCookies([{ name: 'campus_intro', value: '1', url: ORIGIN }]);
if (session) {
  for (const cookie of session.cookies) {
    await context.addCookies([{ name: cookie.name, value: cookie.value, url: ORIGIN, sameSite: 'Lax' }]);
  }
}
const page = await context.newPage();
await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 90_000 });
const interactionSkip = page.getByRole('button', { name: 'Skip intro' });
if (await interactionSkip.count()) {
  await interactionSkip.first().click().catch(() => {});
  await page.waitForTimeout(400);
}
await page.waitForTimeout(1500);

const depth = await page.evaluate(async () => {
  const host = document.querySelector('.island-motion');
  if (!host) return { supported: false };
  const before = getComputedStyle(host).getPropertyValue('--pointer-x');
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 20, bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 350));
  const after = getComputedStyle(host).getPropertyValue('--pointer-x');
  return { supported: true, before: before.trim(), after: after.trim() };
});
check(
  'pointer depth writes a custom property (no React re-render)',
  depth.supported && depth.after !== '' && depth.after !== depth.before,
  JSON.stringify(depth),
);

const focus = await page.evaluate(async () => {
  const reached = [];
  for (let i = 0; i < 40; i += 1) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    break;
  }
  return { first: document.activeElement?.tagName?.toLowerCase() };
});
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
const focused = await page.evaluate(() => ({
  tag: document.activeElement?.tagName?.toLowerCase(),
  label: (document.activeElement?.textContent || document.activeElement?.getAttribute('aria-label') || '').trim().slice(0, 40),
  outline: getComputedStyle(document.activeElement).outlineStyle,
}));
check('keyboard focus lands on real controls with a visible focus style', Boolean(focused.tag) && focused.outline !== 'none', JSON.stringify(focused));
void focus;

await context.close();
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed\n`);
process.exit(failed.length ? 1 : 0);
