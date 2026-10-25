#!/usr/bin/env node
/**
 * Offline + install check for the timetable, driven in a real browser against a
 * real production build.
 *
 * Unit tests can prove the policy and the reducer. They cannot prove the three
 * things that actually matter to a student sitting in a lecture hall with no
 * signal:
 *
 *   1. that a page saved while online still *renders its rows* after the
 *      network is switched off and the document is reloaded;
 *   2. that two batches saved on one device stay two separate copies;
 *   3. that the service worker never cached anything it had no business
 *      caching — not the signed-in pages, not `/api/**`, not another student's
 *      data.
 *
 * So this file drives headless Chromium through exactly those steps against a
 * built app and reports one line per assertion. It is the browser half of the
 * offline story; `npm run verify` runs the unit half.
 *
 *   npm run build && npm start                     # or: next start -p 3100
 *   npm run verify:offline
 *   PERF_APP_URL=http://127.0.0.1:3100 npm run verify:offline
 *
 * What it deliberately does not do: pretend an install happened. Headless
 * Chromium never offers `beforeinstallprompt`, so the native-prompt branch is
 * reported here and asserted nowhere. The button falling back to the platform
 * guide is the correct behaviour, and that part *is* asserted.
 *
 * Exit codes: 0 everything passed, 1 an assertion failed, 2 the app at
 * `PERF_APP_URL` is not reachable or is not a production build.
 */

import { launchBrowser } from './browser.mjs';

const BASE = process.env.PERF_APP_URL || 'http://127.0.0.1:3100';
const FIRST = (process.env.OFFLINE_CHECK_FIRST || 'o').toLowerCase();
const SECOND = (process.env.OFFLINE_CHECK_SECOND || 'j').toLowerCase();
const THIRD = (process.env.OFFLINE_CHECK_THIRD || 'b').toLowerCase();
const CACHE_DOCS = 'campusplus-timetable-documents-v1';

let failures = 0;
const results = [];

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
}

function section(title) {
  console.log(`\n\u001b[1m${title}\u001b[22m`);
}

async function reachable(url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(4000) });
    return response.status > 0;
  } catch {
    return false;
  }
}

if (!(await reachable(`${BASE}/timetable/${FIRST}`))) {
  console.error(`offline check: nothing answering at ${BASE}`);
  console.error('  npm run build && npm start      (or: next start -p 3100 -H 127.0.0.1)');
  process.exit(2);
}

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 412, height: 900 } });
// A passive probe. It records whether the browser *offered* an install; it never
// calls preventDefault, so it cannot change what the app under test sees.
await context.addInitScript(() => {
  window.__installProbe = { offered: false, accepted: false };
  window.addEventListener('beforeinstallprompt', () => {
    window.__installProbe.offered = true;
  });
  window.addEventListener('appinstalled', () => {
    window.__installProbe.accepted = true;
  });
});
let page = await context.newPage();

const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 200)));

/** Settle after a load: the timetable runs a 1 s timer and hydrates after paint. */
const settle = (ms = 900) => page.waitForTimeout(ms);
const evaluate = (fn, arg) => page.evaluate(fn, arg);
const letter = (division) => division.toUpperCase();

const idbRecords = () =>
  evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('campusplus-timetable-offline', 1);
        open.onsuccess = () => {
          const all = open.result.transaction('batches', 'readonly').objectStore('batches').getAll();
          all.onsuccess = () =>
            resolve(
              all.result.map((record) => ({
                division: record.division,
                checksum: record.checksum,
                events: record.eventCount,
                bytes: record.bytes,
                savedAt: record.savedAt,
                schemaVersion: record.schemaVersion,
              })),
            );
          all.onerror = () => resolve([{ error: 'read-error' }]);
        };
        open.onerror = () => resolve([{ error: 'open-error' }]);
      }),
  );

const cacheReport = () =>
  evaluate(
    async ({ docsCache, probe }) => {
      const names = await caches.keys();
      const sizes = {};
      for (const name of names) sizes[name] = (await (await caches.open(name)).keys()).length;
      const documents = await caches.open(docsCache).catch(() => null);
      const probes = {};
      if (documents) {
        for (const key of probe) probes[key] = Boolean(await documents.match(key));
      }
      return { names, sizes, probes };
    },
    {
      docsCache: CACHE_DOCS,
      probe: [
        `/timetable/${FIRST}`,
        `/timetable/${SECOND}`,
        '/home',
        '/login',
        '/admin',
        '/api/messages/sync',
        `/api/timetable/${FIRST}`,
      ],
    },
  );

const view = () =>
  evaluate(() => {
    const rows = [...document.querySelectorAll('.tt-item__subject')].map((node) => node.textContent.trim());
    const pill = document.querySelector('.tt-offline__label');
    const button = document.querySelector('.tt-install__actions .btn');
    return {
      h1: document.querySelector('h1')?.textContent?.trim() ?? null,
      rows,
      count: rows.length,
      pill: pill?.textContent?.trim() ?? null,
      button: button?.textContent?.trim() ?? null,
      dialog: Boolean(document.querySelector('[role="dialog"]')),
      dayTabs: document.querySelectorAll('.tt-tabs .tt-tab').length,
      todayMarks: document.querySelectorAll('.tt-tab__today, .tt-dayhead__today').length,
      status: document.querySelector('.tt-status')?.textContent?.trim() ?? null,
      text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 240),
    };
  });

const workerState = () =>
  evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      scope: registration?.scope ?? null,
      state: registration?.active?.state ?? registration?.installing?.state ?? null,
      controlling: Boolean(navigator.serviceWorker.controller),
      script: registration?.active?.scriptURL ?? registration?.installing?.scriptURL ?? null,
    };
  });

/**
 * Click the action and wait for the *record*, not for a label: the save is
 * finished when the week is on the device, and the wording afterwards is what
 * the next assertions check.
 */
const saveNow = async (division) => {
  await page.locator('.tt-install__actions .btn').first().click();
  await page.waitForFunction(
    (wanted) =>
      new Promise((resolve) => {
        const open = indexedDB.open('campusplus-timetable-offline', 1);
        open.onsuccess = () => {
          const all = open.result.transaction('batches', 'readonly').objectStore('batches').getAll();
          all.onsuccess = () => resolve(all.result.some((record) => record.division === wanted && record.checksum));
          all.onerror = () => resolve(false);
        };
        open.onerror = () => resolve(false);
      }),
    letter(division),
    { timeout: 30000 },
  );
  await settle(700);
};

// ---------------------------------------------------------------------------
section('0. the build under test');
await page.goto(`${BASE}/timetable/${FIRST}`, { waitUntil: 'load' });
await settle(1200);

check('a production build (a dev server registers no worker on purpose)', !(await page.content()).includes('react-refresh.js'));
const worker = await workerState();
check(
  'the timetable service worker is registered and activated',
  worker.state === 'activated' && String(worker.script).endsWith('/timetable/sw.js'),
  `${worker.state} · ${worker.script}`,
);
check('one registration, controlling this origin from the wide scope', worker.scope === `${BASE}/`, worker.scope ?? 'none');

const fresh = await view();
check('the real timetable is on the page', fresh.count > 0 && fresh.h1 === `Division ${letter(FIRST)}`, `${fresh.h1} · ${fresh.count} rows`);
check(
  'nothing was written to the device before the student asked',
  (await idbRecords()).filter((record) => record.division).length === 0,
);
check('the action asks to save, and does not claim an install yet', /^Save timetable for offline use$/.test(fresh.button ?? ''), fresh.button);

// ---------------------------------------------------------------------------
section(`1. saving ${letter(FIRST)} while online`);
await saveNow(FIRST);

const afterFirst = await idbRecords();
const savedFirst = afterFirst.find((record) => record.division === letter(FIRST));
check('one record for this batch, holding its whole week', afterFirst.filter((r) => r.division).length === 1 && savedFirst.events > 20, `${savedFirst?.events} events · ${savedFirst?.bytes} bytes`);
check('the record is versioned and timed', savedFirst?.schemaVersion === 1 && Boolean(savedFirst?.savedAt), `v${savedFirst?.schemaVersion} · ${savedFirst?.savedAt}`);

const saved = await view();
check('the button names the batch once the copy is on the device', new RegExp(`Add Division ${letter(FIRST)} \\([^)]*\\) timetable to Home Screen`).test(saved.button ?? ''), saved.button);
check('the header reports the saved copy', /Offline copy ready|Saved copy/.test(saved.pill ?? ''), saved.pill);

const caches1 = await cacheReport();
check('this batch’s document is cached, so a reload needs no network', caches1.probes[`/timetable/${FIRST}`] === true);
check('the other batch was not touched by this save', caches1.probes[`/timetable/${SECOND}`] === false);
check('no signed-in, admin or auth page was cached', !caches1.probes['/home'] && !caches1.probes['/login'] && !caches1.probes['/admin']);
check('no API response is in CacheStorage (the data lives in IndexedDB)', !caches1.probes[`/api/timetable/${FIRST}`] && !caches1.probes['/api/messages/sync']);
check('only this feature’s own caches exist on the origin', caches1.names.every((name) => name.startsWith('campusplus-timetable')), caches1.names.join(', '));

// ---------------------------------------------------------------------------
section('2. the saved page, reloaded with the radio off');
await context.setOffline(true);
await page.reload({ waitUntil: 'load' });
await settle(1400);

const offline = await view();
check('the timetable renders with no network at all', offline.count > 0 && offline.h1 === `Division ${letter(FIRST)}`, `${offline.h1} · ${offline.count} rows`);
check('the entries are the real subject lines, not a skeleton', offline.rows.some((row) => row.includes('/')), offline.rows[0]);
check('the five weekday controls still work offline', offline.dayTabs === 5, `${offline.dayTabs} tabs`);
// The marker is device-local and calendar-correct, which means the expectation
// depends on the day this runs: on a weekend no tab is "today" and no NOW/NEXT
// line may be invented. Assert the page agrees with the calendar instead of
// asserting a fixed answer.
const calendar = await evaluate(() => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' }).formatToParts(new Date());
  const day = parts.find((part) => part.type === 'weekday')?.value ?? '';
  return { day, teaching: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(day) };
});
check(
  `today’s marker and the NOW/NEXT line agree with the campus calendar (${calendar.day})`,
  calendar.teaching ? offline.todayMarks >= 1 && /NOW|NEXT|free|no more/i.test(offline.status ?? '') : offline.todayMarks === 0 && offline.status === null,
  `${offline.todayMarks} marker(s), status: ${offline.status ?? 'none'}`,
);
check('the page labels its copy as saved, with a time', /Saved copy|Offline copy ready/.test(offline.pill ?? ''), offline.pill);
check('an offline load never throws inside the page', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

const walked = [];
for (const index of [0, 1, 2, 3, 4]) {
  await page.locator('.tt-tabs .tt-tab').nth(index).click();
  await settle(260);
  const step = await view();
  walked.push(step.rows.length);
  const pressed = await evaluate((i) => document.querySelectorAll('.tt-tabs .tt-tab')[i]?.getAttribute('aria-pressed'), index);
  walked.push(pressed === 'true');
}
check('every weekday can be switched offline, and the choice is announced', walked.filter((v) => v === true).length === 5, `rows per day: ${walked.filter((v) => typeof v === 'number').join(',')}`);

// Back to the day the offline capture was taken on, so the two views describe
// the same weekday and the comparison below means something.
await page.locator('.tt-tabs .tt-tab').nth(0).click();
await settle(300);
await context.setOffline(false);
await settle(1500);
const online = await view();
check('coming back online does not empty the page', online.count === offline.count, `${online.count} rows`);
check('and the offline rows were the same rows the network has', online.rows.join('|') === offline.rows.join('|'), online.rows.slice(0, 2).join(' · '));

// ---------------------------------------------------------------------------
section(`3. an unsaved batch (${letter(THIRD)}), offline`);
await context.setOffline(true);
await page.goto(`${BASE}/timetable/${THIRD}`, { waitUntil: 'load' }).catch(() => {});
await settle(1400);
const unsaved = await view();
check(
  'an unsaved batch explains itself instead of showing a blank page',
  /Nothing saved|no signal|offline/i.test(unsaved.text),
  unsaved.text.slice(0, 90),
);
await context.setOffline(false);
await settle(800);

// ---------------------------------------------------------------------------
section(`4. a second batch, and reconstruction from the shell alone`);
await page.goto(`${BASE}/timetable/${SECOND}`, { waitUntil: 'load' });
await settle(1200);
await saveNow(SECOND);

const both = await idbRecords();
check('both batches are stored on this device', both.filter((r) => r.division).length === 2, both.map((r) => r.division).join(', '));
check('each batch kept its own checksum', both.find((r) => r.division === letter(FIRST))?.checksum === savedFirst.checksum, both.map((r) => `${r.division}:${r.checksum}`).join(' '));
check('the second record holds the second week, not a copy of the first', both.find((r) => r.division === letter(SECOND))?.events !== savedFirst.events || both.find((r) => r.division === letter(SECOND))?.checksum !== savedFirst.checksum);

// Delete both documents from CacheStorage on purpose. What is left is the app
// shell plus IndexedDB — exactly what an installed icon has after the browser
// drops its HTTP cache or the phone is rebooted. If the shell cannot rebuild
// the page from the stored data, "saved for offline use" is a lie.
await evaluate(
  async ({ docsCache, keys }) => {
    const cache = await caches.open(docsCache);
    for (const key of keys) await cache.delete(key);
  },
  { docsCache: CACHE_DOCS, keys: [`/timetable/${FIRST}`, `/timetable/${SECOND}`] },
);
await context.setOffline(true);
await page.goto(`${BASE}/timetable/${SECOND}`, { waitUntil: 'load' });
await settle(1600);
const fromShell = await view();
check('the shell rebuilds the saved batch from IndexedDB with no document cached', fromShell.count > 0 && fromShell.h1 === `Division ${letter(SECOND)}`, `${fromShell.h1} · ${fromShell.count} rows`);
check('the address stays the batch that was asked for', page.url().endsWith(`/timetable/${SECOND}`), page.url());
await page.goto(`${BASE}/timetable/${FIRST}`, { waitUntil: 'load' });
await settle(1200);
const otherStillThere = await view();
check('and the first batch still renders as itself', otherStillThere.h1 === `Division ${letter(FIRST)}` && otherStillThere.count > 0, `${otherStillThere.h1} · ${otherStillThere.count} rows`);
check('no page error escaped through any offline step', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
await context.setOffline(false);
await settle(1200);

// ---------------------------------------------------------------------------
section('5. a cold start: every page closed, still offline');
// Storage must survive the *process*, not just the tab. Closing every page lets
// Chromium retire the worker, so the next open boots a cold worker from disk and
// re-runs activation — the closest reproducible stand-in for a reboot.
for (const openPage of context.pages()) await openPage.close();
await context.setOffline(true);
const reopened = await context.newPage();
const reopenErrors = [];
reopened.on('pageerror', (error) => reopenErrors.push(String(error).slice(0, 160)));
await reopened.goto(`${BASE}/timetable/${FIRST}`, { waitUntil: 'load' });
await reopened.waitForTimeout(1600);
const cold = await reopened.evaluate(() => {
  const rows = [...document.querySelectorAll('.tt-item__subject')].map((n) => n.textContent.trim());
  return {
    rows: rows.length,
    h1: document.querySelector('h1')?.textContent?.trim() ?? null,
    pill: document.querySelector('.tt-offline__label')?.textContent?.trim() ?? null,
    worker: Boolean(navigator.serviceWorker.controller),
  };
});
check('the reopened page still renders the saved week with no network', cold.rows > 0 && cold.h1 === `Division ${letter(FIRST)}`, `${cold.h1} · ${cold.rows} rows`);
check('a cold worker took control without a network', cold.worker, `controller: ${cold.worker}`);
check('the chip reports the copy’s age, from disk', /Saved copy|Offline copy ready/.test(cold.pill ?? ''), cold.pill);
check('the cold start threw nothing', reopenErrors.length === 0, reopenErrors.join(' | '));
// The sections below drive `page`, so replace the closed one — the same context,
// which is the point: a new page in the same profile, online again.
await reopened.close();
await context.setOffline(false);
page = await context.newPage();
await page.goto(`${BASE}/timetable/${FIRST}`, { waitUntil: 'load' });
await settle(1200);

// ---------------------------------------------------------------------------
section('6. placement, keyboard and motion');
await page.goto(`${BASE}/timetable`, { waitUntil: 'load' });
await settle(700);
const index = await view();
check('the timetable index carries no install action', !index.button && !index.pill, `button=${index.button}`);
await page.goto(`${BASE}/login`, { waitUntil: 'load' });
await settle(700);
const login = await view();
check('sign-in carries none either', !login.button && !login.pill);

await page.goto(`${BASE}/timetable/${FIRST}`, { waitUntil: 'load' });
await settle(1200);
await page.keyboard.press('Tab');
const focusedTag = await evaluate(() => document.activeElement?.tagName ?? 'BODY');
check('the page is reachable from the keyboard', focusedTag !== 'BODY', `first stop: <${focusedTag.toLowerCase()}>`);
await page.locator('.tt-install__actions .btn').first().focus();
await page.keyboard.press('Enter');
await settle(600);
const opened = await view();
check('Enter on the action opens the sheet', opened.dialog);
const sheetText = await evaluate(() => document.querySelector('[role="dialog"]')?.innerText?.replace(/\s+/g, ' ') ?? '');
check('the sheet names this batch', sheetText.includes(`Division ${letter(FIRST)}`), sheetText.slice(0, 80));
check('and it tells the truth about the platform in front of us', /Home Screen|browser menu|Chrome|Safari|Firefox/i.test(sheetText));
await page.keyboard.press('Escape');
await settle(500);
check('Escape closes it', !(await view()).dialog);

await page.emulateMedia({ reducedMotion: 'reduce' });
const motion = await evaluate(() => {
  const seconds = (value) => String(value || '0s').split(',').map((part) => (part.trim().endsWith('ms') ? parseFloat(part) / 1000 : parseFloat(part) || 0));
  const pill = document.querySelector('.tt-offline__pill');
  const spinner = document.querySelector('.tt-offline__spinner');
  const card = document.querySelector('.tt-install');
  return {
    pillTransition: seconds(pill ? getComputedStyle(pill).transitionDuration : '0s'),
    spinnerAnimation: spinner ? getComputedStyle(spinner).animationName : 'none',
    spinnerSeconds: spinner ? seconds(getComputedStyle(spinner).animationDuration) : [0],
    // The bottom action has to clear the iOS home indicator; that is what the
    // safe-area padding is for, so it is measured here rather than assumed.
    cardPaddingBottom: card ? getComputedStyle(card).paddingBottom : '0px',
  };
});
// The design system's own reduced-motion rule uses the accessible 0.001ms
// pattern, not `0s`, so "no perceptible motion" is the assertion — under 10 ms.
const still = (values) => values.every((value) => value < 0.01);
check(
  'reduced motion stops the offline pill and the spinner',
  still(motion.pillTransition) && (motion.spinnerAnimation === 'none' || still(motion.spinnerSeconds)),
  JSON.stringify(motion),
);
check('the card has real bottom padding for a notched phone', parseFloat(motion.cardPaddingBottom) >= 16, motion.cardPaddingBottom);
await page.emulateMedia({ reducedMotion: 'no-preference' });

// ---------------------------------------------------------------------------
section('7. a browser that refuses the worker (private profile, blocked storage)');
// `context.route` cannot intercept a registration request, so the block is
// placed where a real private profile places it: the API itself. A save must
// still succeed here — it is IndexedDB doing the work — and the copy must not
// promise an offline *page reload* that this browser will not deliver.
const blocked = await browser.newContext({ viewport: { width: 412, height: 900 } });
await blocked.addInitScript(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  }
});
const blockedPage = await blocked.newPage();
const blockedErrors = [];
blockedPage.on('pageerror', (error) => blockedErrors.push(String(error).slice(0, 160)));
await blockedPage.goto(`${BASE}/timetable/${FIRST}`, { waitUntil: 'load' });
await blockedPage.waitForSelector('.tt-install__actions .btn');
await blockedPage.waitForTimeout(1500);
await blockedPage.locator('.tt-install__actions .btn').first().click();
await blockedPage.waitForTimeout(4000);

const blockedView = await blockedPage.evaluate(() => {
  const rows = [...document.querySelectorAll('.tt-item__subject')].map((n) => n.textContent.trim());
  return {
    rows: rows.length,
    button: document.querySelector('.tt-install__actions .btn')?.textContent?.trim() ?? null,
    detail: document.querySelector('.tt-offline__detail')?.textContent?.trim() ?? null,
  };
});
const blockedRecords = await blockedPage.evaluate(
  () =>
    new Promise((resolve) => {
      const open = indexedDB.open('campusplus-timetable-offline', 1);
      open.onsuccess = () => {
        const all = open.result.transaction('batches', 'readonly').objectStore('batches').getAll();
        all.onsuccess = () => resolve(all.result.map((record) => record.division));
        all.onerror = () => resolve([]);
      };
      open.onerror = () => resolve([]);
    }),
);
check('the timetable is still saved without a service worker', blockedRecords.includes(letter(FIRST)), blockedRecords.join(',') || 'no records');
check('and the page still renders its rows', blockedView.rows > 0, `${blockedView.rows} rows`);
check('the action is not stuck on “preparing”', !/Preparing/.test(blockedView.button ?? ''), blockedView.button);
check(
  'the copy names the limitation instead of hiding it',
  /would not keep the page files|not active/.test(blockedView.detail ?? ''),
  (blockedView.detail ?? '').slice(0, 96),
);
check('no error escaped into the console', blockedErrors.length === 0, blockedErrors.join(' | '));
await blocked.close();

// ---------------------------------------------------------------------------
section('8. what the platform actually offered');
const probe = await evaluate(() => window.__installProbe ?? {});
const standalone = await evaluate(() => window.matchMedia('(display-mode: standalone)').matches);
console.log(`  beforeinstallprompt offered: ${probe.offered ? 'yes' : 'no (headless Chromium never fires it)'} · appinstalled: ${probe.accepted ? 'yes' : 'no'} · standalone: ${standalone}`);
check('an unoffered prompt becomes a guide, never a fake success or a failure', /^Add (Division .* )?timetable to Home Screen$/.test((await view()).button ?? '') || /from Safari|guide/i.test((await view()).button ?? ''));
const quota = await evaluate(async () => {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage, quota: estimate.quota, persisted: await navigator.storage?.persisted?.() };
});
console.log(
  `  storage: ${quota ? `${(quota.usage / 1024).toFixed(0)} kB used · durable grant: ${quota.persisted ? 'granted' : 'not granted (browser decides)'}` : 'estimate unavailable'}`,
);

// ---------------------------------------------------------------------------
section('summary');
const failed = results.filter((result) => !result.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed against ${BASE}`);
if (failed.length) {
  for (const result of failed) console.log(`  ✗ ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
  console.log('\noffline check FAILED');
  await browser.close();
  process.exit(1);
}
console.log('offline check OK');
await browser.close();
process.exit(0);
