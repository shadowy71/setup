'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SEARCH_SCOPES } from '@/lib/constants';
import { Badge, Button, EmptyState, Notice, SkeletonList, WordLoader } from '@/components/ui';
import { SearchField } from '@/components/ui/SearchField';
import { Icon } from '@/components/ui/icons';

/**
 * Unified search.
 *
 * Calls the same `global_search` PostgreSQL function the rest of the product
 * uses — Postgres-native, RLS-scoped, block-aware. Nothing is filtered in the
 * browser and there is no second search engine.
 *
 * URL state
 * ---------
 * The query and scope live in the address (`/explore?q=robotics&scope=projects`)
 * so a result page can be bookmarked, shared and restored by Back/Forward. The
 * URL is written with `history.replaceState` — a keystroke must not push a
 * history entry, and it must not re-render the server page either; the address
 * mirrors the search, it does not drive it.
 *
 * Pagination
 * ----------
 * The API reports `hasMore`, computed from a page-size + 1 probe row. The client
 * asks for the next offset, merges rows without duplicating an id, and resets
 * everything when the query or scope changes. A slow response for an old query
 * can never overwrite a newer one (monotonic request id).
 */

const PAGE_SIZE = 20;

/** Write q/scope into the address bar without adding a history entry. */
function syncAddress(term, scope) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (term) params.set('q', term);
  else params.delete('q');
  if (scope && scope !== 'all') params.set('scope', scope);
  else params.delete('scope');
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ''}`;
  if (next !== `${window.location.pathname}${window.location.search}`) {
    window.history.replaceState(window.history.state, '', next);
  }
}

/** Read q/scope from the address bar (used by Back/Forward and remounts). */
function readAddress() {
  if (typeof window === 'undefined') return { q: '', scope: 'all' };
  const params = new URLSearchParams(window.location.search);
  return {
    q: (params.get('q') || '').slice(0, 80),
    scope: params.get('scope') || 'all',
  };
}

export function SearchResults({ initialQuery = '', initialScope = 'all' }) {
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState(initialScope);
  const [groups, setGroups] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  // Which (term, scope) the rows in `groups` belong to. Results are shown only
  // when that matches the box, so clearing or retyping hides stale rows by
  // derivation — no render-phase side effects, no effect that resets state.
  const [resultsFor, setResultsFor] = useState({ term: initialQuery.trim(), scope: initialScope });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const offset = useRef(0);
  const debounce = useRef(null);
  const requestId = useRef(0);

  const run = useCallback(async (term, activeScope, nextOffset = 0) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setResultsFor({ term, scope: activeScope });
    try {
      const params = new URLSearchParams({
        q: term,
        scope: activeScope,
        offset: String(nextOffset),
        limit: String(PAGE_SIZE),
      });
      const response = await fetch(`/api/search?${params.toString()}`);
      const payload = await response.json();
      if (id !== requestId.current) return; // a newer search owns the panel
      if (!response.ok) throw new Error(payload?.error || 'Search is unavailable right now.');
      offset.current = nextOffset;
      setHasMore(Boolean(payload.hasMore));
      setGroups((current) => (nextOffset === 0 ? payload.groups || [] : mergeGroups(current, payload.groups || [])));
    } catch (thrown) {
      if (id === requestId.current) {
        setError(thrown.message);
        setHasMore(false);
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  const trimmed = query.trim();
  const tooShort = trimmed.length < 2;

  // Debounced search. Every new term starts at offset 0 and replaces the list;
  // the URL follows once the term is settled.
  useEffect(() => {
    if (tooShort) return undefined;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      offset.current = 0;
      setHasMore(false);
      run(trimmed, scope, 0);
      syncAddress(trimmed, scope);
    }, 320);
    return () => clearTimeout(debounce.current);
  }, [trimmed, tooShort, scope, run]);

  // Back/Forward (and an address edited by hand) restores the search in place.
  useEffect(() => {
    const onPop = () => {
      const next = readAddress();
      setQuery(next.q);
      setScope(next.scope);
      if (next.q.trim().length < 2) {
        setGroups([]);
        setHasMore(false);
        setError(null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // A row set is only shown when it belongs to the term and scope in the box.
  const fresh = !tooShort && resultsFor.term === trimmed && resultsFor.scope === scope;
  const visibleGroups = fresh ? groups : [];
  const hasResults = visibleGroups.some((group) => group.items?.length);
  const shown = visibleGroups.reduce((count, group) => count + (group.items?.length || 0), 0);
  const canLoadMore = fresh && hasMore;

  // Clearing the box clears the address immediately (an event handler, not a
  // render), while the rows disappear by derivation above.
  const onChange = (value) => {
    setQuery(value);
    if (value.trim().length < 2) {
      requestId.current += 1; // a pending search for the old term must not land
      syncAddress('', scope);
    }
  };

  const loadMore = () => {
    const next = offset.current + PAGE_SIZE;
    setLoading(true);
    run(trimmed, scope, next);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <SearchField
          value={query}
          onChange={onChange}
          onSubmit={(term) => {
            clearTimeout(debounce.current);
            offset.current = 0;
            run(term.trim(), scope, 0);
            syncAddress(term.trim(), scope);
          }}
          hint="Search people, posts, communities, events, listings…"
          autoFocus
        />
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Search scope">
        {SEARCH_SCOPES.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={scope === item.value}
            onClick={() => setScope(item.value)}
            className="chip"
            data-active={scope === item.value}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* One live region for the whole surface: a screen reader hears the count
          change instead of discovering a silently rebuilt list. */}
      <p className="sr-only" role="status" aria-live="polite">
        {loading
          ? 'Searching'
          : tooShort
            ? ''
            : hasResults
              ? `${shown} result${shown === 1 ? '' : 's'} shown${canLoadMore ? ', more available' : ''}`
              : 'No results'}
      </p>

      {loading && !hasResults ? (
        <div className="flex flex-col gap-3">
          <WordLoader words={['people', 'posts', 'communities', 'listings', 'results']} />
          <SkeletonList rows={3} variant="rows" />
        </div>
      ) : null}

      {error ? (
        <Notice tone="danger" icon="flag">
          {error} Try again in a moment.
        </Notice>
      ) : null}

      {!loading && !tooShort && !hasResults && !error ? (
        <EmptyState icon="search" title="No matches" description="Try a different word, or a username without the @." />
      ) : null}

      {tooShort ? (
        <EmptyState
          icon="search"
          title="Search Campus+"
          description="People, posts, discussions, communities, events, listings, clubs, resources, opportunities, projects and study requests. Private messages are never searchable."
        />
      ) : null}

      {visibleGroups.map((group) =>
        group.items?.length ? (
          <section key={group.scope} aria-label={group.label} className="card overflow-hidden">
            <header className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
              <h2 className="t-label flex items-center gap-1.5">
                <Icon name={iconFor(group.scope)} size={13} />
                {group.label}
              </h2>
              <Badge>{group.items.length}</Badge>
            </header>
            <ul className="divide-y divide-line">
              {group.items.map((item) => (
                <li key={`${group.scope}-${item.id}`}>
                  <Link href={safeHref(item.url)} className="row-link hover:no-underline">
                    <span className="mt-0.5 shrink-0 text-muted-soft">
                      <Icon name={iconFor(group.scope)} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[0.875rem] font-semibold">{item.title || 'Untitled'}</span>
                        {item.meta?.is_official ? <Badge tone="accent">Official</Badge> : null}
                      </span>
                      {item.subtitle ? <span className="mt-0.5 block text-[0.8125rem] text-muted">{item.subtitle}</span> : null}
                      {item.snippet ? (
                        <span className="mt-0.5 block text-2xs text-muted-soft">{String(item.snippet).slice(0, 160)}</span>
                      ) : null}
                    </span>
                    <Icon name="chevronRight" size={14} className="mt-1 shrink-0 text-muted-soft" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}

      {canLoadMore && hasResults ? (
        <Button variant="secondary" size="sm" className="self-center" loading={loading} onClick={loadMore}>
          {loading ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}

      {fresh && !hasMore && hasResults && !loading ? (
        <p className="self-center text-2xs text-muted-soft">That is everything that matched.</p>
      ) : null}
    </div>
  );
}

/**
 * Merge a continuation page into the groups already on screen.
 *
 * Ids are deduplicated per scope: if a row moves between pages (new content
 * arriving mid-session), it is shown once rather than twice.
 */
function mergeGroups(current, incoming) {
  const byScope = new Map(current.map((group) => [group.scope, { ...group, items: [...(group.items || [])] }]));
  for (const group of incoming) {
    if (!byScope.has(group.scope)) {
      byScope.set(group.scope, { ...group, items: [...(group.items || [])] });
      continue;
    }
    const target = byScope.get(group.scope);
    const seen = new Set(target.items.map((item) => item.id));
    for (const item of group.items || []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      target.items.push(item);
    }
  }
  return [...byScope.values()];
}

/** Only relative Campus+ links are ever rendered from search results. */
function safeHref(url) {
  const value = String(url || '');
  return value.startsWith('/') ? value : '/explore';
}

function iconFor(scope) {
  switch (scope) {
    case 'people':
      return 'user';
    case 'communities':
    case 'clubs':
      return 'users';
    case 'marketplace':
      return 'tag';
    case 'events':
      return 'calendar';
    case 'resources':
      return 'book';
    case 'opportunities':
      return 'briefcase';
    case 'projects':
      return 'sparkle';
    case 'study':
      return 'book';
    default:
      return 'comment';
  }
}
