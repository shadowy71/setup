import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getCampusTime } from '@/lib/timetable/clock';
import { getDivisionTimetable, isSpecialTimetableDate, timetableDaysForDate } from '@/lib/timetable';
import { SPECIAL_TIMETABLE_2026_11 } from '@/lib/timetable/special-2026-11-18-to-20';
import { buildSnapshot, validateSnapshot } from '@/lib/timetable/offline';
import TimetableLive from '@/components/timetable/TimetableLive';

const campus = (iso) => getCampusTime(new Date(iso));
const day = (days, name) => days.find((entry) => entry.day === name);

describe('18–20 November special timetable', () => {
  it('covers every division and only the three dated days with non-overlapping periods', () => {
    expect(Object.keys(SPECIAL_TIMETABLE_2026_11)).toEqual(['Wednesday', 'Thursday', 'Friday']);
    for (const rows of Object.values(SPECIAL_TIMETABLE_2026_11)) {
      expect(Object.keys(rows)).toEqual('ABCDEFGHIJKLMNOPQR'.split(''));
      for (const events of Object.values(rows)) {
        let last = -1;
        for (const [start, end, lines] of events) {
          expect(start).toBeGreaterThan(last);
          expect(end).toBeGreaterThanOrEqual(start);
          expect(end).toBeLessThan(9);
          expect(lines.length).toBeGreaterThan(0);
          last = end;
        }
      }
    }
  });

  it('switches at campus midnight and reverts after Friday, regardless of browser timezone', () => {
    expect(isSpecialTimetableDate(campus('2026-11-17T18:29:59Z'))).toBe(false);
    expect(isSpecialTimetableDate(campus('2026-11-17T18:30:00Z'))).toBe(true);
    expect(isSpecialTimetableDate(campus('2026-11-20T18:29:59Z'))).toBe(true);
    expect(isSpecialTimetableDate(campus('2026-11-20T18:30:00Z'))).toBe(false);
    const regular = getDivisionTimetable('A').days;
    const special = timetableDaysForDate(regular, 'A', campus('2026-11-18T04:00:00Z'));
    expect(day(special, 'Wednesday').events[0].lines[0]).toBe('EG-2/ENG-3');
    expect(day(special, 'Monday')).toBe(day(regular, 'Monday'));
    expect(timetableDaysForDate(regular, 'A', campus('2026-11-21T04:00:00Z'))).toBe(regular);
  });

  it('retains and flags the two ambiguous entries exactly as supplied', () => {
    const f = timetableDaysForDate(getDivisionTimetable('F').days, 'F', campus('2026-11-19T04:00:00Z'));
    const practical = day(f, 'Thursday').events.find((event) => event.start === 2);
    expect(practical.lines[2]).toBe('[6408L/NEW-CC3//6507L]');
    expect(practical.needsVerification).toBe(true);
    const g = timetableDaysForDate(getDivisionTimetable('G').days, 'G', campus('2026-11-20T04:00:00Z'));
    const coi = day(g, 'Friday').events.find((event) => event.start === 5);
    expect(coi.lines[0]).toBe('[COI');
    expect(coi.needsVerification).toBe(true);
  });

  it('also overlays saved data and keeps the saved regular schedule unchanged', () => {
    const original = getDivisionTimetable('A');
    const saved = validateSnapshot(buildSnapshot(original)).snapshot;
    const before = JSON.stringify(saved.days);
    const special = timetableDaysForDate(saved.days, 'A', campus('2026-11-18T04:00:00Z'));
    expect(day(special, 'Wednesday').events[0].lines[0]).toBe('EG-2/ENG-3');
    expect(JSON.stringify(saved.days)).toBe(before);
    expect(timetableDaysForDate(saved.days, 'A', campus('2026-11-21T04:00:00Z'))).toBe(saved.days);
  });

  it('renders the same dated schedule in the live view and the week grid', () => {
    const t = getDivisionTimetable('A');
    const html = renderToStaticMarkup(React.createElement(TimetableLive, {
      division: 'A', label: t.label, friendly: t.friendly, days: t.days, subjects: t.subjects,
      initialDay: 'Wednesday', initialNow: '2026-11-18T04:00:00Z', showWeek: true,
    }));
    expect(html).toContain('Special timetable for 18–20 November 2026');
    expect(html.match(/EG-2\/ENG-3/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
