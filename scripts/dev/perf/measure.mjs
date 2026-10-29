#!/usr/bin/env node
/**
 * Measures the running application against the harness backend.
 *
 * Every measured page view is a real HTTP request against a production build of
 * the app (`next start`) pointed at the Supabase stub, so the numbers reported
 * are wall-clock latency and real Supabase request counts — not estimates from
 * reading the code.
 *
 *   node scripts/dev/perf/measure.mjs --label before
 *   node scripts/dev/perf/measure.mjs --label after --json perf-results/after.json
 *
 * Options:
 *   --base <url>     Next.js server (default http://127.0.0.1:3100)
 *   --user student   Which seeded account to browse as (student|admin)
 *   --runs 3         Measured runs per page (median is reported)
 *   --only /home     Measure a single path
 *   --extended       Add Clubs/Gigs/details/Explore/timetable (or club admin)
 *   --waterfall      Print the request waterfall for every page
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSessionCookie } from './session.mjs';
import { root } from './lib.mjs';

const { values } = parseArgs({
  options: {
    label: { type: 'string', default: 'run' },
    base: { type: 'string', default: process.env.PERF_BASE || 'http://127.0.0.1:3100' },
    user: { type: 'string', default: 'student' },
    runs: { type: 'string', default: '3' },
    only: { type: 'string' },
    extended: { type: 'boolean', default: false },
    json: { type: 'string' },
    waterfall: { type: 'boolean', default: false },
  },
});

const harness = JSON.parse(await readFile(path.join(root, 'node_modules/.cache/perf/harness.json'), 'utf8'));
const runs = Number(values.runs);
const cookie = await createSessionCookie(harness.stubUrl, values.user === 'admin' ? harness.admin.email : harness.student.email);

const STUDENT_PAGES = [
  ['Home', '/home'],
  ['Campus hub', '/campus'],
  ['Noticeboard', '/campus/noticeboard'],
  ['Explore', '/explore'],
  ['Communities', '/communities'],
  ['Marketplace', '/market'],
  ['Notifications', '/notifications'],
  ['Chat list', '/chat'],
  ['Chat thread', `/chat/${harness.conversationId}`],
  ['Profile (own)', '/profile'],
  ['Settings', '/settings'],
  ['Public profile', `/user/${harness.student.username}`],
  ['Post detail', `/post/${harness.postId}`],
];

const ADMIN_PAGES = [
  ['Admin · users', '/admin?tab=users'],
  ['Admin · roles', '/admin?tab=roles'],
  ['Admin · permissions', '/admin?tab=permissions'],
  ['Admin · reports', '/admin?tab=reports'],
  ['Admin · content', '/admin?tab=content'],
  ['Admin · marketplace', '/admin?tab=marketplace'],
  ['Admin · events', '/admin?tab=events'],
  ['Admin · settings', '/admin?tab=settings'],
  ['Admin · flags', '/admin?tab=flags'],
  ['Admin · audit', '/admin?tab=audit'],
  ['Admin · counts', '/admin?tab=counts'],
  ['Moderation', '/moderator'],
];

// Opt-in coverage for surfaces outside the original quick audit. Keeping this
// separate makes like-for-like labels explicit and leaves historical invocations
// comparable; representative ids come from the same seeded harness snapshot.
const EXTENDED_STUDENT_PAGES = [
  ['Home feed API', '/api/home/feed'],
  ['Gigs', '/gigs'],
  ['Clubs', '/clubs'],
  ['Campus events', '/campus/events'],
  ['Explore resources', '/explore/resources'],
  ['Explore opportunities', '/explore/opportunities'],
  ['Explore projects', '/explore/projects'],
  ['Timetable division', '/timetable/a'],
  ['Timetable offline', '/timetable/offline'],
  ...(harness.gigId ? [['Gig detail', `/gigs/${harness.gigId}`]] : []),
  ...(harness.clubId ? [['Club detail', `/clubs/${harness.clubId}`]] : []),
  ...(harness.communitySlug ? [['Community detail', `/communities/${harness.communitySlug}`]] : []),
  ...(harness.listingId ? [['Listing detail', `/market/listing/${harness.listingId}`]] : []),
  ...(harness.eventId ? [['Event detail', `/campus/events/${harness.eventId}`]] : []),
];

const EXTENDED_ADMIN_PAGES = [
  ['Admin · clubs', '/admin?tab=clubs'],
  ['Admin · backups', '/admin?tab=backups'],
  ...(harness.clubId ? [['Club management', `/clubs/${harness.clubId}/manage`]] : []),
];

const pages = [
  ...(values.user === 'admin' ? ADMIN_PAGES : STUDENT_PAGES),
  ...(values.extended ? (values.user === 'admin' ? EXTENDED_ADMIN_PAGES : EXTENDED_STUDENT_PAGES) : []),
].filter(([, href]) => !values.only || href === values.only);
if (!pages.length) {
  console.error(`No page matched --only ${values.only}`);
  process.exit(1);
}

let cursor = await traceTotal();

async function traceTotal() {
  const res = await fetch(`${harness.stubUrl}/__perf/trace?since=0`);
  return Number(res.headers.get('x-perf-total') || 0);
}

async function traceSince(index) {
  const res = await fetch(`${harness.stubUrl}/__perf/trace?since=${index}`);
  return res.json();
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function spread(numbers) {
  return numbers.length ? [Math.min(...numbers), Math.max(...numbers)] : null;
}

function traceMetrics(entries) {
  const upstream = entries.filter((entry) => entry.kind === 'rest' || entry.kind === 'auth');
  return {
    requests: upstream.length,
    supabaseMs: entries.filter((entry) => entry.kind !== 'other').reduce((sum, entry) => sum + entry.ms, 0),
    slowestMs: Math.max(0, ...upstream.map((entry) => entry.ms)),
    requestBytes: entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0),
  };
}

async function timePage(href) {
  const started = performance.now();
  const epochStart = Date.now();
  const response = await fetch(`${values.base}${href}`, { headers: { cookie: cookie.cookieHeader }, redirect: 'manual' });
  const ttfb = performance.now() - started;
  const body = await response.text();
  const total = performance.now() - started;
  return { status: response.status, ttfb, total, bytes: Buffer.byteLength(body), body, epochStart };
}

const results = [];
for (const [label, href] of pages) {
  await timePage(href); // warm-up (JIT, connection pool)
  // The warm-up render issues its own upstream reads. Discard them before the
  // measured window opens, otherwise the first sample inherits the warm-up's
  // trace entries and the reported request count is inflated.
  cursor = await traceTotal();
  const samples = [];
  const traces = [];
  for (let run = 0; run < runs; run += 1) {
    const before = cursor;
    const sample = await timePage(href);
    const entries = await traceSince(before);
    cursor = await traceTotal();
    samples.push(sample);
    traces.push(entries);
    if (sample.status >= 400) {
      console.error(`  ! ${href} responded ${sample.status}`);
    }
  }
  const entries = traces[traces.length - 1];
  const supabase = entries.filter((entry) => entry.kind === 'rest' || entry.kind === 'auth');
  const runMetrics = traces.map(traceMetrics);
  const sampleRuns = samples.map(({ body, ...sample }, index) => ({
    run: index + 1,
    ...sample,
    ...runMetrics[index],
    entries: traces[index].map((entry) => ({
      t0: entry.t0,
      ms: entry.ms,
      kind: entry.kind,
      method: entry.method,
      path: entry.path,
      query: entry.query,
      status: entry.status,
      bytes: entry.bytes,
    })),
  }));
  results.push({
    label,
    href,
    pageStart: samples[samples.length - 1].epochStart,
    ttfb: median(samples.map((sample) => sample.ttfb)),
    total: median(samples.map((sample) => sample.total)),
    bytes: median(samples.map((sample) => sample.bytes)),
    status: samples[samples.length - 1].status,
    requests: median(runMetrics.map((run) => run.requests)),
    supabaseMs: median(runMetrics.map((run) => run.supabaseMs)),
    slowestMs: Math.max(0, ...supabase.map((entry) => entry.ms)),
    slowest: supabase.reduce((worst, entry) => (!worst || entry.ms > worst.ms ? entry : worst), null),
    broken: samples.some((sample) => /could not be loaded|temporarily unavailable/i.test(sample.body)),
    entries,
    requestBytes: runMetrics[runMetrics.length - 1].requestBytes,
    spreads: {
      ttfb: spread(samples.map((sample) => sample.ttfb)),
      total: spread(samples.map((sample) => sample.total)),
      requests: spread(runMetrics.map((run) => run.requests)),
      supabaseMs: spread(runMetrics.map((run) => run.supabaseMs)),
    },
    sampleRuns,
  });
}

/* ----------------------------------------------------------------- report */

const pad = (value, width) => String(value).padEnd(width);
console.log(`\n\x1b[1mCampus+ performance — ${values.label}\x1b[0m  (${values.base}, ${harness.rtt}ms simulated RTT/request)\n`);
console.log(
  `${pad('Page', 22)}${pad('TTFB', 10)}${pad('Total', 10)}${pad('Supabase', 12)}${pad('ΣSupabase', 12)}${pad('Slowest', 10)}${pad('HTML', 10)}`,
);
console.log('─'.repeat(86));
for (const result of results) {
  console.log(
    pad(result.label, 22) +
      pad(`${result.ttfb.toFixed(0)}ms`, 10) +
      pad(`${result.total.toFixed(0)}ms`, 10) +
      pad(`${result.requests}`, 12) +
      pad(`${result.supabaseMs}ms`, 12) +
      pad(`${result.slowestMs}ms`, 10) +
      pad(`${(result.bytes / 1024).toFixed(1)}kB`, 10),
  );
}

const summary = {
  label: values.label,
  base: values.base,
  rtt: harness.rtt,
  user: values.user,
  extended: values.extended,
  requestedRuns: runs,
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  nodeVersion: process.version,
  platform: `${process.platform}-${process.arch}`,
  measuredAt: new Date().toISOString(),
  pages: results.map(({ entries, ...rest }) => rest),
  waterfalls: Object.fromEntries(
    results.map((result) => [
      result.href,
      result.entries.map((entry) => ({
        ms: entry.ms,
        method: entry.method,
        path: entry.path,
        status: entry.status,
        bytes: entry.bytes,
      })),
    ]),
  ),
};

if (values.waterfall) {
  for (const result of results) {
    console.log(`\n\x1b[1m${result.label}\x1b[0m ${result.href}`);
    const start = Math.min(...result.entries.map((entry) => entry.t0));
    for (const entry of result.entries.slice(0, 30)) {
      console.log(
        `  +${String(entry.t0 - start).padStart(5)}ms  ${String(entry.ms).padStart(4)}ms  ${entry.method.padEnd(6)} ${entry.path}${
          entry.query ? `?${entry.query}` : ''
        }`,
      );
    }
  }
}

const target = values.json || path.join(root, 'perf-results', `${values.label}.json`);
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(summary, null, 2));
console.log(`\nwrote ${path.relative(root, target)}`);

const broken = results.filter((result) => result.broken);
if (broken.length) {
  console.log(`\n! pages rendering a data-unavailable state: ${broken.map((result) => result.href).join(', ')}`);
}
