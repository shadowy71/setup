/**
 * scripts/dev/week-probe.mjs — which CSS keeps the open week grid inside the phone viewport?
 *
 *   node scripts/dev/week-probe.mjs [port] [path]
 *
 * On a phone (mobile viewport emulation) the layout viewport follows the
 * document's scrollable overflow: `documentElement.scrollWidth` above
 * `innerWidth` is what the browser reports as "this page is wider than the
 * screen", and the phone answers by zooming the whole page out. This opens the
 * <details> under a set of candidate rules and prints the numbers for each, so
 * the fix is chosen by measurement instead of by folklore.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launchBrowser } from './browser.mjs';

const PORT = Number(process.argv[2] ?? 3100);
const PATH = process.argv[3] ?? '/timetable/o';
const OUT_DIR = 'node_modules/.cache/week-probe';

const CANDIDATES = {
  none: '',
  'scroll contain:paint': '.tt-scroll{contain:paint}',
  'scroll contain:layout paint': '.tt-scroll{contain:layout paint}',
  'scroll contain:layout style paint': '.tt-scroll{contain:layout style paint}',
  'body overflow hidden': '.tt-week__body{overflow-x:hidden}',
  'body contain paint': '.tt-week__body{contain:paint}',
  'details contain paint': 'details.tt-week{contain:paint}',
  'details contain paint + radius': 'details.tt-week{contain:paint;border-radius:var(--radius-lg)}',
  'scroller overflow hidden': '.tt-scroll{overflow:hidden auto}',
  'root clip on body wrapper': '.tt-week__body{clip-path:inset(0)}',
};

const MEASURE = `(async () => {
  const el = document.getElementById('probe-style');
  el.textContent = __CSS__;
  const details = document.querySelector('details.tt-week');
  details.open = false;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  details.open = true;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const de = document.documentElement;
  const scroller = document.querySelector('.tt-scroll');
  const inner = document.querySelector('.tt-scroll table');
  return {
    innerWidth: window.innerWidth,
    vvWidth: window.visualViewport ? Math.round(window.visualViewport.width) : null,
    scale: window.visualViewport ? Number(window.visualViewport.scale.toFixed(3)) : null,
    docClientWidth: de.clientWidth,
    docScrollWidth: de.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    scrollerW: Math.round(scroller.getBoundingClientRect().width),
    scrollerScrolls: scroller.scrollWidth > scroller.clientWidth,
    scrollerLeft: scroller.scrollLeft,
    tableW: inner ? Math.round(inner.getBoundingClientRect().width) : null,
  };
})()`;

await mkdir(OUT_DIR, { recursive: true });
const browser = await launchBrowser();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
  locale: 'en-IN',
  timezoneId: 'Asia/Kolkata',
});
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}${PATH}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.evaluate(`{ const s = document.createElement('style'); s.id = 'probe-style'; document.head.appendChild(s); }`);

for (const [name, css] of Object.entries(CANDIDATES)) {
  const r = await page.evaluate(MEASURE.replace('__CSS__', JSON.stringify(css)));
  const expanded = r.docScrollWidth > r.innerWidth + 1 || r.innerWidth > 391;
  console.log(
    `${expanded ? 'ZOOMS OUT' : 'fits     '} · ${name.padEnd(22)} innerWidth ${String(r.innerWidth).padStart(4)}` +
      ` · vv ${r.vvWidth}@${r.scale} · html.clientWidth ${String(r.docClientWidth).padStart(4)}` +
      ` · scrollWidth html ${String(r.docScrollWidth).padStart(4)} body ${String(r.bodyScrollWidth).padStart(4)}` +
      ` · scroller ${r.scrollerW}px scrolls:${r.scrollerScrolls} · table ${r.tableW}`,
  );
}

// Leave the page in the untouched, real user state and photograph the glitch.
await page.evaluate(`{ document.getElementById('probe-style').textContent = ''; }`);
await page
  .locator('details.tt-week > summary')
  .click({ force: true, timeout: 3_000 })
  .catch(() => {});
await page.waitForTimeout(900);
await page.screenshot({ path: join(OUT_DIR, 'phone-zoomed.png') });
await browser.close();
console.log(`\nzoomed-state screenshot: ${OUT_DIR}/phone-zoomed.png`);
