import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  formatClock12,
  formatClockRange12,
  formatPeriodLabel,
  getCampusTime,
  parseMinutes,
  toClock12,
} from '@/lib/timetable/clock';
import { TIMETABLE_PERIODS, TIMETABLE_PERIOD_LABELS, getDivisionTimetable, periodRange } from '@/lib/timetable';

/**
 * The timetable prints 12-hour times.
 *
 * Students read "1:10 PM"; they do not read "13:10". The 24-hour strings stay
 * in the data because the schedule engine, the tests that pin the source row
 * and anything SQL-side compare them — so the conversion lives in exactly one
 * place (`lib/timetable/clock.js`) and the page asks for the label.
 */

describe('reading a single instant', () => {
  it('converts morning, afternoon, noon and midnight', () => {
    expect(formatClock12('09:00')).toBe('9:00 AM');
    expect(formatClock12('11:10')).toBe('11:10 AM');
    expect(formatClock12('12:00')).toBe('12:00 PM');
    expect(formatClock12('13:10')).toBe('1:10 PM');
    expect(formatClock12('17:10')).toBe('5:10 PM');
    expect(formatClock12('00:00')).toBe('12:00 AM');
    expect(formatClock12('00:05')).toBe('12:05 AM');
  });

  it('does not turn 12 o’clock into 0 o’clock', () => {
    // The classic %12 bug: noon must not print "0:00 PM".
    for (const value of ['12:00', '12:30', '00:30']) {
      expect(formatClock12(value)).not.toMatch(/\b0:/);
    }
  });

  it('keeps minutes two digits so columns do not jitter', () => {
    expect(formatClock12('9:05')).toBe('9:05 AM');
    expect(toClock12('09:05')).toMatchObject({ hour12: 9, minutes: 5, meridiem: 'AM' });
  });

  it('returns nothing rather than inventing a time for junk', () => {
    expect(toClock12('')).toBeNull();
    expect(toClock12(null)).toBeNull();
    expect(toClock12('lunch')).toBeNull();
    expect(formatClock12('soon')).toBe('');
  });
});

describe('reading a range', () => {
  it('states the meridiem once inside the same half of the day', () => {
    expect(formatClockRange12('09:00', '11:00')).toBe('9:00–11:00 AM');
    expect(formatClockRange12('13:10', '15:10')).toBe('1:10–3:10 PM');
  });

  it('names both halves when a range crosses noon', () => {
    // 11:10 AM – 12:10 PM: writing "11:10–12:10 PM" would read as evening.
    expect(formatClockRange12('11:10', '12:10')).toBe('11:10 AM – 12:10 PM');
    expect(formatClockRange12('11:10', '13:10')).toBe('11:10 AM – 1:10 PM');
  });

  it('degrades to the half it has instead of printing "undefined"', () => {
    expect(formatClockRange12('09:00', '')).toBe('9:00 AM');
    expect(formatClockRange12('', '11:00')).toBe('until 11:00 AM');
    expect(formatClockRange12('', '')).toBe('');
  });
});

describe('period columns', () => {
  it('labels all nine printed columns', () => {
    expect(TIMETABLE_PERIOD_LABELS).toHaveLength(TIMETABLE_PERIODS.length);
    expect(TIMETABLE_PERIOD_LABELS.map((entry) => entry.label)).toEqual([
      '9–10 AM',
      '10–11 AM',
      '11:10 AM – 12:10 PM',
      '12:10–1:10 PM',
      '1:10–2:10 PM',
      '2:10–3:10 PM',
      '3:10–4:10 PM',
      '4:10–5:10 PM',
      '5:10–6:10 PM',
    ]);
  });

  it('keeps the source period string addressable for the table keys', () => {
    expect(TIMETABLE_PERIOD_LABELS[0]).toEqual({ period: '09:00-10:00', label: '9–10 AM' });
    expect(TIMETABLE_PERIODS[0]).toBe('09:00-10:00');
  });

  it('leaves an unparseable column alone rather than blanking it', () => {
    expect(formatPeriodLabel('not-a-period')).toBe('not-a-period');
  });
});

describe('the timetable data carries both readings', () => {
  const day = getDivisionTimetable('O').days.find((entry) => entry.day === 'Friday');

  it('keeps 24-hour `from`/`to` for the engine', () => {
    // These are the values the schedule comparison depends on.
    const practical = day.events.find((event) => event.lines[0] === 'WDL-1/LAUC-2/DEL-3');
    expect(practical.time.from).toBe('09:00');
    expect(practical.time.to).toBe('11:00');
    expect(parseMinutes(practical.time.from)).toBe(540);
  });

  it('adds printed labels beside them', () => {
    const practical = day.events.find((event) => event.lines[0] === 'WDL-1/LAUC-2/DEL-3');
    expect(practical.time.fromLabel).toBe('9:00 AM');
    expect(practical.time.toLabel).toBe('11:00 AM');
    expect(practical.time.label12).toBe('9:00–11:00 AM');

    const afterLunch = periodRange(4, 5);
    expect(afterLunch).toMatchObject({ from: '13:10', to: '15:10', label12: '1:10–3:10 PM' });
  });

  it('labels a free range too, so the free row is not the one place still in 24-hour', () => {
    const free = day.freeRanges[day.freeRanges.length - 1];
    expect(free).toMatchObject({ from: '17:10', to: '18:10', fromLabel: '5:10 PM', toLabel: '6:10 PM' });
  });
});

describe('the campus clock', () => {
  it('renders 12-hour time and the meridiem alongside the 24-hour label', () => {
    const parts = getCampusTime(new Date('2026-10-23T07:20:00Z')); // 12:50 IST
    expect(parts.timeLabel).toBe('12:50');
    expect(parts.timeLabel12).toBe('12:50 PM');
    expect(parts.hourMinute12).toBe('12:50');
    expect(parts.meridiem).toBe('PM');
  });

  it('moves the meridiem with the half of the day', () => {
    expect(getCampusTime(new Date('2026-10-23T04:35:00Z'))).toMatchObject({ timeLabel12: '10:05 AM', meridiem: 'AM' });
    // 00:05 IST next day — still AM, now 12 o'clock.
    expect(getCampusTime(new Date('2026-10-23T18:35:00Z'))).toMatchObject({ hourMinute12: '12:05', meridiem: 'AM' });
  });
});

describe('the shipped icon', () => {
  it('ships a square PNG plus-glyph icon and an Apple touch icon', () => {
    for (const file of ['app/icon.png', 'app/apple-icon.png']) {
      const buffer = fs.readFileSync(file);
      // PNG signature, then IHDR: width/height at bytes 16..24.
      expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(buffer.readUInt32BE(16)).toBe(buffer.readUInt32BE(20));
    }
  });

  it('does not leave the placeholder SVG in place to shadow it', () => {
    // A route with both icon.svg and icon.png emits two competing links.
    expect(fs.existsSync('app/icon.svg')).toBe(false);
  });
});
