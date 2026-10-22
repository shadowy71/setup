/**
 * Campus clock — the one source of "what time is it at the institute?".
 *
 * Every timetable decision (which weekday opens by default, whether a class
 * is on right now, which class is next) is made in `Asia/Kolkata`, never in
 * the visitor's browser timezone: a student checking from a train, a VPN or
 * a laptop set to UTC must still see the Pune timetable. India has a single
 * fixed offset with no DST, so a wall-clock conversion is exact.
 *
 * This module is client-safe (no dataset import) because the live clock and
 * the day selector run in the browser.
 */

export const CAMPUS_TIME_ZONE = 'Asia/Kolkata';

/** The printed timetable runs Monday → Friday. */
export const TIMETABLE_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CAMPUS_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAMPUS_TIME_ZONE,
  hourCycle: 'h23',
  weekday: 'long',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const pad = (value) => String(value).padStart(2, '0');

/**
 * The wall clock at the institute for a given instant.
 *
 * Returns a plain object (no Date arithmetic on the caller side) so the same
 * values can be derived identically on the server and in the browser:
 * `minutesOfDay` drives the timetable status engine, `dateLabel` is the
 * human line under the clock ("Friday, 23 Oct").
 */
export function getCampusTime(date = new Date()) {
  const parts = {};
  for (const part of CAMPUS_PARTS.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const weekday = parts.weekday;

  return {
    iso: date.toISOString(),
    weekday,
    weekdayIndex: WEEK.indexOf(weekday),
    isWeekend: !TIMETABLE_WEEKDAYS.includes(weekday),
    year: Number(parts.year),
    month: parts.month,
    day: Number(parts.day),
    hour,
    minute,
    second,
    minutesOfDay: hour * 60 + minute,
    dateLabel: `${weekday}, ${Number(parts.day)} ${parts.month}`,
    timeLabel: `${pad(hour)}:${pad(minute)}`,
    secondLabel: pad(second),
  };
}

/** The timetable weekday for a weekday name, or null on Saturday/Sunday. */
export function timetableDayFor(weekday) {
  return TIMETABLE_WEEKDAYS.includes(weekday) ? weekday : null;
}

/** '09:00' → 540. Used for the printed period boundaries. */
export function parseMinutes(label) {
  const [hours, minutes] = String(label).split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** 540 → '09:00' (clamped to a single day). */
export function formatMinutes(total) {
  const minutes = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * Which day the schedule should show.
 *
 * A manual choice wins until the visitor returns to "today"; otherwise the
 * page follows the institute's weekday — including across midnight while it
 * stays open. Weekend days resolve to null, which the UI renders as the
 * weekend state rather than inventing a Saturday timetable.
 */
export function resolveDaySelection({ selected, pinned, today }) {
  if (pinned) return selected;
  return selected === today ? selected : today;
}
