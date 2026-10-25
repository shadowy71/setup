#!/usr/bin/env node
/**
 * Timetable PWA icons — derived from the same `logo.jpeg` as the favicon.
 *
 * `npm run brand:icons` writes the 128px tab icon and the 180px Apple tile.
 * An installable web app additionally needs a 192 and a 512 in two purposes:
 *
 *   any       — what a launcher may render as-is (Chrome shows these square,
 *               Android/Launchers apply their own shape hints, macOS rounded)
 *   maskable  — what a launcher *crops*: the safe zone is the central 80% of a
 *               circle, so the mark has to sit at ~62% of the canvas on a full
 *               bleed background or it will be shaved.
 *
 * Nothing about the artwork is redrawn: the ink is trimmed exactly as the
 * favicon recipe does it, painted on the same flat white paper (the source's
 * near-white carries JPEG grain, and a flat backing compresses far smaller),
 * and the channels are snapped to the same step of 20 so a 192px tile is a few
 * kilobytes rather than a few hundred.
 *
 * The files land in `public/brand/`, next to the crest, because the manifest
 * route references them by URL and the service worker precaches that exact
 * path — see PRECACHE_URLS in lib/timetable/sw-policy.js.
 *
 *   node scripts/dev/timetable-icons.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';
import { root } from './perf/lib.mjs';

const SOURCE = path.join(root, 'logo.jpeg');
const OUT_DIR = path.join(root, 'public/brand');

/** `{ background, radius, scale }` per target, size last for the filename. */
const TARGETS = [
  { file: 'timetable-icon-192.png', size: 192, radius: 0.19, scale: 0.94 },
  { file: 'timetable-icon-512.png', size: 512, radius: 0.19, scale: 0.94 },
  // Maskable: full bleed, no rounding (the launcher supplies the shape), and
  // the mark pulled back into the safe zone.
  { file: 'timetable-maskable-192.png', size: 192, radius: 0, scale: 0.62 },
  { file: 'timetable-maskable-512.png', size: 512, radius: 0, scale: 0.62 },
];

const RASTERISE = async ({ dataUrl, size, radius, scale }) => {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();

  // 1. Find the ink, exactly as brand-icons.mjs does: the paper behind the mark
  //    is a very light blue-white, so "not white" would count the whole canvas.
  //    Ink is a pixel clearly darker than that paper or clearly saturated (the
  //    cyan in the mark).
  const probe = document.createElement('canvas');
  probe.width = image.naturalWidth;
  probe.height = image.naturalHeight;
  const probeContext = probe.getContext('2d', { willReadFrequently: true });
  probeContext.drawImage(image, 0, 0);
  const { data, width, height } = probeContext.getImageData(0, 0, probe.width, probe.height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue, alpha] = [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      const ink = alpha > 8 && ((red + green + blue) / 3 < 210 || chroma > 50);
      if (!ink) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { empty: true };

  // 2. A square crop around the ink, with a small breathing margin.
  const inkWidth = maxX - minX + 1;
  const inkHeight = maxY - minY + 1;
  const side = Math.round(Math.max(inkWidth, inkHeight) * 1.06);
  const sourceX = Math.max(0, Math.round(minX - (side - inkWidth) / 2));
  const sourceY = Math.max(0, Math.round(minY - (side - inkHeight) / 2));
  const sourceSide = Math.min(side, width - sourceX, height - sourceY);

  // 3. Flatten the source paper to pure white in its own buffer first.
  //
  //    This is the step that makes a *maskable* icon work. A maskable tile is
  //    the mark inset on a full-bleed background, so any difference between the
  //    source's paper and the painted background would show as a square seam
  //    inside the icon. Near-paper pixels are set to #ffffff here, so the crop
  //    and the background become the same white and the inset disappears.
  const mark = document.createElement('canvas');
  mark.width = sourceSide;
  mark.height = sourceSide;
  const markContext = mark.getContext('2d', { willReadFrequently: true });
  markContext.imageSmoothingEnabled = false;
  markContext.drawImage(image, sourceX, sourceY, sourceSide, sourceSide, 0, 0, sourceSide, sourceSide);
  const art = markContext.getImageData(0, 0, sourceSide, sourceSide);
  for (let index = 0; index < art.data.length; index += 4) {
    const [red, green, blue] = [art.data[index], art.data[index + 1], art.data[index + 2]];
    const luminance = (red + green + blue) / 3;
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    if (luminance > 196 && chroma < 44) {
      art.data[index] = 255;
      art.data[index + 1] = 255;
      art.data[index + 2] = 255;
      art.data[index + 3] = 255;
    }
  }
  markContext.putImageData(art, 0, 0);

  // 4. Paint the tile. `scale` is how much of it the mark may occupy — the only
  //    difference between an `any` icon and a maskable one — and `radius` is the
  //    favicon's own rounding, so the tab and the launcher read as one artwork.
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  if (radius > 0) {
    context.beginPath();
    context.roundRect(0, 0, size, size, size * radius);
    context.clip();
  }

  const draw = Math.round(size * scale);
  const offset = Math.round((size - draw) / 2);
  context.drawImage(mark, offset, offset, draw, draw);

  // 5. Same grain collapse as the favicon: snapping each channel to a step of
  //    20 is invisible at tile size and keeps a 512px PNG a few dozen kB.
  const frame = context.getImageData(0, 0, size, size);
  const step = 20;
  for (let index = 0; index < frame.data.length; index += 4) {
    if (frame.data[index + 3] === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      frame.data[index + channel] = Math.round(frame.data[index + channel] / step) * step;
    }
  }
  context.putImageData(frame, 0, 0);

  // Outside the rounded clip the canvas is transparent, which is what stops the
  // favicon reading as a white slab in a dark tab bar; a maskable tile keeps
  // its square corners because the launcher supplies the shape itself.
  return { dataUrl: canvas.toDataURL('image/png'), box: { sourceSide, draw } };
};

const source = await readFile(SOURCE);
const dataUrl = `data:image/jpeg;base64,${source.toString('base64')}`;

await mkdir(OUT_DIR, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage();
// A blank page still owns a real canvas with the browser's own decoders.
await page.setContent('<!doctype html><title>timetable icons</title>');

let failures = 0;
for (const target of TARGETS) {
  const file = path.join(OUT_DIR, target.file);
  const result = await page.evaluate(RASTERISE, { dataUrl, ...target });
  if (result.empty) {
    console.error(`! ${path.relative(root, SOURCE)} appears to be blank — nothing written`);
    failures += 1;
    continue;
  }
  const png = Buffer.from(result.dataUrl.split(',')[1], 'base64');
  await writeFile(file, png);
  console.log(
    `  ${target.file.padEnd(28)} ${String(png.length).padStart(7)} bytes  ${target.size}x${target.size}  ` +
      `mark ${result.box.draw}px (crop ${result.box.sourceSide})`,
  );
}

await browser.close();
if (failures) process.exitCode = 1;
