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

/* --------------------------------------------------------------------------
   Reading the clock
   --------------------------------------------------------------------------
   The timetable is read by students, not by a machine, so every time shown on
   the page is 12-hour with an explicit AM/PM. The 24-hour strings stay in the
   data (`event.time.from` / `.to`, `period_columns`) because they are what the
   schedule engine compares and what `<input type="time">` and the SQL side
   expect — this is a presentation layer, not a data change.

   Formats, in order of use:

     9:00 AM            one instant
     9:00–11:00 AM      a range inside one half of the day (the meridiem is
                        stated once, at the end)
     11:10 AM – 12:10 PM   a range that crosses noon (both halves named)
     9–10 AM            a period column: on-the-hour ends drop their `:00`
   -------------------------------------------------------------------------- */

/** '09:05' → { hour12: 9, minutes: 5, meridiem: 'AM', text: '9:05 AM' }. */
export function toClock12(value) {
  const source = String(value ?? '').trim();
  const match = /^(\d{1,2}):(\d{2})/.exec(source);
  if (!match) return null;
  const hours = Number(match[1]) % 24;
  const minutes = Number(match[2]);
  const meridiem = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return { hour12, minutes, meridiem, text: `${hour12}:${pad(minutes)} ${meridiem}` };
}

/** '09:00' → '9:00 AM'. Empty when the input is not a time. */
export function formatClock12(value) {
  return toClock12(value)?.text ?? '';
}

/**
 * A range. Same half of the day: `9:00–11:00 AM`. Across noon:
 * `11:10 AM – 12:10 PM`. Either end missing renders the half we do have.
 */
export function formatClockRange12(from, to) {
  const start = toClock12(from);
  const end = toClock12(to);
  if (!start) return end ? `until ${end.text}` : '';
  if (!end) return start.text;
  if (start.meridiem === end.meridiem) {
    return `${start.hour12}:${pad(start.minutes)}–${end.hour12}:${pad(end.minutes)} ${end.meridiem}`;
  }
  return `${start.text} – ${end.text}`;
}

/**
 * A period column header: `09:00-10:00` → `9–10 AM`.
 *
 * On-the-hour ends lose their `:00` because nine of these sit side by side in
 * one table header; anything with minutes keeps them.
 */
export function formatPeriodLabel(period) {
  const [from, to] = String(period ?? '').split('-');
  const start = toClock12(from);
  const end = toClock12(to);
  if (!start || !end) return String(period ?? '');
  const clock = (clock12) => (clock12.minutes === 0 ? String(clock12.hour12) : `${clock12.hour12}:${pad(clock12.minutes)}`);
  if (start.meridiem === end.meridiem) {
    return `${clock(start)}–${clock(end)} ${end.meridiem}`;
  }
  return `${start.text} – ${end.text}`;
}

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
    // 24-hour, kept for callers that need a sortable/comparable label.
    timeLabel: `${pad(hour)}:${pad(minute)}`,
    // What the timetable actually shows: 12-hour with an explicit meridiem.
    hourMinute12: `${hour % 12 === 0 ? 12 : hour % 12}:${pad(minute)}`,
    meridiem: hour >= 12 ? 'PM' : 'AM',
    timeLabel12: `${hour % 12 === 0 ? 12 : hour % 12}:${pad(minute)} ${hour >= 12 ? 'PM' : 'AM'}`,
    secondLabel: pad(second),
  };
}

/** The timetable weekday for a weekday name, or null on Saturday/Sunday. */
export function timetableDayFor(weekday) {
  return TIMETABLE_WEEKDAYS.includes(weekday) ? weekday : null;
}

/**
 * A `?day=` parameter normalised to the canonical weekday, or null.
 * `?day=monday` and `?day=FRIDAY` are the same deep link as the canonical
 * spelling; anything else (weekends, typos, arrays) is not a day here and is
 * dropped rather than guessed.
 */
export function normalizeTimetableDay(value) {
  if (typeof value !== 'string') return null;
  const wanted = value.trim().toLowerCase();
  return TIMETABLE_WEEKDAYS.find((day) => day.toLowerCase() === wanted) ?? null;
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
