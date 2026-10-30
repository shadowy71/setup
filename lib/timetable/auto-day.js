/**
 * Schedule-aware day selection — the timetable is not midnight-aware.
 *
 * A timetable day stops being "the day you are looking at" when its **last
 * scheduled lecture ends**, not when the clock strikes twelve. This module
 * answers one question, purely and without React or the dataset:
 *
 *   given the printed events for every day, the institute's weekday and the
 *   minutes since midnight, which day should be on screen?
 *
 * The rules, in order:
 *
 *   1. If today is a teaching day whose final lecture has not finished yet
 *      (ongoing or still to come), today is shown. Before the first lecture,
 *      during a gap and during the last lecture all stay on today.
 *   2. Otherwise — the final lecture has ended, today has no lectures printed,
 *      or today is not a teaching day at all — the next day **with scheduled
 *      lectures** is shown, wrapping Friday → Monday. A day nobody teaches is
 *      skipped rather than rendered empty.
 *   3. If no day in the timetable has a lecture, there is nothing to follow:
 *      the caller gets `day: null` and renders its empty state.
 *
 * The switch time is never a constant. It is `max(end)` over the academic
 * events of the day in question (lunch and the Empowerment Hour are not
 * lectures), read from the same view model the page renders, so editing the
 * timetable moves the switch with it. Intervals are half-open, matching
 * `getDayStatus`: at exactly `15:30` the 13:10–15:30 lecture is over.
 *
 * `weekday` and `nowMinutes` are the institute's wall clock
 * (`getCampusTime()`), the same source the rest of the timetable uses — no
 * UTC arithmetic happens here, so a laptop in another timezone cannot move
 * the switch.
 */

import { TIMETABLE_WEEKDAYS } from '@/lib/timetable/clock';
import { eventBounds, isAcademicEvent } from '@/lib/timetable/schedule';

/** A day's printed lectures: standard sessions and batch practicals only. */
export function lecturesOf(day) {
  return (day?.events ?? []).filter(isAcademicEvent);
}

/** True when the day carries at least one lecture. */
export function hasLectures(day) {
  return lecturesOf(day).length > 0;
}

/**
 * The ending minute (since midnight) of the day's last lecture, or null when
 * the day has none. This is the only "switching time" the timetable has.
 */
export function lastLectureEndMinutes(day) {
  let end = null;
  for (const lecture of lecturesOf(day)) {
    const bound = eventBounds(lecture).end;
    if (!Number.isFinite(bound)) continue;
    end = end === null ? bound : Math.max(end, bound);
  }
  return end;
}

/**
 * Has the day's last lecture finished at `nowMinutes`?
 *
 * Half-open, like every other interval in the timetable: the printed end
 * minute is already over. A day without lectures is never "complete" — it is
 * simply empty, and `resolveAutoDay` skips it separately.
 */
export function isScheduleComplete(day, nowMinutes) {
  const end = lastLectureEndMinutes(day);
  if (end === null) return false;
  return Number(nowMinutes) >= end;
}

function result(day, { today, todayHasLectures, todayComplete, reason }) {
  return {
    day: day?.day ?? null,
    // The day the schedule is on, or null when nothing is scheduled at all.
    today: today ?? null,
    todayHasLectures: Boolean(todayHasLectures),
    todayComplete: Boolean(todayComplete),
    // The chosen day's own last-lecture end — what the switch was measured
    // against when today is the chosen day.
    endsAtMinutes: lastLectureEndMinutes(day),
    reason,
  };
}

/**
 * Which day the timetable should show right now.
 *
 * @param {object} input
 * @param {Array<{ day: string, events: Array }>} input.days  the week, in
 *        timetable order (Monday → Friday for the printed source)
 * @param {string|null} input.weekday  the institute's weekday, or null/unknown
 * @param {number} input.nowMinutes    minutes since midnight at the institute
 * @returns {{
 *   day: string|null,
 *   today: string|null,
 *   todayHasLectures: boolean,
 *   todayComplete: boolean,
 *   endsAtMinutes: number|null,
 *   reason: 'in-session'|'after-last-lecture'|'today-empty'|'next-teaching-day'|'empty',
 * }}
 */
export function resolveAutoDay({ days = [], weekday = null, nowMinutes = 0 } = {}) {
  const order = (days ?? []).map((entry) => entry.day);
  const byName = new Map((days ?? []).map((entry) => [entry.day, entry]));

  // Only a real timetable weekday can be "today"; Saturday and Sunday have no
  // printed day, which is what sends the weekend to the next teaching day.
  const today = TIMETABLE_WEEKDAYS.includes(weekday) ? weekday : null;
  const todayEntry = today ? byName.get(today) ?? null : null;
  const todayHasLectures = hasLectures(todayEntry);
  const todayComplete = todayHasLectures && isScheduleComplete(todayEntry, nowMinutes);

  if (!order.length) {
    return result(null, { today, todayHasLectures, todayComplete, reason: 'empty' });
  }

  // Scenario A — today's own schedule has not run out yet.
  if (todayEntry && todayHasLectures && !todayComplete) {
    return result(todayEntry, { today, todayHasLectures, todayComplete, reason: 'in-session' });
  }

  // Scenario B — advance to the next day that actually has lectures. Starting
  // after today (the loop wraps, so Friday finds Monday); at the weekend there
  // is no today in the timetable, so the search starts at the week's first day.
  const todayIndex = today ? order.indexOf(today) : -1;
  const startAt = todayIndex >= 0 ? todayIndex + 1 : 0;
  // Why we left today, for the page's own explanation: it had no classes
  // printed, or its last one has ended — or today is not a teaching day.
  const reason = todayIndex < 0 ? 'next-teaching-day' : todayHasLectures ? 'after-last-lecture' : 'today-empty';
  for (let step = 0; step < order.length; step += 1) {
    const candidate = byName.get(order[(startAt + step) % order.length]);
    if (hasLectures(candidate)) {
      return result(candidate, { today, todayHasLectures, todayComplete, reason });
    }
  }

  // Every day is empty: say so instead of inventing a day.
  return result(null, { today, todayHasLectures, todayComplete, reason: 'empty' });
}
