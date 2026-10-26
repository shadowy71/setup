import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { SETTING_KEYS } from '@/lib/timetable/offline-store';
import { TIMETABLE_APP_ID_PREFIX, TIMETABLE_SCOPE, TIMETABLE_SW_PATH, describeBatch } from '@/lib/timetable/batch';

/**
 * Installability, and the plumbing that makes an offer safe to make.
 *
 * Chrome will not offer an install it cannot justify, and Campus+ must not offer one
 * it cannot keep. Both halves are checked here from the artefacts the browser
 * actually reads — the served manifest, the icon files on disk, the shipped service
 * worker, the provider's own wiring — rather than from a description of them.
 *
 * What this deliberately does *not* claim: that the native dialog appeared. Chrome's
 * decision needs a real Android Chrome profile, a real install and a real launcher,
 * none of which exist in this sandbox. The browser gate
 * (`scripts/dev/timetable-offline-check.mjs`) drives the flow in a real Chromium with
 * a synthetic event and says so in its output; the criteria below are the part that is
 * checkable here.
 */

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

const BATCH = describeBatch('o');

/** PNG dimensions straight from the IHDR chunk — no image library needed. */
async function pngSize(relative) {
  const bytes = await readFile(path.join(root, relative));
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bits: bytes[24],
    colour: bytes[25],
  };
}

describe('the manifest Chrome reads', () => {
  it('is one per batch, keyed by the division letter alone', () => {
    expect(BATCH.manifestUrl).toBe('/timetable/manifest/o');
    expect(BATCH.appId).toBe(`${TIMETABLE_APP_ID_PREFIX}-o`);
    // A label change must never orphan an install: identity comes from the letter.
    for (const division of ['a', 'o', 'J', 'r']) {
      const batch = describeBatch(division);
      expect(batch.appId).toBe(`${TIMETABLE_APP_ID_PREFIX}-${division.toLowerCase()}`);
      expect(batch.href).toBe(`/timetable/${division.toLowerCase()}`);
      expect(batch.manifestUrl).toBe(`/timetable/manifest/${division.toLowerCase()}`);
    }
  });

  it('carries the fields installability is judged on', async () => {
    const { GET } = await import('@/app/timetable/manifest/[division]/route.js');
    const response = await GET(null, { params: { division: 'o' } });
    expect(response.status ?? 200).toBe(200);
    const manifest = await response.json();

    // Every one of these is a documented reason Chrome refuses to offer an install.
    expect(typeof manifest.name).toBe('string');
    expect(manifest.name.length).toBeLessThanOrEqual(128);
    expect(manifest.short_name).toBe('O · IT');
    expect(manifest.start_url).toBe('/timetable/o');
    expect(manifest.scope).toBe(TIMETABLE_SCOPE);
    expect(manifest.display).toBe('standalone');
    expect(manifest.display_override).toEqual(['standalone', 'minimal-ui', 'browser']);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toBe(manifest.theme_color);
    expect(manifest.prefer_related_applications).toBe(false);
    // `id` is the identity an install is keyed by; changing it orphans every icon
    // already on a phone, so it is asserted as a value, not just as a field.
    expect(manifest.id).toBe(`${TIMETABLE_APP_ID_PREFIX}-o`);
    // Two sizes, both purposes, all PNG — and each declared size is the real size.
    const any = manifest.icons.filter((icon) => (icon.purpose ?? 'any').includes('any'));
    const maskable = manifest.icons.filter((icon) => icon.purpose === 'maskable');
    expect(any.map((icon) => icon.sizes).sort()).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(maskable).toHaveLength(2);
    for (const icon of manifest.icons) expect(icon.type).toBe('image/png');
    // An unknown division must not answer with a manifest of nulls.
    const missing = await GET(null, { params: { division: 'z' } });
    expect(missing.status).toBe(404);
  });

  it('names icons that exist, at the sizes it claims, as real PNGs', async () => {
    const { GET } = await import('@/app/timetable/manifest/[division]/route.js');
    const manifest = await (await GET(null, { params: { division: 'j' } })).json();
    const icons = manifest.icons.map((icon) => ({ src: icon.src, w: icon.sizes.split('x')[0], h: icon.sizes.split('x')[1] }));
    expect(icons.length).toBeGreaterThanOrEqual(4);
    const seen = new Set();
    for (const icon of icons) {
      // `/apple-icon.png` is a generated route, not a file in public/ — the source
      // image is what has to exist on disk for it to be served at all.
      const file = icon.src === '/timetable/apple-icon.png' ? 'app/timetable/apple-icon.png' : `public${icon.src}`;
      seen.add(icon.src);
      const size = await pngSize(file).catch(() => null);
      expect(size, file).not.toBeNull();
      expect(size.width, file).toBe(Number(icon.w));
      expect(size.height, file).toBe(Number(icon.h));
      expect(size.colour, `${file} must be 8-bit RGBA or RGB`).toBeGreaterThanOrEqual(2);
    }
    // Chrome needs both of these sizes; a 512-only manifest is the classic miss.
    const bySrc = [...seen].join(' ');
    expect(bySrc).toMatch(/192/);
    expect(bySrc).toMatch(/512/);
    // iOS ignores the manifest for its icon and wants its own tile — and that tile
    // has to be inside the public prefix, or the shortcut is a screenshot.
    expect(icons.some((icon) => icon.src === '/timetable/apple-icon.png')).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith(TIMETABLE_SCOPE), icon.src).toBe(true);
    }
  });

  it('keeps start_url and id inside the declared scope, on one origin', () => {
    const scope = new URL(TIMETABLE_SCOPE, 'https://pccoe.in');
    const start = new URL(BATCH.href, 'https://pccoe.in');
    expect(start.origin).toBe(scope.origin);
    expect(start.pathname.startsWith(scope.pathname)).toBe(true);
    const id = new URL(`${TIMETABLE_APP_ID_PREFIX}-${BATCH.slug}`, new URL(BATCH.manifestUrl, 'https://pccoe.in'));
    expect(id.origin).toBe(scope.origin);
    expect(id.pathname.startsWith(scope.pathname)).toBe(true);
    // The manifest must be reachable without a session, or the install dies before
    // it starts for the signed-out student the timetable is public for.
    expect(BATCH.manifestUrl.startsWith(TIMETABLE_SCOPE)).toBe(true);
    // The worker the page registers has to sit inside the scope it claims, or the
    // registration throws and the install eligibility check never passes.
    const worker = new URL(TIMETABLE_SW_PATH, 'https://pccoe.in');
    expect(worker.pathname.startsWith(scope.pathname)).toBe(true);
  });

  it('is linked from the division page, and from nothing else', async () => {
    const page = await read('app/timetable/[division]/page.js');
    expect(page).toContain('manifest: batch ? batch.manifestUrl : undefined');
    expect(page).toContain('capable: true');
    expect(page).toContain('statusBarStyle');
    // No second manifest link anywhere: two `<link rel="manifest">` tags is how an
    // install ends up pointing at the wrong batch.
    const all = await Promise.all([
      read('app/timetable/layout.js'),
      read('app/layout.js'),
      read('app/(app)/layout.js'),
    ]);
    for (const source of all) {
      expect(source).not.toMatch(/rel=["']manifest["']/);
      expect(source).not.toMatch(/manifest:/);
    }
  });
});

describe('the service worker an install depends on', () => {
  it('answers every message the page knows how to send', async () => {
    const client = await read('lib/timetable/offline-install.js');
    const worker = await read('public/timetable/sw.js');
    const sent = new Set([...client.matchAll(/type: '(cp:[a-z-]+)'/g)].map((m) => m[1]));
    expect(sent.size).toBeGreaterThanOrEqual(4);
    for (const type of sent) {
      expect(worker, `${type} is sent by the page and never handled by the worker`).toContain(type);
    }
    // The reply names must line up too, or every round trip ends in a timeout that
    // the UI politely ignores — and nothing is cached.
    const replied = new Set([...client.matchAll(/'(cp:[a-z-]+-done)'/g)].map((m) => m[1]));
    replied.add('cp:cleared');
    for (const type of replied) {
      expect(worker, `${type} is awaited by the page but never posted by the worker`).toContain(type);
    }
  });

  it('handles fetch, because an install without a fetch handler is not an app', async () => {
    const worker = await read('public/timetable/sw.js');
    // Quoted either way: the bundle is generated, and its style is not the point.
    expect(worker).toMatch(/addEventListener\((["'])fetch\1\s*,/);
    expect(worker).toMatch(/event\.respondWith/);
    // Registration is the page's job alone; the worker must not try to control
    // other features' scopes by claiming a broader one at install time.
    expect(worker).not.toMatch(/navigator\.serviceWorker\.register/);
  });

  it('is registered once, early, and only where a worker will not pin a stale bundle', async () => {
    const provider = await read('components/timetable/TimetableOfflineProvider.js');
    expect([...provider.matchAll(/registerTimetableWorker\(/g)]).toHaveLength(1);
    // "Early" is testable in one sense: registration may not sit behind the
    // IndexedDB read, which is exactly what made the prompt missable before.
    const head = provider.slice(0, provider.indexOf('Mount: read the device'));
    const tail = provider.slice(provider.indexOf('Mount: read the device'));
    expect(head).toContain('registerTimetableWorker(navigator)');
    expect(tail).not.toContain('registerTimetableWorker');
    // and the listener is attached in that same first effect, not after a read
    expect(head.indexOf('watchInstallPrompt(window')).toBeLessThan(head.indexOf('registerTimetableWorker(navigator)'));
    expect(tail).not.toContain('watchInstallPrompt(window');
    expect(provider).toContain('workerAllowed(PRODUCTION)');
    expect(provider).toContain('if (typeof window !== \'undefined\') parkInstallPrompt(window)');
  });

  it('persists every decision the offer reads back', () => {
    // A key outside SETTING_KEYS is silently a no-op, so the offer would forget the
    // dismissal on the next load — the difference between "not now" and "nagging".
    for (const key of ['installDismissedAt', 'installOfferDismissedAt', 'installAcceptedAt', 'lastPrepareAt']) {
      expect(SETTING_KEYS).toContain(key);
    }
  });
});

describe('the install action stays in one place', () => {
  const providerPath = 'components/timetable/TimetableOfflineProvider.js';

  it('calls prompt() only from the shared helper, which only a click reaches', async () => {
    const provider = await read(providerPath);
    const ui = await read('components/timetable/TimetableOfflineUi.js');
    for (const [name, source] of [['provider', provider], ['ui', ui]]) {
      expect(source, name).not.toMatch(/\.prompt\(/);
      expect(source, name).not.toMatch(/\bwindow\.__cpInstallPrompt\s*=/);
    }
    expect(provider).toContain('showInstallPrompt(promptEvent)');
    // A spent event is dropped, so no button is left pointing at a dialog Chrome
    // will not show twice in one navigation.
    expect(provider).toMatch(/setPromptEvent\(null\)/);
    const lib = await read('lib/timetable/offline-install.js');
    expect(lib).toMatch(/if \(!event\?\.prompt\) return \{ outcome: 'unsupported' \}/);
  });

  it('offers at most once per page view, and records the answer', async () => {
    const provider = await read(providerPath);
    expect([...provider.matchAll(/offerAsked\.current = true/g)]).toHaveLength(2);
    expect(provider).toContain("setSheet('offer')");
    const ui = await read('components/timetable/TimetableOfflineUi.js');
    // One dialog at a time: the sheet swaps to the offer, and back to the guide.
    expect(ui).toContain("if (sheet === 'offer') return <TimetableInstallOffer />;");
    expect(provider).toMatch(/await writeSetting\('installOfferDismissedAt', stamp\)/);
    expect(provider).toMatch(/await writeSetting\('installAcceptedAt', stamp\)/);
    // Closing a status or instructions sheet is not a refusal, so it records nothing.
    expect([...provider.matchAll(/writeSetting\('installOfferDismissedAt'/g)]).toHaveLength(1);
  });

  it('renders the offer from the same modal, with real controls', async () => {
    const ui = await read('components/timetable/TimetableOfflineUi.js');
    const offer = ui.slice(ui.indexOf('export function TimetableInstallOffer'), ui.indexOf('export function TimetableInstallSheet'));
    expect(offer).toContain('<Modal');
    expect(offer).toContain('closeLabel="Close this sheet"');
    expect(offer).toContain('aria-live="polite"');
    expect(offer).toContain('size="lg"');
    expect(offer).toContain('Not now');
    // One dialog per sheet: the offer delegates to the guide rather than stacking a
    // second modal on top of itself.
    expect(offer).not.toMatch(/openSheet\(/);
    expect(ui.match(/export function TimetableInstallOffer/g)).toHaveLength(1);
  });
});
