#!/usr/bin/env node
/**
 * Real-browser check for Home's paging: ten at a time, and a "Show more" that keeps going.
 *
 * Home used to *stop* at ten — the route asked `campus_feed()` for ten rows and the browser
 * cache re-truncated whatever came back, so no request could have made the page longer. Ten is
 * still the page size (a screenful is what a request should cost), but it is now a page rather
 * than a ceiling: each tap of "Show more" appends another ten under what is already on screen,
 * and nothing slices the list afterwards.
 *
 * This runs against the local harness (`npm run perf:serve`: real PostgreSQL, real migrations,
 * real RLS, 240 published posts) and a real Chromium, and asserts what a student would see
 * rather than the source of the component:
 *
 *   • the first paint is exactly one page, and the page size is what the route says it is;
 *   • the SQL offset boundary neither repeats nor skips an entry;
 *   • "Show more" can be pressed repeatedly and each press grows the list by one page;
 *   • a post that arrives while the reader is three pages deep does not evict their oldest
 *     loaded entry, and the merged list stays in the feed's documented order.
 *
 *   npm run build && npx next start -p 3100      # .env.local pointing at the stub
 *   node scripts/dev/home-feed-depth-check.mjs
 *
 * Options: --base <url> --student <email> --page <n> --taps <n> --shots <dir>
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
    // The expected page size. Unset means "whatever the route reports", so a deliberate change
    // to `HOME_FEED_PAGE_SIZE` does not need this script edited as well — but passing `--page 10`
    // is how you assert the number itself.
    page: { type: 'string', default: '' },
    taps: { type: 'string', default: '2' },
    shots: { type: 'string', default: path.join(root, 'node_modules/.cache/home-feed-depth') },
  },
});

const BASE = values.base;
const EXPECTED_PAGE = values.page ? Number(values.page) : null;
const TAPS = Number(values.taps);
const SHOTS = values.shots;
await mkdir(SHOTS, { recursive: true });

const harness = JSON.parse(await readFile(path.join(root, 'node_modules/.cache/perf/harness.json'), 'utf8'));
let failures = 0;
const report = { base: BASE, expectedPage: EXPECTED_PAGE, taps: TAPS, checks: [], startedAt: new Date().toISOString() };

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
const showMore = () => page.locator('button', { hasText: 'Show more' }).first();

/**
 * The stream mounts placeholder slots and then fills them, so counting rows the instant some
 * appear measures the skeleton. `settledCount` returns a number only after it has stopped moving,
 * which is what makes "one page of ten" a measurement rather than a race.
 */
async function settledCount(timeoutMs = 60_000, samples = 3) {
  const started = Date.now();
  let last = -1;
  let stable = 0;
  while (Date.now() - started < timeoutMs) {
    const count = (await slots()).length;
    if (count === last && count > 0) {
      stable += 1;
      if (stable >= samples) return count;
    } else {
      stable = 0;
      last = count;
    }
    await page.waitForTimeout(300);
  }
  return last;
}

async function waitForPaint(minimum, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if ((await slots()).length >= minimum) return settledCount(timeoutMs - (Date.now() - started));
    await page.waitForTimeout(300);
  }
  throw new Error(`the stream never reached ${minimum} entries (last count ${(await slots()).length})`);
}

/** Clicks "Show more" and waits for exactly one more page to have settled on screen. */
async function tapShowMore(loaded, pageSize, tap) {
  const wanted = loaded + pageSize;
  await showMore().click();
  const count = await waitForPaint(wanted, 45_000);
  expect(count === wanted, `tap ${tap}: the stream holds ${count} entries, expected ${wanted}`);
  return count;
}

// The page size is read from the route before the page is opened, so every expectation below is
// "one page" as the server defines it rather than a number duplicated into this script. The
// request runs in the browser context, so it carries the same session cookie Home will get.
const meta = await (await context.request.get(`${BASE}/api/home/feed`, { headers: { Accept: 'application/json' } })).json();
const PAGE = meta.page?.limit ?? 0;
expect(PAGE > 0, `the feed route did not report a page size (${JSON.stringify(meta).slice(0, 120)})`);
expect(EXPECTED_PAGE === null || PAGE === EXPECTED_PAGE, `the route pages ${PAGE} at a time, expected ${EXPECTED_PAGE}`);
expect(PAGE <= 20, `a page is ${PAGE} entries — that is not a screenful, it is a dump`);

await page.goto(`${BASE}/home`, { waitUntil: 'load', timeout: 90_000 });

/* ------------------------------------------------------------------- the checks */

let firstPage = 0;

await check('the first paint is one page — ten entries, not the whole feed', async () => {
  firstPage = await waitForPaint(PAGE);
  expect(firstPage === PAGE, `the stream settled at ${firstPage} entries for a page of ${PAGE}`);
  return `${firstPage} entries, page size ${PAGE}`;
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
  expect(body.page?.offset === 0, `page.offset says ${body.page?.offset}`);
  expect(body.page?.hasMore === true, 'hasMore is false with 240 published posts in the database');
  return `${body.feed.length} rows, hasMore ${body.page.hasMore}`;
});

await check('the next page continues the list without repeating or skipping', async () => {
  const both = await page.evaluate(
    async (pageSize) => {
      const one = await (await fetch('/api/home/feed', { headers: { Accept: 'application/json' } })).json();
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
  expect(!new Set(both.a).has(both.b[0]), 'the newest entry of page two was already on page one');
  return `${both.a.length} + ${both.b.length} distinct entries, no overlap`;
});

await page.screenshot({ path: path.join(SHOTS, 'home-first-page.png'), fullPage: false });

let loaded = firstPage;
for (let tap = 1; tap <= TAPS; tap += 1) {
  await check(`"Show more" tap ${tap} appends one page under what is on screen`, async () => {
    const label = (await showMore().innerText()).trim();
    expect(label === 'Show more', `the control says "${label}"`);
    const before = loaded;
    loaded = await tapShowMore(loaded, PAGE, tap);
    return `${before} → ${loaded} entries`;
  });
}

await page.screenshot({ path: path.join(SHOTS, 'home-after-taps.png'), fullPage: false });

await check('it offers another page while one exists, and the rail keeps count', async () => {
  const onScreen = await settledCount(10_000);
  expect(onScreen === loaded, `the stream settled at ${onScreen} entries after ${TAPS} taps (expected ${loaded})`);
  expect((await showMore().count()) === 1, `the control is gone after ${loaded} entries, but 240 posts are seeded`);
  const shown = await railCount();
  expect(shown === loaded, `the rail says ${shown} while the stream holds ${loaded}`);
  await showMore().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'home-show-more.png'), fullPage: false });
  return `button: ${(await showMore().innerText()).trim()} · rail: ${shown} entries`;
});

const POST_KINDS = ['post', 'discussion', 'poll'];
const firstPostSlot = () =>
  page.locator(POST_KINDS.map((kind) => `.home-stream .stream-slot[data-kind="${kind}"]`).join(', ')).first();

await check('the pages stay in the feed’s own order across every seam', async () => {
  const rows = await page.$$eval('.home-stream .stream-slot', (els) =>
    els.map((el) => ({
      kind: el.dataset.kind || '',
      time: el.querySelector('time')?.getAttribute('datetime') || null,
    })),
  );
  // Only the entries `campus_feed()` sorts by their own timestamp: pinned notices lead the
  // stream by design (the SQL gives them a sort key a day ahead of everything else), and
  // events sort by when they start, so comparing their rendered dates would be checking the
  // wrong column, not the wrong order.
  const stamps = rows.filter((row) => POST_KINDS.includes(row.kind) && row.time).map((row) => Date.parse(row.time));
  expect(stamps.length > firstPage, `${stamps.length} timestamped entries after ${TAPS} more page(s) of ${PAGE}`);
  const sorted = [...stamps].sort((a, b) => b - a);
  expect(JSON.stringify(stamps) === JSON.stringify(sorted), 'the merged pages are not newest-first');
  return `${stamps.length} timestamps, descending across ${TAPS} page boundary(ies)`;
});

await check('a fresh post lands in front without evicting the loaded tail', async () => {
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

report.page = PAGE;
report.loaded = loaded;
report.finishedAt = new Date().toISOString();
report.failures = failures;
await writeFile(path.join(SHOTS, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

console.log(`\n${failures === 0 ? 'home-feed paging ✓' : `home-feed paging ✗ (${failures} failing check${failures === 1 ? '' : 's'})`}  ·  ${loaded} entries on screen  ·  report: ${path.relative(process.cwd(), path.join(SHOTS, 'report.json'))}`);
process.exit(failures === 0 ? 0 : 1);
