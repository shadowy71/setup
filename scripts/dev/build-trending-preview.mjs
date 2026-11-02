#!/usr/bin/env node
/**
 * Generates `public/home-trending-preview.html` — a side-by-side visual
 * comparison of the old and new "Busiest right now" bars (dev/preview tool).
 *
 * Both cards are rendered by the REAL `components/home/HomeRail.js` component
 * and use the REAL compiled app CSS. The "before" card only has its bar widths
 * swapped to values from the previous relative formula
 * `(likes + comments) / max(visible counters)`; everything else is the same
 * markup and the same three real trending rows from the running app.
 *
 * Requires `npm run perf:serve`, the dev server, and the preview proxy:
 *   node scripts/dev/build-trending-preview.mjs
 *
 * Nothing here runs in production.
 */

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = 'http://127.0.0.1:3100';
const PREVIEW = 'http://127.0.0.1:3300';
const require = createRequire(import.meta.url);

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response.json();
}

async function text(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response.text();
}

// 1. Real trending rows, exactly as HomeFeedClient receives them.
const payload = await json(`${PREVIEW}/api/home/feed?offset=0`);
const trending = payload.trending || [];
if (trending.length < 3) throw new Error('Preview fixture is not seeded — run preview-trending-fixtures.mjs first.');

// 2. Real compiled CSS from the running dev server (both layout + home sheets).
const html = await text(`${APP}/home`);
const cssPaths = [...html.matchAll(/href="(\/_next\/static\/chunks\/[^"]+\.css)"/g)].map((m) => m[1]);
if (!cssPaths.length) throw new Error('Could not find the app CSS chunks.');
const css = (await Promise.all(cssPaths.map((p) => text(`${APP}${p}`)))).join('\n');

// 3. Render the real component. `next/link` is stubbed because a static page
//    has no router; that changes only the anchor element, not the rail layout.
const stub = path.join(root, 'scripts/dev/contrast/next-stubs.jsx');
const entry = path.join(root, 'node_modules/.cache/trending-preview-entry.jsx');
const outfile = path.join(root, 'node_modules/.cache/trending-preview-render.cjs');
await mkdir(path.dirname(entry), { recursive: true });
await writeFile(entry, `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomeRail } from '@/components/home/HomeRail';
export function render(rows) {
  return renderToStaticMarkup(React.createElement(HomeRail, { trending: rows }));
}
`);
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  write: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
    '@': root,
    'next/link': stub,
    'next/navigation': stub,
  },
  logLevel: 'error',
});
const { render } = require(outfile);

// 4. "After": the component as it now ships. "Before": the same markup with
//    widths from the deleted relative formula, in the order that formula
//    produced (sorted by lifetime likes + comments, descending).
const after = render(trending);
const beforeOrder = trending.slice().sort(
  (a, b) => (b.reaction_count || 0) + (b.comment_count || 0) - ((a.reaction_count || 0) + (a.comment_count || 0)),
);
const lifetime = beforeOrder.map((p) => (p.reaction_count || 0) + (p.comment_count || 0));
const ceiling = Math.max(...lifetime);
const beforeWidths = lifetime.map((value) => Math.round(Math.min(100, Math.max(0, (value / ceiling) * 100))));
let before = render(beforeOrder);
let index = 0;
before = before
  .replace(/width:(?:\d+(?:\.\d+)?)%/g, () => `width:${beforeWidths[index++]}%`)
  .replace(/\s*data-hot="true"/g, '');

const afterWidths = [...after.matchAll(/width:(\d+)%/g)].map((m) => `${m[1]}%`);
const benchmark = 25;

const rowsTable = trending.map((row, i) => {
  const score = Number(row.score);
  const label = (row.title || (row.body || '').slice(0, 48) || 'Untitled discussion');
  return `<tr><td>${i + 1}</td><td>${escapeHtml(label.slice(0, 44))}</td><td>${row.reaction_count} ♥ · ${row.comment_count} ↺</td><td>${score.toFixed(2)}</td><td><strong>${afterWidths[i]}</strong></td></tr>`;
}).join('');

const page = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Busiest right now — before / after</title>
<style>
${css}
/* Preview-board only chrome; the two cards below are 100% app markup + CSS. */
.preview-board { max-width: 1120px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
.preview-board__eyebrow { font: 600 .7rem/1.4 var(--font-micro, ui-monospace, monospace); letter-spacing: .14em; text-transform: uppercase; color: var(--cp-text-subtle); }
.preview-board h1 { font-size: clamp(1.6rem, 3vw, 2.4rem); line-height: 1.1; letter-spacing: -.03em; margin: .5rem 0 .65rem; color: var(--cp-text-primary); }
.preview-board__lede { max-width: 62ch; color: var(--cp-text-muted); line-height: 1.6; font-size: .9rem; margin: 0 0 1.5rem; }
.preview-board__link { color: var(--cp-accent-cyan); text-decoration: underline; text-underline-offset: 3px; }
.preview-board__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; align-items: start; }
.preview-panel { min-width: 0; }
.preview-panel__head { display: flex; align-items: baseline; gap: .6rem; margin-bottom: .75rem; }
.preview-panel__tag { font: 600 .65rem/1 var(--font-micro, ui-monospace, monospace); letter-spacing: .12em; text-transform: uppercase; padding: .35rem .5rem; border-radius: 999px; border: 1px solid color-mix(in oklab, var(--cp-text-subtle) 40%, transparent); color: var(--cp-text-muted); }
.preview-panel__title { font-size: .95rem; font-weight: 600; color: var(--cp-text-primary); }
.preview-panel__note { font-size: .78rem; line-height: 1.55; color: var(--cp-text-muted); margin-top: .75rem; }
.preview-panel__note strong { color: var(--cp-text-primary); font-weight: 600; }
.preview-formula { margin: 2rem 0 0; padding: 1rem 1.25rem; border: 1px solid color-mix(in oklab, var(--cp-text-subtle) 28%, transparent); border-radius: 14px; background: color-mix(in oklab, var(--cp-bg-subtle) 55%, transparent); }
.preview-formula code { font-family: var(--font-micro, ui-monospace, monospace); font-size: .8rem; color: var(--cp-accent-cyan); }
.preview-formula p { color: var(--cp-text-muted); font-size: .82rem; line-height: 1.6; margin: .4rem 0 0; }
.preview-table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; font-size: .8rem; color: var(--cp-text-muted); }
.preview-table th { text-align: left; font-weight: 600; color: var(--cp-text-subtle); padding: .45rem .5rem; border-bottom: 1px solid color-mix(in oklab, var(--cp-text-subtle) 30%, transparent); }
.preview-table td { padding: .5rem; border-bottom: 1px solid color-mix(in oklab, var(--cp-text-subtle) 14%, transparent); }
.preview-table strong { color: var(--cp-text-primary); }
.preview-disclaimer { margin-top: 1.5rem; font-size: .74rem; line-height: 1.55; color: var(--cp-text-subtle); max-width: 80ch; }
</style>
</head>
<body class="bg-canvas text-ink antialiased min-h-dvh">
<main class="preview-board">
  <p class="preview-board__eyebrow">Home / Busiest right now</p>
  <h1>Two likes should look like two likes.</h1>
  <p class="preview-board__lede">Both cards below are rendered by the real <code>HomeRail</code> component with the real compiled CSS and the same three live database rows. Open the <a class="preview-board__link" href="/home">full Home page</a> to see the card in place.</p>

  <div class="preview-board__grid">
    <section class="preview-panel">
      <div class="preview-panel__head"><span class="preview-panel__tag">Before</span><span class="preview-panel__title">Relative to the biggest counter on screen</span></div>
      ${before}
      <p class="preview-panel__note">The discussion with <strong>${lifetime[0]} lifetime likes + comments</strong> fills the track simply because it leads the visible set. ${beforeWidths[1]} and ${beforeWidths[2]} are just proportions of that one number. Any quiet campus where the top post has two likes would still show a full bar.</p>
    </section>
    <section class="preview-panel">
      <div class="preview-panel__head"><span class="preview-panel__tag">After</span><span class="preview-panel__title">Absolute logarithmic scale, benchmark ${benchmark}</span></div>
      ${after}
      <p class="preview-panel__note">Bars now measure <strong>recent, time-decayed engagement</strong>. The ${trending[2].reaction_count} ♥ post drops from ${beforeWidths[0]}% to ${afterWidths[2]}% because 100 of those likes are old. Only the discussion that actually reached ${benchmark} recent points fills the track.</p>
    </section>
  </div>

  <div class="preview-formula">
    <code>progress = clamp(round(100 × ln(1 + score) / ln(1 + ${benchmark})), 0, 100)</code>
    <p>score = (Σ likes · decay + 2 · Σ comments · decay) × (0.5 + 0.5 · 2<sup>−postAge/72h</sup>), with decay reaching zero at the 48 h window edge. 100% is only possible at or above the benchmark; rounding can never promote a sub-benchmark score.</p>
  </div>

  <table class="preview-table">
    <thead><tr><th>#</th><th>Discussion</th><th>Lifetime counters</th><th>Recent score</th><th>Bar</th></tr></thead>
    <tbody>${rowsTable}</tbody>
  </table>

  <p class="preview-disclaimer">Preview board generated from the local fixture harness (real PostgreSQL, real migrations, real RLS, real <code>trending_posts</code> rows). The “before” card reconstructs the deleted relative formula on the same rows — it is a visual comparison, not a running copy of the old app. The live Home page never uses sample data. Scores decay with real time, so bars on the live page can drift by a point or two; re-running <code>preview-trending-fixtures.mjs</code> resets the clock.</p>
</main>
</body>
</html>
`;

await mkdir(path.join(root, 'public'), { recursive: true });
await writeFile(path.join(root, 'public/home-trending-preview.html'), page);
await rm(entry, { force: true });
await rm(outfile, { force: true });

console.log('Generated public/home-trending-preview.html');
console.log('  real rows:', trending.map((r) => `${r.reaction_count}♥ score=${Number(r.score).toFixed(2)}`).join(' | '));
console.log('  before widths:', beforeWidths.map((w) => `${w}%`).join(', '));
console.log('  after widths: ', afterWidths.join(', '));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
