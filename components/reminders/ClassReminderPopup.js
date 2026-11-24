'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/icons';
import { getCampusTime } from '@/lib/timetable/clock';
import { addDaysToDateKey, getDueReminders, istDateKeyToUtc } from '@/lib/reminders/reminders';
import { claimReminder, listenReminderSignals, reminderKey } from '@/lib/reminders/browser';

const REFRESH_MS = 60 * 1000;

/** One controller inside the authenticated frame. Data always comes from the session API. */
export function ClassReminderPopup({ profileId }) {
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    let alive = true;
    let generation = 0;
    let requestId = 0;
    let schedule = null;
    let currentItem = null;
    let checking = false;
    let paused = false;
    let timers = [];
    const shown = new Set();

    function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
    }
    function clear() {
      generation += 1;
      schedule = null;
      currentItem = null;
      clearTimers();
      if (alive) setCurrent(null);
    }
    function today() { return getCampusTime(new Date()).dateKey; }
    function validSchedule() { return schedule?.eligible && schedule.dateKey === today(); }

    async function checkDue() {
      if (!alive || paused || checking || document.hidden || !validSchedule() || currentItem) return;
      checking = true;
      const version = generation;
      try {
        for (const item of getDueReminders(schedule.reminders, new Date())) {
          const key = reminderKey(profileId, item);
          if (shown.has(key)) continue;
          const claimed = await claimReminder(key);
          if (!alive || version !== generation || document.hidden || !validSchedule()) return;
          shown.add(key);
          if (!claimed) continue;
          if (Date.now() >= Date.parse(item.class_start_at)) continue;
          currentItem = item;
          setCurrent({ ...item, late: Date.now() - Date.parse(item.reminder_at) > 5000 });
          return;
        }
      } finally {
        checking = false;
        if (alive && version !== generation) void checkDue();
      }
    }

    function reconcile() {
      clearTimers();
      if (!alive) return;
      const now = Date.now();
      if (schedule && schedule.dateKey !== today()) clear();
      if (validSchedule()) {
        for (const item of schedule.reminders) {
          const fireAt = Date.parse(item.reminder_at);
          const startAt = Date.parse(item.class_start_at);
          if (Number.isFinite(fireAt) && Number.isFinite(startAt) && fireAt > now && startAt > now) {
            timers.push(setTimeout(() => { reconcile(); }, fireAt - now));
          }
        }
        if (currentItem && now >= Date.parse(currentItem.class_start_at)) {
          currentItem = null;
          setCurrent(null);
        }
        void checkDue();
      }
      const midnight = istDateKeyToUtc(addDaysToDateKey(today(), 1), 0)?.getTime();
      if (midnight > now) timers.push(setTimeout(() => { clear(); void refresh(); }, midnight - now + 50));
    }

    async function refresh() {
      if (paused) return;
      const request = ++requestId;
      if (schedule && schedule.dateKey !== today()) clear();
      try {
        const response = await fetch('/api/reminders/me', { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!alive || request !== requestId) return;
        if (response.status === 401 || response.status === 403) { clear(); return; }
        if (!response.ok) { reconcile(); return; }
        const data = await response.json();
        if (!alive || request !== requestId) return;
        if (!data?.ok || data.profileId !== profileId || data.dateKey !== today() || !data.eligible) {
          clear();
          reconcile();
          return;
        }
        const reminders = Array.isArray(data.reminders)
          ? data.reminders.filter((item) => item.event_date === data.dateKey && item.division === data.division)
          : [];
        const next = { eligible: true, dateKey: data.dateKey, division: data.division, reminders };
        if (JSON.stringify(schedule) !== JSON.stringify(next)) generation += 1;
        schedule = next;
        if (currentItem && !reminders.some((item) => item.event_key === currentItem.event_key && item.division === currentItem.division && item.class_start_at === currentItem.class_start_at)) {
          currentItem = null;
          setCurrent(null);
        }
        reconcile();
      } catch {
        // Keep only an already authenticated, same-day schedule while offline.
        if (alive && request === requestId) reconcile();
      }
    }

    const onDismiss = () => { currentItem = null; reconcile(); };
    window.addEventListener('campusplus:reminder-dismiss', onDismiss);
    const wake = () => { if (!document.hidden) void refresh(); };
    const onSignal = (message) => {
      if (!message || (message.profileId && message.profileId !== profileId)) return;
      if (message.type === 'disabled' || message.type === 'signout') paused = true;
      if (message.type === 'changed') paused = false;
      if (message.type === 'disabled' || message.type === 'signout' || message.type === 'changed') {
        requestId += 1;
        clear();
      }
      if (message.type !== 'signout' && message.type !== 'disabled') void refresh();
    };
    const unlisten = listenReminderSignals(onSignal);
    window.addEventListener('focus', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    const interval = setInterval(() => { if (!document.hidden) void refresh(); }, REFRESH_MS);
    void refresh();
    return () => {
      alive = false;
      generation += 1;
      requestId += 1;
      clearTimers();
      clearInterval(interval);
      unlisten();
      window.removeEventListener('campusplus:reminder-dismiss', onDismiss);
      window.removeEventListener('focus', wake);
      window.removeEventListener('pageshow', wake);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [profileId]);

  // Dismissal emits a local event so the controller can display any other due class.
  function dismiss() {
    setCurrent(null);
    window.dispatchEvent(new CustomEvent('campusplus:reminder-dismiss'));
  }

  if (!current) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[70] flex justify-center px-4 lg:bottom-6">
      <div role="status" className="pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 shadow-lg">
        <Icon name="calendar" size={16} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-semibold">{current.late ? 'Class starts soon' : 'Class starts in 10 minutes'}</p>
          <p className="text-[0.8125rem] text-muted">
            {current.subject || 'Class'}{current.start_label ? ` · ${current.start_label}` : current.time_label ? ` · ${current.time_label}` : ''}
            {current.location ? ` · ${current.location}` : ''}
          </p>
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss class reminder" className="shrink-0 rounded-md p-1 text-muted hover:text-ink">
          <Icon name="close" size={14} aria-hidden="true" />
        </button>
      </div>
    </div>, document.body,
  );
}
