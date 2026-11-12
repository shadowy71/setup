// KLIPY is called directly by the browser; never send this public key to our server.
const BASE = 'https://api.klipy.com/api/v1';
export const KLIPY_HOSTS = ['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com'];

export function isKlipyMediaUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\/static[12]?\.klipy\.com\//.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && KLIPY_HOSTS.includes(url.hostname);
  } catch { return false; }
}

// Refuse the whole page if it contains an unsupported item. Silently removing
// it would change KLIPY's result composition; do not turn on ads until their
// impression/click integration has been implemented and reviewed.
export function parseKlipyPage(payload) {
  if (payload?.result !== true || !Array.isArray(payload.data?.data) || typeof payload.data.has_next !== 'boolean') throw new Error('KLIPY returned an unexpected response.');
  const items = payload.data.data.map((item) => {
    const file = item?.file?.md?.gif || item?.file?.sm?.gif || item?.file?.hd?.gif;
    const preview = item?.file?.sm?.gif || file;
    const id = String(item?.id ?? item?.slug ?? '');
    if ((item?.type && item.type !== 'gif') || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || !isKlipyMediaUrl(file?.url) || !isKlipyMediaUrl(preview?.url)) {
      throw new Error('KLIPY returned unsupported content. Please contact an administrator.');
    }
    return { provider: 'klipy', id, url: file.url, preview: preview.url, title: typeof item.title === 'string' ? item.title : '', width: file.width, height: file.height };
  });
  return { items, hasNext: payload.data.has_next };
}

export async function klipyRequest({ key, endpoint, params = {}, signal }) {
  if (!key) throw new Error('GIF search is not configured.');
  if (!['trending', 'search', 'categories', 'items'].includes(endpoint)) throw new Error('Unsupported KLIPY endpoint.');
  const query = new URLSearchParams(params);
  const response = await fetch(`${BASE}/${encodeURIComponent(key)}/gifs/${endpoint}?${query}`, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 429 ? 'KLIPY rate limit reached. Please try again later.' : 'KLIPY is unavailable right now.');
  const payload = await response.json();
  if (payload?.result !== true) throw new Error('KLIPY is unavailable right now.');
  return payload;
}
