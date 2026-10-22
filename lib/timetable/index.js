/**
 * Timetable view models (server-side).
 *
 * Turns the verbatim source payload (`master-timetable-2026-27-sem1.js`)
 * into what the pages render, without altering a single source string:
 * subject lines, faculty initials, room codes, `#` markers and literal
 * labels (`Lunch`, `Empowerment Hour`) pass through untouched, batch
 * allocations stay together as one spanning event, and lunch keeps
 * whatever column the source gave each division.
 */

import { DIVISIONS } from '@/lib/constants';
import { MASTER_TIMETABLE_2026_27_SEM1 as SOURCE } from '@/lib/timetable/master-timetable-2026-27-sem1';
import { DIVISION_PROGRAMMES, normalizeDivision } from '@/lib/timetable/meta';

export { TIMETABLE_SOURCE } from '@/lib/timetable/meta';

export const TIMETABLE_DAYS = Object.keys(SOURCE.days);
export const TIMETABLE_PERIODS = SOURCE.period_columns;

/** '09:00-10:00' + span → the wall-clock range an event occupies. */
export function periodRange(start, end) {
  const from = TIMETABLE_PERIODS[start]?.split('-')[0] || '';
  const to = TIMETABLE_PERIODS[end]?.split('-')[1] || '';
  return { from, to, label: start === end ? TIMETABLE_PERIODS[start] : `${from}-${to}` };
}

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
  return {
    start,
    end,
    span: end - start + 1,
    lines,
    needsVerification: Boolean(needsVerification),
    kind: eventKind(lines),
    time: periodRange(start, end),
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

/** Selector data: every division A–R with its source programme label. */
export function getDivisionSummaries() {
  return DIVISIONS.map((division) => ({
    division,
    ...DIVISION_PROGRAMMES[division],
  }));
}

/**
 * The full view model for one division, or null for anything that is not a
 * division. `flagged` collects every entry the source marks as needing
 * manual verification, flattened with its day and time for the on-page
 * notice (and for whoever next compares against the department PDF).
 */
export function getDivisionTimetable(value) {
  const division = normalizeDivision(value);
  if (!division) return null;

  const programme = DIVISION_PROGRAMMES[division];
  const flagged = [];
  const days = TIMETABLE_DAYS.map((day) => {
    const entry = SOURCE.days[day][division];
    const events = entry.events.map(toEvent);
    for (const event of events) {
      if (event.needsVerification) flagged.push({ day, ...event });
    }
    return { day, branch: entry.branch, events, slots: toSlots(events), rawCells: entry.raw_cells };
  });

  return { division, ...programme, days, flagged };
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

/**
 * The weekday name in the campus timezone, for the mobile day default.
 * Saturday/Sunday fall back to Monday (the source is Mon–Fri).
 */
export function currentTimetableDay(date = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(date);
  return TIMETABLE_DAYS.includes(name) ? name : 'Monday';
}
