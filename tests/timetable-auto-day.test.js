import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  hasLectures,
  isScheduleComplete,
  lastLectureEndMinutes,
  lecturesOf,
  resolveAutoDay,
} from '@/lib/timetable/auto-day';
import { getCampusTime, parseMinutes } from '@/lib/timetable/clock';
import { getDivisionTimetable } from '@/lib/timetable';
import { isAcademicEvent } from '@/lib/timetable/schedule';

/**
 * The timetable is schedule-aware, not midnight-aware.
 *
 * A day stays on screen until its **last scheduled lecture ends**, so these
 * tests are written in wall-clock minutes: 15:29 is still Monday, 15:30 is
 * already Tuesday. Nothing here waits for a real clock, and nothing here
 * hardcodes a switching hour — every expectation is derived from the events of
 * the day under test.
 */

const read = (file) => fs.readFileSync(file, 'utf8');

/** One academic session, in the shape the view model renders. */
function lecture(from, to, subject = 'SUB') {
  return {
    id: `${from}-${to}-${subject}`,
    start: 0,
    end: 0,
    span: 1,
    lines: [subject],
    kind: 'standard',
    needsVerification: false,
    accent: 'neutral',
    subject,
    time: { from, to, fromLabel: from, toLabel: to, label12: `${from}-${to}` },
    startMinutes: parseMinutes(from),
    endMinutes: parseMinutes(to),
  };
}

/** One non-academic entry: never a switching time, never a lecture. */
function nonLecture(from, to, label = 'Lunch') {
  return { ...lecture(from, to, label), kind: label === 'Lunch' ? 'lunch' : 'special' };
}

function day(name, events) {
  return { day: name, events, freeRanges: [] };
}

/**
 * The example from the brief: four Monday lectures, the last one 13:30–15:30,
 * and a Tuesday whose own last lecture ends at a different time.
 */
const EXAMPLE_WEEK = [
  day('Monday', [
    lecture('09:00', '10:00', 'ONE'),
    lecture('10:00', '11:00', 'TWO'),
    lecture('11:30', '12:30', 'THREE'),
    lecture('13:30', '15:30', 'FOUR'),
  ]),
  day('Tuesday', [
    lecture('09:00', '10:00', 'ONE'),
    lecture('10:00', '11:00', 'TWO'),
    lecture('11:30', '12:30', 'THREE'),
    nonLecture('12:30', '13:30'),
    lecture('13:30', '17:10', 'FOUR'),
  ]),
  day('Wednesday', [lecture('09:00', '10:00', 'ONE')]),
  day('Thursday', [lecture('09:00', '11:00', 'ONE')]),
  day('Friday', [lecture('09:00', '10:00', 'ONE')]),
];

const at = (dayName, time, days = EXAMPLE_WEEK) =>
  resolveAutoDay({ days, weekday: dayName, nowMinutes: parseMinutes(time) });

describe('reading the last lecture from a day’s own data', () => {
  it('takes the latest academic ending time, not the last row printed', () => {
    const monday = EXAMPLE_WEEK[0];
    expect(lastLectureEndMinutes(monday)).toBe(parseMinutes('15:30'));
    // Tuesday's last row ends at 17:10; lunch is not a lecture.
    expect(lecturesOf(EXAMPLE_WEEK[1])).toHaveLength(4);
    expect(lastLectureEndMinutes(EXAMPLE_WEEK[1])).toBe(parseMinutes('17:10'));
  });

  it('ignores lunch, blank columns and the Empowerment Hour', () => {
    const withSpecials = day('Monday', [
      lecture('09:00', '10:00', 'ONE'),
      nonLecture('10:00', '11:00'),
      nonLecture('11:00', '12:00', 'Empowerment'),
      nonLecture('12:00', '18:00', 'Lunch'),
    ]);
    expect(lastLectureEndMinutes(withSpecials)).toBe(parseMinutes('10:00'));

    const onlySpecials = day('Monday', [nonLecture('09:00', '18:00')]);
    expect(hasLectures(onlySpecials)).toBe(false);
    expect(lastLectureEndMinutes(onlySpecials)).toBeNull();
  });

  it('reads a day without events as empty instead of throwing', () => {
    for (const empty of [null, undefined, { day: 'Monday' }, { day: 'Monday', events: [] }]) {
      expect(hasLectures(empty)).toBe(false);
      expect(lastLectureEndMinutes(empty)).toBeNull();
      expect(isScheduleComplete(empty, 600)).toBe(false);
    }
  });

  it('treats the printed ending minute as already over (half-open)', () => {
    const monday = EXAMPLE_WEEK[0];
    expect(isScheduleComplete(monday, parseMinutes('15:29'))).toBe(false);
    expect(isScheduleComplete(monday, parseMinutes('15:30'))).toBe(true);
    expect(isScheduleComplete(monday, parseMinutes('23:59'))).toBe(true);
  });
});

describe('Scenario A — the day is still running', () => {
  it('keeps Monday before the first lecture, during gaps and during the last lecture', () => {
    // The brief's own example: 14:00 and 15:15 are both still Monday.
    expect(at('Monday', '08:00').day).toBe('Monday');
    expect(at('Monday', '09:30').day).toBe('Monday');
    expect(at('Monday', '12:45').day).toBe('Monday');
    expect(at('Monday', '14:00').day).toBe('Monday');
    expect(at('Monday', '15:15').day).toBe('Monday');
    expect(at('Monday', '15:29').day).toBe('Monday');
  });

  it('reports why it stayed, and what the switch will be measured against', () => {
    const status = at('Monday', '14:00');
    expect(status.reason).toBe('in-session');
    expect(status.today).toBe('Monday');
    expect(status.todayHasLectures).toBe(true);
    expect(status.todayComplete).toBe(false);
    expect(status.endsAtMinutes).toBe(parseMinutes('15:30'));
  });
});

describe('Scenario B — the last lecture has ended', () => {
  it('switches at exactly the ending time and stays switched afterwards', () => {
    // 15:30 is the boundary: the 13:30–15:30 lecture is over.
    expect(at('Monday', '15:30').day).toBe('Tuesday');
    expect(at('Monday', '15:31').day).toBe('Tuesday');
    expect(at('Monday', '16:00').day).toBe('Tuesday');
    expect(at('Monday', '23:59').day).toBe('Tuesday');

    expect(at('Monday', '15:30').todayComplete).toBe(true);
    expect(at('Monday', '15:30').reason).toBe('after-last-lecture');
  });

  it('calculates the transition independently for every day', () => {
    // Tuesday's own last lecture ends at 17:10, not Monday's 15:30.
    expect(at('Tuesday', '15:30').day).toBe('Tuesday');
    expect(at('Tuesday', '17:09').day).toBe('Tuesday');
    expect(at('Tuesday', '17:10').day).toBe('Wednesday');

    // Wednesday, Thursday and Friday each end when their own data says.
    expect(at('Wednesday', '10:00').day).toBe('Thursday');
    expect(at('Thursday', '10:59').day).toBe('Thursday');
    expect(at('Thursday', '11:00').day).toBe('Friday');
    expect(at('Friday', '09:59').day).toBe('Friday');
    expect(at('Friday', '10:00').day).toBe('Monday');
  });

  it('follows the real timetable, not the example', () => {
    // Division O: Monday ends 17:10, Tuesday 14:10 (its 14:10–15:10 row is the
    // Empowerment Hour), Wednesday 17:10.
    const timetable = getDivisionTimetable('O');
    const days = timetable.days;
    const resolve = (weekday, time) =>
      resolveAutoDay({ days, weekday, nowMinutes: parseMinutes(time) }).day;

    expect(resolve('Monday', '17:09')).toBe('Monday');
    expect(resolve('Monday', '17:10')).toBe('Tuesday');
    expect(resolve('Tuesday', '14:00')).toBe('Tuesday');
    expect(resolve('Tuesday', '14:10')).toBe('Wednesday');
    expect(resolve('Wednesday', '17:10')).toBe('Thursday');
    expect(resolve('Friday', '17:10')).toBe('Monday');
  });
});

describe('empty days, weekends and late nights', () => {
  it('skips a day with no lectures and lands on the next one that has them', () => {
    const week = [
      day('Monday', [lecture('09:00', '10:00', 'ONE')]),
      day('Tuesday', []),
      day('Wednesday', [lecture('09:00', '10:00', 'THREE')]),
      day('Thursday', []),
      day('Friday', []),
    ];
    // Monday has run out: Tuesday is skipped, so Wednesday is next.
    expect(resolveAutoDay({ days: week, weekday: 'Monday', nowMinutes: 600 }).day).toBe('Wednesday');
    // Before Monday's lecture the empty Tuesday never appears either.
    expect(resolveAutoDay({ days: week, weekday: 'Monday', nowMinutes: 500 }).day).toBe('Monday');
    // Sunday (no timetable day at all) is the week's first teaching day.
    expect(resolveAutoDay({ days: week, weekday: 'Sunday', nowMinutes: 0 }).day).toBe('Monday');
  });

  it('skips a day that only has lunch and the Empowerment Hour printed', () => {
    const week = [
      day('Monday', [lecture('09:00', '10:00', 'ONE')]),
      day('Tuesday', [nonLecture('09:00', '10:00'), nonLecture('10:00', '11:00', 'Empowerment')]),
      day('Wednesday', [lecture('09:00', '10:00', 'THREE')]),
    ];
    expect(resolveAutoDay({ days: week, weekday: 'Monday', nowMinutes: 700 }).day).toBe('Wednesday');
    const onTuesday = resolveAutoDay({ days: week, weekday: 'Tuesday', nowMinutes: 400 });
    expect(onTuesday.day).toBe('Wednesday');
    expect(onTuesday.reason).toBe('today-empty');
  });

  it('shows Monday all weekend, at any hour', () => {
    for (const weekday of ['Saturday', 'Sunday']) {
      for (const time of ['00:00', '09:00', '15:30', '23:59']) {
        const status = resolveAutoDay({
          days: EXAMPLE_WEEK,
          weekday,
          nowMinutes: parseMinutes(time),
        });
        expect(status.day, `${weekday} ${time}`).toBe('Monday');
        expect(status.today, `${weekday} ${time}`).toBeNull();
        expect(status.reason, `${weekday} ${time}`).toBe('next-teaching-day');
      }
    }
  });

  it('opens on the next scheduled day late at night', () => {
    expect(at('Monday', '23:59').day).toBe('Tuesday');
    expect(at('Thursday', '23:59').day).toBe('Friday');
    // No timetable on Saturday: Monday.
    expect(resolveAutoDay({ days: EXAMPLE_WEEK, weekday: 'Saturday', nowMinutes: 0 }).day).toBe('Monday');
  });

  it('never lands on a day that has no lectures, even if that is the only other day', () => {
    const week = [day('Monday', [lecture('09:00', '10:00')]), day('Tuesday', [])];
    expect(resolveAutoDay({ days: week, weekday: 'Monday', nowMinutes: 600 }).day).toBe('Monday');
  });
});

describe('no timetable data', () => {
  it('returns null instead of a day when nothing is scheduled', () => {
    const empty = resolveAutoDay({ days: [], weekday: 'Monday', nowMinutes: 600 });
    expect(empty.day).toBeNull();
    expect(empty.reason).toBe('empty');
    expect(empty.todayHasLectures).toBe(false);

    const allEmpty = resolveAutoDay({
      days: [day('Monday', []), day('Tuesday', [])],
      weekday: 'Monday',
      nowMinutes: 600,
    });
    expect(allEmpty.day).toBeNull();
    expect(allEmpty.reason).toBe('empty');
  });

  it('survives missing arguments rather than throwing', () => {
    expect(resolveAutoDay().day).toBeNull();
    expect(resolveAutoDay({ days: null, weekday: null, nowMinutes: null }).day).toBeNull();
  });
});

describe('timezone and wiring', () => {
  it('is driven by the institute clock, so a browser in another timezone cannot move the switch', () => {
    // 2026-10-26 (Monday) 12:45 UTC is 18:15 IST — after Division O's Monday.
    const mondayEvening = getCampusTime(new Date('2026-10-26T12:45:00Z'));
    expect(mondayEvening.weekday).toBe('Monday');
    expect(mondayEvening.minutesOfDay).toBe(parseMinutes('18:15'));

    const timetable = getDivisionTimetable('O');
    const resolved = resolveAutoDay({
      days: timetable.days,
      weekday: mondayEvening.weekday,
      nowMinutes: mondayEvening.minutesOfDay,
    });
    expect(resolved.day).toBe('Tuesday');

    // 2026-10-26 05:00 UTC is 10:30 IST — still Monday, same timetable.
    const mondayMorning = getCampusTime(new Date('2026-10-26T05:00:00Z'));
    expect(
      resolveAutoDay({
        days: timetable.days,
        weekday: mondayMorning.weekday,
        nowMinutes: mondayMorning.minutesOfDay,
      }).day,
    ).toBe('Monday');
  });

  it('is read from the events the page already renders, not a second copy of the data', () => {
    const source = read('lib/timetable/auto-day.js');
    // One timetable, one schedule rule set: no dataset import, no hour literal.
    expect(source).not.toContain('master-timetable');
    expect(source).toContain("from '@/lib/timetable/schedule'");
    // No clock time in the code itself (the doc comment may quote an example):
    // the switch is never a constant, not even as a default.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/['"`](?:\d|1\d|2[0-3]):[0-5]\d['"`]/);
    expect(source).toContain('Math.max(end, bound)');
  });

  it('is used by the live view, the server page and the offline shell', () => {
    const live = read('components/timetable/TimetableLive.js');
    expect(live).toContain('resolveAutoDay({ days, weekday: parts.weekday, nowMinutes: parts.minutesOfDay })');
    // The automatic switch happens when that answer changes, on the one tick.
    expect(live).toContain('}, [autoDay, today]);');

    const page = read('app/timetable/[division]/page.js');
    expect(page).toContain('resolveAutoDay({');
    expect(page).toContain('const initialDay = requestedDay ?? auto.day;');

    const offline = read('components/timetable/TimetableOfflineShell.js');
    expect(offline).toContain('resolveAutoDay({');
    expect(offline).toContain('initialDay={initialDay}');
  });

  it('still counts every non-academic entry as non-academic', () => {
    for (const entry of EXAMPLE_WEEK[1].events) {
      expect(isAcademicEvent(entry)).toBe(entry.kind === 'standard' || entry.kind === 'batch');
    }
  });
});
