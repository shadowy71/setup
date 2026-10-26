'use client';

/**
 * Live reconciliation for a server-rendered post board.
 *
 * Home keeps its feed in client state and re-reads it itself. Every other post
 * surface — a community, a club, a profile's posts, Explore's trending column — is
 * rendered on the server, so the thing that goes stale there is the *rendered
 * page*, not a store. This component is the whole bridge: it renders nothing, owns
 * no data, and on a feed change asks the Router Cache for the current route to be
 * re-read once.
 *
 * Two rules it exists to respect:
 *
 *   - Scroll and view state survive. `router.refresh()` re-renders the current
 *     route in place; the URL, any open tab and the scroll offset stay where the
 *     reader left them. Nothing navigates and nothing is remounted under it.
 *   - One refresh per burst, however busy the campus is. A page-level throttle
 *     keeps this from turning into a refetch loop the way a per-card subscription
 *     would; a change this tab caused itself (a publish, a delete) is applied
 *     immediately instead, because that is the moment latency is visible.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveFeed } from '@/components/layout/LiveFeedProvider';

/** Minimum gap between two server re-reads triggered by other people's posts. */
export const FEED_SYNC_THROTTLE_MS = 4_000;

const IMMEDIATE_REASONS = ['local', 'reconcile', 'reconnect'];

export function LiveFeedSync() {
  const router = useRouter();
  const feed = useLiveFeed();
  const lastRunRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    const run = () => {
      lastRunRef.current = Date.now();
      router.refresh();
    };

    const unsubscribe = feed.subscribe((event) => {
      if (IMMEDIATE_REASONS.includes(event?.reason)) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        run();
        return;
      }
      const wait = FEED_SYNC_THROTTLE_MS - (Date.now() - lastRunRef.current);
      if (wait <= 0) {
        run();
        return;
      }
      if (timerRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        run();
      }, wait);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [feed, router]);

  return null;
}
