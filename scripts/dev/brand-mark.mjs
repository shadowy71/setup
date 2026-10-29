#!/usr/bin/env node
/**
 * Generate the small in-app Campus+ mark from the supplied 1024px source.
 *
 * The original logo.jpeg remains the input for favicon/PWA generation. This
 * display derivative is 256px square: enough for the largest 44 CSS px mark at
 * 5x DPR, without sending a 1024px JPEG to every route. Artwork, crop and
 * background are unchanged; only the raster dimensions and delivery codec are.
 *
 *   node scripts/dev/brand-mark.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';
import { root } from './perf/lib.mjs';

const sourcePath = path.join(root, 'logo.jpeg');
const targetPath = path.join(root, 'public/brand/campus-mark.webp');
const source = await readFile(sourcePath);
const dataUrl = `data:image/jpeg;base64,${source.toString('base64')}`;
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>Campus+ display mark</title>');
  const result = await page.evaluate(async ({ dataUrl: url }) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, 256, 256);
    return canvas.toDataURL('image/webp', 0.9);
  }, { dataUrl });
  if (!result.startsWith('data:image/webp;base64,')) throw new Error('Chromium did not encode a WebP mark.');
  const bytes = Buffer.from(result.split(',')[1], 'base64');
  await writeFile(targetPath, bytes);
  console.log(`${path.relative(root, targetPath)}: 256x256, ${bytes.length} bytes (source ${source.length} bytes)`);
} finally {
  await browser.close();
}
