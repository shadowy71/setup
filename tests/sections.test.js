import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ROUTES,
  PRIMARY_NAV,
  MOBILE_NAV,
  GIG_STATES,
  GIG_PAYMENT_TYPES,
  CLUB_CATEGORIES,
  CLUB_CATEGORY_VALUES,
} from '@/lib/constants';
import { validate, gigSchema, gigApplicationSchema, clubSchema, vSkills } from '@/lib/validation/schemas';
import { listGigs, listGigSkills } from '@/lib/data/marketplace';
import { listCommunities, countClubsByCategory } from '@/lib/data/campus';

/**
 * The Gigs and Clubs sections.
 *
 * These pin the decisions that are easy to undo by accident: one canonical
 * route per section (with the pre-section addresses still redirecting), one nav
 * entry per section (no duplication), a real lifecycle on gigs, a closed club
 * category list, and the query filters each board actually sends.
 */

const ROOT = process.cwd();
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Minimal chainable Supabase stub that records the query it was asked for. */
function stub(rows = [], { error = null } = {}) {
  const calls = [];
  const api = {
    select() {
      return api;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return api;
    },
    in(column, value) {
      calls.push(['in', column, value]);
      return api;
    },
    contains(column, value) {
      calls.push(['contains', column, value]);
      return api;
    },
    or(expression) {
      calls.push(['or', expression]);
      return api;
    },
    textSearch(column, value, options) {
      calls.push(['textSearch', column, value, options]);
      return api;
    },
    order(column, options) {
      calls.push(['order', column, options]);
      return api;
    },
    limit(value) {
      calls.push(['limit', value]);
      return api;
    },
    range(from, to) {
      calls.push(['range', from, to]);
      return api;
    },
    then(resolve) {
      return Promise.resolve(error ? { data: null, error } : { data: rows, error: null }).then(resolve);
    },
  };
  return { calls, from: () => api };
}

describe('gig and club routes', () => {
  it('gives each section its own canonical address', () => {
    expect(ROUTES.gigs).toBe('/gigs');
    expect(ROUTES.gigNew).toBe('/gigs/new');
    expect(ROUTES.gig('abc')).toBe('/gigs/abc');
    expect(ROUTES.gigEdit('abc')).toBe('/gigs/abc/edit');
    expect(ROUTES.clubs).toBe('/clubs');
    expect(ROUTES.clubNew).toBe('/clubs/new');
    expect(ROUTES.club('abc')).toBe('/clubs/abc');
    expect(ROUTES.clubEdit('abc')).toBe('/clubs/abc/edit');
  });

  it('keeps the old addresses reachable as redirects, not as second pages', () => {
    const legacyGig = read('app/(app)/market/gigs/[id]/page.js');
    expect(legacyGig).toContain('redirect(ROUTES.gig(id))');

    const legacyClubs = read('app/(app)/campus/clubs/page.js');
    expect(legacyClubs).toContain('redirect(ROUTES.clubs)');

    const legacyClub = read('app/(app)/campus/clubs/[id]/page.js');
    expect(legacyClub).toContain('redirect(ROUTES.club(id))');

    // Old tab links land on the dedicated boards instead of rendering a
    // second, slightly different list.
    expect(read('app/(app)/market/page.js')).toContain("params?.tab === 'gigs'");
    expect(read('app/(app)/communities/page.js')).toContain("params?.tab === 'clubs'");
    expect(read('app/(app)/market/new/page.js')).toContain("params?.type === 'gig'");
    expect(read('app/(app)/communities/new/page.js')).toContain("params?.kind === 'club'");
  });
});

describe('navigation', () => {
  it('keeps exactly one Clubs entry and no Gigs row in the sidebar', () => {
    const hrefs = PRIMARY_NAV.map((item) => item.href);
    // Gigs was retired from the primary rail (and from the campus feed header),
    // so the rail must not offer a second, competing gig board entry.
    expect(hrefs.filter((href) => href === ROUTES.gigs)).toHaveLength(0);
    expect(hrefs.filter((href) => href === ROUTES.clubs)).toHaveLength(1);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('keeps the mobile tab bar at five targets', () => {
    expect(MOBILE_NAV).toHaveLength(5);
    const hrefs = MOBILE_NAV.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    // Clubs is reachable from the "everything else" sheet; the sheet no longer
    // carries a Gigs row.
    const menu = read('components/layout/MobileMenu.js');
    expect(menu).not.toContain('href={ROUTES.gigs}');
    expect(menu).toContain('href={ROUTES.clubs}');
  });

  it('describes each remaining section once in the sidebar', () => {
    const clubs = PRIMARY_NAV.filter((item) => item.href === ROUTES.clubs)[0];
    expect(clubs).toMatchObject({ label: 'Clubs', icon: 'star' });
    // The gig board's own data and components are untouched — only its
    // navigation promotion was removed.
    expect(read('components/gigs/GigCard.js')).toContain('ROUTES.gig(gig.id)');
  });
});

describe('gig lifecycle vocabulary', () => {
  it('offers exactly Open, Closed and Completed', () => {
    expect(GIG_STATES.map((state) => state.value)).toEqual(['open', 'closed', 'completed']);
    expect(GIG_STATES.map((state) => state.label)).toEqual(['Open', 'Closed', 'Completed']);
  });

  it('offers exactly paid and unpaid', () => {
    expect(GIG_PAYMENT_TYPES.map((entry) => entry.value)).toEqual(['paid', 'unpaid']);
  });
});

describe('club categories', () => {
  it('is exactly the six the campus runs', () => {
    expect(CLUB_CATEGORY_VALUES).toEqual([
      'Technical',
      'Cultural',
      'Sports',
      'Arts',
      'Entrepreneurship',
      'Social',
    ]);
    expect(CLUB_CATEGORIES).toHaveLength(6);
    // Each chip has a real icon from the shared set, not a placeholder.
    for (const category of CLUB_CATEGORIES) expect(category.icon).toBeTruthy();
  });
});

describe('gig validation', () => {
  const base = {
    title: 'Poster design for the cultural fest',
    description: 'Two A3 posters and one Instagram story, by the end of the month.',
    category: 'Design help',
    category_id: '',
    skills: 'Figma, Illustrator',
    payment_type: 'paid',
    compensation: '₹800',
    availability: 'Weekends',
    deadline: '2099-12-31',
    contact_details: 'Send two samples.',
  };

  it('accepts the form the page renders', () => {
    const checked = validate(base, gigSchema);
    expect(checked.ok).toBe(true);
    expect(checked.data.skills).toEqual(['Figma', 'Illustrator']);
    expect(checked.data.payment_type).toBe('paid');
    expect(checked.data.category_id).toBeNull();
  });

  it('defaults payment to unpaid when the field is absent', () => {
    const checked = validate({ ...base, payment_type: '' }, gigSchema);
    expect(checked.ok).toBe(true);
    expect(checked.data.payment_type).toBe('unpaid');
  });

  it('rejects a payment value that is neither paid nor unpaid', () => {
    expect(validate({ ...base, payment_type: 'maybe' }, gigSchema).ok).toBe(false);
  });

  it('rejects a deadline in the past', () => {
    expect(validate({ ...base, deadline: '2000-01-01' }, gigSchema).ok).toBe(false);
  });

  it('normalises skills: trims, dedupes case-insensitively and caps the list', () => {
    expect(vSkills(' React, react ,  , Node ').value).toEqual(['React', 'Node']);
    const tooMany = Array.from({ length: 13 }, (_, index) => `skill-${index}`).join(',');
    expect(vSkills(tooMany).ok).toBe(false);
    expect(vSkills('x'.repeat(41)).ok).toBe(false);
  });

  it('requires a real application message', () => {
    const ok = validate({ gig_id: '96000000-0000-4000-a000-000000000001', message: 'I can do this.' }, gigApplicationSchema);
    expect(ok.ok).toBe(true);
    const short = validate({ gig_id: '96000000-0000-4000-a000-000000000001', message: 'hi' }, gigApplicationSchema);
    expect(short.ok).toBe(false);
    expect(short.errors.message).toBeTruthy();
  });
});

describe('club validation', () => {
  const base = {
    name: 'Robotics and Automation Club',
    slug: 'robotics-and-automation-club',
    description: 'Builds competition robots and runs weekly workshops in the robotics lab.',
    club_category: 'Technical',
    organization_type: 'technical_club',
    recruitment_info: 'Open to first and second year students.',
    visibility: 'campus',
    join_policy: 'open',
  };

  it('requires one of the six discovery categories', () => {
    expect(validate(base, clubSchema).ok).toBe(true);
    expect(validate({ ...base, club_category: 'Astrology' }, clubSchema).ok).toBe(false);
    expect(validate({ ...base, club_category: '' }, clubSchema).ok).toBe(false);
  });

  it('requires a controlled organization type', () => {
    expect(validate({ ...base, organization_type: 'unofficial_fan_club' }, clubSchema).ok).toBe(false);
    expect(validate({ ...base, organization_type: '' }, clubSchema).ok).toBe(false);
  });
});

describe('board queries', () => {
  it('sends every gig filter the board offers', async () => {
    const supabase = stub([]);
    await listGigs(supabase, {
      status: ['published', 'draft'],
      state: 'closed',
      skill: 'React',
      categoryId: '96000000-0000-4000-a000-000000000001',
      paymentType: 'paid',
      q: 'poster',
      sort: 'deadline',
      limit: 30,
    });

    expect(supabase.calls).toContainEqual(['in', 'status', ['published', 'draft']]);
    expect(supabase.calls).toContainEqual(['eq', 'state', 'closed']);
    expect(supabase.calls).toContainEqual(['contains', 'skills', ['React']]);
    expect(supabase.calls).toContainEqual(['eq', 'payment_type', 'paid']);
    expect(supabase.calls).toContainEqual(['eq', 'category_id', '96000000-0000-4000-a000-000000000001']);
    expect(supabase.calls).toContainEqual(['textSearch', 'search_vector', 'poster', { config: 'english', type: 'websearch' }]);
    // Closing soon sorts by deadline, with missing deadlines last.
    expect(supabase.calls).toContainEqual(['order', 'deadline', { ascending: true, nullsFirst: false }]);
    expect(supabase.calls).toContainEqual(['range', 0, 29]);
  });

  it('reports unavailability instead of throwing when the gig query fails', async () => {
    const supabase = stub([], { error: { message: 'permission denied for table gigs' } });
    const result = await listGigs(supabase);
    expect(result).toEqual({ items: [], unavailable: true });
  });

  it('builds the skill filter from real skills, most common first', async () => {
    const supabase = stub([
      { skills: ['React', 'Node'] },
      { skills: ['React'] },
      { skills: [''] },
    ]);
    const { items, unavailable } = await listGigSkills(supabase);
    expect(unavailable).toBe(false);
    expect(items[0]).toEqual({ label: 'React', count: 2 });
    expect(items.find((entry) => entry.label === 'Node')).toEqual({ label: 'Node', count: 1 });
    expect(items.find((entry) => entry.label === '')).toBeUndefined();
  });

  it('searches clubs by name, interest, category or alias and filters by category', async () => {
    const supabase = stub([]);
    await listCommunities(supabase, { kind: 'club', category: 'Technical', q: 'robotics, drones' });

    expect(supabase.calls).toContainEqual(['eq', 'kind', 'club']);
    expect(supabase.calls).toContainEqual(['eq', 'club_category', 'Technical']);
    const search = supabase.calls.find(([kind]) => kind === 'or');
    expect(search).toBeTruthy();
    // Commas and parentheses would break PostgREST's or= syntax; the term is
    // sanitised before it is sent.
    expect(search[1]).toBe(
      'name.ilike.%robotics  drones%,subject.ilike.%robotics  drones%,description.ilike.%robotics  drones%,club_category.ilike.%robotics  drones%,directory_aliases.ilike.%robotics  drones%',
    );
  });

  it('counts published clubs per category', async () => {
    const supabase = stub([
      { club_category: 'Technical' },
      { club_category: 'Technical' },
      { club_category: null },
    ]);
    const result = await countClubsByCategory(supabase);
    expect(result.total).toBe(3);
    expect(result.counts.Technical).toBe(2);
    expect(result.counts.Uncategorised).toBe(1);
    expect(result.unavailable).toBe(false);
  });
});

describe('the two boards are not the marketplace', () => {
  it('keeps gig cards and club cards as their own components', () => {
    expect(fs.existsSync(path.join(ROOT, 'components/gigs/GigCard.js'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'components/gigs/GigActions.js'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'components/clubs/ClubCard.js'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'components/clubs/ClubMonogram.js'))).toBe(true);
  });

  it('does not invent uploads for club marks — the monogram is drawn', () => {
    const monogram = read('components/clubs/ClubMonogram.js');
    expect(monogram).not.toMatch(/<img|<Image|next\/image/);
    expect(monogram).toContain('club-monogram');
  });

  it('styles the new surfaces from the shared stylesheet, not inline palettes', () => {
    const css = read('app/styles/sections.css');
    expect(css).toContain('.gig-card');
    expect(css).toContain('.club-monogram');
    // `sections.css` is route CSS now: it ships with the two trees whose cards
    // it styles, not with every page in the app.
    for (const layout of ['app/(app)/clubs/layout.js', 'app/(app)/gigs/layout.js']) {
      expect(read(layout)).toContain("@/app/styles/sections.css");
    }
    expect(read('app/globals.css')).not.toContain('styles/sections.css');
    // Colours come from the existing role tokens.
    expect(css).toContain('var(--c-accent)');
  });
});

describe('Campus hub tiles', () => {
  /**
   * The hub's tile list, as written: `href` is a literal or one `ROUTES.x` name.
   * The grid keys itself on `href`, so two tiles pointing at one destination are a
   * duplicated card on screen and a duplicate-key warning in the console.
   */
  const tileHrefs = () => {
    const source = read('app/(app)/campus/page.js');
    const block = /const SECTIONS = \[([\s\S]*?)\n\];/.exec(source)[1];
    return Array.from(block.matchAll(/href:\s*(?:'([^']+)'|ROUTES\.(\w+))/g)).map(
      ([, literal, key]) => literal ?? ROUTES[key],
    );
  };

  it('points at each destination exactly once', () => {
    const hrefs = tileHrefs();
    expect(hrefs.length).toBeGreaterThan(5);
    expect(hrefs).toEqual([...new Set(hrefs)]);
  });
});
