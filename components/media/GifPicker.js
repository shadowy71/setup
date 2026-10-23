'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Button, Input, Notice, Skeleton } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

/**
 * The one GIF picker.
 *
 * Talks only to `/api/giphy/search` — the GIPHY key stays on the server — and
 * stores just the validated `{ provider, id, url, title }` ref that the database
 * accepts. Attribution is rendered with the results, as the provider requires.
 *
 * If GIPHY is not configured the component shows a configuration message and
 * everything else keeps working: GIFs are a garnish, never a dependency.
 */
export function GifPicker({ onPick, onRemove = null, value = null, label = 'GIF' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(null);
  const [attribution, setAttribution] = useState(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const debounce = useRef(null);
  const containerRef = useRef(null);
  // Responses can arrive out of order while someone types. Only the newest
  // request may touch state; older results are dropped instead of flickering
  // over the correct ones.
  const requestSeq = useRef(0);

  const search = useCallback(async (term) => {
    requestSeq.current += 1;
    const seq = requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '24' });
      if (term) params.set('q', term);
      const response = await fetch(`/api/giphy/search?${params.toString()}`);
      const payload = await response.json();
      if (seq !== requestSeq.current) return;
      if (!response.ok) {
        if (payload?.code === 'configuration') {
          setUnconfigured(true);
          setItems([]);
          return;
        }
        throw new Error(payload?.error || 'GIF search is unavailable right now.');
      }
      setItems(payload.results || []);
      setAttribution(payload.attribution || null);
    } catch (thrown) {
      if (seq !== requestSeq.current) return;
      setError(thrown.message || 'GIF search failed.');
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setLoadedOnce(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const term = query.trim();
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(term.length >= 2 ? term : ''), 320);
    return () => clearTimeout(debounce.current);
  }, [open, query, search]);

  useEffect(() => {
    if (!open) {
      // Closing abandons any in-flight search: its result must not populate
      // the picker when it is opened again.
      requestSeq.current += 1;
      return undefined;
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // True from the moment the picker opens until its first result (or error)
  // arrives, including the 320ms debounce — so the empty prompt never flashes.
  const busy = loading || (open && !loadedOnce);

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
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
        <div className="card-flush p-3" role="region" aria-label="GIF search">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search GIFs"
            aria-label="Search GIFs"
            autoFocus
          />

          {unconfigured ? (
            <Notice tone="warning" className="mt-3" icon="settings">
              GIF search is not configured on this deployment. An administrator can enable it by adding a GIPHY API key
              to the server environment.
            </Notice>
          ) : null}

          {error ? (
            <Notice tone="danger" className="mt-3" icon="flag">
              {error}
            </Notice>
          ) : null}

          {busy && items.length === 0 ? (
            <ul className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-hidden sm:grid-cols-3">
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
            <ul className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {items.map((gif) => (
                <li key={gif.id}>
                  <button
                    type="button"
                    onClick={() => {
                      // Dimensions travel with the reference: every surface that
                      // renders it reserves the real aspect ratio up front, so a
                      // GIF can never resize a post or message when it loads.
                      const picked = {
                        provider: 'giphy',
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
                    className="w-full overflow-hidden rounded-[var(--radius-sm)] border border-line text-left transition-all hover:border-accent/50 active:scale-[0.98]"
                    aria-label={gif.title ? `Attach GIF: ${gif.title}` : 'Attach GIF'}
                  >
                    {/* Validated GIPHY preview (lib/giphy); the full GIF is only
                        fetched once it is actually attached. */}
                    <Image
                      src={gif.preview || gif.url}
                      alt={gif.title || ''}
                      width={200}
                      height={96}
                      unoptimized
                      className="h-24 w-full bg-surface-2 object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {attribution ? (
            <p className="mt-3 text-2xs text-muted">
              Powered by{' '}
              <a href={attribution.providerUrl} target="_blank" rel="noreferrer noopener" className="underline">
                {attribution.provider}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders a stored GIF ref. Only validated GIPHY URLs reach the database.
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
