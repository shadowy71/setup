'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, Notice } from '@/components/ui';
import { PostCard } from '@/components/posts/PostCard';
import { StreamSlot } from '@/components/home/StreamItem';
import { useLiveFeed } from '@/components/layout/LiveFeedProvider';

/** A separate viewer-scoped page window: never mix discovery results into it. */
export function FollowingFeed({ currentUserId, canModerate }) {
  const [posts, setPosts] = useState([]);
  const [page, setPage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const sequence = useRef(0);
  const sentinel = useRef(null);
  const { subscribe } = useLiveFeed();

  const load = useCallback(async (offset = 0) => {
    const request = ++sequence.current;
    setBusy(true);
    setError(false);
    if (offset === 0) { setPosts([]); setPage(null); }
    try {
      const response = await fetch(`/api/home/feed?mode=following&offset=${offset}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Following feed unavailable');
      const payload = await response.json();
      if (!payload.ok || !Array.isArray(payload.posts) || !payload.page) throw new Error('Invalid feed');
      if (request !== sequence.current) return;
      setPosts((previous) => {
        const prior = offset ? previous : [];
        const seen = new Set(prior.map((post) => post.id));
        return [...prior, ...payload.posts.filter((post) => !seen.has(post.id))];
      });
      setPage(payload.page);
    } catch {
      if (request === sequence.current) setError(true);
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Load the authenticated page on mount and re-read on live changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('campus:follow-change', refresh);
    const unsubscribe = subscribe(refresh);
    return () => { sequence.current += 1; window.removeEventListener('campus:follow-change', refresh); unsubscribe(); };
  }, [load, subscribe]);

  // Keep the explicit button for keyboards and browsers without IntersectionObserver.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !page?.hasMore || busy || error || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void load(page.offset + page.limit);
      }
    }, { rootMargin: '200px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [busy, error, load, page]);

  return (
    <section className="flex flex-col gap-4" aria-label="Following feed" aria-busy={busy}>
      {busy && !page ? <p role="status" className="text-sm text-muted">Loading your Following feed…</p> : null}
      {error ? <div><Notice tone="warning" icon="flag">The Following feed could not be loaded.</Notice><Button variant="secondary" size="sm" onClick={() => { void load(page ? page.offset + page.limit : 0); }}>Try again</Button></div> : null}
      {page && !posts.length && !busy && !error ? (
        <EmptyState icon="sparkle" title="Your Following feed is empty." description="Follow students and discover what they're sharing on campus." action={<Link href="/explore" className="text-xs font-semibold text-accent-ink hover:underline">Explore →</Link>} />
      ) : null}
      <div className="home-stream">
        {posts.map((post, index) => (
          <StreamSlot key={post.id} kind={post.kind} order={index}>
            <PostCard variant="stream" post={{ ...post, following_by_me: true }} currentUserId={currentUserId} canModerate={canModerate} reactions={{ count: post.reaction_count || 0, mine: Boolean(post.reacted_by_me) }} poll={post.poll} />
          </StreamSlot>
        ))}
      </div>
      {page?.hasMore ? <div ref={sentinel} aria-hidden="true" /> : null}
      {page?.hasMore ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => { void load(page.offset + page.limit); }}>{busy ? 'Loading more…' : 'Show more'}</Button> : null}
    </section>
  );
}
