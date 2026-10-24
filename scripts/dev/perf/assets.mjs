#!/usr/bin/env node
/**
 * Client payload per route — the half of the cost `measure.mjs` cannot see.
 *
 * `measure.mjs` times the server render (TTFB, Supabase round trips). This
 * tool measures what the browser then has to download and parse *before it can
 * hydrate*: the raw HTML, every stylesheet it references, and every JS chunk a
 * route loads — both as the server actually serves it (gzip on the wire) and
 * uncompressed, plus which chunks are route-specific versus shared.
 *
 * It reads the real asset graph out of the rendered HTML of a production build
 * (script tags, modulepreload links and stylesheets — the same set the browser
 * requests), so it is not an estimate: each file is fetched exactly once and
 * measured, and the per-route total is the sum of unique files.
 *
 * Usage (same conventions as measure.mjs):
 *
 *   node scripts/dev/perf/assets.mjs --label before
 *   node scripts/dev/perf/assets.mjs --label after --user student --json perf-results/assets-after.json
 *
 * Options:
 *   --base <url>     Next.js server (default http://127.0.0.1:3100)
 *   --user student   Which seeded account the authenticated routes use
 *   --public         Only measure routes that need no session
 *   --top 12         How many chunks to list per route
 */

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { createSessionCookie } from './session.mjs';
import { root } from './lib.mjs';

const { values } = parseArgs({
  options: {
    label: { type: 'string', default: 'run' },
    base: { type: 'string', default: process.env.PERF_BASE || 'http://127.0.0.1:3100' },
    user: { type: 'string', default: 'student' },
    json: { type: 'string' },
    public: { type: 'boolean', default: false },
    top: { type: 'string', default: '10' },
  },
});

const PUBLIC_ROUTES = [
  ['Login', '/login'],
  ['Legal', '/legal'],
  ['Timetable', '/timetable'],
];

const STUDENT_ROUTES = [
  ['Home', '/home'],
  ['Campus hub', '/campus'],
  ['Noticeboard', '/campus/noticeboard'],
  ['Explore', '/explore'],
  ['Communities', '/communities'],
  ['Marketplace', '/market'],
  ['Gigs', '/gigs'],
  ['Clubs', '/clubs'],
  ['Notifications', '/notifications'],
  ['Chat list', '/chat'],
  ['Profile (own)', '/profile'],
  ['Settings', '/settings'],
];

const routes = values.public ? PUBLIC_ROUTES : [...PUBLIC_ROUTES, ...STUDENT_ROUTES];

const harnessPath = path.join(root, 'node_modules/.cache/perf/harness.json');
if (!values.public && !existsSync(harnessPath)) {
  console.error('No harness.json — start `npm run perf:serve` first (or pass --public).');
  process.exit(1);
}
const harness = existsSync(harnessPath) ? JSON.parse(await readFile(harnessPath, 'utf8')) : null;

const cookie = values.public
  ? null
  : await createSessionCookie(harness.stubUrl, values.user === 'admin' ? harness.admin.email : harness.student.email);

/* ------------------------------------------------------------- asset utils */

const staticDirs = ['.next/static/chunks', '.next/static/media'];
const diskIndex = new Map();
for (const dir of staticDirs) {
  if (!existsSync(path.join(root, dir))) continue;
  for (const entry of await readdir(path.join(root, dir))) {
    diskIndex.set(`/_next/static/${dir.split('/').pop()}/${entry}`, path.join(root, dir, entry));
  }
}

/** Raw bytes on disk (what the browser must parse) and the gzip size served. */
async function readAsset(url) {
  const file = diskIndex.get(url);
  if (!file) return null;
  const buffer = await readFile(file);
  return { url, raw: buffer.length, gzip: gzipSync(buffer, { level: 9 }).length };
}

const assetCache = new Map();
async function measure(url) {
  if (assetCache.has(url)) return assetCache.get(url);
  let measured = await readAsset(url);
  if (!measured) {
    // A chunk outside the known static dirs (or an external URL): measure the
    // response the server actually returns.
    const response = await fetch(`${values.base}${url}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    measured = { url, raw: buffer.length, gzip: gzipSync(buffer, { level: 9 }).length };
  }
  assetCache.set(url, measured);
  return measured;
}

function extractAssets(html) {
  // `nomodule` scripts are fetched only by browsers without ES-module support
  // (Next ships its core-js bundle that way), so they are not part of what a
  // modern browser downloads. React renders the attribute as `noModule`.
  const scripts = [...html.matchAll(/<script([^>]*)>/g)]
    .filter(([, attributes]) => /src="([^"]+)"/.test(attributes) && !/nomodule/i.test(attributes))
    .map(([, attributes]) => attributes.match(/src="([^"]+)"/)[1]);
  const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map((match) => match[1]);
  // Two shapes count as a stylesheet: the normal `<link rel="stylesheet">`, and
  // the `<link rel="preload" as="style">` Next emits when a route-segment layout
  // streams its CSS after the shell. Both are downloaded by the browser for the
  // first paint, so both belong in the total. Attributes are checked
  // individually because their order is not stable.
  const styles = [...html.matchAll(/<link\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /rel="stylesheet"/.test(tag) || (/rel="preload"/.test(tag) && /as="style"/.test(tag)))
    .map((tag) => tag.match(/href="([^"]+)"/)?.[1])
    .filter(Boolean);
  const unique = (list) => [...new Set(list)].filter((url) => url.startsWith('/_next/'));
  return { js: unique([...scripts, ...preloads]), css: unique(styles) };
}

const PUBLIC_HREFS = new Set(PUBLIC_ROUTES.map(([, href]) => href));

async function fetchRoute(href) {
  const started = performance.now();
  // Public routes are measured signed out — with a session cookie `/login`
  // would redirect to /home and measure the wrong page.
  const headers = cookie && !PUBLIC_HREFS.has(href) ? { cookie: cookie.cookieHeader } : {};
  const response = await fetch(`${values.base}${href}`, { headers, redirect: 'manual' });
  const html = await response.text();
  return { status: response.status, ms: performance.now() - started, html, bytes: Buffer.byteLength(html) };
}

/* ------------------------------------------------------------------- measure */

const results = [];
for (const [label, href] of routes) {
  const page = await fetchRoute(href);
  const { js, css } = extractAssets(page.html);
  const jsAssets = [];
  for (const url of js) {
    const asset = await measure(url);
    if (asset) jsAssets.push(asset);
  }
  const cssAssets = [];
  for (const url of css) {
    const asset = await measure(url);
    if (asset) cssAssets.push(asset);
  }
  const sum = (assets, key) => assets.reduce((total, asset) => total + asset[key], 0);
  results.push({
    label,
    href,
    status: page.status,
    htmlBytes: page.bytes,
    ttfbMs: page.ms,
    jsCount: jsAssets.length,
    jsRaw: sum(jsAssets, 'raw'),
    jsGzip: sum(jsAssets, 'gzip'),
    cssCount: cssAssets.length,
    cssRaw: sum(cssAssets, 'raw'),
    cssGzip: sum(cssAssets, 'gzip'),
    totalRaw: page.bytes + sum(jsAssets, 'raw') + sum(cssAssets, 'raw'),
    totalGzip: page.bytes + sum(jsAssets, 'gzip') + sum(cssAssets, 'gzip'),
    largest: [...jsAssets, ...cssAssets].sort((a, b) => b.raw - a.raw).slice(0, Number(values.top)),
  });
}

/* -------------------------------------------------------------------- report */

const kb = (bytes) => `${(bytes / 1024).toFixed(1)}kB`;
const pad = (value, width) => String(value).padEnd(width);
console.log(`\n\x1b[1mCampus+ client payload — ${values.label}\x1b[0m  (${values.base})\n`);
console.log(
  `${pad('Route', 20)}${pad('HTML', 10)}${pad('JS files', 11)}${pad('JS gzip', 10)}${pad('JS raw', 10)}${pad('CSS gzip', 11)}${pad('Total gzip', 12)}`,
);
console.log('─'.repeat(84));
for (const result of results) {
  console.log(
    pad(result.label, 20) +
      pad(kb(result.htmlBytes), 10) +
      pad(result.jsCount, 11) +
      pad(kb(result.jsGzip), 10) +
      pad(kb(result.jsRaw), 10) +
      pad(kb(result.cssGzip), 11) +
      pad(kb(result.totalGzip), 12),
  );
}

const sharedOnce = [...new Set(results.flatMap((result) => result.largest.map((asset) => asset.url)))].length;
console.log(`\nDistinct measured assets across all routes: ${sharedOnce}`);

for (const result of results) {
  if (result.status >= 400) console.log(`! ${result.href} responded ${result.status}`);
  if (result.largest.length) {
    const biggest = result.largest[0];
    console.log(`  ${pad(result.label, 18)} largest ${kb(biggest.raw).padStart(8)}  ${biggest.url}`);
  }
}

const summary = {
  label: values.label,
  base: values.base,
  user: values.public ? 'public' : values.user,
  measuredAt: new Date().toISOString(),
  routes: results,
};
const target = values.json || path.join(root, 'perf-results', `assets-${values.label}.json`);
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(summary, null, 2));
console.log(`\nwrote ${path.relative(root, target)}`);
