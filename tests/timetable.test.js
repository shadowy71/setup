import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DIVISIONS, ROUTES } from '@/lib/constants';
import { MASTER_TIMETABLE_2026_27_SEM1 as SOURCE } from '@/lib/timetable/master-timetable-2026-27-sem1';
import { DIVISION_PROGRAMMES, getTimetableHref, normalizeDivision } from '@/lib/timetable/meta';
import { adjacentDivisions, getDivisionSummaries, getDivisionTimetable } from '@/lib/timetable';

/**
 * Public division timetables.
 *
 * The dataset is a verbatim transcription of the AS & H master timetable
 * (SEM-I 2026–27); these tests pin its integrity so a future edit cannot
 * silently drop a division, move lunch, "tidy" a source string, or widen
 * the public surface. They also pin the two behaviours around it: the
 * pages stay public, and the logged-in shortcut follows the saved profile
 * division without ever inferring one.
 */

const read = (file) => fs.readFileSync(file, 'utf8');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

describe('embedded master timetable data', () => {
  it('covers all five days and all eighteen divisions', () => {
    expect(Object.keys(SOURCE.days)).toEqual(DAYS);
    expect(SOURCE.period_columns).toHaveLength(9);
    expect(SOURCE.period_columns[0]).toBe('09:00-10:00');
    for (const day of DAYS) {
      expect(Object.keys(SOURCE.days[day]), day).toEqual(DIVISIONS);
    }
  });

  it('keeps the source branch label for every division-day', () => {
    for (const day of DAYS) {
      for (const division of DIVISIONS) {
        expect(SOURCE.days[day][division].branch, `${day} ${division}`).toBe(DIVISION_PROGRAMMES[division].label);
      }
    }
    // Source abbreviations stay distinct and unmangled.
    expect(DIVISION_PROGRAMMES.N.label).toBe('Comp-R');
    expect(DIVISION_PROGRAMMES.D.label).toBe('E & TC');
    expect(JSON.stringify(SOURCE)).not.toContain('&amp;');
  });

  it('aligns raw cells and event spans to the nine period columns', () => {
    let eventCount = 0;
    for (const day of DAYS) {
      for (const division of DIVISIONS) {
        const entry = SOURCE.days[day][division];
        expect(entry.raw_cells, `${day} ${division}`).toHaveLength(9);
        const covered = new Set();
        for (const [start, end, lines, flag] of entry.events) {
          eventCount += 1;
          expect(start).toBeGreaterThanOrEqual(0);
          expect(end).toBeGreaterThanOrEqual(start);
          expect(end).toBeLessThanOrEqual(8);
          expect(lines.length).toBeGreaterThan(0);
          expect(typeof flag).toBe('boolean');
          for (let i = start; i <= end; i += 1) {
            expect(covered.has(i), `${day} ${division} overlap at ${i}`).toBe(false);
            covered.add(i);
          }
        }
      }
    }
    expect(eventCount).toBe(567);
  });

  it('does not force a common lunch time', () => {
    const lunchColumns = new Set();
    for (const day of DAYS) {
      for (const division of DIVISIONS) {
        for (const [start, , lines] of SOURCE.days[day][division].events) {
          if (lines[0] === 'Lunch') lunchColumns.add(start);
        }
      }
    }
    expect([...lunchColumns].sort()).toEqual([3, 4]);
    // Every division-day has exactly one lunch.
    for (const day of DAYS) {
      for (const division of DIVISIONS) {
        const lunches = SOURCE.days[day][division].events.filter(([, , lines]) => lines[0] === 'Lunch');
        expect(lunches, `${day} ${division}`).toHaveLength(1);
      }
    }
  });

  it('preserves source strings exactly, including the awkward ones', () => {
    const monday = (division) => SOURCE.days.Monday[division].events;
    // A batch practical: subjects / faculty / rooms kept together, verbatim.
    expect(monday('A')[0]).toEqual([
      0,
      1,
      ['EG-1/ENG-2/FES-3', '[AVS/SPG/PPM]', '[9407DH/6504L/9511L]'],
      false,
    ]);
    // '#' markers and the empowerment hour survive untouched.
    expect(monday('A').some(([, , lines]) => lines[0] === 'FES #')).toBe(true);
    expect(monday('J').at(-1)).toEqual([8, 8, ['Empowerment', 'Hour'], false]);
    // Extraction artefacts are data, not bugs to clean up here.
    const tuesdayQ = SOURCE.days.Tuesday.Q.events.at(-1);
    expect(tuesdayQ[2][2]).toBe('[5302L/6119L//5305L]');
  });

  it('flags exactly the two uncertain reconstructions, and fingers them', () => {
    const flagged = [];
    for (const day of DAYS) {
      for (const division of DIVISIONS) {
        for (const [start, end, lines, flag] of SOURCE.days[day][division].events) {
          if (flag) flagged.push({ day, division, start, end, lines });
        }
      }
    }
    expect(flagged).toEqual([
      {
        day: 'Monday',
        division: 'L',
        start: 2,
        end: 3,
        lines: ['WDL-1/LAUC-2/WDL-3', '[RS/SUP/IJ]]', '[6104L/6518L/9001L]'],
      },
      { day: 'Friday', division: 'G', start: 5, end: 5, lines: ['[COI', '[SY]', '[6409CR]'] },
    ]);
  });
});

describe('timetable view models', () => {
  it('summarises every division for the selector', () => {
    const summaries = getDivisionSummaries();
    expect(summaries.map((entry) => entry.division)).toEqual(DIVISIONS);
    expect(summaries.find((entry) => entry.division === 'O')).toMatchObject({
      label: 'IT',
      friendly: 'Information Technology',
    });
    expect(summaries.find((entry) => entry.division === 'N')).toMatchObject({ label: 'Comp-R', friendly: null });
  });

  it('builds a full week for a division with spanning slots', () => {
    const timetable = getDivisionTimetable('o');
    expect(timetable.division).toBe('O');
    expect(timetable.label).toBe('IT');
    expect(timetable.days.map((entry) => entry.day)).toEqual(DAYS);
    const monday = timetable.days[0];
    expect(monday.slots).toHaveLength(9);
    expect(monday.slots[0]).toMatchObject({ type: 'event', event: { span: 2, kind: 'batch' } });
    expect(monday.slots[0].event.lines[0]).toBe('WDL-1/ENG-2/WDL-3');
    expect(monday.slots[1].type).toBe('covered');
    expect(monday.events.find((event) => event.kind === 'lunch').start).toBe(4);
  });

  it('surfaces flagged entries per division', () => {
    expect(getDivisionTimetable('L').flagged).toHaveLength(1);
    expect(getDivisionTimetable('G').flagged[0]).toMatchObject({ day: 'Friday', start: 5 });
    expect(getDivisionTimetable('A').flagged).toEqual([]);
  });

  it('rejects anything that is not a division', () => {
    for (const bad of ['z', 'AA', '', '1', null, undefined, 7]) {
      expect(getDivisionTimetable(bad)).toBeNull();
      expect(normalizeDivision(bad)).toBeNull();
    }
    expect(normalizeDivision(' o ')).toBe('O');
  });

  it('steps through neighbouring divisions', () => {
    expect(adjacentDivisions('A')).toEqual({ previous: null, next: 'B' });
    expect(adjacentDivisions('R')).toEqual({ previous: 'Q', next: null });
  });
});

describe('division-aware shortcut', () => {
  it('routes a saved valid division straight to its timetable', () => {
    expect(getTimetableHref('O')).toBe('/timetable/o');
    expect(getTimetableHref('q')).toBe('/timetable/q');
  });

  it('falls back to the selector for missing or invalid preferences', () => {
    for (const value of [null, undefined, '', '  ', 'Z', 'Comp', 3]) {
      expect(getTimetableHref(value)).toBe('/timetable');
    }
  });

  it('is wired through layout, sidebar, mobile menu and the palette', () => {
    const layout = read('app/(app)/layout.js');
    // The shell's division now comes from the one identity adapter; the palette
    // built on the server keeps reading the session directly.
    expect(layout).toContain('toShellUser(user)');
    expect(read('lib/identity/shell-user.js')).toContain('division: text(profile.division)');
    expect(layout).toContain('getTimetableHref(user.profile?.division)');
    expect(read('components/layout/Sidebar.js')).toContain('getTimetableHref(user?.division)');
    expect(read('components/layout/MobileMenu.js')).toContain('getTimetableHref(user?.division)');
  });

  it('reuses the existing profile division field — no new column or inference', () => {
    // The field and its A–R workflows already exist (see tests/divisions).
    expect(read('lib/validation/schemas.js')).toContain('DIVISIONS');
    // The timetable code never derives a division from anything but the
    // saved profile value / explicit route param: no email, username or
    // branch property is ever read to guess one. (The word "branch" itself
    // legitimately appears — it is the source dataset's field name.)
    const meta = read('lib/timetable/meta.js');
    expect(meta).not.toMatch(/\.email|\.username|\.branch\b(?!\s+field)/);
    expect(meta).toContain('export function getTimetableHref(savedDivision)');
  });
});

describe('public routes', () => {
  it('registers the routes in the catalogue', () => {
    expect(ROUTES.timetable).toBe('/timetable');
    expect(ROUTES.timetableDivision('O')).toBe('/timetable/o');
  });

  it('allows the timetable signed out without unprotecting anything else', () => {
    const proxy = read('proxy.js');
    expect(proxy).toContain("'/timetable'");
    // The list itself is unchanged apart from the timetable: no app route
    // (home, settings, admin…) may ever appear here.
    const list = proxy.match(/const PUBLIC_PATHS = \[(.*?)\]/s)[1];
    for (const protectedPath of ["'/home'", "'/settings'", "'/admin'", "'/chat'", "'/profile'"]) {
      expect(list).not.toContain(protectedPath);
    }
  });

  it('ships public pages that do no session work', () => {
    for (const file of [
      'app/timetable/page.js',
      'app/timetable/layout.js',
      'app/timetable/[division]/page.js',
      'app/timetable/[division]/not-found.js',
    ]) {
      expect(fs.existsSync(file), file).toBe(true);
      const source = read(file);
      expect(source, file).not.toContain('requireUser');
      expect(source, file).not.toContain('getCurrentUser');
    }
    expect(read('app/timetable/[division]/page.js')).toContain('notFound()');
  });
});
