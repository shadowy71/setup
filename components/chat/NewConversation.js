'use client';

/**
 * Start a direct conversation (spec §21: anyone can message anyone — no friend
 * requests). People search reuses the one search system (`/api/search`,
 * scope=people), so blocks and privacy rules apply identically everywhere.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, IdentityMark, Input, Notice } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import { startConversation } from '@/lib/actions/messaging';
import { ROUTES } from '@/lib/constants';

export function NewConversation({ canMessage = true }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const start = useFormAction(startConversation, { redirectTo: (result) => result.href || ROUTES.chat });

  const term = query.trim();
  const tooShort = term.length < 2;
  const visibleResults = tooShort ? [] : results;

  useEffect(() => {
    if (!open || tooShort) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}&scope=people&limit=8`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || 'Search failed.');
        const group = (payload.groups || []).find((item) => item.scope === 'people');
        setResults(group?.items || []);
      } catch (thrown) {
        setError(thrown.message || 'Search failed.');
      } finally {
        setSearching(false);
      }
    }, 320);
    return () => clearTimeout(timer.current);
  }, [term, open, tooShort]);

  if (!canMessage) return null;

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="t-card">Messages</p>
        <Button size="sm" variant={open ? 'ghost' : 'secondary'} icon="plus" onClick={() => setOpen((value) => !value)}>
          {open ? 'Close' : 'New message'}
        </Button>
      </div>

      {open ? (
        <div className="mt-3 flex flex-col gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search students by name or @username"
            aria-label="Search students"
          />
          {searching ? <p className="text-2xs text-muted">Searching…</p> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {!tooShort && !searching && !visibleResults.length && !error ? (
            <p className="text-2xs text-muted">No students found.</p>
          ) : null}
          {visibleResults.length ? (
            <ul className="divide-y divide-line">
              {visibleResults.map((person) => (
                <li key={person.id} className="flex items-center justify-between gap-3 py-2">
                  <IdentityMark name={person.subtitle || person.title} username={person.title} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate text-[0.8125rem] font-medium">{person.title}</span>
                    {person.subtitle ? <span className="block truncate text-2xs text-muted">{person.subtitle}</span> : null}
                  </span>
                  <form
                    action={(formData) => {
                      formData.set('profile_id', person.id);
                      start.run(formData);
                    }}
                  >
                    <Button type="submit" size="sm" icon="send" disabled={start.pending}>
                      Message
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
          {start.error ? <Notice tone="danger">{start.error}</Notice> : null}
        </div>
      ) : null}
    </div>
  );
}
