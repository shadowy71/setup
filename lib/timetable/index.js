import { normalizeBranch } from '@/lib/branches';
/**
 * Timetable view models (server-side).
 *
 * Turns the verbatim source payloads into what the pages render, without
 * altering a single source string. Which payload is in effect is decided
 * per request by `resolveActiveWeek` (`active-week.js`): inside 23–27
 * November 2026 (Asia/Kolkata) Mon/Wed/Fri come from
 * `special-timetable-2026-11-23-to-27.js`; everything else always comes
 * from `master-timetable-2026-27-sem1.js`:
 * subject lines, faculty initials, room codes, `#` markers and literal
 * labels (`Lunch`, `Empowerment Hour`) pass through untouched, batch
 * allocations stay together as one spanning event, and lunch keeps
 * whatever column the source gave each division.
 */

import { DIVISIONS } from '@/lib/constants';
import { formatClock12, formatClockRange12, formatPeriodLabel, parseMinutes } from '@/lib/timetable/clock';
import { MASTER_TIMETABLE_2026_27_SEM1 } from '@/lib/timetable/master-timetable-2026-27-sem1';
import { resolveActiveWeek } from '@/lib/timetable/active-week';
import { DIVISION_PROGRAMMES, TIMETABLE_YEAR, NEUTRAL_ACCENT, normalizeDivision, subjectAccent, subjectRoot } from '@/lib/timetable/meta';

export { TIMETABLE_SOURCE } from '@/lib/timetable/meta';
export { resolveActiveWeek, SPECIAL_WEEK_REPLACED_DAYS } from '@/lib/timetable/active-week';

// The set of days and the period columns never change between the master
// and the special sheet, so they stay static constants. The events do.
export const TIMETABLE_DAYS = Object.keys(MASTER_TIMETABLE_2026_27_SEM1.days);
export const TIMETABLE_PERIODS = MASTER_TIMETABLE_2026_27_SEM1.period_columns;

/**
 * '09:00-10:00' + span → the wall-clock range an event occupies.
 *
 * `from`/`to` stay 24-hour (the schedule engine and the tests compare them);
 * the `*Label` fields are what the page prints — 12-hour, with AM/PM.
 */
export function periodRange(start, end) {
  const from = TIMETABLE_PERIODS[start]?.split('-')[0] || '';
  const to = TIMETABLE_PERIODS[end]?.split('-')[1] || '';
  return {
    from,
    to,
    label: start === end ? TIMETABLE_PERIODS[start] : `${from}-${to}`,
    fromLabel: formatClock12(from),
    toLabel: formatClock12(to),
    label12: formatClockRange12(from, to),
  };
}

/** The printed period columns, labelled for people: `9–10 AM`, `12:10–1:10 PM`. */
export const TIMETABLE_PERIOD_LABELS = TIMETABLE_PERIODS.map((period) => ({
  period,
  label: formatPeriodLabel(period),
}));

/**
 * Display kind for restrained styling only — never a reinterpretation of
 * the text. A `batch` is a subgroup-split allocation (slash-separated
 * subjects with their faculty/room lines kept together); everything else
 * is a standard entry.
 */
function eventKind(lines) {
  if (lines[0] === 'Lunch') return 'lunch';
  if (lines[0] === 'Empowerment') return 'special';
  if (lines.length >= 3 && lines[0].includes('/')) return 'batch';
  return 'standard';
}

function toEvent([start, end, lines, needsVerification]) {
  const time = periodRange(start, end);
  return {
    // Stable identity for the live status engine (NOW/NEXT are matched by id).
    id: `${start}-${end}-${lines[0]}`,
    start,
    end,
    span: end - start + 1,
    lines,
    needsVerification: Boolean(needsVerification),
    kind: eventKind(lines),
    time,
    subject: subjectRoot(lines[0]),
    accent: subjectAccent(lines[0]),
    startMinutes: parseMinutes(time.from),
    endMinutes: parseMinutes(time.to),
  };
}

/**
 * One division-day expanded into nine column slots for rendering: an event
 * occupies its start slot (with its span), continuation columns are marked
 * covered, and columns no event claims are blank (raw `""` or trailing
 * space in the source row).
 */
function toSlots(events) {
  const slots = Array.from({ length: TIMETABLE_PERIODS.length }, () => ({ type: 'blank' }));
  for (const event of events) {
    slots[event.start] = { type: 'event', event };
    for (let i = event.start + 1; i <= event.end; i += 1) slots[i] = { type: 'covered' };
  }
  return slots;
}

/**
 * Consecutive blank printed columns, as time ranges. A blank column is part
 * of the source row (the division has no class printed there), so it is
 * surfaced honestly as a free slot rather than dropped.
 */
function toFreeRanges(slots) {
  const ranges = [];
  let run = null;
  slots.forEach((slot, index) => {
    if (slot.type !== 'blank') {
      run = null;
      return;
    }
    if (run) {
      run.endIndex = index;
    } else {
      run = { startIndex: index, endIndex: index };
      ranges.push(run);
    }
  });

  return ranges.map((range) => {
    const from = TIMETABLE_PERIODS[range.startIndex].split('-')[0];
    const to = TIMETABLE_PERIODS[range.endIndex].split('-')[1];
    return {
      ...range,
      from,
      to,
      fromLabel: formatClock12(from),
      toLabel: formatClock12(to),
      label12: formatClockRange12(from, to),
      startMinutes: parseMinutes(from),
      endMinutes: parseMinutes(to),
    };
  });
}

/** Selector data: every division A–R with its source programme label. */
export function getDivisionSummaries() {
  return DIVISIONS.map((division) => ({
    division,
    ...DIVISION_PROGRAMMES[division],
    year: TIMETABLE_YEAR,
  }));
}

/**
 * The full view model for one division, or null for anything that is not a
 * division. `flagged` collects every entry the source marks as needing
 * manual verification, flattened with its day and time for the on-page
 * notice (and for whoever next compares against the department PDF).
 *
 * The week is date-scoped: inside 2026-11-23 → 2026-11-27 (Asia/Kolkata)
 * Mon/Wed/Fri come from the special sheet; everywhere else, always the
 * master. Pass `{ at }` to resolve for a specific instant (tests); the
 * default is the current time.
 */
export function getDivisionTimetable(value, { at = new Date() } = {}) {
  const division = normalizeDivision(value);
  if (!division) return null;

  const week = resolveActiveWeek(at);
  const programme = DIVISION_PROGRAMMES[division];
  const flagged = [];
  // Subjects present in this division, in first-seen order, for the legend.
  // Only accented families are listed: a neutral edge carries no information
  // worth a chip.
  const subjects = new Map();

  const days = TIMETABLE_DAYS.map((day) => {
    const entry = week.days[day][division];
    const events = entry.events.map(toEvent);
    for (const event of events) {
      if (event.needsVerification) flagged.push({ day, ...event });
      if (event.accent !== NEUTRAL_ACCENT && event.subject && !subjects.has(event.subject)) {
        subjects.set(event.subject, event.accent);
      }
    }
    const slots = toSlots(events);
    return { day, branch: normalizeBranch(entry.branch), events, slots, freeRanges: toFreeRanges(slots), rawCells: entry.raw_cells };
  });

  return {
    division,
    ...programme,
    days,
    flagged,
    subjects: [...subjects].map(([code, accent]) => ({ code, accent })),
    // Which week this is: `specialWeek` inside 23–27 Nov 2026, plus the
    // source identity to print (`SPECIAL TIME TABLE` vs `MASTER TIME TABLE`).
    source: week.source,
    specialWeek: week.specialWeek,
    weekLabel: week.weekLabel,
    replacedDays: week.replacedDays,
  };
}

/** Previous/next division letters for stepping through A–R. */
export function adjacentDivisions(value) {
  const division = normalizeDivision(value);
  if (!division) return { previous: null, next: null };
  const index = DIVISIONS.indexOf(division);
  return {
    previous: index > 0 ? DIVISIONS[index - 1] : null,
    next: index < DIVISIONS.length - 1 ? DIVISIONS[index + 1] : null,
  };
}


