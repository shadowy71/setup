import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const worker = readFileSync('public/timetable/sw.js', 'utf8');

function harness({ cached = true, fetchImpl }) {
  const handlers = {};
  const oldHtml = '<!doctype html><html><head></head><body>saved timetable</body></html>';
  const cache = {
    match: vi.fn(async () => cached ? new Response(oldHtml, { headers: { 'content-type': 'text/html' } }) : undefined),
    put: vi.fn(async () => {}),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
    add: vi.fn(async () => {}),
  };
  const self = { location: { origin: 'https://campus.test' }, addEventListener: (name, fn) => { handlers[name] = fn; } };
  class BrowserRequest extends Request {
    constructor(url, options) { super(new URL(url, self.location.origin), options); }
  }
  vm.runInNewContext(worker, {
    self, URL, Request: BrowserRequest, Response, setTimeout, clearTimeout,
    fetch: fetchImpl,
    caches: { open: async () => cache, keys: async () => [] },
    console,
  });
  const invoke = (url = 'https://campus.test/timetable/o') => {
    let response;
    let background;
    handlers.fetch({
      request: { url, method: 'GET', mode: 'navigate', destination: 'document', headers: new Headers({ accept: 'text/html' }), referrer: '' },
      respondWith: (promise) => { response = promise; },
      waitUntil: (promise) => { background = promise; },
    });
    return { response, background };
  };
  return { invoke, cache };
}

afterEach(() => vi.useRealTimers());

describe('timetable navigation worker', () => {
  it('shows marked cached HTML quickly on a slow connection and refreshes in the background', async () => {
    vi.useFakeTimers();
    let resolveNetwork;
    const fetchImpl = vi.fn(() => new Promise((resolve) => { resolveNetwork = resolve; }));
    const { invoke } = harness({ fetchImpl });
    const { response, background } = invoke();
    await vi.advanceTimersByTimeAsync(700);
    const result = await response;
    expect(result.headers.get('X-Campus-Plus-Offline')).toBe('stale');
    expect(await result.text()).toContain('name="campus-timetable-cached"');
    resolveNetwork(new Response('new page', { headers: { 'content-type': 'text/html' } }));
    await background;
  });

  it('returns the fresh response without waiting for asset caching', async () => {
    let finishAsset;
    const fresh = new Response('<html><head><script src="/_next/static/a.js"></script></head></html>', { headers: { 'content-type': 'text/html' } });
    Object.defineProperty(fresh, 'type', { value: 'basic' });
    const { invoke, cache } = harness({ fetchImpl: async () => fresh });
    cache.add.mockImplementation(() => new Promise((resolve) => { finishAsset = resolve; }));
    const { response, background } = invoke();
    expect(await (await response).text()).toContain('/_next/static/a.js');
    await vi.waitFor(() => expect(finishAsset).toBeDefined());
    expect(cache.put).not.toHaveBeenCalled();
    finishAsset();
    await background;
    expect(cache.put).toHaveBeenCalled();
  });

  it('does not replace an existing document when a required asset fails', async () => {
    const fresh = new Response('<html><head><script src="/_next/static/a.js"></script></head></html>', { headers: { 'content-type': 'text/html' } });
    Object.defineProperty(fresh, 'type', { value: 'basic' });
    const { invoke, cache } = harness({ fetchImpl: async () => fresh });
    cache.add.mockRejectedValue(new Error('asset unavailable'));
    const { response, background } = invoke();
    await response;
    await background;
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('never sends a cached timetable as an RSC payload or for an unrelated route', () => {
    const { invoke } = harness({ fetchImpl: vi.fn() });
    expect(invoke('https://campus.test/home').response).toBeUndefined();
  });
});

describe('timetable entry points and glass', () => {
  it('uses real navigations from the app so the worker can answer offline', () => {
    expect(readFileSync('components/layout/Sidebar.js', 'utf8')).toContain('item.href === timetableHref');
    expect(readFileSync('components/layout/MobileMenu.js', 'utf8')).toContain('label="Timetable" onNavigate={close} documentNavigation');
    expect(readFileSync('components/home/HomeFeatureTiles.js', 'utf8')).toContain("tile.tone === 'timetable' ? 'a' : Link");
    expect(readFileSync('app/timetable/page.js', 'utf8')).toContain('<a\n                href={divisionTimetableHref(division)}');
  });

  it('keeps glass scoped and provides a reduced-transparency fallback', () => {
    const css = readFileSync('app/styles/timetable.css', 'utf8');
    expect(css).toContain('var(--cp-bg-elevated) 48%, transparent');
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(css).toContain(':root .tt-shell');
  });
});
