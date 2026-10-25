#!/usr/bin/env node
/**
 * Refresh `tests/fixtures/timetable-document.html` from a running production
 * build, so `extractAssetUrls` keeps being tested against markup the framework
 * really emits rather than against a hand-written impression of it.
 *
 *   npm run build && npm start            # or: next start -p 3100
 *   node scripts/dev/timetable-fixture.mjs [base-url]
 *
 * The asset names are content-hashed, so this file changes whenever the build
 * does. That is expected; the assertions in tests/timetable-sw-policy.test.js
 * pin three of these names and the *shape* of the rest.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const base = process.argv[2] || process.env.PERF_APP_URL || 'http://127.0.0.1:3100';

async function html(pathname) {
  const response = await fetch(new URL(pathname, base));
  if (!response.ok) throw new Error(`${base}${pathname} → HTTP ${response.status}`);
  return response.text();
}

const [shell, page] = await Promise.all([html('/timetable/offline'), html('/timetable/o')]);
const header =
  '<!--\n' +
  '  A capture of what the production build actually emits, kept as a fixture so\n' +
  '  `extractAssetUrls` is tested against real Next markup (modulepreload links,\n' +
  '  hashed chunks, self-hosted fonts) instead of a hand-written guess.\n' +
  '  Refresh with: node scripts/dev/timetable-fixture.mjs  (after a build)\n' +
  '-->\n';
const extra =
  '<link rel="icon" href="/brand/timetable-icon-192.png"><img src="/brand/pccoe-crest.webp" alt="PCCOE crest">';
const out = path.join(root, 'tests/fixtures/timetable-document.html');
await writeFile(out, `${header}${shell}\n${extra}\n${page}`, 'utf8');
console.log(`fixture → tests/fixtures/timetable-document.html (${Buffer.byteLength(shell) + Buffer.byteLength(page)} bytes from ${base})`);
