'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/icons';
import { VerifyBadge } from '@/components/timetable/EventText';
import { CAMPUS_TIME_ZONE, defaultTimetableDay, getCampusTime, resolveDaySelection, timetableDayFor } from '@/lib/timetable/clock';
import { getDayStatus } from '@/lib/timetable/schedule';
import { sessionScrollBehavior, shouldScrollToSession } from '@/lib/timetable/scroll';
import { TIMETABLE_SOURCE } from '@/lib/timetable/meta';

/**
 * The live half of a division timetable.
 *
 * Since this has to know the time, it is the one client component on the
 * page — and it owns the only timer: one `setInterval` for the clock, cleared
 * on unmount. Everything time-dependent (which weekday opens, the NOW/NEXT
 * status, the date) is derived from `Asia/Kolkata`, so the schedule never
 * disagrees with the institute's wall clock, and it keeps moving while the
 * page stays open: at a period boundary the NOW badge moves to the next
 * session on its own.
 *
 * The initial values arrive from the server (`initialNow` as an ISO instant,
 * `initialDay` already resolved in the campus timezone), so the server HTML
 * and the first client render are identical — no hydration mismatch and no
 * flash of Monday before the real day appears.
 *
 * `offlineSlot` is the one thing the offline feature adds here: an optional
 * node rendered in the header row, under the clock, where a status can live
 * without covering the timetable. The live page and the offline shell both
 * pass the same pill; every other caller passes nothing and renders exactly as
 * before.
 */

const DAY_SHORT = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
};

function subjectLabel(event) {
  if (!event) return '';
  return event.subject || event.lines[0];
}

function nextSentence(status) {
  if (!status?.next) return ' No more classes today.';
  return ` Next: ${subjectLabel(status.next)} at ${status.next.time.fromLabel}.`;
}

/** One calm sentence that mirrors the NOW/NEXT badges in words. */
function describeStatus(status) {
  if (!status) return '';
  if (status.ongoing) {
    return `Now: ${subjectLabel(status.ongoing)} · ${status.ongoing.time.label12}.${nextSentence(status)}`;
  }
  switch (status.phase) {
    case 'lunch':
      return `Lunch break until ${status.current.time.toLabel}.${nextSentence(status)}`;
    case 'special':
      return `${status.current.lines.join(' ')} until ${status.current.time.toLabel}.${nextSentence(status)}`;
    case 'free':
      return `Free period until ${status.currentFree.toLabel}.${nextSentence(status)}`;
    case 'before':
      return `First class at ${status.first.time.fromLabel}.`;
    case 'gap':
      return status.next ? `Next class: ${subjectLabel(status.next)} at ${status.next.time.fromLabel}.` : 'No more classes today.';
    case 'after':
      return 'No more classes today.';
    case 'empty':
      return 'No classes are printed for this day.';
    default:
      return '';
  }
}

function EventRow({ event, ongoing, next, itemRef }) {
  const subject = event.kind === 'special' ? event.lines.join(' ') : event.lines[0];
  const meta = event.kind === 'lunch' || event.kind === 'special' ? [] : event.lines.slice(1);

  return (
    <li
      ref={itemRef}
      data-state={ongoing ? 'now' : next ? 'next' : undefined}
      className={[
        'tt-item',
        `tt-item--${event.kind}`,
        ongoing ? 'tt-item--now' : '',
        next ? 'tt-item--next' : '',
        event.needsVerification ? 'tt-item--flagged' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        event.kind === 'standard' || event.kind === 'batch'
          ? { '--tt-accent': `var(--tt-hue-${event.accent})` }
          : undefined
      }
    >
      <div className="tt-item__time">
        <span className="tt-item__from">{event.time.fromLabel}</span>
        <span className="tt-item__to">{event.time.toLabel}</span>
        {event.span > 1 ? <span className="tt-item__span">{event.span} periods</span> : null}
      </div>

      <div className="tt-item__body">
        <div className="tt-item__head">
          <span className="tt-item__dot" aria-hidden="true" />
          {event.kind === 'lunch' ? (
            <span className="tt-item__subject tt-item__subject--label">
              <Icon name="utensils" size={13} aria-hidden="true" />
              {subject}
            </span>
          ) : (
            <span className="tt-item__subject">{subject}</span>
          )}
          {event.kind === 'batch' ? <span className="tt-tag">Batches</span> : null}
          {event.needsVerification ? <VerifyBadge /> : null}
          {ongoing ? <span className="tt-badge tt-badge--now">NOW</span> : null}
          {next ? <span className="tt-badge tt-badge--next">NEXT</span> : null}
        </div>

        {meta.map((line, index) => (
          <span key={`${index}-${line}`} className="tt-item__meta">
            {line}
          </span>
        ))}
      </div>
    </li>
  );
}

function FreeRow({ range }) {
  return (
    <li className="tt-item tt-item--free">
      <div className="tt-item__time">
        <span className="tt-item__from">{range.fromLabel}</span>
        <span className="tt-item__to">{range.toLabel}</span>
        {range.endIndex > range.startIndex ? (
          <span className="tt-item__span">{range.endIndex - range.startIndex + 1} periods</span>
        ) : null}
      </div>
      <div className="tt-item__body">
        <div className="tt-item__head">
          <span className="tt-item__dot" aria-hidden="true" />
          <span className="tt-item__subject">Free</span>
        </div>
        <span className="tt-item__meta">No class printed in this slot</span>
      </div>
    </li>
  );
}

export default function TimetableLive({
  division,
  label,
  friendly,
  days,
  subjects,
  initialDay,
  initialPinned = false,
  initialNow,
  offlineSlot = null,
  children,
}) {
  const [now, setNow] = useState(() => new Date(initialNow));
  // Always a weekday: the page passes one, and a caller that passes nothing
  // still gets the weekend preview rather than an empty page.
  const [selected, setSelected] = useState(initialDay ?? defaultTimetableDay(null));
  const pinnedRef = useRef(Boolean(initialPinned));
  const ongoingRef = useRef(null);
  const nextRef = useRef(null);
  const didAutoScrollRef = useRef(false);

  // The one timer. Recreated only on mount; always cleared on unmount.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parts = useMemo(() => getCampusTime(now), [now]);
  const today = timetableDayFor(parts.weekday);

  // Follow the institute's weekday — across midnight and into/out of the
  // weekend — unless the visitor has chosen a day themselves. Out of term hours
  // on a Saturday or Sunday there is no weekday to follow, so the selection
  // falls back to Monday (`resolveDaySelection` → `defaultTimetableDay`), which
  // is a preview: `isToday` stays false because `today` is null.
  useEffect(() => {
    setSelected((previous) => resolveDaySelection({ selected: previous, pinned: pinnedRef.current, today }));
  }, [today]);

  const day = selected ? days.find((entry) => entry.day === selected) ?? null : null;
  const isToday = Boolean(selected && selected === today);

  const status = useMemo(
    () =>
      day
        ? getDayStatus({
            events: day.events,
            freeRanges: day.freeRanges,
            nowMinutes: parts.minutesOfDay,
            isToday,
          })
        : null,
    [day, parts.minutesOfDay, isToday],
  );

  const entries = useMemo(() => {
    if (!day) return [];
    return [
      ...day.events.map((event) => ({ key: `event-${event.id}`, startIndex: event.start, event })),
      ...day.freeRanges.map((range) => ({ key: `free-${range.startIndex}`, startIndex: range.startIndex, range })),
    ].sort((a, b) => a.startIndex - b.startIndex);
  }, [day]);

  function syncUrl(nextDay) {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (nextDay) url.searchParams.set('day', nextDay);
    else url.searchParams.delete('day');
    // Search params only: keep the App Router state, skip a server round trip.
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  // Choosing a day pins it. Choosing *today* is not a preference — it is
  // following the calendar — so it keeps no `day` parameter and the page
  // moves on by itself when the weekday changes.
  function chooseDay(name) {
    const pin = name !== today;
    pinnedRef.current = pin;
    setSelected(name);
    syncUrl(pin ? name : null);
  }

  function showToday() {
    pinnedRef.current = false;
    setSelected(defaultTimetableDay(today));
    syncUrl(null);
  }

  // A URL that names today (or that was normalised on the server) should not
  // keep claiming a pinned day. Clean it once, after hydration, without a
  // navigation.
  useEffect(() => {
    if (pinnedRef.current) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('day')) return;
    url.searchParams.delete('day');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // Bring the session that matters into view, once per page view. It runs
  // after layout (two frames), never on the clock tick, and does nothing if
  // the session is already fully on screen or the selected day is not today.
  useEffect(() => {
    if (didAutoScrollRef.current || !isToday) return undefined;
    const target = ongoingRef.current || nextRef.current;
    if (!target) return undefined;

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        didAutoScrollRef.current = true;
        const rect = target.getBoundingClientRect();
        if (!shouldScrollToSession(rect, window.innerHeight)) return;
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        target.scrollIntoView({ block: 'center', behavior: sessionScrollBehavior(reducedMotion) });
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isToday, status?.ongoing?.id, status?.next?.id]);

  // Another weekday is a preview, not a live claim: name its first academic
  // session in words instead of borrowing the NOW/NEXT badges. At the weekend
  // the preview is the whole page, so the note says why Monday is on screen.
  let dayNote = null;
  if (!day) dayNote = null;
  else if (!today) dayNote = `It’s the weekend — showing ${selected}’s timetable.`;
  else if (selected !== today) {
    dayNote = status?.first
      ? `Not today — ${selected}’s first class is ${status.first.lines[0]} at ${status.first.time.fromLabel}.`
      : 'Not today.';
  }

  return (
    <div className="tt-live">
      <header className="tt-head">
        <div className="tt-head__intro">
          <p className="t-label">
            {TIMETABLE_SOURCE.department} · {TIMETABLE_SOURCE.semester} · {TIMETABLE_SOURCE.academicYear}
          </p>
          <h1 className="t-display mt-2">Division {division}</h1>
          <p className="t-secondary mt-2">
            {label}
            {friendly ? ` · ${friendly}` : ''}
          </p>
        </div>

        <div className="tt-clock">
          <span className="tt-clock__time">
            <time dateTime={parts.iso}>
              {parts.hourMinute12}
              <span className="tt-clock__seconds">:{parts.secondLabel}</span>
              <span className="tt-clock__meridiem">{parts.meridiem}</span>
            </time>
          </span>
          <span className="tt-clock__date">{parts.dateLabel}</span>
          <span className="tt-clock__zone">IST · {CAMPUS_TIME_ZONE}</span>
        </div>

        {offlineSlot}
      </header>

      <p className="tt-help">
        How to read practicals: an entry like <span className="text-ink-soft">EG-1/ENG-2/FES-3</span> means the three
        batches are in different rooms at the same time — the [faculty] and [room] lists below it follow the same batch
        order. Lunch is wherever this division’s row puts it. All times are the institute’s, {CAMPUS_TIME_ZONE}.
      </p>

      <div className="tt-tabsbar">
        <div className="tt-tabs" role="group" aria-label="Choose a weekday">
          {days.map(({ day: name }) => {
            const isRealToday = today === name;
            return (
              <button
                key={name}
                type="button"
                className="tt-tab"
                aria-pressed={selected === name}
                aria-label={isRealToday ? `${name}, today` : name}
                onClick={() => chooseDay(name)}
              >
                {DAY_SHORT[name] ?? name}
                {isRealToday ? <span className="tt-tab__today" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>

        {today && selected !== today ? (
          <button type="button" className="tt-jump" onClick={showToday}>
            <Icon name="calendar" size={14} aria-hidden="true" />
            Today
          </button>
        ) : null}
      </div>

      <div className="tt-dayhead">
        <h2 className="tt-dayhead__title">{selected}</h2>
        {isToday ? <span className="tt-dayhead__today">Today</span> : null}
        {dayNote ? <p className="tt-dayhead__note">{dayNote}</p> : null}
      </div>

      {isToday && status ? (
        <p className="tt-status" role="status">
          {describeStatus(status)}
        </p>
      ) : null}

      {day ? (
        <ol className="tt-day" aria-label={`${selected} timetable for Division ${division}`}>
          {entries.map((entry) =>
            entry.event ? (
              <EventRow
                key={entry.key}
                event={entry.event}
                ongoing={status?.ongoing?.id === entry.event.id}
                next={status?.next?.id === entry.event.id}
                itemRef={
                  status?.ongoing?.id === entry.event.id
                    ? ongoingRef
                    : status?.next?.id === entry.event.id
                      ? nextRef
                      : undefined
                }
              />
            ) : (
              <FreeRow key={entry.key} range={entry.range} />
            ),
          )}
        </ol>
      ) : null}

      {selected && subjects.length ? (
        <ul className="tt-legend" aria-label="Subject colours">
          {subjects.map(({ code, accent }) => (
            <li key={code}>
              <span className="tt-legend__dot" style={{ backgroundColor: `var(--tt-hue-${accent})` }} aria-hidden="true" />
              {code}
            </li>
          ))}
          <li>
            <span className="tt-legend__dot tt-legend__dot--lunch" aria-hidden="true" />
            Lunch
          </li>
          <li>
            <span className="tt-legend__dot tt-legend__dot--special" aria-hidden="true" />
            Empowerment Hour
          </li>
        </ul>
      ) : null}

      {children}
    </div>
  );
}
