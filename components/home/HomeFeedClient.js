'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROUTES } from '@/lib/constants';
import { Button, EmptyState, Notice } from '@/components/ui';
import { PostComposer } from '@/components/posts/PostComposer';
import { IslandMotion } from '@/components/home/IslandMotion';
import { HomePulse, HomeZone } from '@/components/home/HomePulse';
import { StreamItem, StreamSlot } from '@/components/home/StreamItem';
import { HomeRail } from '@/components/home/HomeRail';
import { clearHomeFeedCache, readHomeFeedCache, writeHomeFeedCache } from '@/components/home/homeFeedCache';

function FeedSkeleton() {
  return (
    <div className="home-stream" role="status" aria-label="Loading campus feed">
      <span className="sr-only">Loading the latest campus posts.</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="stream-slot" aria-hidden="true">
          <div className="stream-card stream-card--post p-4">
            <div className="flex items-center gap-3">
              <span className="h-8 w-8 rounded-full bg-surface-2" />
              <span className="h-3 w-28 rounded bg-surface-2" />
            </div>
            <span className="mt-4 block h-3 w-full max-w-lg rounded bg-surface-2" />
            <span className="mt-2 block h-3 w-3/4 rounded bg-surface-2" />
            <span className="mt-5 block h-7 w-24 rounded-full bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function RailSkeleton() {
  return (
    <aside className="home-body__rail" aria-hidden="true">
      {[0, 1].map((row) => (
        <div key={row} className="card flex flex-col gap-3 p-4">
          <span className="h-3 w-24 rounded bg-surface-2" />
          <span className="h-3 w-full rounded bg-surface-2" />
          <span className="h-3 w-4/5 rounded bg-surface-2" />
        </div>
      ))}
    </aside>
  );
}

export function HomeFeedClient({
  user,
  userId,
  currentUserId,
  canPost,
  canModerate,
  beforeFeed = null,
  afterFeed = null,
  quickLinks = [],
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestRef = useRef(null);

  const refresh = useCallback(async (force = false) => {
    const cached = readHomeFeedCache(userId);
    if (!force && cached?.fresh) {
      setSnapshot(cached.payload);
      setLoading(false);
      setError(false);
      return cached.payload;
    }

    if (cached?.payload) setSnapshot(cached.payload);
    else setLoading(true);

    // Coalesce ordinary refreshes. A forced refresh (e.g. after posting) waits
    // for any earlier request, then fetches again so it cannot miss the new row.
    if (requestRef.current) {
      if (!force) return requestRef.current;
      await requestRef.current.catch(() => {});
    }

    const task = (async () => {
      try {
        const response = await fetch('/api/home/feed', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });

        if (response.status === 401) {
          clearHomeFeedCache(userId);
          setSnapshot(null);
          setError(true);
          router.replace('/login');
          return null;
        }
        if (response.status === 403) {
          clearHomeFeedCache(userId);
          setSnapshot(null);
          setError(true);
          router.refresh();
          return null;
        }
        if (!response.ok) throw new Error('Home feed request failed.');

        const payload = await response.json();
        if (!payload?.ok) throw new Error('Home feed response was invalid.');

        if (payload.unavailable) {
          const previous = readHomeFeedCache(userId);
          setSnapshot(previous?.payload
            ? { ...previous.payload, feedUnavailable: true }
            : { ...payload, feedUnavailable: true });
          setError(true);
          return null;
        }

        // The server returns newest-first. Replacing the cache with its first
        // ten entries inserts any new post and FIFO-evicts the oldest one.
        const next = writeHomeFeedCache(userId, payload);
        setSnapshot(next);
        setError(false);
        return next;
      } catch {
        const previous = readHomeFeedCache(userId);
        if (previous?.payload) {
          setSnapshot(previous.payload);
          setError(false);
        } else {
          setError(true);
        }
        return null;
      } finally {
        setLoading(false);
      }
    })();

    requestRef.current = task;
    try {
      return await task;
    } finally {
      if (requestRef.current === task) requestRef.current = null;
    }
  }, [router, userId]);

  useEffect(() => {
    const cached = readHomeFeedCache(userId);
    if (cached?.payload) {
      setSnapshot(cached.payload);
      setLoading(false);
    } else {
      setSnapshot(null);
      setLoading(true);
    }
    void refresh(false);

    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible') return;
      if (!readHomeFeedCache(userId)?.fresh) void refresh(false);
    };
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', refreshIfStale);
    return () => {
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [refresh, userId]);

  const feed = snapshot?.feed || [];
  const events = snapshot?.events || [];
  const notices = snapshot?.notices || [];
  const unavailable = Boolean(snapshot?.unavailable || snapshot?.feedUnavailable);
  const postItems = feed.filter((item) => ['post', 'discussion', 'poll'].includes(item.type));
  const posts = postItems.map((item) => item.post).filter(Boolean);
  const trending = posts
    .slice()
    .sort((a, b) => (b.reaction_count || 0) + (b.comment_count || 0) - ((a.reaction_count || 0) + (a.comment_count || 0)))
    .slice(0, 3);
  const marketplace = feed.filter((item) => ['listing', 'deal'].includes(item.type)).slice(0, 3);
  const stats = snapshot
    ? [
        { label: 'On the feed', value: feed.length },
        { label: 'Events ahead', value: events.length },
        { label: 'Notices pinned', value: notices.length },
        { label: 'Market listings', value: marketplace.length },
      ].filter((stat) => stat.value > 0)
    : [];

  return (
    <>
      <HomePulse user={user} stats={stats} />

      <IslandMotion>
        <div className="home-body">
          <div className="home-body__main">
            <div className="home-composer">
              <p className="home-composer__label">
                New on campus
                <span aria-hidden="true">·</span>
                <span className="text-muted-soft">Posts, discussions and polls</span>
              </p>
              {canPost ? (
                <PostComposer
                  authorName={user.profile.display_name || user.profile.username}
                  onCreated={() => { void refresh(true); }}
                />
              ) : (
                <Notice tone="neutral" icon="lock">
                  Your account cannot publish posts right now.
                </Notice>
              )}
            </div>

            {beforeFeed}

            {unavailable ? (
              <div className="flex flex-col items-start gap-2">
                <Notice tone="warning" icon="flag">
                  The feed is temporarily unavailable. {feed.length ? 'Showing the last cached entries.' : 'Try again shortly.'}
                </Notice>
                {error ? <Button variant="secondary" size="sm" onClick={() => { void refresh(true); }}>Try again</Button> : null}
              </div>
            ) : null}

            <section className="flex flex-col gap-4" aria-labelledby="home-stream-title">
              <HomeZone
                id="home-stream-title"
                eyebrow="Campus feed"
                title="What's moving right now"
                note="Ordered by the database, newest first — no ranking, no AI, no engagement theatre."
                aside={feed.length ? (
                  <span className="home-zone__count text-2xs text-muted">
                    {feed.length} {feed.length === 1 ? 'entry' : 'entries'}
                  </span>
                ) : null}
              />

              {snapshot && feed.length === 0 && !unavailable ? (
                <EmptyState
                  icon="sparkle"
                  title="Nothing on the feed yet"
                  description={canPost
                    ? 'The feed is genuinely empty right now. The composer above is the fastest way to start it — a question counts.'
                    : 'The feed is genuinely empty right now. Official notices and events from campus are still worth a look.'}
                  action={
                    <Link href="/campus/events" className="text-xs font-semibold text-accent-ink hover:underline">
                      See what&apos;s on this week →
                    </Link>
                  }
                />
              ) : null}

              {!snapshot && loading ? <FeedSkeleton /> : null}

              {feed.length ? (
                <div className="home-stream">
                  {feed.map((item) => {
                    const post = item.post || null;
                    return (
                      <StreamSlot key={`${item.type}-${item.id}`} kind={item.type}>
                        <StreamItem
                          item={item}
                          post={post}
                          currentUserId={currentUserId}
                          canModerate={canModerate}
                          reactions={{
                            count: post?.reaction_count || 0,
                            mine: Boolean(post?.reacted_by_me),
                          }}
                        />
                      </StreamSlot>
                    );
                  })}
                </div>
              ) : null}

              {!snapshot && !loading && error ? (
                <div className="flex flex-col items-start gap-2">
                  <Notice tone="warning" icon="flag">The campus feed could not be loaded.</Notice>
                  <Button variant="secondary" size="sm" onClick={() => { void refresh(true); }}>Try again</Button>
                </div>
              ) : null}

              {feed.length ? (
                <Link href={ROUTES.explore} className="self-start text-xs font-semibold text-accent-ink hover:underline">
                  More on Explore →
                </Link>
              ) : null}
            </section>

            {afterFeed}
          </div>

          {snapshot ? (
            <HomeRail events={events} notices={notices} trending={trending} marketplace={marketplace} quickLinks={quickLinks} />
          ) : (
            <RailSkeleton />
          )}
        </div>
      </IslandMotion>
    </>
  );
}
