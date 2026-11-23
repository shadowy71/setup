'use client';

/**
 * Subtle in-app class-reminder popup.
 *
 * Fires only while Campus+ is open and the tab is active, at the scheduled
 * reminder time (10 minutes before the class). It is dismissible and
 * non-blocking, and it never re-fires after every React render or route
 * navigation: shown reminders are tracked in an in-memory set (never
 * persisted — the preference and division are never stored in the browser).
 *
 * The schedule comes from `/api/reminders/me`, which derives the division
 * from the authenticated profile. The component polls it every minute and
 * on window focus, so a division or preference change made while the app
 * is open updates the locally scheduled popups too.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDueReminders } from '@/lib/reminders/reminders';
import { Icon } from '@/components/ui/icons';

const POLL_MS = 60 * 1000;

export function ClassReminderPopup({ initialReminders = [] }) {
  const [reminders, setReminders] = useState(initialReminders);
  const [current, setCurrent] = useState(null);
  const shownRef = useRef(new Set());
  const timersRef = useRef([]);

  const check = useCallback((list) => {
    const due = getDueReminders(list, new Date(), shownRef.current);
    if (due.length) {
      const next = due[0];
      shownRef.current.add(next.event_key);
      setCurrent(next);
    }
  }, []);

  const scheduleChecks = useCallback((list) => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
    for (const reminder of list) {
      const at = Date.parse(reminder.reminder_at);
      if (!Number.isFinite(at)) continue;
      const delay = at - Date.now();
      if (delay < 0) continue;
      // Cap the timer: browsers throttle long timers, and the poll below
      // is the backstop. Anything beyond 24h is picked up by the poll.
      if (delay > 24 * 60 * 60 * 1000) continue;
      timersRef.current.push(setTimeout(() => check(list), delay));
    }
  }, [check]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/reminders/me', { headers: { Accept: 'application/json' } });
      if (response.status === 401 || response.status === 403) {
        setReminders([]);
        setCurrent(null);
        scheduleChecks([]);
        return;
      }
      if (!response.ok) return;
      const data = await response.json();
      if (!data?.ok) return;
      const list = Array.isArray(data.reminders) ? data.reminders : [];
      setReminders(list);
      setCurrent((previous) => previous && list.some((item) => item.event_key === previous.event_key) ? previous : null);
      scheduleChecks(list);
      check(list);
    } catch {
      // Offline or transient: the last known schedule still fires while
      // the page is active. Nothing to do.
    }
  }, [check, scheduleChecks]);

  useEffect(() => {
    scheduleChecks(reminders);
    check(reminders);
    const interval = setInterval(refresh, POLL_MS);
    const onFocus = () => {
      if (!document.hidden) refresh();
    };
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const timer of timersRef.current) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = useCallback(() => {
    setCurrent(null);
    check(reminders);
  }, [check, reminders]);

  if (!current) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[70] flex justify-center px-4 lg:bottom-6">
      <div
        role="status"
        className="pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 shadow-lg"
      >
        <Icon name="calendar" size={16} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-semibold">Class in 10 minutes</p>
          <p className="truncate text-[0.8125rem] text-muted">
            {current.subject}
            {current.time_label ? ` · ${current.time_label}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss class reminder"
          className="shrink-0 rounded-md p-1 text-muted hover:text-ink"
        >
          <Icon name="close" size={14} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
