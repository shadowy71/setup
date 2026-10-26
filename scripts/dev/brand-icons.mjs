#!/usr/bin/env node
/**
 * Brand icons — derived from the one supplied logo (`logo.jpeg`).
 *
 * The site's favicon must be the Campus+ artwork, not a placeholder glyph, and
 * it must be produced from the same file the in-app mark uses so the two can
 * never drift apart. This script rasterises `logo.jpeg` in a real browser
 * (Chromium via `scripts/dev/browser.mjs`) and writes the two files Next.js
 * picks up from the app directory:
 *
 *   app/icon.png         the favicon — rounded corners, transparent outside
 *                        the badge so it does not read as a white slab in a
 *                        dark tab bar
 *   app/apple-icon.png   iOS home-screen icon — opaque, square, because iOS
 *                        applies its own corner mask and would show black
 *                        through a transparent one
 *
 * Nothing about the artwork changes: the mark is trimmed of its empty outer
 * margin (so it is legible at 16px) and resized. Run it after replacing the
 * source file:
 *
 *   npm run brand:icons
 *
 * The generated PNGs are committed; this script is the reproducible recipe.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';
import { root } from './perf/lib.mjs';

const SOURCE = path.join(root, 'logo.jpeg');
const TARGETS = [
  // 128px is four device pixels per CSS pixel for a 32px tab icon and still a
  // compact file; anything larger is bytes no browser will use.
  { file: path.join(root, 'app/icon.png'), size: 128, radius: 0.19, opaque: false },
  { file: path.join(root, 'app/apple-icon.png'), size: 180, radius: 0, opaque: true },
  // The timetable is the one surface expected to work signed out, and it is the
  // one surface that gets installed. `/icon.png` and `/apple-icon.png` sit behind
  // the auth proxy, so a home-screen tile added from a shared link would lose its
  // artwork; these are byte-identical copies that Next serves from the public
  // `/timetable/` prefix instead. Same artwork, deliberately — nothing is invented
  // for the second copy, and the manifest's icons come from
  // `npm run brand:timetable-icons`, also under `/timetable/`.
  { file: path.join(root, 'app/timetable/icon.png'), size: 128, radius: 0.19, opaque: false },
  { file: path.join(root, 'app/timetable/apple-icon.png'), size: 180, radius: 0, opaque: true },
];

/** Trim the artwork's empty margin, then rasterise at each target size. */
const RASTERISE = async ({ dataUrl, size, radius, opaque }) => {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();

  // 1. Find the ink: any pixel that is not near-white.
  const probe = document.createElement('canvas');
  probe.width = image.naturalWidth;
  probe.height = image.naturalHeight;
  const probeContext = probe.getContext('2d', { willReadFrequently: true });
  probeContext.drawImage(image, 0, 0);
  const { data, width, height } = probeContext.getImageData(0, 0, probe.width, probe.height);

  // The supplied artwork sits on a very light blue-white (about #f1f6fc), not
  // on pure white, so "not white" is the wrong test: it would count the whole
  // canvas as ink. A pixel is ink when it is clearly darker than that paper or
  // clearly saturated (the cyan in the mark).
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

  // 2. Square the crop around the ink and keep a small breathing margin.
  const inkWidth = maxX - minX + 1;
  const inkHeight = maxY - minY + 1;
  const side = Math.round(Math.max(inkWidth, inkHeight) * 1.12);
  const sourceX = Math.max(0, Math.round(minX - (side - inkWidth) / 2));
  const sourceY = Math.max(0, Math.round(minY - (side - inkHeight) / 2));
  const sourceSide = Math.min(side, width - sourceX, height - sourceY);

  // 3. Draw. A rounded badge gets a clipped transparent corner; the iOS icon
  //    is an opaque square (see the header comment).
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  // The paper behind the mark is painted pure white: the source's near-white
  // carries JPEG grain, and a flat backing both looks cleaner at 32px and
  // compresses to a far smaller file.
  if (radius > 0 && !opaque) {
    context.beginPath();
    context.roundRect(0, 0, size, size, size * radius);
    context.clip();
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);

  context.drawImage(image, sourceX, sourceY, sourceSide, sourceSide, 0, 0, size, size);

  // The source is a JPEG, so its flat areas carry compression grain — and a
  // 180px icon only has ~32k pixels, so every unique colour costs real bytes.
  // Snapping each channel to a step of 20 (at most ±10/255, invisible at icon
  // size) collapses the grain into a small palette: 20 kB instead of 200 kB.
  const frame = context.getImageData(0, 0, size, size);
  const step = 20;
  for (let index = 0; index < frame.data.length; index += 4) {
    if (frame.data[index + 3] === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      frame.data[index + channel] = Math.round(frame.data[index + channel] / step) * step;
    }
  }
  context.putImageData(frame, 0, 0);

  return { dataUrl: canvas.toDataURL('image/png'), box: { sourceX, sourceY, sourceSide } };
};

const source = await readFile(SOURCE);
const dataUrl = `data:image/jpeg;base64,${source.toString('base64')}`;

const browser = await launchBrowser();
const page = await browser.newPage();
// A blank page still owns a real canvas with the browser's own decoders.
await page.setContent('<!doctype html><title>brand icons</title>');

for (const target of TARGETS) {
  const result = await page.evaluate(RASTERISE, { dataUrl, ...target });
  if (result.empty) {
    console.error(`! ${path.relative(root, SOURCE)} appears to be blank — nothing written`);
    process.exitCode = 1;
    continue;
  }
  const png = Buffer.from(result.dataUrl.split(',')[1], 'base64');
  await writeFile(target.file, png);
  console.log(
    `  ${path.relative(root, target.file).padEnd(22)} ${String(png.length).padStart(7)} bytes  ` +
      `${target.size}x${target.size}  crop ${result.box.sourceSide}px @ ${result.box.sourceX},${result.box.sourceY}`,
  );
}

await browser.close();
