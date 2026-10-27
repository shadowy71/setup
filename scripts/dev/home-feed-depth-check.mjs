#!/usr/bin/env node
/**
 * Real-browser check for Home's feed depth — the thing "don't cap Home at ten posts"
 * is actually about.
 *
 * Home's list used to be cut twice: the route asked `campus_feed()` for ten rows, and the
 * browser cache re-truncated whatever came back, so no request could have made the page
 * longer. It is now a page at a time (one page = the biggest page the SQL function
 * accepts), and the surface keeps every page the reader has asked for.
 *
 * This runs against the local harness (`npm run perf:serve`: real PostgreSQL, real
 * migrations, real RLS, 240 published posts) and a real Chromium, and asserts the
 * behaviour a student would see rather than the source of the component:
 *
 *   • the first page is a page, not ten;
 *   • the SQL offset boundary does not repeat or skip an entry;
 *   • "load older" appends the next page underneath what is on screen, once each;
 *   • the newest entry still arrives at the head without evicting the oldest loaded one.
 *
 *   npm run build && npx next start -p 3100      # .env.local pointing at the stub
 *   node scripts/dev/home-feed-depth-check.mjs
 *
 * Options: --base <url> --student <email> --page <n> --shots <dir>
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createSessionCookie } from './perf/session.mjs';
import { root } from './perf/lib.mjs';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: process.env.PERF_APP_URL || 'http://127.0.0.1:3100' },
    student: { type: 'string', default: 'perf.student1@pccoepune.org' },
    page: { type: 'string', default: '50' },
    shots: { type: 'string', default: path.join(root, 'node_modules/.cache/home-feed-depth') },
  },
});

const BASE = values.base;
const PAGE = Number(values.page);
const SHOTS = values.shots;
await mkdir(SHOTS, { recursive: true });

const harness = JSON.parse(await readFile(path.join(root, 'node_modules/.cache/perf/harness.json'), 'utf8'));
let failures = 0;
const report = { base: BASE, page: PAGE, checks: [], startedAt: new Date().toISOString() };

function log(kind, label, detail = '') {
  report.checks.push({ label, kind, detail });
  console.log(`${kind === 'ok' ? 'ok  ' : kind === 'note' ? 'note' : 'FAIL'}  ${label.padEnd(56)} ${detail}`);
}

async function check(label, assert) {
  try {
    const detail = await assert();
    log('ok', label, typeof detail === 'string' ? detail : '');
  } catch (error) {
    failures += 1;
    log('FAIL', label, (error?.message || String(error)).split('\n')[0].slice(0, 220));
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/* ----------------------------------------------------------------------- setup */

const session = await createSessionCookie(harness.stubUrl, values.student);

let launchBrowser;
try {
  ({ launchBrowser } = await import(path.join(root, 'scripts/dev/browser.mjs')));
  await import('playwright-core');
} catch (error) {
  console.error(`\nChromium bootstrap unavailable (${error.message}). Run \`npm ci\` first.`);
  process.exit(2);
}
const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
await context.addCookies([
  ...session.cookies.map(({ name, value }) => ({ name, value, url: BASE })),
  // The one-time island intro overlay would otherwise cover the stream.
  { name: 'campus_intro', value: '1', url: BASE },
]);
const pageErrors = [];
const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(error.message));

const slots = () => page.$$eval('.home-stream .stream-slot', (els) => els.map((el) => el.dataset.kind || ''));
const railCount = () =>
  page.evaluate(() => {
    const match = /(\d+)\s+entries/.exec(document.body.innerText || '');
    return match ? Number(match[1]) : null;
  });

/**
 * Waits for the first page to paint and returns its slot count. Polls the DOM rather
 * than a fixed sleep because a cold production route needs a database round trip.
 */
async function waitForPaint(minimum, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const count = (await slots()).length;
    if (count >= minimum) return count;
    await page.waitForTimeout(500);
  }
  throw new Error(`the stream never reached ${minimum} entries (last count ${(await slots()).length})`);
}

await page.goto(`${BASE}/home`, { waitUntil: 'load', timeout: 90_000 });

/* ------------------------------------------------------------------- the checks */

let firstPage = 0;
await check(`first page paints more than the ten posts Home used to cap at`, async () => {
  firstPage = await waitForPaint(PAGE > 10 ? 11 : 1);
  expect(firstPage > 10, `only ${firstPage} entries rendered — the ten-entry cap is still in force`);
  expect(firstPage <= PAGE, `${firstPage} entries on one page, but a page is ${PAGE}`);
  return `${firstPage} entries`;
});

await check('the page is complete, not a skeleton that fills in later', async () => {
  const empty = await page.$$eval('.home-stream .stream-slot', (els) =>
    els.filter((el) => (el.innerText || '').trim().length < 40).length,
  );
  expect(empty === 0, `${empty} slots rendered without a body`);
  return `${firstPage} cards, each with content`;
});

await check('the rail and the stream agree about how much is loaded', async () => {
  const shown = await railCount();
  expect(shown === firstPage, `the rail says ${shown} entries while the stream holds ${firstPage}`);
  return `${shown} entries`;
});

await check('the route reports a full page and that an older page exists', async () => {
  const body = await page.evaluate(async () => (await fetch('/api/home/feed', { headers: { Accept: 'application/json' } })).json());
  expect(body.ok === true, `the feed route answered ${JSON.stringify(body).slice(0, 120)}`);
  expect(body.feed.length === PAGE, `the route returned ${body.feed.length} rows, expected one page of ${PAGE}`);
  expect(body.page?.limit === PAGE, `page.limit says ${body.page?.limit}`);
  expect(body.page?.offset === 0, `page.offset says ${body.page?.offset}`);
  expect(body.page?.hasMore === true, 'hasMore is false with 240 published posts in the database');
  return `${body.feed.length} rows, hasMore ${body.page.hasMore}`;
});

await check('the second page continues the list without repeating or skipping', async () => {
  const both = await page.evaluate(
    async (pageSize) => {
      const one = await (await fetch(`/api/home/feed`, { headers: { Accept: 'application/json' } })).json();
      const two = await (await fetch(`/api/home/feed?offset=${pageSize}`, { headers: { Accept: 'application/json' } })).json();
      const ids = (payload) => payload.feed.map((item) => `${item.type}:${item.id}`);
      const a = ids(one);
      const b = ids(two);
      return { a, b, overlap: a.filter((id) => b.includes(id)).length, page: two.page };
    },
    PAGE,
  );
  expect(both.b.length === PAGE, `the second page returned ${both.b.length} rows`);
  expect(both.overlap === 0, `${both.overlap} entries appear on both pages — the offset boundary is wrong`);
  expect(both.page?.offset === PAGE, `the second page reports offset ${both.page?.offset}`);
  const firstOfTwo = both.b[0];
  const boundary = new Set(both.a);
  expect(!boundary.has(firstOfTwo), 'the newest entry of page two was already on page one');
  return `${both.a.length} + ${both.b.length} distinct entries, no overlap`;
});

await page.screenshot({ path: path.join(SHOTS, 'home-first-page.png'), fullPage: false });

let withSecondPage = firstPage;
await check('the button offers exactly one more page', async () => {
  const label = await page.locator('button', { hasText: `Load ${PAGE} older entries` }).first().innerText();
  expect(label.includes(String(PAGE)), `the button says "${label}"`);
  return label.trim();
});

await check('pressing it appends the older page under the newer one', async () => {
  await page.locator('button', { hasText: `Load ${PAGE} older entries` }).first().click();
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    withSecondPage = (await slots()).length;
    if (withSecondPage >= firstPage + PAGE) break;
    await page.waitForTimeout(400);
  }
  expect(withSecondPage === firstPage + PAGE, `the stream holds ${withSecondPage} entries after one more page (expected ${firstPage + PAGE})`);
  const shown = await railCount();
  expect(shown === withSecondPage, `the rail says ${shown} while the stream holds ${withSecondPage}`);
  return `${firstPage} → ${withSecondPage} entries`;
});

await page.screenshot({ path: path.join(SHOTS, 'home-two-pages.png'), fullPage: false });

// The affordance itself, in place: what a reader sees at the bottom of the list.
await check('the offer to go further back is still there after a page', async () => {
  const button = page.locator('button', { hasText: `Load ${PAGE} older entries` }).first();
  expect(await button.count() === 1, 'the stream no longer offers an older page after one page was added');
  await button.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'home-load-more.png'), fullPage: false });
  return `button: ${(await button.innerText()).trim()}`;
});

const POST_KINDS = ['post', 'discussion', 'poll'];
const firstPostSlot = () =>
  page
    .locator(POST_KINDS.map((kind) => `.home-stream .stream-slot[data-kind="${kind}"]`).join(', '))
    .first();

await check('a page deeper still keeps the feed ordered newest-first', async () => {
  const rows = await page.$$eval('.home-stream .stream-slot', (els) =>
    els.map((el) => ({
      kind: el.dataset.kind || '',
      time: el.querySelector('time')?.getAttribute('datetime') || null,
    })),
  );
  // Only the entries `campus_feed()` sorts by their own timestamp: pinned notices lead the
  // stream by design (the SQL gives them a sort key a day ahead of everything else), and
  // events sort by when they start, so comparing their rendered dates would be checking
  // the wrong column, not the wrong order.
  const stamps = rows.filter((row) => POST_KINDS.includes(row.kind) && row.time).map((row) => Date.parse(row.time));
  expect(stamps.length > firstPage, `${stamps.length} timestamped entries after loading two pages of ${PAGE}`);
  const sorted = [...stamps].sort((a, b) => b - a);
  expect(JSON.stringify(stamps) === JSON.stringify(sorted), 'the merged pages are not newest-first');
  return `${stamps.length} timestamps, descending across the page boundary`;
});

await check('a fresh post lands at the head without evicting the loaded tail', async () => {
  const before = (await slots()).length;
  // A body the 240 seeded posts cannot contain, so a match is unambiguous.
  const probe = `home-feed-depth ${Date.now().toString(36)}`;
  await page.locator('#post-body').first().click();
  await page.locator('#post-body').first().fill(probe);
  await page
    .locator('form')
    .filter({ has: page.locator('#post-body') })
    .first()
    .locator('button[type="submit"]')
    .click();

  const started = Date.now();
  let found = 0;
  while (Date.now() - started < 30_000) {
    found = await page.locator('.home-stream .stream-slot', { hasText: probe }).count();
    if (found > 0) break;
    await page.waitForTimeout(500);
  }
  expect(found === 1, `the new post appears ${found} times in the stream`);
  const after = (await slots()).length;
  expect(after === before + 1, `the stream went from ${before} to ${after} entries — a loaded entry was evicted to make room`);
  const head = await firstPostSlot().innerText();
  expect(head.includes(probe), 'the new post did not lead the entries the feed orders by time');
  return `${before} → ${after} entries, new post in front of the loaded pages`;
});

await check('nothing in the run threw in the page', async () => {
  expect(pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  return 'no page errors';
});

await page.screenshot({ path: path.join(SHOTS, 'home-after-write.png'), fullPage: false });
await browser.close();

report.finishedAt = new Date().toISOString();
report.failures = failures;
await writeFile(path.join(SHOTS, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log(`\n${failures === 0 ? 'home-feed depth ✓' : `home-feed depth ✗ (${failures} failing check${failures === 1 ? '' : 's'})`}  ·  report: ${path.relative(process.cwd(), path.join(SHOTS, 'report.json'))}`);
process.exit(failures === 0 ? 0 : 1);
