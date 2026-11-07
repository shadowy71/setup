'use client';

/**
 * Campus+ search field — the supplied soft-blue pill, scoped and themed.
 *
 * The source's nested pill: a pale blue gradient frame around a lighter
 * gradient field, an offset highlight/glow edge pair behind it, and a round
 * white magnifier button that closes the pill. Adapted to the Campus+ system:
 * classes are scoped (`search-pill*`, never `.container`/`.input`), the
 * palette follows both themes, and it is a real form with a real submit
 * button — keyboard, screen readers and mobile behave normally.
 *
 * Search behaviour is untouched: the field hands the query to Explore, which
 * owns the `global_search()` surface.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

/** The supplied magnifier glyph. */
const SEARCH_PATH =
  'M21.53 20.47l-3.66-3.66C19.195 15.24 20 13.214 20 11c0-4.97-4.03-9-9-9s-9 4.03-9 9 4.03 9 9 9c2.215 0 4.24-.804 5.808-2.13l3.66 3.66c.147.146.34.22.53.22s.385-.073.53-.22c.295-.293.295-.767.002-1.06zM3.5 11c0-4.135 3.365-7.5 7.5-7.5s7.5 3.365 7.5 7.5-3.365 7.5-7.5 7.5-7.5-3.365-7.5-7.5z';

export function SearchField({
  initialQuery = '',
  autoFocus = false,
  hint = 'People, posts, communities, events, listings…',
  className = '',
  size = 'md',
  shortcut = false,
  label = 'Search Campus+',
  // Controlled mode: the results page owns live search state and submits
  // nothing automatically — pass `value` + `onChange`, and `onSubmit` if the
  // pill's button should trigger an action.
  value = null,
  onChange = null,
  onSubmit = null,
  onNavigate = null,
}) {
  const router = useRouter();
  const [internal, setInternal] = useState(initialQuery);
  const controlled = value !== null;
  const shown = controlled ? value : internal;
  const inputRef = useRef(null);

  // "/" focuses the field from anywhere on the page; Escape clears it.
  useEffect(() => {
    if (!shortcut) return undefined;
    const onKey = (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut]);

  const update = (next) => {
    if (controlled) onChange?.(next);
    else setInternal(next);
  };

  const submit = (event) => {
    event.preventDefault();
    const query = shown.trim();
    if (controlled) {
      if (query.length >= 2) onSubmit?.(query);
      return;
    }
    if (query.length >= 2) {
      router.push(`/explore?q=${encodeURIComponent(query)}`);
      onNavigate?.(query);
    }
  };

  return (
    <form role="search" className={cn('search-pill', className)} data-size={size} onSubmit={submit}>
      <div className="search-pill__shell">
        <input
          ref={inputRef}
          type="search"
          className="search-pill__input"
          value={shown}
          onChange={(event) => update(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') update('');
          }}
          placeholder={hint}
          aria-label={label}
          autoFocus={autoFocus}
          enterKeyHint="search"
        />
        <button type="submit" className="search-pill__icon" aria-label="Search">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d={SEARCH_PATH} />
          </svg>
        </button>
      </div>
    </form>
  );
}
