#!/usr/bin/env node
/**
 * Cold + repeat document visits in one real Chromium browser context.
 *
 * The first page in each context has HTTP cache disabled. It is then closed and
 * a new page opens the same URL with cache enabled, preserving the context's
 * HTTP cache/cookies but none of the first document's JavaScript heap. Every
 * response, paint metric and long task is retained; nothing is estimated.
 *
 *   node scripts/dev/perf/repeat.mjs --label before --paths /home,/explore
 *   node scripts/dev/perf/repeat.mjs --label after --paths /home --runs 3 --throttle
 *
 * Options: --base, --user student|admin, --runs 3, --paths a,b (required),
 * --public-paths /login,/timetable/a, --viewport phone|desktop, --throttle,
 * --keep-intro, --json. This is a lab measurement, not field Web Vitals.
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createSessionCookie } from './session.mjs';
import { root } from './lib.mjs';
import { launchBrowser } from '../browser.mjs';

const { values } = parseArgs({
  options: {
    label: { type: 'string', default: 'run' },
    base: { type: 'string', default: process.env.PERF_BASE || 'http://127.0.0.1:3100' },
    user: { type: 'string', default: 'student' },
    runs: { type: 'string', default: '3' },
    paths: { type: 'string' },
    'public-paths': { type: 'string', default: '/login' },
    viewport: { type: 'string', default: 'phone' },
    throttle: { type: 'boolean', default: false },
    'keep-intro': { type: 'boolean', default: false },
    settle: { type: 'string', default: '1200' },
    json: { type: 'string' },
  },
});

if (!values.paths) {
  console.error('Pass --paths /home,/explore (comma-separated document paths).');
  process.exit(2);
}

const paths = [...new Set(values.paths.split(',').map((value) => value.trim()).filter((value) => value.startsWith('/')))];
const publicPaths = new Set(values['public-paths'].split(',').map((value) => value.trim()).filter(Boolean));
const runs = Math.max(1, Number(values.runs) || 3);
const viewport = values.viewport === 'desktop'
  ? { key: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false }
  : { key: 'phone', width: 390, height: 844, dpr: 3, mobile: true };
const profile = {
  key: values.throttle ? 'slow4g' : 'fast',
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  cpu: values.throttle ? 4 : 1,
};
const harness = JSON.parse(await readFile(path.join(root, 'node_modules/.cache/perf/harness.json'), 'utf8'));
const session = await createSessionCookie(
  harness.stubUrl,
  values.user === 'admin' ? harness.admin.email : harness.student.email,
);
const browser = await launchBrowser();

const INIT_SCRIPT = () => {
  window.__repeatPerf = { lcp: null, cls: 0, longTasks: [] };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__repeatPerf.lcp = entry.startTime;
        const element = entry.element;
        window.__repeatPerf.lcpElement = element ? {
          tag: element.tagName,
          className: typeof element.className === 'string' ? element.className : '',
          text: (element.textContent || '').trim().slice(0, 120),
          url: entry.url || null,
        } : null;
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* unsupported stays null */ }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__repeatPerf.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* unsupported stays zero */ }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__repeatPerf.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* unsupported stays empty */ }
};

function resourceKind(mime, url) {
  if (mime.includes('text/html')) return 'document';
  if (mime.includes('javascript')) return 'script';
  if (mime.includes('css')) return 'stylesheet';
  if (mime.includes('font') || /\.(woff2?|ttf|otf)(?:\?|$)/.test(url)) return 'font';
  if (mime.startsWith('image/')) return 'image';
  return 'other';
}

async function visit(context, href, { cold }) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`));

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: cold });
  if (values.throttle) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: profile.latency,
      downloadThroughput: profile.downloadThroughput,
      uploadThroughput: profile.uploadThroughput,
    });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });

  const requests = new Map();
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    requests.set(requestId, {
      url: response.url,
      status: response.status,
      mime: response.mimeType || '',
      fromDiskCache: Boolean(response.fromDiskCache),
      fromServiceWorker: Boolean(response.fromServiceWorker),
      fromPrefetchCache: Boolean(response.fromPrefetchCache),
      encodedBytes: null,
      failed: null,
    });
  });
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const request = requests.get(requestId);
    if (request) request.encodedBytes = encodedDataLength || 0;
  });
  cdp.on('Network.loadingFailed', ({ requestId, errorText, canceled }) => {
    const request = requests.get(requestId);
    if (request) request.failed = canceled ? 'cancelled' : errorText || 'failed';
  });

  const started = Date.now();
  await page.goto(`${values.base}${href}`, { waitUntil: 'load', timeout: 60_000 });
  let introShown = false;
  const skip = page.getByRole('button', { name: 'Skip intro' });
  if (await skip.count()) {
    introShown = true;
    if (!values['keep-intro']) {
      await skip.first().click({ timeout: 5000 });
      await page.waitForTimeout(400);
    }
  }
  await page.waitForTimeout(Math.max(Number(values.settle) || 1200, values.throttle ? 2500 : 0));

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint');
    return {
      fcp: fcp ? Math.round(fcp.startTime) : null,
      lcp: window.__repeatPerf?.lcp == null ? null : Math.round(window.__repeatPerf.lcp),
      lcpElement: window.__repeatPerf?.lcpElement || null,
      cls: Number((window.__repeatPerf?.cls || 0).toFixed(4)),
      longTasks: (window.__repeatPerf?.longTasks || []).map((task) => ({
        start: Math.round(task.start), duration: Math.round(task.duration),
      })),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav.loadEventEnd || 0),
      ttfb: Math.round(nav.responseStart || 0),
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });
  const responseRows = [...requests.values()];
  const transfer = { document: 0, script: 0, stylesheet: 0, font: 0, image: 0, other: 0 };
  for (const row of responseRows) transfer[resourceKind(row.mime, row.url)] += row.encodedBytes || 0;
  const result = {
    ...metrics,
    visit: cold ? 'cold' : 'repeat',
    introShown,
    wallClockMs: Date.now() - started,
    transfer,
    transferTotal: Object.values(transfer).reduce((sum, value) => sum + value, 0),
    longTaskCount: metrics.longTasks.length,
    totalTaskTime: metrics.longTasks.reduce((sum, task) => sum + task.duration, 0),
    consoleErrors: [...new Set(consoleErrors)],
    requests: responseRows,
  };
  await page.close();
  return result;
}

function median(valuesToSort) {
  const numbers = valuesToSort.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}
function summarize(samples) {
  const pick = (field) => median(samples.map((sample) => sample[field]));
  const spread = (field) => {
    const numbers = samples.map((sample) => sample[field]).filter((value) => typeof value === 'number' && Number.isFinite(value));
    return numbers.length ? [Math.min(...numbers), Math.max(...numbers)] : null;
  };
  return {
    samples: samples.length,
    fcp: pick('fcp'), lcp: pick('lcp'), cls: pick('cls'), ttfb: pick('ttfb'),
    domContentLoaded: pick('domContentLoaded'), loadEvent: pick('loadEvent'),
    transferTotal: pick('transferTotal'), fontTransfer: median(samples.map((sample) => sample.transfer.font)),
    longTaskCount: pick('longTaskCount'), totalTaskTime: pick('totalTaskTime'),
    horizontalOverflow: Math.max(0, ...samples.map((sample) => sample.horizontalOverflow)),
    spreads: {
      fcp: spread('fcp'), lcp: spread('lcp'), transferTotal: spread('transferTotal'), totalTaskTime: spread('totalTaskTime'),
    },
  };
}

const rawRuns = [];
try {
  for (const href of paths) {
    for (let run = 1; run <= runs; run += 1) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.dpr,
        isMobile: viewport.mobile,
        hasTouch: viewport.mobile,
        userAgent: viewport.mobile
          ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
          : undefined,
      });
      await context.addInitScript(INIT_SCRIPT);
      if (!publicPaths.has(href)) {
        await context.addCookies(session.cookies.map(({ name, value }) => ({
          name, value, url: values.base, sameSite: 'Lax',
        })));
      }
      try {
        const cold = await visit(context, href, { cold: true });
        const repeat = await visit(context, href, { cold: false });
        rawRuns.push({ href, run, cold, repeat });
        console.log(`${href} run ${run}: cold LCP ${cold.lcp ?? 'n/m'}ms / ${(cold.transferTotal / 1024).toFixed(1)}kB; repeat LCP ${repeat.lcp ?? 'n/m'}ms / ${(repeat.transferTotal / 1024).toFixed(1)}kB`);
      } catch (error) {
        rawRuns.push({ href, run, error: String(error.message || error) });
        console.error(`${href} run ${run}: ${error.message}`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}

const results = paths.map((href) => {
  const good = rawRuns.filter((run) => run.href === href && !run.error);
  return {
    href,
    cold: summarize(good.map((run) => run.cold)),
    repeat: summarize(good.map((run) => run.repeat)),
    errors: rawRuns.filter((run) => run.href === href && run.error).map((run) => run.error),
  };
});
const target = values.json || path.join(root, 'perf-results', `repeat-${values.label}.json`);
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, JSON.stringify({
  label: values.label,
  base: values.base,
  measuredAt: new Date().toISOString(),
  sourceRevision: (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  nodeVersion: process.version,
  runs,
  viewport,
  profile,
  settleMs: Math.max(Number(values.settle) || 1200, values.throttle ? 2500 : 0),
  publicPaths: [...publicPaths],
  results,
  rawRuns,
}, null, 2));
console.log(`\nwrote ${path.relative(root, target)}`);
if (rawRuns.some((run) => run.error)) process.exit(1);
