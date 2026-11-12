'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Button, Input, Notice, Skeleton } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import { klipyRequest, parseKlipyPage } from '@/lib/klipy';

const KLIPY_KEY = process.env.NEXT_PUBLIC_KLIPY_APP_KEY || '';


/** GIF discovery is performed directly from the end-user browser. */
export function GifPicker({ onPick, onRemove = null, value = null, label = 'GIF' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(null);
  const [categories, setCategories] = useState([]);
  const [hasNext, setHasNext] = useState(false);
  const [page, setPage] = useState(1);
  const unconfigured = !KLIPY_KEY || /^YOUR_/i.test(KLIPY_KEY);
  const controller = useRef(null);
  const requestSeq = useRef(0);
  const containerRef = useRef(null);

  const search = useCallback(async (term, nextPage = 1) => {
    if (unconfigured) { setLoadedOnce(true); return; }
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const params = { page: String(nextPage), per_page: '24', locale: 'in' };
      if (term) params.q = term;
      const payload = await klipyRequest({ key: KLIPY_KEY, endpoint: term ? 'search' : 'trending', params, signal: active.signal });
      const result = parseKlipyPage(payload);
      if (seq !== requestSeq.current) return;
      setItems((current) => nextPage === 1 ? result.items : [...current, ...result.items]);
      setHasNext(result.hasNext);
      setPage(nextPage);
    } catch (thrown) {
      if (seq !== requestSeq.current || thrown.name === 'AbortError') return;
      if (nextPage === 1) { setItems([]); setHasNext(false); }
      setError(thrown.message || 'GIF search failed.');
    } finally {
      if (seq === requestSeq.current) { setLoading(false); setLoadedOnce(true); }
    }
  }, [unconfigured]);

  useEffect(() => {
    if (!open) return undefined;
    // Invalidate immediately, including during the debounce interval.
    controller.current?.abort();
    requestSeq.current += 1;
    const term = query.trim();
    const timer = setTimeout(() => search(term.length >= 2 ? term : ''), 320);
    return () => { clearTimeout(timer); controller.current?.abort(); requestSeq.current += 1; };
  }, [open, query, search]);

  useEffect(() => {
    if (!open || unconfigured) return undefined;
    const active = new AbortController();
    klipyRequest({ key: KLIPY_KEY, endpoint: 'categories', params: { locale: 'in' }, signal: active.signal })
      .then((payload) => {
        if (Array.isArray(payload.data?.categories)) setCategories(payload.data.categories);
      }).catch(() => {});
    return () => active.abort();
  }, [open, unconfigured]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // True from the moment the picker opens until its first result (or error)
  // arrives, including the 320ms debounce — so the empty prompt never flashes.
  const busy = loading || (open && !loadedOnce);

  return (
    <div ref={containerRef} className={cn('flex min-w-0 max-w-full flex-col gap-2', open && 'w-[22rem]')}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={open ? 'subtle' : 'ghost'}
          size="sm"
          icon="image"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {value ? 'Change GIF' : label}
        </Button>
        {value && onRemove ? (
          <Button type="button" variant="ghost" size="sm" icon="close" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>

      {value ? (
        <p className="flex items-center gap-1.5 text-2xs text-muted">
          <Icon name="check" size={13} className="text-success" />
          GIF attached{value.title ? `: ${value.title}` : ''}
        </p>
      ) : null}

      {open ? (
        <div className="card-flush min-w-0 w-full max-w-full p-3" role="region" aria-label="GIF search">
          <Input
            type="search"
            value={query}
            onChange={(event) => { setHasNext(false); setQuery(event.target.value); }}
            placeholder="Search KLIPY"
            aria-label="Search KLIPY"
            autoFocus
          />

          {categories.length > 0 && !query.trim() ? (
            <div className="mt-2 flex w-full min-w-0 max-w-full gap-2 overflow-x-auto" aria-label="GIF categories">
              {categories.map((category, index) => (
                <Button key={index} type="button" size="sm" variant="subtle" className="shrink-0" onClick={() => { setHasNext(false); setQuery(String(category.query || category.category || '')); }}>
                  {category.category}
                </Button>
              ))}
            </div>
          ) : null}

          {unconfigured ? (
            <Notice tone="warning" className="mt-3" icon="settings">
              GIF search is not configured on this deployment. An administrator can enable it by configuring the public KLIPY app key.
            </Notice>
          ) : null}

          {error ? (
            <Notice tone="danger" className="mt-3" icon="flag">
              {error}
            </Notice>
          ) : null}

          {busy && items.length === 0 ? (
            <ul className="mt-3 grid w-full min-w-0 max-h-72 grid-cols-2 gap-2 overflow-hidden sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <li key={index}>
                  <Skeleton className="h-24 w-full rounded-[var(--radius-sm)]" />
                </li>
              ))}
            </ul>
          ) : null}

          {/* A later search keeps the current results on screen instead of
              replacing them with skeletons (which made the panel jump). */}
          {busy && items.length > 0 ? (
            <p className="mt-2 text-2xs text-muted" role="status">
              Searching…
            </p>
          ) : null}

          {!busy && !unconfigured && !error && items.length === 0 ? (
            <p className="py-5 text-center text-[0.8125rem] text-muted">
              {query.trim().length >= 2 ? 'No GIFs matched that search.' : 'Type to search GIFs.'}
            </p>
          ) : null}

          {items.length ? (
            <ul className="mt-3 grid w-full min-w-0 max-h-72 grid-cols-2 gap-2 overflow-y-auto overflow-x-hidden sm:grid-cols-3">
              {items.map((gif, index) => (
                <li key={`${gif.id}-${index}`} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      // Dimensions travel with the reference: every surface that
                      // renders it reserves the real aspect ratio up front, so a
                      // GIF can never resize a post or message when it loads.
                      const picked = {
                        provider: 'klipy',
                        id: gif.id,
                        url: gif.url,
                        preview: gif.preview || gif.url,
                        title: gif.title,
                      };
                      if (Number(gif.width) > 0 && Number(gif.height) > 0) {
                        picked.width = Number(gif.width);
                        picked.height = Number(gif.height);
                      }
                      onPick(picked);
                      setOpen(false);
                    }}
                    className="motion-control block h-24 w-full overflow-hidden rounded-[var(--radius-sm)] border border-line text-left hover:border-accent/50 active:scale-[0.98]"
                    aria-label={gif.title ? `Attach GIF: ${gif.title}` : 'Attach GIF'}
                  >
                    {/* KLIPY preview, loaded directly from its CDN; the full GIF is only
                        fetched once it is actually attached. */}
                    <Image
                      src={gif.preview || gif.url}
                      alt={gif.title || ''}
                      width={200}
                      height={96}
                      unoptimized
                      className="h-full w-full bg-surface-2 object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {hasNext && !busy && !error ? (
            <Button type="button" variant="subtle" size="sm" onClick={() => search(query.trim().length >= 2 ? query.trim() : '', page + 1)}>
              Load more GIFs
            </Button>
          ) : null}
          <p className="mt-3 text-2xs text-muted">Powered by <a href="https://klipy.com" target="_blank" rel="noreferrer noopener" className="underline">KLIPY</a></p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders stored KLIPY and historical GIPHY references.
 *
 * A GIF is an external image whose real size is only known once it has
 * downloaded, so it must never be allowed to dictate its own layout:
 *
 *  - New references carry the provider's width/height. Those become the
 *    `width`/`height` attributes, so the browser reserves exactly the right
 *    box before the first frame arrives, and `aspect-ratio` keeps it while
 *    the CSS max-height/max-width caps scale it down. Zero layout shift.
 *  - Older references predate that (no dimensions stored). They render in a
 *    fixed 16:9 frame with `object-contain`: the card keeps its size no
 *    matter what shape the GIF turns out to be.
 */
export function GifAttachment({ gif, className = '' }) {
  if (!gif?.url) return null;

  const width = Math.round(Number(gif.width));
  const height = Math.round(Number(gif.height));
  // A stored 1×1 is a placeholder, not a picture: treat it as unknown rather
  // than reserving a square for a landscape GIF.
  const measured = Number.isFinite(width) && Number.isFinite(height) && width >= 16 && height >= 16;

  if (!measured) {
    return (
      <span
        className={cn(
          'flex max-h-72 w-full max-w-[20rem] overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface-2',
          className,
        )}
        style={{ aspectRatio: '16 / 9' }}
      >
        <Image
          src={gif.url}
          alt={gif.title || 'GIF'}
          width={320}
          height={180}
          unoptimized
          className="h-full w-full object-contain"
        />
      </span>
    );
  }

  return (
    <Image
      src={gif.url}
      alt={gif.title || 'GIF'}
      width={width}
      height={height}
      unoptimized
      style={{ aspectRatio: `${width} / ${height}` }}
      className={cn(
        'block h-auto max-h-72 w-auto max-w-full rounded-[var(--radius-md)] border border-line bg-surface-2',
        className,
      )}
    />
  );
}
