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
import { parseMinutes } from '@/lib/timetable/clock';
import { MASTER_TIMETABLE_2026_27_SEM1 as SOURCE } from '@/lib/timetable/master-timetable-2026-27-sem1';
import { DIVISION_PROGRAMMES, NEUTRAL_ACCENT, normalizeDivision, subjectAccent, subjectRoot } from '@/lib/timetable/meta';

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
    return { ...range, from, to, startMinutes: parseMinutes(from), endMinutes: parseMinutes(to) };
  });
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
  // Subjects present in this division, in first-seen order, for the legend.
  // Only accented families are listed: a neutral edge carries no information
  // worth a chip.
  const subjects = new Map();

  const days = TIMETABLE_DAYS.map((day) => {
    const entry = SOURCE.days[day][division];
    const events = entry.events.map(toEvent);
    for (const event of events) {
      if (event.needsVerification) flagged.push({ day, ...event });
      if (event.accent !== NEUTRAL_ACCENT && event.subject && !subjects.has(event.subject)) {
        subjects.set(event.subject, event.accent);
      }
    }
    const slots = toSlots(events);
    return { day, branch: entry.branch, events, slots, freeRanges: toFreeRanges(slots), rawCells: entry.raw_cells };
  });

  return {
    division,
    ...programme,
    days,
    flagged,
    subjects: [...subjects].map(([code, accent]) => ({ code, accent })),
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


