import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TIMETABLE_SCOPE,
  TIMETABLE_SHELL_PATH,
  TIMETABLE_SW_PATH,
  TIMETABLE_WIDE_SCOPE,
} from '@/lib/timetable/batch';
import {
  cacheCurrentDocument,
  collectShellAssetUrls,
  detectPlatform,
  dropOfflineCaches,
  installPathFor,
  isStandalone,
  offlineStateCopy,
  precacheOfflineShell,
  registerTimetableWorker,
  sendPrecacheMessage,
  showInstallPrompt,
  skipWaiting,
  unregisterOwnWorker,
  watchInstallPrompt,
  watchInstalled,
  workerAllowed,
} from '@/lib/timetable/offline-install';
import { primaryAction } from '@/components/timetable/TimetableOfflineUi';

/**
 * Platform plumbing: what the browser is, what it allows, and what the button
 * is therefore allowed to promise.
 *
 * This is where an offline feature most often starts lying — a button that
 * claims "Added to Home Screen" because a click happened, a worker registered
 * in `next dev` that pins a stale bundle, a reload that changes nothing. The
 * tests below keep the claims honest, including the two ways a registration can
 * be scoped, and the rule that the next page must never unregister a service
 * worker that is not its own.
 */

const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DESKTOP_FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';

function fakeTarget({ register, registration } = {}) {
  const listeners = new Map();
  return {
    listeners,
    serviceWorker: {
      addEventListener: (type, handler) => listeners.set(type, handler),
      removeEventListener: (type) => listeners.delete(type),
      register,
      getRegistration: async () => registration ?? null,
    },
  };
}

beforeEach(() => {
  const listeners = new Map();
  vi.stubGlobal('navigator', {
    serviceWorker: {
      addEventListener: (type, handler) => listeners.set(type, handler),
      removeEventListener: (type) => listeners.delete(type),
      getRegistration: async () => null,
    },
    storage: { persisted: async () => true, persist: async () => true, estimate: async () => ({ usage: 1, quota: 2 }) },
    userAgent: DESKTOP_CHROME,
    maxTouchPoints: 0,
  });
  navigator.serviceWorker._listeners = listeners;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the browser is', () => {
  it('separates iOS, Android, Chromium, Firefox and desktop Safari', () => {
    expect(detectPlatform(IOS_SAFARI, { maxTouchPoints: 5 }).kind).toBe('ios');
    expect(detectPlatform(ANDROID_CHROME, { maxTouchPoints: 10 }).kind).toBe('android');
    expect(detectPlatform(DESKTOP_CHROME, { maxTouchPoints: 0 }).kind).toBe('chromium-desktop');
    expect(detectPlatform(DESKTOP_FIREFOX, { maxTouchPoints: 0 }).kind).toBe('firefox');
    expect(detectPlatform(MAC_SAFARI, { maxTouchPoints: 0 }).kind).toBe('safari-desktop');
    expect(detectPlatform('', {}).kind).toBe('unknown');
    expect(detectPlatform(undefined, undefined).kind).toBe('unknown');
  });

  it('recognises an iPad reporting itself as a Mac', () => {
    // iPadOS "desktop site" mode is the classic false negative: the only clue is
    // that a Mac does not have five touch points.
    expect(detectPlatform(IPAD_AS_MAC, { maxTouchPoints: 5 }).kind).toBe('ios');
    expect(detectPlatform(IPAD_AS_MAC, { maxTouchPoints: 0 }).kind).toBe('safari-desktop');
  });

  it('labels the platform the way the sheet will say it out loud', () => {
    expect(detectPlatform(IOS_SAFARI, { maxTouchPoints: 5 }).label).toContain('Safari');
    expect(detectPlatform(ANDROID_CHROME, { maxTouchPoints: 10 }).label).toContain('Android');
  });

  it('maps platform plus prompt support onto the three install paths', () => {
    expect(installPathFor({ kind: 'chromium-desktop' }, { hasBeforeInstallPrompt: true })).toBe('native');
    expect(installPathFor({ kind: 'android' }, { hasBeforeInstallPrompt: true })).toBe('native');
    // Chromium without the event (too few visits, or a browser that removed it):
    // the guide, not a fake dialog.
    expect(installPathFor({ kind: 'chromium-desktop' }, { hasBeforeInstallPrompt: false })).toBe('manual');
    expect(installPathFor({ kind: 'firefox' })).toBe('manual');
    expect(installPathFor({ kind: 'safari-desktop' })).toBe('manual');
    expect(installPathFor({ kind: 'unknown' })).toBe('manual');
    // iOS never has the event, and never gets a "native" promise either.
    expect(installPathFor({ kind: 'ios' }, { hasBeforeInstallPrompt: true })).toBe('ios');
    expect(installPathFor(undefined)).toBe('manual');
  });

  it('treats "installed" as something only the platform can say', () => {
    expect(isStandalone(() => ({ matches: false }), { standalone: true })).toBe(true);
    expect(isStandalone((query) => ({ matches: query === '(display-mode: standalone)' }))).toBe(true);
    expect(isStandalone((query) => ({ matches: query === '(display-mode: fullscreen)' }))).toBe(true);
    expect(isStandalone(() => ({ matches: false }), {})).toBe(false);
    expect(isStandalone(null, {})).toBe(false);
    expect(
      isStandalone(() => {
        throw new Error('no matchMedia');
      }),
    ).toBe(false);
  });
});

describe('beforeinstallprompt', () => {
  it('captures the event and prevents the browser infobar', () => {
    const events = new Map();
    const target = {
      addEventListener: (type, handler) => events.set(type, handler),
      removeEventListener: (type) => events.delete(type),
    };
    let captured = null;
    const stop = watchInstallPrompt(target, (event) => {
      captured = event;
    });
    expect(events.has('beforeinstallprompt')).toBe(true);

    let prevented = false;
    events.get('beforeinstallprompt')({ preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true); // no unprompted popup, ever
    expect(captured).toBeTruthy();

    stop();
    expect(events.has('beforeinstallprompt')).toBe(false);
  });

  it('tolerates a browser without the event at all', () => {
    expect(typeof watchInstallPrompt(undefined, () => {})).toBe('function');
    expect(typeof watchInstalled(null, () => {})).toBe('function');
  });

  it('reports accepted, dismissed and unsupported separately', async () => {
    let shown = 0;
    const accepted = { prompt: () => (shown += 1), userChoice: Promise.resolve({ outcome: 'accepted' }) };
    expect(await showInstallPrompt(accepted)).toEqual({ outcome: 'accepted' });
    expect(shown).toBe(1);

    const dismissed = { prompt: () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
    expect(await showInstallPrompt(dismissed)).toEqual({ outcome: 'dismissed' });

    // A browser that has the event but fails to resolve the choice is "unsupported",
    // never a silent failure.
    const broken = { prompt: () => {}, userChoice: Promise.reject(new Error('nope')) };
    expect(await showInstallPrompt(broken)).toEqual({ outcome: 'unsupported' });

    expect(await showInstallPrompt(undefined)).toEqual({ outcome: 'unsupported' });
    expect(await showInstallPrompt({ prompt: () => { throw new Error('gone'); } })).toEqual({ outcome: 'unsupported' });
  });

  it('listens for appinstalled, the only reliable evidence of a home-screen icon', () => {
    const events = new Map();
    let fired = 0;
    const stop = watchInstalled({ addEventListener: (t, h) => events.set(t, h), removeEventListener: (t) => events.delete(t) }, () => (fired += 1));
    events.get('appinstalled')();
    expect(fired).toBe(1);
    stop();
    expect(events.has('appinstalled')).toBe(false);
  });
});

describe('the service worker', () => {
  it('is registered only in a production build', () => {
    expect(workerAllowed(true)).toBe(true);
    expect(workerAllowed(false)).toBe(false);
    expect(workerAllowed(undefined)).toBe(false);
    expect(workerAllowed('production')).toBe(false); // only the boolean counts
  });

  it('is registered at the timetable path, and a wide scope is a bonus', async () => {
    const attempts = [];
    const target = fakeTarget({
      register: async (path, options) => {
        attempts.push({ path, scope: options.scope });
        return { scope: options.scope, installing: null, active: {}, waiting: null };
      },
    });
    const result = await registerTimetableWorker(target);
    expect(result.state).toBe('registered');
    expect(attempts[0]).toEqual({ path: TIMETABLE_SW_PATH, scope: TIMETABLE_WIDE_SCOPE });
    expect(result.wide).toBe(true);
    expect(result.scope).toBe(TIMETABLE_WIDE_SCOPE);
    // The wide scope is the goal (it lets the worker answer a reload of
    // `/timetable/o`, which lives outside `/timetable/` only as a path
    // convention); the narrow scope is the fallback for a browser that will not
    // accept it. Both are inside Campus+ and neither covers the whole site.
    expect(TIMETABLE_WIDE_SCOPE).toBe('/');
    expect(TIMETABLE_SCOPE).toBe('/timetable/');
    expect(TIMETABLE_SW_PATH).toBe('/timetable/sw.js');
    expect(TIMETABLE_SHELL_PATH).toBe('/timetable/offline');
  });

  it('falls back to the narrow scope when the origin refuses a wide one', async () => {
    const attempts = [];
    const target = fakeTarget({
      register: async (path, options) => {
        attempts.push(options.scope);
        if (options.scope === TIMETABLE_WIDE_SCOPE) throw new TypeError('Scope not allowed');
        return { scope: options.scope, installing: null, active: {} };
      },
    });
    const result = await registerTimetableWorker(target);
    expect(attempts).toEqual([TIMETABLE_WIDE_SCOPE, TIMETABLE_SCOPE]);
    expect(result.state).toBe('registered');
    expect(result.wide).toBe(false);
  });

  it('reports no support and a failure instead of throwing', async () => {
    expect(await registerTimetableWorker({})).toEqual({ state: 'unsupported', scope: null });
    expect(await registerTimetableWorker(null)).toEqual({ state: 'unsupported', scope: null });
    const failing = fakeTarget({
      register: async () => {
        throw new Error('denied');
      },
    });
    const result = await registerTimetableWorker(failing);
    expect(result.state).toBe('error');
    expect(result.error).toContain('Error');
  });

  it('waits for the worker to settle before the page starts messaging it', async () => {
    let settled = false;
    const installing = { addEventListener: (type, handler) => setTimeout(() => { settled = true; handler(); }, 5) };
    const target = fakeTarget({
      register: async (path, options) => ({ scope: options.scope, installing, active: null, waiting: null }),
    });
    const result = await registerTimetableWorker(target);
    expect(settled).toBe(true);
    expect(result.state).toBe('registered');
  });

  it('never unregisters a worker that is not this feature’s own', async () => {
    let unregistered = 0;
    const other = {
      active: { scriptURL: 'https://pccoe.in/sw.js' },
      unregister: async () => (unregistered += 1),
    };
    const mine = {
      active: { scriptURL: 'https://pccoe.in/timetable/sw.js' },
      unregister: async () => (unregistered += 1),
    };
    expect(await unregisterOwnWorker(fakeTarget({ registration: other }))).toEqual({ ok: true, unregistered: false });
    expect(unregistered).toBe(0);
    expect(await unregisterOwnWorker(fakeTarget({ registration: mine }))).toEqual({ ok: true, unregistered: true });
    expect(unregistered).toBe(1);
    // Nothing to look at is not a failure — and nothing was removed either.
    expect(await unregisterOwnWorker(null)).toEqual({ ok: true, unregistered: false });
  });

  it('only claims an update when there is a waiting worker to claim it', () => {
    let posted = null;
    expect(skipWaiting({ waiting: { postMessage: (message) => (posted = message) } })).toBe(true);
    expect(posted).toEqual({ type: 'cp:skip-waiting' });
    // No waiting worker → false, so the page does not reload for nothing.
    expect(skipWaiting({ active: {}, waiting: null })).toBe(false);
    expect(skipWaiting(null)).toBe(false);
    expect(
      skipWaiting({
        waiting: {
          postMessage: () => {
            throw new Error('context destroyed');
          },
        },
      }),
    ).toBe(false);
  });
});

describe('worker messages', () => {
  const registrationWith = (worker) => ({ active: worker, waiting: null, installing: null });

  it('resolve to unsupported when there is nobody to ask', async () => {
    expect(await cacheCurrentDocument(null)).toMatchObject({ state: 'unsupported', cached: false });
    expect(await precacheOfflineShell(undefined)).toMatchObject({ state: 'unsupported' });
    expect(await sendPrecacheMessage(null, [])).toMatchObject({ state: 'unsupported', requested: 0 });
    expect(await dropOfflineCaches({})).toMatchObject({ state: 'unsupported', deleted: 0 });
  });

  it('wait for the reply and report what the worker said', async () => {
    const reply = (type, payload) =>
      registrationWith({
        postMessage: () => {
          setTimeout(() => navigator.serviceWorker._listeners.get('message')({ data: { type, ...payload } }), 1);
        },
      });

    await expect(cacheCurrentDocument(reply('cp:cache-document-done', { cached: true, stored: 21, failed: 0 }))).resolves.toEqual({
      state: 'done',
      cached: true,
      stored: 21,
      failed: 0,
    });
    await expect(precacheOfflineShell(reply('cp:precache-shell-done', { stored: 19, failed: 0 }))).resolves.toMatchObject({
      state: 'done',
      stored: 19,
      failed: 0,
    });
    await expect(sendPrecacheMessage(reply('cp:precache-assets-done', { stored: 4, requested: 6 }), ['a', 'b', 'c', 'd', 'e', 'f'])).resolves.toEqual({
      state: 'done',
      stored: 4,
      requested: 6,
    });
    await expect(dropOfflineCaches(reply('cp:cleared', { deleted: 3 }))).resolves.toEqual({ state: 'done', deleted: 3 });
  });

  it('give up on a timeout rather than hanging the save, and stop listening', async () => {
    const silent = registrationWith({ postMessage: () => {} });
    const started = Date.now();
    const result = await cacheCurrentDocument(silent, { timeoutMs: 25 });
    expect(result).toMatchObject({ state: 'timeout', cached: false });
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
    // The listener from the finished call is gone; only leaked handlers would
    // make every later message arrive twice.
    expect(navigator.serviceWorker._listeners.has('message')).toBe(false);
  });

  it('treats a dead worker as an error, not a success', async () => {
    const dead = registrationWith({
      postMessage: () => {
        throw new Error('context destroyed');
      },
    });
    await expect(precacheOfflineShell(dead)).resolves.toMatchObject({ state: 'error' });
    await expect(sendPrecacheMessage(dead, ['/_next/static/a.js'])).resolves.toMatchObject({ state: 'error', requested: 1 });
  });
});

describe('which assets are worth keeping', () => {
  it('keeps only same-origin build assets, by pathname', () => {
    const urls = collectShellAssetUrls(
      [
        { name: 'https://pccoe.in/_next/static/chunks/main-app.js' },
        { name: 'https://pccoe.in/_next/static/chunks/app/timetable/%5Bdivision%5D/page.js' },
        { name: 'https://pccoe.in/_next/static/css/timetable.css' },
        { name: 'https://pccoe.in/api/timetable/o' },
        { name: 'https://cdn.example.com/_next/static/ch/x.js' },
        { name: 'https://pccoe.in/login' },
        { name: '' },
        {},
        null,
      ],
      'https://pccoe.in',
    );
    expect(urls).toEqual([
      '/_next/static/chunks/main-app.js',
      '/_next/static/chunks/app/timetable/%5Bdivision%5D/page.js',
      '/_next/static/css/timetable.css',
    ]);
    expect(collectShellAssetUrls()).toEqual([]);
    expect(collectShellAssetUrls([{ name: '/_next/static/a.js' }])).toEqual(['/_next/static/a.js']);
  });

  it('de-duplicates, because a chunk fetched twice must not be cached twice', () => {
    const dupes = [{ name: 'https://pccoe.in/_next/static/chunks/a.js' }, { name: 'https://pccoe.in/_next/static/chunks/a.js' }];
    expect(collectShellAssetUrls(dupes, 'https://pccoe.in')).toEqual(['/_next/static/chunks/a.js']);
  });
});

describe('what the copy is allowed to say', () => {
  it('names the six pill states without over-claiming', () => {
    expect(offlineStateCopy('ready', { savedAgo: 'today 9:10 PM', freshLabel: 'Synced this week' })).toEqual({
      tone: 'ready',
      label: 'Offline copy ready · saved today 9:10 PM',
      detail: 'Synced this week',
    });
    expect(offlineStateCopy('saving').label).toContain('Saving');
    expect(offlineStateCopy('stale', { savedAgo: 'yesterday 7:35 AM' }).label).toContain('Saved copy');
    // A refresh failure is described as "the live one could not be read" — the
    // saved copy is still there, and no wording says the timetable is lost.
    expect(offlineStateCopy('stale').detail).toContain('could not be read');
    expect(offlineStateCopy('error', { error: 'Storage is full' }).detail).toBe('Storage is full');
    expect(offlineStateCopy('unavailable').label).toContain('not saved');
    expect(offlineStateCopy('checking').label).toContain('Checking');
    for (const state of ['ready', 'saving', 'stale', 'error', 'unavailable', 'checking']) {
      const copy = offlineStateCopy(state);
      expect(copy.label, state).toBeTruthy();
      expect(copy.detail, state).toBeTruthy();
    }
  });

  it('walks the eight button states in the right order of precedence', () => {
    const base = { savedReady: false, preparing: false, installOutcome: null, installPath: 'native', error: null, division: 'O' };
    expect(primaryAction(base).label).toBe('Save timetable for offline use');
    expect(primaryAction({ ...base, preparing: true }).label).toBe('Preparing offline timetable…');
    expect(primaryAction({ ...base, preparing: true }).disabled).toBe(true);
    expect(primaryAction({ ...base, installOutcome: 'waiting' }).label).toBe('Waiting for installation confirmation…');
    // "Added" is only ever reachable from an outcome, never from a click.
    expect(primaryAction({ ...base, installOutcome: 'accepted' }).label).toBe('Added to Home Screen');
    expect(primaryAction({ ...base, error: 'Storage is full' }).label).toBe('Could not prepare offline copy — Retry');
    expect(primaryAction({ ...base, error: 'x', savedReady: true }).kind).toBe('retry');
    expect(primaryAction({ ...base, savedReady: true }).label).toBe('Add Division O (IT) timetable to Home Screen');
    expect(primaryAction({ ...base, savedReady: true, installPath: 'ios' }).label).toBe('Add to Home Screen from Safari');
    expect(primaryAction({ ...base, savedReady: true, installPath: 'manual' }).kind).toBe('guide');
    // An unknown batch must not produce a fake name on the button.
    expect(primaryAction({ ...base, savedReady: true, division: null }).label).toBe('Add this timetable to Home Screen');
    // Precedence: preparing beats everything, error beats a ready copy.
    expect(primaryAction({ ...base, preparing: true, installOutcome: 'accepted' }).kind).toBe('busy');
    expect(primaryAction({ ...base, savedReady: true, error: 'boom', installOutcome: 'accepted' }).label).toBe('Added to Home Screen');
  });

  it('never claims an icon was added while the outcome is merely a dismissed prompt', () => {
    const dismissed = primaryAction({ savedReady: true, preparing: false, installOutcome: 'dismissed', installPath: 'native', error: null, division: 'J' });
    expect(dismissed.label).not.toContain('Added');
    expect(dismissed.disabled).toBe(false);
    expect(dismissed.kind).toBe('install');
  });
});
