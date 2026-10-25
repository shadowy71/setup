/**
 * Install and offline plumbing — plain functions, no React.
 *
 * Everything that talks to the browser about *installation* lives here: the
 * service-worker registration and its scope negotiation, the
 * `beforeinstallprompt` capture, standalone detection, the shell warm-up and the
 * asset precache. It is deliberately not a hook, because each of these is a
 * small decision with a browser-specific failure mode, and each one is unit
 * tested without a renderer (see tests/timetable-install-plumbing.test.js).
 *
 * The rules these functions exist to enforce:
 *   - `beforeinstallprompt` is captured, never auto-shown; `prompt()` is only
 *     called from a real click;
 *   - iOS has no install event at all, in any browser, so it gets instructions
 *     instead of a fake success (`installSupportedFor` returns `manual`);
 *   - installation and offline readiness are *separate* results. A successful
 *     cache is not a successful install, and a dismissed prompt is not a failed
 *     save. The card reports both, independently.
 */

import { TIMETABLE_SCOPE, TIMETABLE_SW_PATH, TIMETABLE_WIDE_SCOPE } from '@/lib/timetable/batch';

/* --------------------------------------------------------------------------
   Environment
   -------------------------------------------------------------------------- */

/**
 * `ios` is iPhone/iPad *including* iPadOS 13+, which reports as a Mac; that
 * detection is the documented one and it matters, because that is exactly the
 * browser that pretends to be a desktop and has no install event.
 */
export function detectPlatform(userAgent = '', navigatorLike = {}) {
  const ua = String(userAgent || '');
  const touch = Number(navigatorLike.maxTouchPoints || 0) > 1;
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch);
  // The mobile labels name the platform, not a browser: on iOS every browser is WebKit
  // with the same Share sheet, and on Android the menu item is the system's. The
  // desktop labels stay browser-specific, because there the browser really does choose
  // the wording — and `kind` is what drives behaviour, never `label`.
  if (isIos) return { kind: 'ios', label: 'iPhone or iPad' };
  if (/Android/.test(ua)) return { kind: 'android', label: 'Android' };
  if (/Edg\//.test(ua)) return { kind: 'chromium-desktop', label: 'Edge on desktop' };
  if (/OPR\//.test(ua)) return { kind: 'chromium-desktop', label: 'Opera on desktop' };
  if (/Chrome\//.test(ua)) return { kind: 'chromium-desktop', label: 'Chrome on desktop' };
  if (/Firefox\//.test(ua)) return { kind: 'firefox', label: 'Firefox' };
  if (/Safari\//.test(ua)) return { kind: 'safari-desktop', label: 'Safari on desktop' };
  return { kind: 'unknown', label: 'this browser' };
}

/**
 * Is this document already running as an installed app? `display-mode` is the
 * standard answer; `navigator.standalone` is the one WebKit offers. Either
 * is reliable enough to *show the installed state* — nothing else is.
 */
export function isStandalone(matchMedia, navigatorLike = {}) {
  if (navigatorLike.standalone === true) return true;
  const queries = ['(display-mode: standalone)', '(display-mode: minimal-ui)', '(display-mode: fullscreen)'];
  return queries.some((query) => {
    try {
      return Boolean(matchMedia?.(query)?.matches);
    } catch {
      return false;
    }
  });
}

/**
 * Which install path this browser has:
 *   `native` — `beforeinstallprompt` is supported (Chromium)
 *   `manual` — the user finishes it in the browser menu (Firefox, desktop
 *              WebKit, anything else with no event)
 *   `ios`    — Share → Add to Home Screen, with no web API behind it
 */
export function installPathFor(platform, { hasBeforeInstallPrompt = false } = {}) {
  if (platform?.kind === 'ios') return 'ios';
  if (hasBeforeInstallPrompt) return 'native';
  if (platform?.kind === 'chromium-desktop' || platform?.kind === 'android') return 'manual';
  return 'manual';
}

/* --------------------------------------------------------------------------
   beforeinstallprompt
   -------------------------------------------------------------------------- */

/**
 * Start listening for the install event. `preventDefault` is what stops Chrome
 * from showing its own infobar whenever it feels like it, and the event is kept
 * so a click can use it later. Returns a disposer.
 */
export function watchInstallPrompt(target, onEvent) {
  if (!target?.addEventListener) return () => {};
  const handler = (event) => {
    event.preventDefault?.();
    onEvent(event);
  };
  target.addEventListener('beforeinstallprompt', handler);
  return () => target.removeEventListener('beforeinstallprompt', handler);
}

/**
 * Show the native prompt. Resolves `{ outcome, error }` — `unsupported` when
 * the browser has no prompt to show, which the UI must render as "finish it in
 * the browser menu", never as a failure of the app.
 */
export async function showInstallPrompt(event) {
  if (!event?.prompt) return { outcome: 'unsupported' };
  try {
    event.prompt();
  } catch {
    return { outcome: 'unsupported' };
  }
  const choice = await event.userChoice.catch(() => ({ outcome: 'unsupported' }));
  const outcome = choice?.outcome === 'accepted' ? 'accepted' : choice?.outcome === 'dismissed' ? 'dismissed' : 'unsupported';
  return { outcome };
}

export function watchInstalled(target, onInstalled) {
  if (!target?.addEventListener) return () => {};
  target.addEventListener('appinstalled', onInstalled);
  return () => target.removeEventListener('appinstalled', onInstalled);
}

/* --------------------------------------------------------------------------
   The service worker
   -------------------------------------------------------------------------- */

/**
 * The worker is only worth registering where its caches will actually be read
 * back: a production build. In `next dev` a worker would pin a stale bundle
 * between reloads and make the page look broken while the code is being
 * edited, so registration is skipped and the UI says offline support is not
 * active in development, instead of pretending.
 *
 * `@param {boolean} production` — pass `process.env.NODE_ENV === 'production'`
 * from the caller. Reading `process.env` inside this module is deliberately not
 * done: Next inlines each `process.env.X` reference at build time, so a bare
 * `process.env` object in a browser bundle is empty and the guard would read as
 * "never register" — which is exactly the bug this signature exists to prevent.
 */
export function workerAllowed(production) {
  return production === true;
}

/**
 * Register `/timetable/sw.js`.
 *
 * The script is served with `Service-Worker-Allowed: /`, so a browser that
 * honours it gets the wide scope and can keep the shell's chunks as well as the
 * documents. Safari ignores that header, so a refused scope is not an error: it
 * retries at the script's own directory, where the timetable documents are
 * still fully covered (the chunks come from the HTTP cache instead, which Next
 * marks `immutable`).
 */
export async function registerTimetableWorker(target) {
  const registration = target?.serviceWorker;
  if (!registration) return { state: 'unsupported', scope: null };

  const attempts = [
    { path: TIMETABLE_SW_PATH, scope: TIMETABLE_WIDE_SCOPE, wide: true },
    { path: TIMETABLE_SW_PATH, scope: TIMETABLE_SCOPE, wide: false },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const registrationResult = await registration.register(attempt.path, { scope: attempt.scope });
      await waitForSettled(registrationResult);
      return {
        state: 'registered',
        registration: registrationResult,
        scope: registrationResult.scope,
        wide: Boolean(attempt.wide),
        waiting: Boolean(registrationResult.waiting),
        updateViaCache: registrationResult.updateViaCache || 'default',
      };
    } catch (error) {
      lastError = error;
    }
  }

  return { state: 'error', scope: null, error: String(lastError?.name || lastError?.message || 'registration-failed') };
}

/** `register()` resolves before the worker installs; offline prep must not. */
async function waitForSettled(registration) {
  if (!registration?.installing || registration.active) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 6000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    registration.installing?.addEventListener?.('installed', done);
    registration.waiting?.addEventListener?.('activated', done);
    registration.active?.addEventListener?.('activated', done);
  });
}

export async function unregisterOwnWorker(target) {
  try {
    const registration = await target?.serviceWorker?.getRegistration?.(TIMETABLE_SCOPE);
    if (registration?.active?.scriptURL?.endsWith('/timetable/sw.js')) {
      await registration.unregister();
      return { ok: true, unregistered: true };
    }
    // Anything else on this origin is not ours to remove.
    return { ok: true, unregistered: false };
  } catch {
    return { ok: false, unregistered: false };
  }
}

/** Ask the waiting worker to take control, then reload only if it answers. */
/**
 * Ask a *waiting* worker to activate. Returns false when there is nothing to
 * activate, which is what stops the page from reloading itself for no reason:
 * a reload that changes nothing reads as a bug to the student.
 */
export function skipWaiting(registration) {
  const waiting = registration?.waiting;
  if (!waiting?.postMessage) return false;
  try {
    waiting.postMessage({ type: 'cp:skip-waiting' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Which of the assets this page needed are worth keeping for an offline open.
 * `performance` is the only trustworthy answer in an App Router build: the URLs
 * are content-hashed and emitted per page, so a hand-written list would be
 * wrong the first time a chunk is renamed.
 */
export function collectShellAssetUrls(entries = [], origin = '') {
  const keep = new Set();
  // With no origin to compare against, a base of `location.origin` is assumed by
  // the caller and only the path matters; the worker re-checks its own origin
  // before storing anything, so nothing cross-site can slip through here.
  const base = origin || 'http://localhost';
  for (const entry of entries) {
    const name = entry?.name;
    if (!name) continue;
    try {
      const url = new URL(name, base);
      if (origin && url.origin !== origin) continue;
      if (!url.pathname.startsWith('/_next/static/')) continue;
      keep.add(url.pathname);
    } catch {
      /* an unparseable entry is simply not precached */
    }
  }
  // Stylesheets the document links directly never appear as resource entries in
  // every browser, so they are collected from the DOM by the caller.
  return [...keep];
}

/**
 * The one way this page talks to the worker: post a message, wait for the
 * matching reply, give up after a timeout.
 *
 * Every cache operation here is idempotent and every reply is optional, so a
 * `timeout` is never fatal — the saved timetable in IndexedDB is the source of
 * truth for offline rendering, and the caches only decide whether the *page*
 * reloads with no network. A missing worker (`unsupported`) is reported the
 * same way, never retried in a loop.
 */
function workerRoundTrip(registration, message, doneType, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const worker = registration?.waiting || registration?.active || registration?.installing;
    if (!worker?.postMessage) {
      resolve({ state: 'unsupported', data: null });
      return;
    }
    let settled = false;
    const finish = (state, data = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      navigator?.serviceWorker?.removeEventListener?.('message', onMessage);
      resolve({ state, data });
    };
    const onMessage = (event) => {
      if (event.data?.type !== doneType) return;
      finish('done', event.data);
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    navigator?.serviceWorker?.addEventListener?.('message', onMessage);
    try {
      worker.postMessage(message);
    } catch {
      finish('error');
    }
  });
}

/** Cache the hashed JS and CSS this page actually loaded, by pathname. */
export async function sendPrecacheMessage(registration, urls) {
  const { state, data } = await workerRoundTrip(
    registration,
    { type: 'cp:precache-assets', urls },
    'cp:precache-assets-done',
  );
  return { state, stored: data?.stored ?? 0, requested: urls.length };
}

/**
 * Ask the worker to (re)cache the offline app shell and the scripts its markup
 * names, and wait for it to answer.
 *
 * This is *not* a hidden-iframe warm-up. An iframe would have been the usual
 * trick, but Campus+ sends `X-Frame-Options: DENY` on every production route —
 * a header this feature must not weaken — so a framed shell is simply refused.
 * The worker fetching the same URL is subject to no such restriction, and the
 * worker is the thing that owns the cache anyway: one owner, one code path, and
 * the document is stored together with the chunks it names.
 */
export async function precacheOfflineShell(registration, { timeoutMs = 8000 } = {}) {
  const { state, data } = await workerRoundTrip(
    registration,
    { type: 'cp:precache-shell' },
    'cp:precache-shell-done',
    timeoutMs,
  );
  return { state, stored: data?.stored ?? 0, failed: data?.failed ?? 0 };
}

/**
 * Ask the worker to store the document the student is reading, together with
 * the scripts that document names.
 *
 * Why the page has to ask at all: on a first visit the worker is installed *by*
 * this page, so it never saw the navigation and has nothing cached — and a
 * saved batch whose document was never cached cannot be reloaded offline. The
 * worker re-fetches the address the browser reports for this client, never one
 * the page supplies, and refuses anything outside `/timetable`.
 */
export async function cacheCurrentDocument(registration, { timeoutMs = 8000 } = {}) {
  const { state, data } = await workerRoundTrip(
    registration,
    { type: 'cp:cache-document' },
    'cp:cache-document-done',
    timeoutMs,
  );
  return { state, cached: Boolean(data?.cached), stored: data?.stored ?? 0, failed: data?.failed ?? 0 };
}

/**
 * Drop this feature's own caches, by name, and unregister this feature's own
 * worker.
 *
 * Used when the student removes every saved timetable: "removed from this
 * device" has to include the pages, or the next offline open still shows a
 * timetable that was supposed to be gone. Both sides are guarded — the worker
 * deletes only caches whose name it owns, and the unregistration checks the
 * script URL — because a shared lab machine may run another offline app under
 * the same origin.
 */
export async function dropOfflineCaches(registration, { timeoutMs = 6000 } = {}) {
  const { state, data } = await workerRoundTrip(registration, { type: 'cp:clear' }, 'cp:cleared', timeoutMs);
  return { state, deleted: data?.deleted ?? 0 };
}

/** The offline chip's copy is built here so both consumers say the same thing. */
export function offlineStateCopy(state, extra = {}) {
  switch (state) {
    case 'saving':
      return { tone: 'busy', label: 'Saving offline copy…', detail: 'Reading the printed week and storing it on this device.' };
    case 'ready':
      return {
        tone: 'ready',
        label: `Offline copy ready${extra.savedAgo ? ` · saved ${extra.savedAgo}` : ''}`,
        detail: extra.freshLabel || 'Up to date',
      };
    case 'stale':
      return {
        tone: 'stale',
        label: `Saved copy · ${extra.savedAgo || 'last synced earlier'}`,
        detail: 'This is your last saved timetable. The live one could not be read.',
      };
    case 'error':
      return { tone: 'error', label: 'Could not prepare offline copy', detail: extra.error || 'Storage was not available on this device.' };
    case 'unavailable':
      return { tone: 'muted', label: 'Offline copy not saved', detail: 'Open this timetable once with a connection to save it.' };
    default:
      return { tone: 'muted', label: 'Checking this device', detail: 'Looking for a saved copy of this timetable.' };
  }
}
