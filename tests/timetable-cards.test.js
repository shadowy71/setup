import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TimetableIndexPage from '@/app/timetable/page';
import { getDivisionSummaries } from '@/lib/timetable';
import { describeBatch } from '@/lib/timetable/batch';

const expected = {
  A: 'Mech', B: 'Mech', C: 'Mech',
  D: 'E & TC', E: 'E & TC', F: 'E & TC',
  G: 'VLSI', H: 'Civil', I: 'Civil RL',
  J: 'Comp', K: 'Comp', L: 'Comp', M: 'Comp', N: 'Comp-R',
  O: 'IT', P: 'IT', Q: 'AI & ML', R: 'AI & ML',
};

const htmlEscape = (text) => text.replace(/&/g, '&amp;');

describe('timetable division cards', () => {
  it('has the specified short branch and shared year for each of the 18 divisions', () => {
    const summaries = getDivisionSummaries();
    expect(summaries.map(({ division }) => division)).toEqual(Object.keys(expected));
    for (const { division, label, year } of summaries) {
      expect(label, division).toBe(expected[division]);
      expect(year, division).toBe('First Year');
      expect(describeBatch(division)).toMatchObject({ label, year });
    }
  });

  it('renders exactly division, short branch and year in that order with the correct link', () => {
    const html = renderToStaticMarkup(TimetableIndexPage());
    const nav = html.match(/<nav aria-label="Divisions A to R"[\s\S]*?<\/nav>/)?.[0];
    expect(nav).toBeTruthy();
    const cards = [...nav.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
    expect(cards).toHaveLength(18);
    Object.entries(expected).forEach(([division, branch], index) => {
      const card = cards[index];
      expect(card).toContain(`href="/timetable/${division.toLowerCase()}"`);
      const fields = [...card.matchAll(/<span class="tt-tile__(?:letter|branch|friendly)">([^<]*)<\/span>/g)].map((match) => match[1]);
      expect(fields, division).toEqual([division, htmlEscape(branch), 'First Year']);
      expect((card.match(/<span\b/g) || [])).toHaveLength(3);
    });
  });
});
