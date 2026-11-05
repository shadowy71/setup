import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import manifest from '@/app/manifest';
import { ACCEPT_MS, DISMISS_MS, HOME_INSTALL_CAPTURE_SCRIPT, INSTALL_EVENT, isIosSafari, isStandalone, offerMode, readPreference, writePreference } from '@/lib/install/home-install';

const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Version/17.2 Mobile/15E148 Safari/604.1';
const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.2 Safari/605.1.15';
const now = 2_000_000_000_000;

describe('Home install offer', () => {
  it('only offers a native prompt when available, or Safari guidance on iOS', () => {
    expect(offerMode({ hasPrompt: true, now })).toBe('native');
    expect(offerMode({ iosSafari: true, now })).toBe('ios');
    expect(offerMode({ now })).toBeNull();
    expect(isIosSafari({ userAgent: ios })).toBe(true);
    expect(isIosSafari({ userAgent: ipad, maxTouchPoints: 5 })).toBe(true);
    expect(isIosSafari({ userAgent: ipad, maxTouchPoints: 0 })).toBe(false);
    expect(isIosSafari({ userAgent: ios.replace('Version/17.2', 'CriOS/120') })).toBe(false);
    expect(isIosSafari({ userAgent: 'Android Chrome Safari' })).toBe(false);
  });
  it('suppresses installed, standalone, dismissed and recently accepted offers', () => {
    for (const suppression of [{ installed: true }, { standalone: true }, { dismissedAt: now - DISMISS_MS + 1 }, { acceptedAt: now - ACCEPT_MS + 1 }]) {
      expect(offerMode({ hasPrompt: true, iosSafari: true, now, ...suppression })).toBeNull();
    }
    expect(offerMode({ hasPrompt: true, now, dismissedAt: now - DISMISS_MS })).toBe('native');
    expect(offerMode({ hasPrompt: true, now, acceptedAt: now - ACCEPT_MS })).toBe('native');
    expect(isStandalone({}, { standalone: true })).toBe(true);
    expect(isStandalone({ matchMedia: (query) => ({ matches: query.includes('standalone') }) }, {})).toBe(true);
    expect(isStandalone({ matchMedia: () => ({ matches: false }) }, {})).toBe(false);
  });
  it('tolerates unavailable storage', () => {
    const storage = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } };
    expect(readPreference(storage, 'x')).toBeNull();
    expect(() => writePreference(storage, 'x', 1)).not.toThrow();
  });
  it('sets a separate root identity with branded ordinary and maskable icons', () => {
    const m = manifest();
    expect(m).toMatchObject({ id: '/home', start_url: '/home', scope: '/', display: 'standalone' });
    expect(m.icons.map((icon) => [icon.sizes, icon.purpose])).toEqual([['192x192', 'any'], ['512x512', 'any'], ['192x192', 'maskable'], ['512x512', 'maskable']]);
  });
});

describe('early capture', () => {
  function setup(path = '/home', href = 'https://pccoe.in/manifest.webmanifest') {
    const handlers = {};
    const notify = vi.fn();
    const window = { addEventListener: (name, fn) => { handlers[name] = fn; }, dispatchEvent: notify };
    const location = { pathname: path, href: `https://pccoe.in${path}` };
    const document = { querySelector: () => href ? { href } : null };
    class Event { constructor(type) { this.type = type; } }
    runInNewContext(HOME_INSTALL_CAPTURE_SCRIPT, { window, location, document, Event, URL });
    return { window, handlers, notify, location, document };
  }
  it('parks the event without prompting, notifies Home, and clears on appinstalled', () => {
    const { window, handlers, notify } = setup();
    const event = { preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), prompt: vi.fn() };
    handlers.beforeinstallprompt(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.prompt).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(window.__campusHomeInstall.prompt).toBe(event);
    expect(notify.mock.calls[0][0].type).toBe(INSTALL_EVENT);
    handlers.appinstalled();
    expect(window.__campusHomeInstall).toEqual({ prompt: null, installed: true });
  });
  it.each([['/timetable', 'https://pccoe.in/manifest.webmanifest'], ['/home', 'https://pccoe.in/timetable/manifest/a'], ['/home', null]])('does not steal other manifests: %s', (path, href) => {
    const { window, handlers } = setup(path, href);
    const event = { preventDefault: vi.fn() };
    handlers.beforeinstallprompt(event);
    handlers.appinstalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.__campusHomeInstall).toEqual({ prompt: null, installed: false });
  });
});
