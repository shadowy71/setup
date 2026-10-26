'use client';

/**
 * Shell-scoped live feed state.
 *
 * One private Realtime channel for the whole signed-in tab, owned here, fanned out
 * to whichever surface is mounted — the Home stream (which keeps its feed in
 * client state) and `LiveFeedSync` (which marks a server-rendered board for a
 * Router refresh). A feed card never subscribes to anything.
 *
 * The provider deliberately holds **no post data**. It turns Realtime rows, the
 * author's own confirmed write and a reconnect into a single signal: "the feed you
 * are showing is no longer what the database says". Every consumer then re-reads
 * through the shared `lib/data/feed.js` path, so nothing renders a shape the server
 * did not produce.
 *
 * Reuse notes: the channel/auth/reconnect discipline mirrors
 * `components/layout/MessagingProvider.js` — same `authenticateRealtime`, same
 * "exactly one channel" rule, same batch-then-flush shape, and the same graceful
 * degradation when Realtime is not reachable. The slow interval below runs *only*
 * while the channel is not live; a live feed is never polled.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authenticateRealtime, subscribeToFeedPosts } from '@/lib/social/realtime';
import { createFeedDeduper } from '@/lib/social/feed-state';

/** Realtime bursts (a mention-heavy post touches the feed once) collapse into one read. */
const EVENT_BATCH_MS = 450;
/** Gap recovery, and only while the channel is not live — same cadence as the
 * notification badge it sits beside, so nothing in the shell polls faster. */
const FALLBACK_INTERVAL_MS = 20_000;

const LiveFeedContext = createContext(null);

const noopFeed = {
  status: 'unconfigured',
  subscribe: () => () => {},
  invalidate: () => {},
  revision: () => 0,
};

export function useLiveFeed() {
  return useContext(LiveFeedContext) || noopFeed;
}

export function LiveFeedProvider({ userId, children }) {
  // A signed-out frame has no channel to wait for, and that is derived rather than
  // written into state from inside an effect.
  const [channelStatus, setChannelStatus] = useState('connecting');
  const status = userId ? channelStatus : 'signed-out';
  const statusRef = useRef(status);
  const listenersRef = useRef(new Set());
  const batchRef = useRef(null);
  const pendingIdsRef = useRef(new Set());
  // Stable per mount — one bounded seen-set for the tab, whatever the feed does.
  const [deduper] = useState(() => createFeedDeduper(500));
  const lastEventRef = useRef(0);
  // Bumped once per flushed invalidation. A surface that is not mounted right now
  // (Home, while the student is reading a community) still has to be able to tell
  // that its remembered page predates a post — that is what this counter is for.
  // Read through `revision()`, never through state, so a feed change cannot rerender
  // the whole shell.
  const [revisionBox] = useState(() => ({ value: 0 }));

  const writeStatus = useCallback((next) => {
    statusRef.current = next;
    setChannelStatus(next);
  }, []);

  const emit = useCallback((event) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch {
        // One surface failing to re-read must not stop the others, and must not
        // turn into an unhandled rejection inside a Realtime callback.
      }
    }
  }, []);

  /** Coalesce every invalidation source into a single flush. */
  const queue = useCallback((reason, ids = []) => {
    for (const id of ids) {
      if (id != null) pendingIdsRef.current.add(String(id));
    }
    if (batchRef.current) return;
    batchRef.current = setTimeout(() => {
      batchRef.current = null;
      const postIds = [...pendingIdsRef.current];
      pendingIdsRef.current = new Set();
      lastEventRef.current = Date.now();
      revisionBox.value += 1;
      emit({ reason, postIds, revision: revisionBox.value });
    }, EVENT_BATCH_MS);
  }, [emit, revisionBox]);

  useEffect(() => () => {
    if (batchRef.current) clearTimeout(batchRef.current);
    batchRef.current = null;
  }, []);

  const subscribe = useCallback((listener) => {
    if (typeof listener !== 'function') return () => {};
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  /**
   * Announce a feed change this tab caused (a successful publish, a delete, a
   * moderation action). The write is already committed by the time a caller may say
   * so, which is what makes an instant update honest rather than speculative:
   * `invalidate` never claims a post exists, it only asks surfaces to re-read.
   */
  const invalidate = useCallback((reason = 'local', ids = []) => {
    queue(reason, ids);
  }, [queue]);

  // One channel per signed-in profile. Remounting on a profile change is the only
  // way a stale subscription can follow a user from one account to the next, and
  // `key` on the provider makes that impossible.
  useEffect(() => {
    if (!userId) return undefined;

    let cancelled = false;
    let removeChannel = null;
    let authSubscription = null;
    let client = null;

    const onStatus = (next) => {
      if (cancelled) return;
      if (next === 'SUBSCRIBED') {
        writeStatus('live');
        // Replaying anything the channel missed while it was down, and forgetting
        // the ids seen before the gap, is what keeps a reconnect from silently
        // dropping a post that arrived mid-disconnect.
        deduper.clear();
        queue('reconcile');
        return;
      }
      if (next === 'CLOSED') {
        writeStatus('reconnecting');
        return;
      }
      writeStatus(next === 'CHANNEL_ERROR' || next === 'TIMED_OUT' ? 'reconnecting' : 'connecting');
    };

    const onPostChange = ({ eventType, postId }) => {
      if (cancelled) return;
      // A hard delete is not in the dedupe set yet even though its id was seen as
      // an update earlier, so the key carries the event kind.
      const key = `${eventType}:${postId}`;
      if (!deduper.remember(key)) return;
      queue(eventType === 'INSERT' ? 'created' : 'changed', [postId]);
    };

    (async () => {
      const { getBrowserClient } = await import('@/lib/supabase/client');
      client = getBrowserClient();
      if (!client) {
        if (!cancelled) writeStatus('unconfigured');
        return;
      }
      if (cancelled) return;

      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (cancelled) return;
        if (event === 'SIGNED_OUT') {
          removeChannel?.();
          removeChannel = null;
          deduper.clear();
          writeStatus('signed-out');
        } else if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session?.access_token) {
          void client.realtime.setAuth(session.access_token);
        }
      });
      authSubscription = data?.subscription || null;

      try {
        const authenticated = await authenticateRealtime(client);
        if (cancelled) return;
        if (!authenticated) {
          writeStatus('signed-out');
          return;
        }
        removeChannel = subscribeToFeedPosts(client, userId, { onPostChange, onStatus });
      } catch {
        if (!cancelled) writeStatus('reconnecting');
      }
    })();

    return () => {
      cancelled = true;
      removeChannel?.();
      authSubscription?.unsubscribe();
    };
  }, [deduper, queue, userId, writeStatus]);

  // Gap recovery while the channel is *not* live: the feed still converges, just
  // at a slower cadence, and a tab that never regains Realtime (a proxy that blocks
  // websockets, a project without the publication applied) is not left frozen.
  useEffect(() => {
    if (!userId) return undefined;

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (['live', 'signed-out', 'unconfigured'].includes(statusRef.current)) return;
      if (Date.now() - lastEventRef.current < FALLBACK_INTERVAL_MS) return;
      queue('fallback');
    };

    const interval = setInterval(tick, FALLBACK_INTERVAL_MS);
    const onOnline = () => queue('reconnect');
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [queue, userId]);

  const revision = useCallback(() => revisionBox.value, [revisionBox]);
  const value = useMemo(
    () => ({ status, subscribe, invalidate, revision }),
    [invalidate, revision, status, subscribe],
  );

  return <LiveFeedContext.Provider value={value}>{children}</LiveFeedContext.Provider>;
}
