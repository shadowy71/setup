'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

const UnreadNotificationsContext = createContext(0);
const REFRESH_COOLDOWN_MS = 20_000;

/**
 * Keep the authenticated shell out of the unread-count database round trip.
 * The server renders the shell immediately with count 0; this provider fetches
 * the real count after hydration and shares it between the header, menu, and
 * sidebar. Requests are private, throttled, and never persisted to storage.
 */
export function UnreadNotificationsProvider({ cacheKey, initialCount = 0, children }) {
  const pathname = usePathname();
  const [count, setCount] = useState(initialCount);
  const requestRef = useRef(null);
  const lastAttemptRef = useRef(0);

  const refresh = useCallback(async (force = false) => {
    if (!cacheKey) {
      setCount(0);
      return;
    }
    if (!force && Date.now() - lastAttemptRef.current < REFRESH_COOLDOWN_MS) return;
    if (requestRef.current) return requestRef.current;

    lastAttemptRef.current = Date.now();
    const task = (async () => {
      try {
        const response = await fetch('/api/notifications/unread-count', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (response.status === 401 || response.status === 403) {
          setCount(0);
          return;
        }
        if (!response.ok) return;

        const payload = await response.json();
        if (!payload?.ok || !Number.isFinite(payload.count)) return;
        setCount(Math.max(0, Math.floor(payload.count)));
      } catch {
        // The shell stays usable if the badge request fails; a later focus or
        // navigation can retry. Do not put a transient failure in the cache.
      }
    })();

    requestRef.current = task;
    try {
      await task;
    } finally {
      if (requestRef.current === task) requestRef.current = null;
    }
  }, [cacheKey]);

  useEffect(() => {
    // Initial unread count is fetched on mount; this is an external sync, not
    // derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(true);
    const refreshIfStale = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastAttemptRef.current >= REFRESH_COOLDOWN_MS) {
        void refresh(false);
      }
    };
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', refreshIfStale);
    return () => {
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', refreshIfStale);
    };
  }, [refresh]);

  // Route changes can follow actions that changed unread state. The cooldown
  // prevents this lightweight counter from becoming one query per navigation.
  useEffect(() => {
    // Route changes can change unread state; refresh the external counter once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(false);
  }, [pathname, refresh]);

  return (
    <UnreadNotificationsContext.Provider value={count}>
      {children}
    </UnreadNotificationsContext.Provider>
  );
}

export function useUnreadNotifications() {
  return useContext(UnreadNotificationsContext);
}
