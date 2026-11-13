/**
 * Post attachment interaction check against the disposable, signed-in preview.
 * Start scripts/dev/perf/serve.mjs and the app first.
 * Usage: node scripts/dev/photo-attachment-check.mjs [http://127.0.0.1:3101] [--publish-with-storage]
 * Creates one clearly named fixture post; never point this at production.
 * Screenshots stay in node_modules/.cache (not in Git).
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { launchBrowser } from './browser.mjs';
import { createSessionCookie } from './perf/session.mjs';

const base = process.argv[2] || 'http://127.0.0.1:3101';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use the local disposable fixture backend only.');
const publishWithStorage = process.argv.includes('--publish-with-storage');
const out = 'node_modules/.cache/attachment-check';
await mkdir(out, { recursive: true });
function image(name, width = 320, height = 180) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    png.data[i] = Math.round(x / width * 220);
    png.data[i + 1] = Math.round(y / height * 180);
    png.data[i + 2] = 130;
    png.data[i + 3] = 255;
  }
  return { name, mimeType: 'image/png', buffer: PNG.sync.write(png) };
}
const wide = image('wide.png');
const tall = image('tall.png', 120, 320);
const square = image('square.png', 220, 220);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const session = await createSessionCookie(process.env.STUB_URL || 'http://127.0.0.1:3111', 'perf.student1@pccoepune.org');
await page.context().addCookies(session.cookies.map(({ name, value }) => ({ name, value, url: base })));
await page.addInitScript(() => {
  window.previewResources = { created: [], revoked: [] };
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (file) => { const url = create(file); window.previewResources.created.push(url); return url; };
  URL.revokeObjectURL = (url) => { window.previewResources.revoked.push(url); revoke(url); };
});
page.on('response', (response) => { if (response.url().includes('/api/storage/post-drafts/') && response.status() >= 400) console.error('Upload response', response.status(), response.url()); });
const dialog = page.locator('.dialog-attachment');
const picker = dialog.locator('input[type=file]');
const tiles = dialog.locator('.attach-tile');
const count = async (n) => { await page.waitForFunction((n) => document.querySelectorAll('.dialog-attachment .attach-tile').length === n, n); };
const open = async () => { await page.getByRole('button', { name: 'Add files', exact: true }).click(); await dialog.waitFor(); };
const fits = async () => {
  const box = await dialog.boundingBox(), viewport = page.viewportSize();
  assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, JSON.stringify({ box, viewport }));
  assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, 'No horizontal overflow');
  await dialog.getByRole('button', { name: 'Continue', exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  assert.equal(await dialog.locator('.dialog-actions .btn-label > span').evaluateAll((labels) => labels.every((label) => label.scrollWidth <= label.clientWidth + 1)), true, 'Footer labels remain fully visible');
};
try {
  await page.goto(`${base}/home`);
  await page.getByRole('button', { name: "What's happening on campus?", exact: true }).click();
  await open();
  await picker.waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Continue', exact: true }).isDisabled(), true);
  assert.equal(await picker.count(), 1);
  await fits();
  await page.screenshot({ path: `${out}/desktop-empty.png`, animations: 'disabled' });

  for (const [name, width, height] of [['tablet', 768, 1024], ['mobile', 390, 844], ['small', 320, 568], ['landscape', 667, 375]]) {
    await page.setViewportSize({ width, height });
    await fits();
    await page.screenshot({ path: `${out}/${name}-empty.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Both the full surface and its visible CTA open the same native picker.
  for (const target of [dialog.locator('.attach-drop__title'), dialog.locator('.attach-drop__cta')]) {
    const chooser = page.waitForEvent('filechooser');
    await target.click();
    await (await chooser).setFiles([]);
  }
  await picker.setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') },
    { name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(3 * 1024 * 1024 + 1) },
    { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
  ]);
  await page.waitForFunction(() => document.querySelector('.attach-error')?.textContent.includes('empty.png'));
  assert.match(await dialog.locator('[role=alert]').innerText(), /notes.txt.*huge.png.*empty.png/);
  await count(0);
  await picker.setInputFiles([wide, tall]);
  await count(2);
  assert.equal(await dialog.getByRole('button', { name: 'Continue', exact: true }).isEnabled(), true);
  assert.equal(await dialog.locator('[role=alert]').count(), 0);
  await picker.setInputFiles(square);
  await count(3);

  // Desktop drag enter/leave and drop use the very same selection handler.
  const transfer = await page.evaluateHandle(({ name, bytes }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }));
    return transfer;
  }, { name: 'dropped.png', bytes: [...wide.buffer] });
  await dialog.locator('.attach-drop').dispatchEvent('dragenter', { dataTransfer: transfer });
  assert.equal(await dialog.locator('.attach-drop').getAttribute('data-dragging'), 'true');
  await dialog.locator('.attach-drop').dispatchEvent('drop', { dataTransfer: transfer });
  await count(4);
  assert.equal(await dialog.locator('.attach-drop').getAttribute('data-dragging'), null);
  await dialog.getByRole('button', { name: 'Remove dropped.png', exact: true }).click();
  await count(3);
  assert.equal(await page.evaluate(() => window.previewResources.revoked.length), 1);
  await page.screenshot({ path: `${out}/desktop-selected.png`, animations: 'disabled' });

  // Add beyond capacity: preserve existing items, accept available slots, explain surplus.
  await picker.setInputFiles(Array.from({ length: 7 }, (_, i) => image(`extra-${i}.png`, 80, 80)));
  await count(8);
  assert.match(await dialog.locator('[role=alert]').innerText(), /Only 5 more files/);
  assert.equal(await picker.count(), 0);
  assert.match(await dialog.locator('.attach-limit').innerText(), /8 files added/);

  for (const [name, width, height] of [
    ['desktop', 1440, 900], ['tablet', 768, 1024], ['mobile', 390, 844],
    ['small', 320, 568], ['landscape', 667, 375],
  ]) {
    await page.setViewportSize({ width, height });
    await fits();
    await page.screenshot({ path: `${out}/${name}-eight.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await dialog.getByRole('button', { name: 'Continue', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await dialog.getByRole('button', { name: 'Close', exact: true }).evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.getByRole('button', { name: 'Continue', exact: true }).evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Add files', exact: true }).evaluate((el) => el === document.activeElement), true);
  await open();
  await count(8);
  // Free all slots and verify resource disposal and same-file reselection.
  while (await tiles.count()) await tiles.first().getByRole('button', { name: /^Remove / }).click();
  await count(0);
  await page.waitForFunction(() => window.previewResources.created.every((url) => window.previewResources.revoked.includes(url)));
  await picker.setInputFiles(wide);
  await count(1);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await open();
  await count(1); // Dismissal preserves the existing immediate draft-selection semantics.
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });

  // Exercise recovery without requiring the external storage gateway in this
  // disposable fixture. --publish-with-storage runs the unmocked upload path.
  const body = `Photo attachment interaction check ${Date.now()}`;
  await page.locator('#post-body').fill(body);
  if (!publishWithStorage) {
    await page.route('**/api/storage/post-drafts/*', (route) => {
      if (route.request().method() === 'PUT') return route.fulfill({ status: 503, json: { error: 'Fixture storage unavailable.' } });
      if (route.request().method() === 'DELETE') return route.fulfill({ json: { ok: true } });
      return route.continue();
    });
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await page.getByText('Could not start upload. Please retry.', { exact: true }).waitFor();
    assert.equal(await page.locator('#post-body').inputValue(), body);
    assert.equal(await page.locator('form img[src^="blob:"]').count(), 1);
    await page.getByRole('button', { name: 'Discard uploaded files', exact: true }).click();
    await page.getByRole('button', { name: 'Discard uploaded files', exact: true }).waitFor({ state: 'hidden' });
    await page.unroute('**/api/storage/post-drafts/*');
  }
  const publish = page.waitForResponse((response) => response.request().method() === 'POST' && response.request().headers()['next-action'], { timeout: 60000 });
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  assert.equal((await publish).status(), 200);
  await page.waitForFunction(() => document.querySelector('#post-body')?.value === '', null, { timeout: 60000 });
  await page.getByText(body, { exact: true }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${out}/published.png`, animations: 'disabled' });
  console.log('PASS: picker, validation, incremental selection, drop, limit, removal, URL cleanup, responsive layouts, focus trap, Escape, dismissal, and post publication.');
  console.log(publishWithStorage ? 'Storage: unmocked attachment upload and publication passed.' : 'Storage: simulated failure preserved the draft and retry/discard controls; text-only publication passed. External upload requires --publish-with-storage and a configured gateway.');
} catch (error) {
  console.error((await page.locator('main').innerText()).slice(0, 3000));
  await page.screenshot({ path: `${out}/failure.png`, animations: 'disabled' });
  throw error;
} finally {
  await browser.close();
}
