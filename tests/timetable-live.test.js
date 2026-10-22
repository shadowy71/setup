import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import TimetableLive from '@/components/timetable/TimetableLive';

import { getDivisionTimetable } from '@/lib/timetable';
import {
  formatMinutes,
  getCampusTime,
  parseMinutes,
  resolveDaySelection,
  timetableDayFor,
} from '@/lib/timetable/clock';
import { getDayStatus, isAcademicEvent } from '@/lib/timetable/schedule';
import { NEUTRAL_ACCENT, subjectAccent, subjectRoot } from '@/lib/timetable/meta';

/**
 * The live timetable: the campus clock, the NOW/NEXT rules and the small
 * contracts that keep them honest in the browser.
 *
 * Everything time-related is pinned to fixed instants in Asia/Kolkata, so
 * these tests say the same thing at 09:00 and at midnight, on any machine.
 */

const read = (file) => fs.readFileSync(file, 'utf8');

function dayOf(division, name) {
  return getDivisionTimetable(division).days.find((entry) => entry.day === name);
}

function statusAt(division, dayName, time, isToday = true) {
  const day = dayOf(division, dayName);
  return getDayStatus({
    events: day.events,
    freeRanges: day.freeRanges,
    nowMinutes: parseMinutes(time),
    isToday,
  });
}

describe('campus clock (Asia/Kolkata)', () => {
  it('derives the wall clock from the institute timezone, not the host', () => {
    // 04:35:07 UTC is 10:05:07 IST.
    const parts = getCampusTime(new Date('2026-10-23T04:35:07Z'));
    expect(parts.weekday).toBe('Friday');
    expect(parts.timeLabel).toBe('10:05');
    expect(parts.secondLabel).toBe('07');
    expect(parts.minutesOfDay).toBe(605);
    expect(parts.dateLabel).toBe('Friday, 23 Oct');
    expect(parts.isWeekend).toBe(false);
  });

  it('has no daylight-saving drift in December', () => {
    expect(getCampusTime(new Date('2026-12-23T04:35:00Z')).timeLabel).toBe('10:05');
  });

  it('rolls the date and weekday over at IST midnight', () => {
    const fridayLate = getCampusTime(new Date('2026-10-23T18:29:59Z'));
    expect(fridayLate.timeLabel).toBe('23:59');
    expect(fridayLate.dateLabel).toBe('Friday, 23 Oct');

    const saturday = getCampusTime(new Date('2026-10-23T18:30:00Z'));
    expect(saturday.timeLabel).toBe('00:00');
    expect(saturday.dateLabel).toBe('Saturday, 24 Oct');
    expect(saturday.minutesOfDay).toBe(0);
    expect(saturday.isWeekend).toBe(true);
  });

  it('opens on a weekday only', () => {
    expect(timetableDayFor('Monday')).toBe('Monday');
    expect(timetableDayFor('Friday')).toBe('Friday');
    expect(timetableDayFor('Saturday')).toBeNull();
    expect(timetableDayFor('Sunday')).toBeNull();
  });

  it('keeps a manual choice, and otherwise follows the real weekday', () => {
    expect(resolveDaySelection({ selected: 'Monday', pinned: true, today: 'Tuesday' })).toBe('Monday');
    expect(resolveDaySelection({ selected: 'Monday', pinned: false, today: 'Tuesday' })).toBe('Tuesday');
    expect(resolveDaySelection({ selected: 'Friday', pinned: false, today: null })).toBeNull();
    expect(resolveDaySelection({ selected: null, pinned: true, today: 'Monday' })).toBeNull();
  });

  it('parses and formats the printed period boundaries', () => {
    expect(parseMinutes('09:00')).toBe(540);
    expect(parseMinutes('17:10')).toBe(1030);
    expect(formatMinutes(610)).toBe('10:10');
    expect(formatMinutes(1030)).toBe('17:10');
  });
});

describe('NOW / NEXT rules on real timetables', () => {
  it('before the first class, the first class is next and nothing is ongoing', () => {
    const status = statusAt('O', 'Thursday', '08:59');
    expect(status.phase).toBe('before');
    expect(status.ongoing).toBeNull();
    expect(status.next.lines[0]).toBe('DELD');
    expect(status.next.time.from).toBe('09:00');
  });

  it('at the starting minute the class is ongoing (start <= now)', () => {
    const status = statusAt('O', 'Thursday', '09:00');
    expect(status.phase).toBe('class');
    expect(status.ongoing.lines[0]).toBe('DELD');
    expect(status.next.lines[0]).toBe('EPH');
  });

  it('at the ending minute the class is finished and the next one is ongoing', () => {
    // 10:00 exactly: DELD (09:00–10:00) is over, EPH (10:00–11:00) begins.
    const status = statusAt('O', 'Thursday', '10:00');
    expect(status.ongoing.lines[0]).toBe('EPH');
  });

  it('never marks a past session as upcoming', () => {
    const status = statusAt('O', 'Thursday', '10:00');
    expect(status.next.startMinutes).toBeGreaterThan(600);
    expect(status.next.lines[0]).not.toBe('DELD');
  });

  it('treats the 11:00–11:10 changeover as a gap, not a class', () => {
    const status = statusAt('O', 'Thursday', '11:05');
    expect(status.phase).toBe('gap');
    expect(status.ongoing).toBeNull();
    expect(status.next.time.from).toBe('11:10');
  });

  it('highlights a two-period practical for its whole duration', () => {
    const status = statusAt('O', 'Thursday', '11:10');
    expect(status.ongoing.lines[0]).toBe('DEL-1/WDL-2/LAUC-3');
    expect(status.ongoing.span).toBe(2);
    expect(status.ongoing.time.label).toBe('11:10-13:10');

    // Still the same block ten minutes before it ends.
    const later = statusAt('O', 'Thursday', '13:09');
    expect(later.ongoing.id).toBe(status.ongoing.id);
  });

  it('does not call lunch a class, and looks past it for NEXT', () => {
    // Division O's lunch sits at 13:10–14:10; Division O Tuesday's at 12:10–13:10.
    const thursday = statusAt('O', 'Thursday', '13:30');
    expect(thursday.phase).toBe('lunch');
    expect(thursday.ongoing).toBeNull();
    expect(thursday.next.lines[0]).toBe('LAUC');
    expect(thursday.next.time.from).toBe('14:10');

    const tuesday = statusAt('O', 'Tuesday', '12:30');
    expect(tuesday.phase).toBe('lunch');
    expect(tuesday.ongoing).toBeNull();
    expect(tuesday.next.lines[0]).toBe('COI');
    expect(tuesday.next.time.from).toBe('13:10');
  });

  it('does not call the Empowerment Hour a class', () => {
    const status = statusAt('O', 'Tuesday', '14:30');
    expect(status.phase).toBe('special');
    expect(status.ongoing).toBeNull();
    expect(status.current.lines.join(' ')).toBe('Empowerment Hour');
    expect(status.next).toBeNull();
  });

  it('reports a free printed slot as free, and no more classes after it', () => {
    // Division A's Monday row ends at 17:10; 17:10–18:10 is printed blank.
    const status = statusAt('A', 'Monday', '17:30');
    expect(status.phase).toBe('free');
    expect(status.ongoing).toBeNull();
    expect(status.next).toBeNull();
    expect(status.currentFree.from).toBe('17:10');
  });

  it('says "no more classes" after the last academic session', () => {
    // 17:10 is the printed blank after Division O's Thursday EPH; the day is
    // over either way, and nothing may be offered as upcoming.
    const trailingFree = statusAt('O', 'Thursday', '17:10');
    expect(trailingFree.phase).toBe('free');
    expect(trailingFree.next).toBeNull();

    for (const time of ['18:10', '18:30', '23:59']) {
      const status = statusAt('O', 'Thursday', time);
      expect(status.phase, time).toBe('after');
      expect(status.ongoing, time).toBeNull();
      expect(status.next, time).toBeNull();
    }
  });

  it('never picks a class from an earlier weekday or wraps to Monday', () => {
    const status = statusAt('O', 'Friday', '18:30');
    expect(status.next).toBeNull();
  });

  it('shows another day without claiming anything is happening', () => {
    const status = statusAt('O', 'Monday', '09:30', false);
    expect(status.isToday).toBe(false);
    expect(status.phase).toBe('other-day');
    expect(status.ongoing).toBeNull();
    expect(status.next).toBeNull();
    expect(status.first.lines[0]).toBe('WDL-1/ENG-2/WDL-3');
  });

  it('keeps lunch and specials out of the academic set everywhere', () => {
    for (const division of ['A', 'L', 'O', 'R']) {
      for (const day of ['Monday', 'Wednesday', 'Friday']) {
        const events = dayOf(division, day).events;
        for (const event of events) {
          if (event.kind === 'lunch' || event.kind === 'special') {
            expect(isAcademicEvent(event)).toBe(false);
          } else {
            expect(isAcademicEvent(event)).toBe(true);
          }
        }
      }
    }
  });

  it('never reports two ongoing sessions for one division-day', () => {
    for (const division of ['A', 'G', 'L', 'O', 'Q']) {
      for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
        const events = dayOf(division, day).events;
        const freeRanges = dayOf(division, day).freeRanges;
        for (let minutes = 480; minutes < 1200; minutes += 5) {
          const status = getDayStatus({ events, freeRanges, nowMinutes: minutes, isToday: true });
          const ongoing = events.filter(
            (event) => event.startMinutes <= minutes && minutes < event.endMinutes,
          );
          expect(ongoing.length, `${division} ${day} ${minutes}`).toBeLessThanOrEqual(1);
          if (status.ongoing) {
            expect(status.ongoing.startMinutes).toBeLessThanOrEqual(minutes);
            expect(minutes).toBeLessThan(status.ongoing.endMinutes);
          }
          if (status.next) {
            expect(status.next.startMinutes).toBeGreaterThan(minutes);
            if (status.ongoing) expect(status.next.id).not.toBe(status.ongoing.id);
          }
        }
      }
    }
  });

  it('covers the whole teaching day for an empty or broken day without throwing', () => {
    const empty = getDayStatus({ events: [], freeRanges: [], nowMinutes: 600, isToday: true });
    expect(empty.phase).toBe('empty');
    expect(empty.ongoing).toBeNull();
    expect(empty.next).toBeNull();
  });
});

describe('subject accents', () => {
  it('reads the printed subject root, never an expansion', () => {
    expect(subjectRoot('WDL-1/ENG-2/WDL-3')).toBe('WDL');
    expect(subjectRoot('LS 2')).toBe('LS');
    expect(subjectRoot('DELD #')).toBe('DELD');
    expect(subjectRoot('[COI')).toBe('COI');
    expect(subjectRoot('EG- 2')).toBe('EG');
    expect(subjectRoot('1234')).toBeNull();
  });

  it('assigns one stable accent per subject family', () => {
    expect(subjectAccent('LAUC')).toBe('teal');
    expect(subjectAccent('EPH-1/DEL-2/WDL-3')).toBe('sky');
    expect(subjectAccent('ECH')).toBe('violet');
    expect(subjectAccent('DECO-3')).toBe('rose');
    expect(subjectAccent('ENG-2')).toBe('orange');
    expect(subjectAccent('LS-1')).toBe('sand');
    expect(subjectAccent('WDL-2')).toBe('mint');
  });

  it('gives the long tail a neutral edge instead of inventing colours', () => {
    expect(subjectAccent('CTPS')).toBe(NEUTRAL_ACCENT);
    expect(subjectAccent('DELD')).toBe(NEUTRAL_ACCENT);
    expect(subjectAccent('[COI')).toBe(NEUTRAL_ACCENT);
  });

  it('reuses the same accent across divisions and weekdays', () => {
    expect(subjectAccent('LAUC-1/ENG-2/DECO-3')).toBe(subjectAccent('LAUC'));
    expect(subjectAccent('DECO #')).toBe(subjectAccent('DECO-1/CTPS-2/WDL-3'));
  });

  it('only lists accented families in the division legend', () => {
    const subjects = getDivisionTimetable('O').subjects;
    expect(subjects.map((entry) => entry.code)).toEqual(['WDL', 'EPH', 'LAUC', 'ENG', 'LS']);
    expect(subjects.every((entry) => entry.accent !== NEUTRAL_ACCENT)).toBe(true);
  });
});

describe('live component contracts', () => {
  const source = read('components/timetable/TimetableLive.js');
  const css = read('app/styles/timetable.css');

  it('is a client component that owns exactly one interval and clears it', () => {
    expect(source.startsWith("'use client';")).toBe(true);
    expect(source.match(/setInterval\(/g)).toHaveLength(1);
    expect(source.match(/clearInterval\(/g)).toHaveLength(1);
    expect(source).toMatch(/return \(\) => window\.clearInterval\(timer\)/);
    expect(source.match(/useEffect\(/g)).toHaveLength(2);
  });

  it('derives today and the status from the campus clock, not the day index', () => {
    expect(source).toContain('getCampusTime(now)');
    expect(source).toContain('timetableDayFor(parts.weekday)');
    expect(source).toContain('nowMinutes: parts.minutesOfDay');
    expect(source).not.toMatch(/weekdayIndex\s*[-+]/);
  });

  it('keeps NOW and NEXT mutually exclusive and labelled in words', () => {
    expect(source).toContain('ongoing ?');
    expect(source).toContain('tt-badge--now');
    expect(source).toContain('tt-badge--next');
    expect(source).toContain('No more classes today');
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-pressed');
  });

  it('updates the URL without a page reload and keeps the day when pinned', () => {
    expect(source).toContain('window.history.replaceState');
    expect(source).not.toContain('router.push');
    expect(source).toContain('pinnedRef.current = true');
  });

  it('exposes a TODAY marker and a way back to today', () => {
    expect(source).toContain('tt-tab__today');
    expect(source).toContain('today` : name}');
    expect(source).toContain('showToday');
  });

  it('treats the weekend as a state, not a schedule', () => {
    expect(source).toContain('No classes this weekend');
    expect(source).toContain('!selected ?');
  });

  it('uses a single, backed glass surface and no theme switch', () => {
    // One unprefixed declaration for the clock (the -webkit alias sits on its
    // own line, and the @supports condition is a feature query, not a second
    // blurred surface).
    expect(css.match(/^\s+backdrop-filter: blur\(10px\)/gm)).toHaveLength(1);
    expect(css).toContain('@supports not ((backdrop-filter: blur(1px))');
    expect(css).not.toContain('data-theme');
    expect(css).not.toContain('prefers-color-scheme');
  });

  it('respects reduced motion and keeps text on tokens', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
    expect(css).toContain('font-variant-numeric: tabular-nums');
    expect(css).not.toMatch(/\.tt-item[^{]*\{[^}]*color:\s*var\(--tt-hue/);
  });
});

describe('rendered day view (server pass, fixed instants)', () => {
  function renderLive({ division = 'O', day, pinned = false, iso }) {
    const timetable = getDivisionTimetable(division);
    return renderToStaticMarkup(
      React.createElement(TimetableLive, {
        division: timetable.division,
        label: timetable.label,
        friendly: timetable.friendly,
        days: timetable.days.map(({ day: name, events, freeRanges }) => ({ day: name, events, freeRanges })),
        subjects: timetable.subjects,
        initialDay: day,
        initialPinned: pinned,
        initialNow: iso,
      }),
    );
  }

  it('opens on the institute weekday with a live clock and one NOW + one NEXT', () => {
    // Friday 10:05 IST — inside Division O's 09:00–11:00 practical block.
    const html = renderLive({ day: 'Friday', iso: '2026-10-23T04:35:00Z' });

    expect(html).toContain('Friday, 23 Oct');
    expect(html).toMatch(/10:05<span class="tt-clock__seconds">:00<\/span>/);
    expect(html).toContain('IST · Asia/Kolkata');
    expect(html).toContain('aria-pressed="true" aria-label="Friday, today">Fri');

    // The whole two-period practical is the ongoing session, not a fragment.
    expect(html.match(/tt-badge--now/g)).toHaveLength(1);
    expect(html.match(/tt-badge--next/g)).toHaveLength(1);
    expect(html).toContain('Now: WDL · 09:00–11:00.');
    expect(html).toContain('Next: EPH at 11:10.');
    expect(html).toContain('2 periods');
    expect(html).not.toContain('tt-jump');
  });

  it('renders the weekend state instead of inventing a Saturday', () => {
    const html = renderLive({ day: null, iso: '2026-10-23T18:35:00Z' });

    expect(html).toContain('Saturday, 24 Oct');
    expect(html).toContain('No classes this weekend');
    expect(html).not.toContain('tt-badge--now');
    expect(html).not.toContain('tt-badge--next');
    expect(html).toContain('aria-pressed="false" aria-label="Monday">Mon');
  });

  it('keeps a manually chosen day without claiming it is live', () => {
    const html = renderLive({ day: 'Monday', pinned: true, iso: '2026-10-23T04:35:00Z' });

    expect(html).toContain('Not today — Monday’s first class is WDL-1/ENG-2/WDL-3 at 09:00.');
    expect(html).not.toContain('tt-badge--now');
    expect(html).not.toContain('tt-badge--next');
    expect(html).toContain('aria-pressed="true" aria-label="Monday">Mon');
    expect(html).toContain('tt-jump');
  });

  it('marks lunch as a break and still finds the next academic class', () => {
    // Friday 12:50 IST — Division O's Friday lunch (12:10–13:10).
    const html = renderLive({ day: 'Friday', iso: '2026-10-23T07:20:00Z' });

    expect(html).toContain('Lunch break until 13:10.');
    expect(html).toContain('Next: LAUC at 13:10.');
    expect(html.match(/tt-badge--now/g)).toBeNull();
    expect(html.match(/tt-badge--next/g)).toHaveLength(1);
  });

  it('at a period boundary the old class is over', () => {
    // Friday 11:00 IST — the 09:00–11:00 block just ended; 11:10 is next.
    const html = renderLive({ day: 'Friday', iso: '2026-10-23T05:30:00Z' });

    expect(html).not.toContain('tt-badge--now');
    expect(html).toContain('Next class: EPH at 11:10.');
  });

  it('says there are no more classes once the day is over', () => {
    // Friday 17:30 IST — the printed row ends at 17:10.
    const html = renderLive({ day: 'Friday', iso: '2026-10-23T12:00:00Z' });

    expect(html).toContain('No more classes today.');
    expect(html).not.toContain('tt-badge--now');
    expect(html).not.toContain('tt-badge--next');
  });

  it('lets lunch keep its own treatment instead of a subject accent', () => {
    const html = renderLive({ day: 'Friday', iso: '2026-10-23T07:20:00Z' });
    const lunch = html.match(/<li class="tt-item tt-item--lunch"[^>]*>/);
    expect(lunch).not.toBeNull();
    expect(lunch[0]).not.toContain('--tt-accent');
  });

  it('keeps the source strings and the legend in the rendered output', () => {
    const html = renderLive({ day: 'Friday', iso: '2026-10-23T04:35:00Z' });

    expect(html).toContain('WDL-1/LAUC-2/DEL-3');
    expect(html).toContain('[SAT/GNT/RVT]');
    expect(html).toContain('[5309L/6504L/5406L]');
    expect(html).toContain('Batches');
    expect(html).toContain('aria-label="Subject colours"');
    expect(html).toContain('Empowerment Hour');
  });
});
