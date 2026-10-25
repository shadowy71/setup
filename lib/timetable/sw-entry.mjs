/**
 * The timetable service worker — source of `public/timetable/sw.js`.
 *
 * Never served directly: `scripts/build-sw.mjs` bundles this file (with
 * `lib/timetable/sw-policy.js` inlined) into a single classic worker script in
 * `public/`, because a service worker cannot import an ESM module that the
 * build has not published, and the policy must have exactly one source. If you
 * edit this file, run `npm run sw:bundle`; `npm run verify` fails when the
 * committed worker is out of date.
 *
 * What it does: keeps the timetable pages (documents) and the immutable
 * chunks/CSS they loaded (assets) so a saved batch renders with no network at
 * all. What it never does: cache an API response, an authenticated page, or
 * anything from another origin. All of those rules live in sw-policy.js.
 */

import {
  CACHE_PREFIX,
  DOCUMENT_LIMIT,
  ASSET_LIMIT,
  MAX_CACHED_BYTES,
  OFFLINE_SHELL_READY_URL,
  OFFLINE_SHELL_URL,
  PRECACHE_URLS,
  isCacheableDocumentPath,
  SW_CACHE_VERSION,
  acceptablePrecacheUrls,
  cacheKeyFor,
  cacheNames,
  classifyRequest,
  extractAssetUrls,
  isOwnedCache,
  pickAssetsToPrune,
  pickDocumentsToPrune,
} from '@/lib/timetable/sw-policy';

const NAMES = cacheNames(SW_CACHE_VERSION);

/**
 * `CacheStorage` is not guaranteed to exist. A private-mode profile, a browser
 * with site data blocked, or a storage API that has just been denied answers
 * `caches.open` with a rejection — and a worker that lets that escape turns a
 * page that would have loaded fine online into a failed navigation.
 *
 * Offline caching is the enhancement here, not the page, so every cache touch in
 * this worker goes through the two helpers below and degrades to "nothing was
 * cached" instead. The timetable's real offline copy is IndexedDB, which the
 * page reads directly and which this worker never touches.
 */
async function openCache(name) {
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

async function listCaches() {
  try {
    return await caches.keys();
  } catch {
    return [];
  }
}

/** A response the page can label: `stale` and `shell` are both honest offline states. */
function mark(source, body, contentType = 'text/html; charset=utf-8') {
  return new Response(body, {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Campus-Plus-Offline': source,
    },
  });
}

function tooBig(response) {
  const length = Number(response.headers?.get?.('content-length') || 0);
  return length > MAX_CACHED_BYTES;
}

function isHtml(response) {
  const type = response.headers?.get?.('content-type') || '';
  return response.status === 200 && response.type === 'basic' && type.includes('text/html');
}

async function entriesOf(cache) {
  const keys = await cache.keys();
  return keys.map((request) => ({ url: new URL(request.url).pathname }));
}

async function prune(cache, urls) {
  for (const url of urls) await cache.delete(url);
}

/**
 * Store a document *and* the chunks/stylesheet its markup names.
 *
 * A cached HTML document whose scripts are missing is worse than no cache at
 * all: the browser paints nothing and the student sees a blank page rather
 * than an honest offline message. Caching the pair together is what makes
 * "opened it once online" mean "opens offline", on the very first visit.
 *
 * Returns `{ stored, failed }`. For the app shell those numbers are also the
 * readiness marker below: `handleDocument` will only serve the shell as a
 * fallback when a previous run stored it with nothing failing.
 */
async function putDocument(cache, request, response, withAssets) {
  await cache.put(request, response.clone());
  if (!withAssets) return { stored: 0, failed: 0 };

  const text = await response.clone().text();
  const urls = extractAssetUrls(text);
  if (!urls.length) return { stored: 0, failed: 1 };

  const store = await openCache(NAMES.assets);
  if (!store) return { stored: 0, failed: urls.length };
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        await store.add(new Request(url, { cache: 'reload' }));
        return true;
      } catch {
        return false;
      }
    }),
  );
  await prune(store, pickAssetsToPrune(await entriesOf(store), ASSET_LIMIT));
  const stored = results.filter(Boolean).length;
  return { stored, failed: urls.length - stored };
}

/** Record that the shell is complete enough to be served with no network. */
async function markShell(cache, ready) {
  if (ready) await cache.put(OFFLINE_SHELL_READY_URL, new Response('ready'));
  else await cache.delete(OFFLINE_SHELL_READY_URL);
}

/**
 * Documents: network first, because a timetable a student reads between
 * classes has to be the department's latest one whenever there is a network.
 * The cache is the fallback, and the app shell is the fallback for the
 * fallback — a batch that was *saved* but whose page was never visited still
 * renders from IndexedDB instead of dying with a browser error page.
 */
async function handleDocument(request) {
  const cache = await openCache(NAMES.documents);
  const key = cacheKeyFor(request.url);

  try {
    const response = await fetch(request);
    if (cache && isHtml(response) && key && !tooBig(response)) {
      await putDocument(cache, request, response, true);
      await prune(cache, pickDocumentsToPrune(await entriesOf(cache), DOCUMENT_LIMIT));
    }
    return response;
  } catch {
    const cached = cache && key ? await cache.match(key) : null;
    if (cached) return mark('stale', await cached.text());

    // No copy of this page at all. The app shell can still render a *saved*
    // batch from IndexedDB — but only when a previous run proved that the
    // shell and the scripts it names are all present, because serving it
    // half-cached produces a blank page instead of an explanation.
    const core = await openCache(NAMES.core);
    const [shell, ready] = core
      ? await Promise.all([core.match(OFFLINE_SHELL_URL), core.match(OFFLINE_SHELL_READY_URL)])
      : [null, null];
    if (shell && ready) return mark('shell', await shell.text());
    return mark('unavailable', offlineNotice());
  }
}

/**
 * Assets: cache first. These URLs are content-hashed by the build, so an entry
 * is correct for as long as it exists and a new deploy simply never asks for
 * the same name again — there is nothing to revalidate and nothing to serve
 * stale. A miss is fetched and stored; a failed fetch (offline, first visit)
 * is an error the page handles.
 */
async function handleAsset(request, cacheName) {
  const cache = await openCache(cacheName);
  if (!cache) return fetch(request); // no CacheStorage: a plain network read
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response?.ok && !tooBig(response)) {
    await cache.put(request, response.clone());
    await prune(cache, pickAssetsToPrune(await entriesOf(cache), ASSET_LIMIT));
  }
  return response;
}

/**
 * The no-cache, no-shell, no-network case: a short static page rather than the
 * browser's "can't reach this site", because the student needs to be told to
 * open the timetable once while online.
 */
/**
 * The last-resort page. It is written inline because it is the one document the
 * network cannot help with: no stylesheet has loaded, and there is nothing to
 * hydrate. The colours are inline for the same reason — this is the only place
 * in the app allowed to name one, because a token cannot be read here.
 */
function offlineNotice() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Timetable unavailable offline</title>
<style>body{margin:0;padding:2.5rem 1.25rem;background:#07151d;color:#f8faf7;min-height:100dvh;display:flex;align-items:center;font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:34rem;margin:0 auto}p{color:#b7c8c6}b{color:#5eead4}</style></head>
<body><main><p style="letter-spacing:.12em;text-transform:uppercase;font-size:.75rem;color:#b7c8c6">Campus+ timetable</p>
<h1 style="font-size:1.5rem;margin:.35rem 0 0">No offline copy yet</h1>
<p>This timetable has to be opened once while online before it can be read with no signal.</p>
<p>Connect for a moment, open <b>Timetable</b>, then come back offline.</p></main></body></html>`;
}

self.addEventListener('install', (event) => {
  // No skipWaiting here on purpose: an update waits for the page to offer a
  // reload, so a student in the middle of reading a timetable is never
  // re-rendered underneath themselves.
  event.waitUntil(
    (async () => {
      const cache = await openCache(NAMES.core);
      if (!cache) return; // installing without a cache still yields a working worker
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const request = new Request(url, { cache: 'reload' });
            const response = await fetch(request);
            if (!response?.ok) return;
            if (url === OFFLINE_SHELL_URL) {
              const { stored, failed } = await putDocument(cache, request, response, true);
              await markShell(cache, failed === 0 && stored > 0);
              return;
            }
            // The icons are just stored. Everything is wrapped so a missing
            // file can never fail the install and leave the worker inactive.
            await cache.put(request, response);
          } catch {
            /* keep installing: a partial precache still beats no worker */
          }
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete only our own caches, and only the ones this version no longer
      // names. IndexedDB (the timetable data) is not CacheStorage and is never
      // touched from here.
      const names = Object.values(cacheNames(SW_CACHE_VERSION));
      const keys = await listCaches();
      await Promise.all(
        keys.filter((name) => isOwnedCache(name) && !names.includes(name)).map((name) => caches.delete(name)),
      );
      // Take over the open tabs, so the page that installed this worker has its
      // own lazily-loaded chunks cached *during that same visit* rather than on
      // the next one. This is not a licence to touch them: every request from
      // an unrelated page is classified `bypass` by sw-policy and is answered
      // with a plain pass-through fetch, so no authenticated response, admin
      // table or DM is ever read from or written to a cache here.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const decision = classifyRequest({
    url: request.url,
    method: request.method,
    mode: request.mode,
    destination: request.destination,
    accept: request.headers.get('accept') || '',
    referrer: request.referrer || '',
    origin: url.origin,
    selfOrigin: self.location.origin,
  });

  if (decision.action === 'bypass') return;
  event.respondWith(
    decision.action === 'network-first'
      ? handleDocument(request)
      : handleAsset(request, decision.cache).catch(() => Response.error()),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'cp:skip-waiting') {
    // Only a page that asked for it — the update is never silent.
    self.skipWaiting();
    return;
  }

  if (data.type === 'cp:precache-shell') {
    // The page asks for this after it has saved a batch, so that the offline
    // fallback view and the scripts it needs are fresh *for the build the
    // student is looking at* — not only for whatever was current at install.
    event.waitUntil(
      (async () => {
        const request = new Request(OFFLINE_SHELL_URL, { cache: 'reload' });
        let stored = 0;
        let failed = 1;
        try {
          const response = await fetch(request);
          if (response?.ok && isHtml(response)) {
            const core = await openCache(NAMES.core);
            if (core) ({ stored, failed } = await putDocument(core, request, response, true));
            else failed = 1;
          }
        } catch {
          stored = 0;
          failed = 1;
        }
        const core = await openCache(NAMES.core);
        if (core) await markShell(core, failed === 0 && stored > 0);
        event.source?.postMessage({ type: 'cp:precache-shell-done', stored, failed });
      })(),
    );
    return;
  }

  if (data.type === 'cp:cache-document') {
    // The page the student is reading asks to be kept. Only the URL the browser
    // reports for that client is used — never one the page supplies — and only
    // under /timetable, so this cannot be pointed at /admin or another
    // student's data.
    const sourceUrl = event.source?.url;
    const pathname = sourceUrl ? new URL(sourceUrl).pathname : null;
    if (!isCacheableDocumentPath(pathname)) {
      event.source?.postMessage({ type: 'cp:cache-document-done', cached: false, reason: 'not-allowed' });
      return;
    }
    event.waitUntil(
      (async () => {
        let cached = false;
        try {
          const request = new Request(pathname, { cache: 'reload' });
          const response = await fetch(request);
          if (response?.ok && isHtml(response)) {
            const documents = await openCache(NAMES.documents);
            if (documents) {
              await putDocument(documents, request, response, true);
              cached = true;
            }
          }
        } catch {
          cached = false;
        }
        event.source?.postMessage({ type: 'cp:cache-document-done', cached });
      })(),
    );
    return;
  }

  if (data.type === 'cp:precache-assets') {
    const urls = acceptablePrecacheUrls(data.urls, self.location.origin);
    event.waitUntil(
      (async () => {
        const cache = await openCache(NAMES.assets);
        const results = cache
          ? await Promise.all(
              urls.map(async (path) => {
                try {
                  await cache.add(new Request(path, { cache: 'reload' }));
                  return true;
                } catch {
                  return false;
                }
              }),
            )
          : [];
        const stored = results.filter(Boolean).length;
        if (event.source) {
          event.source.postMessage({ type: 'cp:precache-assets-done', stored, requested: urls.length });
        }
      })(),
    );
    return;
  }

  if (data.type === 'cp:clear') {
    // Removal has to mean removal — but only for the caches this feature
    // created. `caches.keys()` is filtered by name, so another offline app on
    // this origin keeps its own entries.
    event.waitUntil(
      (async () => {
        const names = (await listCaches()).filter(isOwnedCache);
        const results = await Promise.all(names.map((name) => caches.delete(name)));
        event.source?.postMessage({ type: 'cp:cleared', deleted: results.filter(Boolean).length });
      })(),
    );
    return;
  }

  if (data.type === 'cp:status') {
    event.waitUntil(
      (async () => {
        const documents = await openCache(NAMES.documents).then((cache) => (cache ? cache.keys() : []));
        const assets = await openCache(NAMES.assets).then((cache) => (cache ? cache.keys() : []));
        event.source?.postMessage({
          type: 'cp:status-done',
          version: SW_CACHE_VERSION,
          prefix: CACHE_PREFIX,
          documents: documents.length,
          assets: assets.length,
        });
      })(),
    );
  }
});
