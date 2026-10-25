import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ASSET_LIMIT,
  CACHE_PREFIX,
  DOCUMENT_LIMIT,
  MAX_CACHED_BYTES,
  OFFLINE_SHELL_READY_URL,
  OFFLINE_SHELL_URL,
  PRECACHE_URLS,
  SW_CACHE_VERSION,
  acceptablePrecacheUrls,
  cacheKeyFor,
  cacheNames,
  classifyRequest,
  extractAssetUrls,
  isCacheableDocumentPath,
  isDocumentRequest,
  isNeverCached,
  isOwnedCache,
  isTimetablePath,
  pickAssetsToPrune,
  pickDocumentsToPrune,
} from '@/lib/timetable/sw-policy';

/**
 * The cache policy — the part of the offline feature with a security edge.
 *
 * A service worker that caches "whatever the page asked for" quietly makes a
 * permanent, unauthenticated copy of signed-in pages on a shared lab computer.
 * Everything here is written so that the *default* is bypass and the exception
 * is narrow: a handful of document paths under `/timetable`, and only the build
 * assets those documents name.
 *
 * These tests exercise the policy module the worker is bundled from, so they
 * cover the shipped behaviour exactly — the file under `public/` is generated
 * from it and `npm run sw:check` proves it is current.
 */

const navigation = (url, extra = {}) => ({
  url,
  method: 'GET',
  mode: 'navigate',
  destination: 'document',
  accept: 'text/html,application/xhtml+xml',
  origin: 'https://pccoe.in',
  selfOrigin: 'https://pccoe.in',
  ...extra,
});

const asset = (url, referrer = 'https://pccoe.in/timetable/o', extra = {}) => ({
  url,
  method: 'GET',
  mode: 'no-cors',
  destination: 'script',
  referrer,
  origin: 'https://pccoe.in',
  selfOrigin: 'https://pccoe.in',
  ...extra,
});

const NAMES = cacheNames();

describe('cache names and versions', () => {
  it('names every cache with the feature prefix and an explicit version', () => {
    expect(NAMES).toEqual({
      core: `${CACHE_PREFIX}-core-${SW_CACHE_VERSION}`,
      assets: `${CACHE_PREFIX}-assets-${SW_CACHE_VERSION}`,
      documents: `${CACHE_PREFIX}-documents-${SW_CACHE_VERSION}`,
    });
    expect(SW_CACHE_VERSION).toMatch(/^v\d+$/);
  });

  it('owns only its own caches, so another feature’s cache is never deleted', () => {
    expect(isOwnedCache(`${CACHE_PREFIX}-documents-v1`)).toBe(true);
    expect(isOwnedCache(`${CACHE_PREFIX}-core-v2`)).toBe(true); // an older version of ours
    expect(isOwnedCache('campusplus-offline-v1')).toBe(false); // somebody else's
    expect(isOwnedCache('workbox-precache-v2')).toBe(false);
    expect(isOwnedCache('')).toBe(false);
    expect(isOwnedCache(null)).toBe(false);
  });

  it('precache only the shell and its launcher icons', () => {
    expect(PRECACHE_URLS).toEqual([OFFLINE_SHELL_URL, ...PRECACHE_URLS.slice(1)]);
    for (const url of PRECACHE_URLS) {
      expect(url.startsWith('/timetable') || url.startsWith('/brand/')).toBe(true);
    }
  });

  it('keeps a size ceiling on a single cached response', () => {
    expect(MAX_CACHED_BYTES).toBeGreaterThan(64 * 1024);
    expect(MAX_CACHED_BYTES).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('what may be cached', () => {
  it('caches a navigation to a timetable page', () => {
    for (const path of ['/timetable', '/timetable/o', '/timetable/j', '/timetable/offline', '/timetable/o/']) {
      expect(classifyRequest(navigation(`https://pccoe.in${path}`)).action, path).toBe('network-first');
    }
  });

  it('never caches another part of Campus+, even on a navigation', () => {
    const paths = [
      '/home',
      '/login',
      '/logout',
      '/admin',
      '/admin/backups',
      '/chat',
      '/chat/room-1',
      '/messages',
      '/profile/me',
      '/settings',
      '/account-status',
      '/onboarding',
      '/setup',
      '/api/messages/sync',
      '/api/timetable/o',
      '/auth/callback',
      '/feed',
      '/marketplace',
    ];
    for (const path of paths) {
      expect(classifyRequest(navigation(`https://pccoe.in${path}`)).action, path).toBe('bypass');
    }
  });

  it('never caches an authenticated or non-GET request under the timetable path', () => {
    // Any method that is not GET is out — a form POST must not be replayable.
    expect(classifyRequest(navigation('https://pccoe.in/timetable/o', { method: 'POST' })).action).toBe('bypass');
    expect(classifyRequest(navigation('https://pccoe.in/timetable/o', { method: 'HEAD' })).action).toBe('bypass');
    // The worker's own script, and the shell readiness sentinel, must not be
    // stored as documents (the cache would feed itself and pin an old build).
    expect(classifyRequest(navigation('https://pccoe.in/timetable/sw.js')).action).toBe('bypass');
    expect(isCacheableDocumentPath('/timetable/sw.js')).toBe(false);
    expect(isCacheableDocumentPath(OFFLINE_SHELL_READY_URL)).toBe(false);
    expect(isCacheableDocumentPath('/timetable/o')).toBe(true);
    expect(isCacheableDocumentPath('/home')).toBe(false);
    expect(isCacheableDocumentPath(undefined)).toBe(false);
  });

  it('recognises a navigation, and treats a route-payload fetch as one', () => {
    expect(isDocumentRequest({ mode: 'navigate', destination: 'document', accept: 'text/html' })).toBe(true);
    // App Router soft navigation: same URL, different accept → never the cache.
    expect(isDocumentRequest({ mode: 'navigate', destination: 'empty', accept: 'text/x-component' })).toBe(false);
    expect(isDocumentRequest({ mode: 'cors', destination: 'empty', accept: '*/*' })).toBe(false);
    expect(isDocumentRequest({})).toBe(false);
  });

  it('caches subresources only when the document asking is a timetable page', () => {
    const js = 'https://pccoe.in/_next/static/chunks/0-wioiv3vk8my.js';
    expect(classifyRequest(asset(js)).action).toBe('cache-first');
    // The same chunk loaded by the signed-in home page is not ours to keep.
    expect(classifyRequest(asset(js, 'https://pccoe.in/home')).action).toBe('bypass');
    // Neither is a file that is not a build asset, even from the timetable page.
    expect(classifyRequest(asset('https://pccoe.in/api/messages/sync', 'https://pccoe.in/timetable/o')).action).toBe('bypass');
    expect(classifyRequest(asset('https://pccoe.in/uploads/schedule.pdf', 'https://pccoe.in/timetable/o')).action).toBe('bypass');
    // …but the launcher artwork and the self-hosted fonts are.
    expect(classifyRequest(asset('https://pccoe.in/brand/timetable-icon-192.png')).action).toBe('cache-first');
    expect(
      classifyRequest(asset('https://pccoe.in/_next/static/media/DMMono_Regular-s.p.00kmgyrwf8rdn.ttf')).action,
    ).toBe('cache-first');
  });

  it('bypasses anything from another origin, whatever the path looks like', () => {
    expect(
      classifyRequest(navigation('https://evil.test/timetable/o', { origin: 'https://evil.test' })).action,
    ).toBe('bypass');
    expect(
      classifyRequest(asset('https://cdn.example.com/x.js', 'https://pccoe.in/timetable/o', { origin: 'https://cdn.example.com' })).action,
    ).toBe('bypass');
  });

  it('keys a cached entry by pathname so a query string cannot fork the cache', () => {
    expect(cacheKeyFor('https://pccoe.in/timetable/o?day=Mon#x')).toBe('/timetable/o');
    expect(cacheKeyFor('https://pccoe.in/timetable/o')).toBe('/timetable/o');
    expect(cacheKeyFor('not a url')).toBeNull();
    // `?bust=` re-requests never accumulate entries.
    expect(cacheKeyFor('https://pccoe.in/_next/static/chunks/a.js?v=2')).toBe('/_next/static/chunks/a.js');
  });

  it('lists the paths that must never be cached even if a rule changes', () => {
    for (const path of ['/api/messages/sync', '/login', '/admin', '/settings', '/auth/callback', '/logout']) {
      expect(isNeverCached(path), path).toBe(true);
    }
    expect(isNeverCached('/timetable/o')).toBe(false);
    // A path that merely *starts with* a sensitive word is not sensitive.
    expect(isNeverCached('/api-docs')).toBe(false);
  });

  it('agrees with the path helper both entry points share', () => {
    expect(isTimetablePath('/timetable/o')).toBe(true);
    expect(isTimetablePath('/timetables')).toBe(false);
    expect(isTimetablePath('/')).toBe(false);
  });
});

describe('limits', () => {
  it('prunes the oldest documents and never the offline shell', () => {
    const entries = [{ url: OFFLINE_SHELL_URL }];
    for (let index = 0; index < DOCUMENT_LIMIT + 1; index += 1) {
      entries.push({ url: `/timetable/div-${index}` });
    }
    const doomed = pickDocumentsToPrune(entries, DOCUMENT_LIMIT);
    expect(doomed.length).toBe(1);
    expect(doomed[0]).toBe('/timetable/div-0');
    expect(doomed).not.toContain(OFFLINE_SHELL_URL);
    expect(pickDocumentsToPrune(entries.slice(0, 3), DOCUMENT_LIMIT)).toEqual([]);
  });

  it('prunes assets from the front, keeping the newest set', () => {
    const entries = Array.from({ length: ASSET_LIMIT + 5 }, (_, index) => ({ url: `/_next/static/chunks/${index}.js` }));
    const doomed = pickAssetsToPrune(entries, ASSET_LIMIT);
    expect(doomed).toEqual(entries.slice(0, 5).map((entry) => entry.url));
  });

  it('accepts only same-origin immutable build URLs for a precache message', () => {
    const urls = acceptablePrecacheUrls(
      [
        'https://pccoe.in/_next/static/chunks/a.js',
        '/_next/static/chunks/b.css',
        'https://pccoe.in/api/messages/sync',
        'https://evil.test/_next/static/chunks/c.js',
        'https://pccoe.in/login',
        'not a url',
        null,
      ],
      'https://pccoe.in',
    );
    expect(urls).toEqual(['/_next/static/chunks/a.js', '/_next/static/chunks/b.css']);
    expect(acceptablePrecacheUrls(undefined, 'https://pccoe.in')).toEqual([]);
    // An origin without the immutable prefix yields nothing at all.
    // A garbage origin fails the parse for every entry, which is the point: an
    // unparseable base means nothing can be trusted.
    expect(acceptablePrecacheUrls(['/_next/static/chunks/a.js'], 'nonsense')).toEqual([]);
  });

  it('refuses a precache list longer than the asset limit', () => {
    const many = Array.from({ length: ASSET_LIMIT + 50 }, (_, index) => `/_next/static/chunks/${index}.js`);
    expect(acceptablePrecacheUrls(many, 'https://pccoe.in')).toHaveLength(ASSET_LIMIT);
  });
});

describe('the assets a document names', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/timetable-document.html'), 'utf8');

  it('finds the scripts, styles, fonts and artwork in the markup', () => {
    const urls = extractAssetUrls(html);
    expect(urls).toContain('/_next/static/chunks/turbopack-0o6gy1muemybi.js');
    expect(urls).toContain('/_next/static/chunks/20zejh-8kyedq.css');
    expect(urls).toContain('/_next/static/media/DMMono_Medium-s.p.1_fagkhdc28kq.ttf');
    expect(urls).toContain('/brand/pccoe-crest.webp');
    expect(new Set(urls).size).toBe(urls.length); // de-duplicated
  });

  it('ignores anything it has no business caching', () => {
    const urls = extractAssetUrls(
      '<a href="/home">home</a><script src="https://evil.test/_next/static/x.js"></script>' +
        '<img src="/api/messages/sync"><link rel="stylesheet" href="/timetable/custom.css">',
    );
    expect(urls).toEqual([]);
  });

  it('stops at the limit', () => {
    const big = Array.from({ length: 400 }, (_, index) => `<script src="/_next/static/c/${index}.js"></script>`).join('');
    expect(extractAssetUrls(big, 10)).toHaveLength(10);
    expect(extractAssetUrls('')).toEqual([]);
    expect(extractAssetUrls(null)).toEqual([]);
  });
});
