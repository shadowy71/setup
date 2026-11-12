import { afterEach, describe, expect, it, vi } from 'vitest';
import { isKlipyMediaUrl, klipyRequest, parseKlipyPage } from '@/lib/klipy';
import { gifRefValidator } from '@/lib/validation/schemas';

const media = (name) => ({ url: `https://static.klipy.com/ii/${name}.gif?token=a%2Fb`, width: 320, height: 180 });
const item = (id) => ({ id, title: `GIF ${id}`, type: 'gif', file: { md: { gif: media(id) }, sm: { gif: media(`${id}-small`) } } });
const page = (data, has_next = false) => ({ result: true, data: { data, has_next } });
afterEach(() => vi.unstubAllGlobals());

describe('KLIPY browser client', () => {
  it('preserves order, repeated items, tracking URL and preview', () => {
    const result = parseKlipyPage(page([item(22), item(11), item(22)], true));
    expect(result.items.map((x) => x.id)).toEqual(['22', '11', '22']);
    expect(result.items[0].url).toBe(media(22).url);
    expect(result.items[0].preview).toBe(media('22-small').url);
    expect(result.hasNext).toBe(true);
  });
  it('fails the entire page rather than silently remove unsupported advertising', () => {
    expect(() => parseKlipyPage(page([item(1), { type: 'ad' }]))).toThrow(/unsupported/);
    expect(() => parseKlipyPage({ result: false })).toThrow();
  });
  it('restricts hosts without rewriting URL query strings', () => {
    for (const host of ['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com']) expect(isKlipyMediaUrl(`https://${host}/a?x=%2F`)).toBe(true);
    for (const value of ['https://static.klipy.com.evil.test/x', 'https://static.klipy.com@evil.test/x', 'https://static.klipy.com:443/x', 'http://static.klipy.com/x']) expect(isKlipyMediaUrl(value)).toBe(false);
    const result = gifRefValidator({ provider: 'klipy', id: '1', url: media(1).url });
    expect(result.value.url).toBe(media(1).url);
    expect(gifRefValidator({ provider: 'klipy', id: '1', url: 'https://evil.test/x' }).ok).toBe(false);
  });
  it('sends direct browser requests with cancellation and safe errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => page([]) });
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    await klipyRequest({ key: 'test', endpoint: 'search', params: { q: 'hello world', page: '2', per_page: '24', locale: 'in' }, signal });
    expect(fetchMock).toHaveBeenCalledWith('https://api.klipy.com/api/v1/test/gifs/search?q=hello+world&page=2&per_page=24&locale=in', expect.objectContaining({ signal, credentials: 'omit', cache: 'no-store' }));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(klipyRequest({ key: 'test', endpoint: 'trending' })).rejects.toThrow(/rate limit/);
    await expect(klipyRequest({ key: '', endpoint: 'items' })).rejects.toThrow(/not configured/);
  });
});
