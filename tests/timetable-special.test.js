import { describe, expect, it } from 'vitest';

import { getDivisionTimetable } from '@/lib/timetable';
import { resolveActiveWeek, SPECIAL_WEEK_REPLACED_DAYS } from '@/lib/timetable/active-week';
import { MASTER_TIMETABLE_2026_27_SEM1 as MASTER } from '@/lib/timetable/master-timetable-2026-27-sem1';
import { SPECIAL_TIMETABLE_2026_11_23_TO_27 as SPECIAL } from '@/lib/timetable/special-timetable-2026-11-23-to-27';
import { getTimetableSourceForDate, isSpecialWeek, SPECIAL_WEEK_WINDOW } from '@/lib/timetable/meta';
import { buildSnapshot } from '@/lib/timetable/offline';

/**
 * The one-week special timetable (23–27 November 2026) and the date-scoped
 * override that serves it. Everything is pinned for explicit instants — the
 * boundary is a property of the calendar, not of the day the suite happens
 * to run.
 */

// Asia/Kolkata is UTC+5:30 with no DST, so the calendar flips at 18:30 UTC.
const SUNDAY_BEFORE = new Date('2026-11-22T12:00:00Z'); // Sun 22 Nov, 17:30 IST
const FIRST_INSTANT = new Date('2026-11-22T18:30:00Z'); // Mon 23 Nov, 00:00 IST
const WEDNESDAY = new Date('2026-11-25T04:30:00Z'); // Wed 25 Nov, 10:00 IST
const LAST_MOMENT = new Date('2026-11-27T18:29:59Z'); // Fri 27 Nov, 23:59:59 IST
const AFTER = new Date('2026-11-27T18:30:00Z'); //      Sat 28 Nov, 00:00 IST

const DIVISIONS = Object.keys(MASTER.days.Monday);
const REPLACED = ['Monday', 'Wednesday', 'Friday'];
const UNTOUCHED = ['Tuesday', 'Thursday'];
const SPECIAL_EVENT_COUNT = REPLACED.reduce(
  (total, day) => total + DIVISIONS.reduce((sum, division) => sum + SPECIAL.days[day][division].events.length, 0),
  0,
);

describe('the special module transcribes Mon/Wed/Fri only', () => {
  it('carries exactly the three replaced days, every division A–R', () => {
    expect(Object.keys(SPECIAL.days).sort()).toEqual([...REPLACED].sort());
    for (const day of REPLACED) {
      expect(Object.keys(SPECIAL.days[day]).sort()).toEqual([...DIVISIONS].sort());
    }
  });

  it('prints the same period columns as the master', () => {
    expect(SPECIAL.period_columns).toEqual(MASTER.period_columns);
  });

  it('keeps nine raw cells per division-day aligned to the periods', () => {
    for (const day of REPLACED) {
      for (const division of DIVISIONS) {
        expect(SPECIAL.days[day][division].raw_cells, `${day} ${division} raw_cells`).toHaveLength(9);
      }
    }
  });

  it('aligns event spans and keeps lunch where the master prints it', () => {
    for (const day of REPLACED) {
      for (const division of DIVISIONS) {
        const entry = SPECIAL.days[day][division];
        const covered = new Set();
        for (const [start, end, lines, flag] of entry.events) {
          expect(start).toBeGreaterThanOrEqual(0);
          expect(end).toBeGreaterThanOrEqual(start);
          expect(end).toBeLessThanOrEqual(8);
          expect(lines.length).toBeGreaterThan(0);
          expect(typeof flag).toBe('boolean');
          for (let index = start; index <= end; index += 1) {
            expect(covered.has(index), `${day} ${division} overlap at ${index}`).toBe(false);
            covered.add(index);
          }
        }
        const specialLunch = entry.events.find(([, , lines]) => lines[0] === 'Lunch')?.[0];
        const masterLunch = MASTER.days[day][division].events.find(([, , lines]) => lines[0] === 'Lunch')?.[0];
        expect(specialLunch, `${day} ${division} lunch column`).toBe(masterLunch);
      }
    }
    // The whole special sheet, as transcribed.
    expect(SPECIAL_EVENT_COUNT).toBe(335);
  });

  it('flags Friday N Empowerment Hour, moved one column earlier than the master prints it', () => {
    const entry = SPECIAL.days.Friday.N;
    const hour = entry.events.find(([, , lines]) => lines[0] === 'Empowerment');
    expect(hour[0]).toBe(7);
    expect(hour[1]).toBe(7);
    expect(hour[3]).toBe(true);
    // One (not two) DECO # cells remain, at period 6 — printed as-is.
    const deco = entry.events.filter(([, , lines]) => lines[0] === 'DECO #');
    expect(deco).toHaveLength(1);
    expect(deco[0][0]).toBe(6);
  });

  it('transcribes the dropped cells as blank, not backfilled from the master', () => {
    expect(SPECIAL.days.Monday.M.events.some(([, , lines]) => lines[0] === 'DECO #')).toBe(false);
    expect(SPECIAL.days.Wednesday.N.events.some(([, , lines]) => lines[0] === 'CTPS #')).toBe(false);
    expect(SPECIAL.days.Friday.J.events.some(([, , lines]) => lines[0] === 'DECO #')).toBe(false);
    expect(SPECIAL.days.Friday.K.events.some(([, , lines]) => lines[0] === 'DECO #')).toBe(false);
    // Blanked raw cells stay blank.
    expect(SPECIAL.days.Monday.M.raw_cells[7]).toBe('');
    expect(SPECIAL.days.Wednesday.N.raw_cells[7]).toBe('');
    expect(SPECIAL.days.Friday.J.raw_cells[0]).toBe('');
    expect(SPECIAL.days.Friday.K.raw_cells[7]).toBe('');
  });

  it('keeps the inherited master flags and the corrected cell contents', () => {
    expect(SPECIAL.days.Monday.L.events[1][3]).toBe(true); // Mon L practical, as flagged in master
    expect(SPECIAL.days.Friday.G.events.find(([, , lines]) => lines[0] === '[COI')?.[3]).toBe(true);
    expect(SPECIAL.days.Wednesday.D.events[2][2][2]).toBe('[6505L/6120L/6407L]'); // printed 6120L
    expect(SPECIAL.days.Friday.A.events[5][2][0]).toBe('ENG-1/EG-2/LS-3');
    expect(SPECIAL.days.Friday.A.events[5][2][1]).toBe('[JL/AVS/RGT]'); // SY → JL as printed
  });

  it('matches the master raw cells for division-days the PDF did not touch', () => {
    for (const day of REPLACED) {
      for (const division of DIVISIONS) {
        expect(SPECIAL.days[day][division].branch).toBe(MASTER.days[day][division].branch);
      }
    }
    // An untouched day: Monday A is identical in both sheets.
    expect(SPECIAL.days.Monday.A.raw_cells).toEqual(MASTER.days.Monday.A.raw_cells);
    expect(SPECIAL.days.Monday.A.events).toEqual(MASTER.days.Monday.A.events);
  });
});

describe('the date-scoped override', () => {
  it('recognises the window boundaries exactly, in Asia/Kolkata', () => {
    expect(isSpecialWeek(SUNDAY_BEFORE)).toBe(false);
    expect(isSpecialWeek(FIRST_INSTANT)).toBe(true); // 23 Nov 00:00 IST
    expect(isSpecialWeek(WEDNESDAY)).toBe(true);
    expect(isSpecialWeek(LAST_MOMENT)).toBe(true); // 27 Nov 23:59 IST
    expect(isSpecialWeek(AFTER)).toBe(false); //      28 Nov 00:00 IST
  });

  it('reports the window itself unchanged', () => {
    expect(SPECIAL_WEEK_WINDOW.fromKey).toBe('2026-11-23');
    expect(SPECIAL_WEEK_WINDOW.toKey).toBe('2026-11-27');
  });

  it('names the source per date', () => {
    expect(getTimetableSourceForDate(SUNDAY_BEFORE).title).toBe('MASTER TIME TABLE');
    expect(getTimetableSourceForDate(SUNDAY_BEFORE).specialWeek).toBe(false);
    expect(getTimetableSourceForDate(WEDNESDAY).title).toBe('SPECIAL TIME TABLE');
    expect(getTimetableSourceForDate(WEDNESDAY).fileTitle).toBe('special tt 23 nov 27 nov.pdf');
    expect(getTimetableSourceForDate(WEDNESDAY).specialWeek).toBe(true);
    expect(getTimetableSourceForDate(AFTER).title).toBe('MASTER TIME TABLE');
  });

  it('swaps Mon/Wed/Fri for the special sheet in-window, and nothing else', () => {
    const week = resolveActiveWeek(WEDNESDAY);
    expect(week.specialWeek).toBe(true);
    expect(week.weekLabel).toBe('23–27 November 2026');
    expect(week.replacedDays).toEqual(SPECIAL_WEEK_REPLACED_DAYS);
    for (const day of REPLACED) expect(week.days[day]).toBe(SPECIAL.days[day]);
    for (const day of UNTOUCHED) expect(week.days[day]).toBe(MASTER.days[day]);
    expect(week.source.title).toBe('SPECIAL TIME TABLE');
    expect(week.period_columns).toBe(MASTER.period_columns);
  });

  it('serves the master everywhere outside the window', () => {
    for (const at of [SUNDAY_BEFORE, AFTER]) {
      const week = resolveActiveWeek(at);
      expect(week.specialWeek).toBe(false);
      expect(week.weekLabel).toBeNull();
      expect(week.replacedDays).toEqual([]);
      expect(week.days).toBe(MASTER.days);
      expect(week.source.title).toBe('MASTER TIME TABLE');
    }
  });

  it('serves the special week through the division view model, flagged where needed', () => {
    const during = getDivisionTimetable('N', { at: WEDNESDAY });
    expect(during.specialWeek).toBe(true);
    expect(during.weekLabel).toBe('23–27 November 2026');
    expect(during.source.fileTitle).toBe('special tt 23 nov 27 nov.pdf');
    const friday = during.days.find((day) => day.day === 'Friday');
    const hour = friday.events.find((event) => event.lines[0] === 'Empowerment');
    expect(hour.start).toBe(7);
    expect(hour.needsVerification).toBe(true);
    expect(during.flagged).toHaveLength(1);
    expect(during.flagged[0]).toMatchObject({ day: 'Friday', start: 7, lines: ['Empowerment', 'Hour'] });
    // The inherited master flag still rides along on its own division.
    const l = getDivisionTimetable('L', { at: WEDNESDAY });
    expect(l.flagged).toEqual(expect.arrayContaining([expect.objectContaining({ day: 'Monday', start: 2 })]));
  });

  it('serves the master through the division view model outside the window', () => {
    const before = getDivisionTimetable('J', { at: SUNDAY_BEFORE });
    expect(before.specialWeek).toBe(false);
    const friday = before.days.find((day) => day.day === 'Friday');
    expect(friday.events.some((event) => event.lines[0] === 'DECO #')).toBe(true);
    const during = getDivisionTimetable('J', { at: WEDNESDAY });
    const fridaySpecial = during.days.find((day) => day.day === 'Friday');
    expect(fridaySpecial.events.some((event) => event.lines[0] === 'DECO #')).toBe(false);
  });

  it('carries the week of record through to the offline snapshot', () => {
    const during = buildSnapshot({ ...getDivisionTimetable('O', { at: WEDNESDAY }), generatedAt: WEDNESDAY.toISOString() });
    expect(during.source.fileTitle).toBe('special tt 23 nov 27 nov.pdf');
    const before = buildSnapshot({ ...getDivisionTimetable('O', { at: SUNDAY_BEFORE }), generatedAt: SUNDAY_BEFORE.toISOString() });
    expect(before.source.fileTitle).toBe('Updated Final MTT SEM I 26-27 (1).pdf');
  });
});
