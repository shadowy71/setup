/**
 * Live class status — the pure half of the timetable page.
 *
 * Given one day's events and the current time in `Asia/Kolkata`, decide what
 * is happening now and what comes next. Kept free of React and of the
 * dataset so every rule below is unit-tested directly:
 *
 *   - intervals are half-open: `start <= now < end`, so at 11:00 the 10:00
 *     class is already over and the 11:10 one has not begun;
 *   - lunch, blank columns and the Empowerment Hour are never "now" or
 *     "next" as academic classes (an Empowerment Hour can still be the
 *     *covering* activity, shown with its own label);
 *   - a practical block is one event spanning its printed columns, so it is
 *     highlighted for its whole duration and never split into fragments;
 *   - next is strictly after now, so a session can never be both NOW and
 *     NEXT, and nothing before now can be offered as upcoming.
 */

import { parseMinutes } from '@/lib/timetable/clock';

/** Academic sessions are lectures and batch practicals — nothing else. */
export function isAcademicEvent(event) {
  return event.kind === 'standard' || event.kind === 'batch';
}

/** Real wall-clock bounds from the printed period times. */
export function eventBounds(event) {
  return {
    start: event.startMinutes ?? parseMinutes(event.time.from),
    end: event.endMinutes ?? parseMinutes(event.time.to),
  };
}

function byStart(a, b) {
  return eventBounds(a).start - eventBounds(b).start;
}

/**
 * @param {object} input
 * @param {Array} input.events       the day's events (lunch/free/special included)
 * @param {Array} input.freeRanges   blank printed columns, as time ranges
 * @param {number} input.nowMinutes  minutes since midnight in Asia/Kolkata
 * @param {boolean} input.isToday    whether the selected day is the real weekday
 */
export function getDayStatus({ events = [], freeRanges = [], nowMinutes = 0, isToday = false }) {
  const academic = events.filter(isAcademicEvent).sort(byStart);
  const first = academic[0] ?? null;
  const lastEnd = academic.reduce((end, event) => Math.max(end, eventBounds(event).end), -1);

  if (!isToday) {
    // Another weekday: show its schedule, but never claim it is happening.
    return { isToday: false, phase: 'other-day', ongoing: null, next: null, first, current: null, currentFree: null };
  }

  const bounds = events.map((event) => ({ event, ...eventBounds(event) }));
  const covering = bounds.find(({ start, end }) => start <= nowMinutes && nowMinutes < end) ?? null;
  const current = covering?.event ?? null;

  const ongoing =
    bounds.find(({ event, start, end }) => isAcademicEvent(event) && start <= nowMinutes && nowMinutes < end)
      ?.event ?? null;

  // Strictly after now. The ongoing block starts at or before now, so it can
  // never be offered as the next class; a class beginning exactly this
  // minute is already the ongoing one.
  const next = academic.find((event) => eventBounds(event).start > nowMinutes) ?? null;

  const currentFree =
    freeRanges.find((range) => range.startMinutes <= nowMinutes && nowMinutes < range.endMinutes) ?? null;

  let phase;
  if (current) {
    phase = current.kind === 'lunch' ? 'lunch' : current.kind === 'special' ? 'special' : 'class';
  } else if (currentFree) {
    phase = 'free';
  } else if (!first) {
    phase = 'empty';
  } else if (nowMinutes < eventBounds(first).start) {
    phase = 'before';
  } else if (nowMinutes >= lastEnd) {
    phase = 'after';
  } else {
    // Between sessions, including the 11:00–11:10 changeover.
    phase = 'gap';
  }

  return { isToday: true, phase, ongoing, next, first, current, currentFree };
}
