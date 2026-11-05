// A separate identity from the timetable's per-division install and storage.
export const DISMISS_KEY = 'campusplus.home-install.v1.dismissed';
export const ACCEPT_KEY = 'campusplus.home-install.v1.accepted';
export const INSTALLED_KEY = 'campusplus.home-install.v1.installed';
export const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
export const ACCEPT_MS = 180 * 24 * 60 * 60 * 1000;
export const INSTALL_EVENT = 'campusplus-home-install-change';

// Inline early capture is necessary: beforeinstallprompt has no replay and can
// fire before React hydrates. Never capture a timetable's separate manifest.
// Static source only; no user data is interpolated into this script.
export const HOME_INSTALL_CAPTURE_SCRIPT = `(()=>{if(window.__campusHomeInstall)return;const s={prompt:null,installed:false};window.__campusHomeInstall=s;function root(){try{const link=document.querySelector('link[rel="manifest"]');return !location.pathname.startsWith('/timetable')&&!!link&&new URL(link.href,location.href).pathname==='/manifest.webmanifest'}catch{return false}}function notify(){window.dispatchEvent(new Event('campusplus-home-install-change'))}window.addEventListener('beforeinstallprompt',e=>{if(!root())return;e.preventDefault();e.stopImmediatePropagation();s.prompt=e;notify()});window.addEventListener('appinstalled',()=>{if(!root())return;s.prompt=null;s.installed=true;notify()})})();`;

export function isStandalone(win, nav) {
  if (nav?.standalone === true) return true;
  return ['standalone', 'minimal-ui', 'fullscreen'].some((mode) => {
    try { return Boolean(win?.matchMedia?.(`(display-mode: ${mode})`).matches); } catch { return false; }
  });
}

// There is no iOS install event. Only show Safari's specific instructions in
// Safari, including iPadOS devices which identify as a touch-enabled Mac.
export function isIosSafari(nav = {}) {
  const ua = String(nav.userAgent || '');
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && Number(nav.maxTouchPoints) > 1);
  return ios && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA\/|FBAN|FBAV|Instagram|Line\//i.test(ua);
}

export function recently(value, period, now = Date.now()) {
  const time = Number(value);
  return Number.isFinite(time) && time > 0 && time <= now + period && now - time < period;
}

export function readPreference(storage, key) {
  try { return storage?.getItem(key) || null; } catch { return null; }
}
export function writePreference(storage, key, value) {
  try { storage?.setItem(key, String(value)); } catch { /* Private browsing: memory still dismisses this view. */ }
}

export function offerMode({ standalone, installed, dismissedAt, acceptedAt, hasPrompt, iosSafari, now = Date.now() }) {
  if (standalone || installed || recently(dismissedAt, DISMISS_MS, now) || recently(acceptedAt, ACCEPT_MS, now)) return null;
  if (hasPrompt) return 'native';
  return iosSafari ? 'ios' : null;
}
