/**
 * One timetable, two data weeks — the date-scoped week selector.
 *
 * The department printed a one-week "Special Time Table" for 23–27
 * November 2026 (left sheet only: Monday/Wednesday/Friday) that replaces the
 * normal Semester-I week for those dates and nothing else. Tuesday/Thursday
 * are not in the special sheet at all, so they always come from the master,
 * and outside the window every day comes from the master. This module is
 * the only place that knows the window; consumers ask it "which week is in
 * effect?" and get one ready-to-render payload either way.
 *
 * Server-only (it imports the datasets). Client code gets the same answer
 * from `getTimetableSourceForDate` in `./meta` for chrome text, and the
 * server-resolved view model for anything that renders events.
 *
 * Time boundaries are Asia/Kolkata calendar dates, inclusive — the special
 * week starts at 2026-11-23 00:00 IST and ends at 2026-11-28 00:00 IST,
 * matching the printed header "Special Time Table from 23/11 till
 * 27/11/2026". There is no time-of-day cut-off: the timetable is a printed
 * artefact, so it applies to the date, not to the minute.
 */

import { getTimetableSourceForDate, SPECIAL_WEEK_WINDOW } from '@/lib/timetable/meta';
import { MASTER_TIMETABLE_2026_27_SEM1 } from '@/lib/timetable/master-timetable-2026-27-sem1';
import { SPECIAL_TIMETABLE_2026_11_23_TO_27 } from '@/lib/timetable/special-timetable-2026-11-23-to-27';

/** Days the special sheet reprints. Everything else always falls back to the master. */
export const SPECIAL_WEEK_REPLACED_DAYS = Object.freeze(['Monday', 'Wednesday', 'Friday']);

/**
 * The week in effect for `at` (defaults to now), as a single payload:
 *
 *   {
 *     period_columns,   // identical in both weeks
 *     days,             // all five weekdays; special replaces Mon/Wed/Fri in-window
 *     source,           // { title, department, academicYear, semester, fileTitle }
 *     specialWeek,      // true inside the window
 *     weekLabel,        // '23–27 November 2026' inside the window, else null
 *     replacedDays,     // days coming from the special sheet (empty outside the window)
 *   }
 *
 * The returned `days` maps the same shape the master uses, so every view
 * model, snapshot, test and renderer works unchanged against either week.
 */
export function resolveActiveWeek(at = new Date()) {
  const source = getTimetableSourceForDate(at);
  const specialWeek = source.specialWeek;
  const days = specialWeek
    ? {
        ...MASTER_TIMETABLE_2026_27_SEM1.days,
        Monday: SPECIAL_TIMETABLE_2026_11_23_TO_27.days.Monday,
        Wednesday: SPECIAL_TIMETABLE_2026_11_23_TO_27.days.Wednesday,
        Friday: SPECIAL_TIMETABLE_2026_11_23_TO_27.days.Friday,
      }
    : MASTER_TIMETABLE_2026_27_SEM1.days;

  return {
    period_columns: MASTER_TIMETABLE_2026_27_SEM1.period_columns,
    days,
    source: {
      title: source.title,
      department: source.department,
      academicYear: source.academicYear,
      semester: source.semester,
      fileTitle: source.fileTitle,
    },
    specialWeek,
    weekLabel: specialWeek ? SPECIAL_WEEK_WINDOW.label : null,
    replacedDays: specialWeek ? [...SPECIAL_WEEK_REPLACED_DAYS] : [],
  };
}

export { SPECIAL_WEEK_WINDOW };
