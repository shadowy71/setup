import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ROUTES } from '@/lib/constants';

/**
 * The campus feed header and its section navigation, plus the shared Dropdown
 * contract.
 *
 * These behaviours are pinned here because each regressed quietly, at the
 * surface layer, while every individual file still "looked right":
 *
 *   1. The header keeps its identity: `PCCOE · Campus feed`, the greeting with
 *      the signed-in student's name, and the department line underneath.
 *   2. Clubs, Timetable, Events and Noticeboard sit beside that identity — one
 *      compact, real destination each, in that order, with decorative icons and
 *      an accessible current-section signal.
 *   3. The legacy Gigs promotion is gone from Home: no feature tile, no rail
 *      shortcut, no large promotional card.
 *   4. The Create dropdown must stay OUT of the sidebar's stacking/clipping
 *      trap: portalled to the body, viewport-clamped, scrollable, and
 *      keyboard-operable — an anchored menu inside `.side-panel` paints
 *      behind the nav rows that follow it in the DOM.
 */

const read = (file) => fs.readFileSync(file, 'utf8');

describe('campus feed header', () => {
  const page = read('app/(app)/home/page.js');
  const feedClient = read('components/home/HomeFeedClient.js');
  const pulse = read('components/home/HomePulse.js');
  const nav = read('components/navigation/CampusSectionNav.js');
  const css = read('app/styles/home.css');

  it('keeps the identity, the greeting and the department line', () => {
    expect(pulse).toContain('PCCOE · Campus feed');
    expect(pulse).toContain('home-pulse__greet');
    expect(pulse).toContain('Hey,');
    // The name comes from the authenticated profile, never a literal.
    expect(pulse).toContain('(user.profile.display_name || user.profile.username)');
    expect(pulse).toContain('everything happening on campus, right now');
    expect(pulse).toContain('${user.profile.branch}');
    expect(page).toContain('homeUser');
    expect(page).toContain('display_name: profile.display_name');
    expect(page).toContain('branch: profile.branch');
  });

  it('renders the section navigation beside the identity, on the same row', () => {
    const header = pulse.indexOf('home-pulse__header');
    const identity = pulse.indexOf('home-pulse__eyebrow');
    const navMount = pulse.indexOf('<CampusSectionNav');
    const actions = pulse.indexOf('home-pulse__actions');
    expect(header).toBeGreaterThan(-1);
    expect(identity).toBeGreaterThan(header);
    expect(navMount).toBeGreaterThan(identity);
    expect(actions).toBeGreaterThan(navMount);
    // Personalised the same way the rail's Timetable row is — saved division or
    // the public selector, never a guess.
    expect(pulse).toContain('division={user.profile.division}');
    expect(page).toContain('division: profile.division');
    // One hero, one HomePulse mount: no promoted tile is passed into it.
    expect(feedClient).toContain('<HomePulse user={user} stats={stats} />');
    expect(feedClient).not.toContain('heroFeatures');
  });

  it('navigates to the four real destinations, in order, with product icons', () => {
    expect(ROUTES.clubs).toBe('/clubs');
    expect(ROUTES.timetable).toBe('/timetable');
    const order = ['label: \'Clubs\'', 'label: \'Timetable\'', 'label: \'Events\'', 'label: \'Noticeboard\''];
    let cursor = -1;
    for (const entry of order) {
      const at = nav.indexOf(entry);
      expect(at, entry).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(nav).toContain('href: ROUTES.clubs');
    expect(nav).toContain('href: getTimetableHref(division)');
    expect(nav).toContain("href: '/campus/events'");
    expect(nav).toContain("href: '/campus/noticeboard'");
    // Icons from the project's own glyph set: decorative, so aria-hidden.
    expect(nav).toContain("icon: 'users'");
    expect(nav).toContain("icon: 'clock'");
    expect(nav).toContain("icon: 'calendar'");
    expect(nav).toContain("icon: 'megaphone'");
    expect(nav).toContain('components/ui/icons');
    expect(nav).not.toMatch(/from 'lucide-react'|from 'react-icons|from '@heroicons/);
    // Nothing points at the retired gig board.
    expect(nav).not.toContain('gigs');
  });

  it('resolves each destination from the route catalogue, in the required order', async () => {
    const { campusSectionLinks } = await import('@/components/navigation/CampusSectionNav');
    // Without a saved division the Timetable door is the public selector; a
    // saved division opens that division's week directly.
    expect(campusSectionLinks(null).map((link) => link.label)).toEqual(['Clubs', 'Timetable', 'Events', 'Noticeboard']);
    expect(campusSectionLinks(null).map((link) => link.href)).toEqual([
      '/clubs',
      '/timetable',
      '/campus/events',
      '/campus/noticeboard',
    ]);
    expect(campusSectionLinks(null).map((link) => link.icon)).toEqual(['users', 'clock', 'calendar', 'megaphone']);
    expect(campusSectionLinks('o')[1].href).toBe('/timetable/o');
  });

  it('is semantic, link-based and announces the current section', () => {
    expect(nav).toContain('<nav');
    expect(nav).toContain('aria-label="Campus sections"');
    expect(nav).toContain('<ul');
    expect(nav).toContain('<Link');
    expect(nav).toContain("aria-current={active ? 'page' : undefined}");
    expect(nav).toContain('resolveActiveHref');
    expect(nav).toContain('usePathname');
  });

  it('removes the legacy Gigs promotion from Home', () => {
    expect(fs.existsSync('components/home/HomeFeatureTiles.js')).toBe(false);
    expect(page).not.toContain('HomeFeatureTiles');
    expect(page).not.toContain("label: 'Gigs'");
    expect(page).not.toContain('ROUTES.gigs');
    expect(pulse).not.toContain("label: 'Gigs'");
    expect(css).not.toContain('.feature-tile');
    expect(css).not.toContain('.home-features');
  });

  it('does not duplicate the header destinations in the "keep exploring" row', () => {
    for (const kept of ["label: 'Explore'", "label: 'Communities'", "label: 'Projects'", "label: 'Marketplace'"]) {
      expect(pulse).toContain(kept);
    }
    expect(pulse).not.toContain("label: 'Clubs'");
  });

  it('is responsive, focus-visible and reduced-motion safe', () => {
    // Phone-first: two equal columns, 44px touch targets, no sideways scroll.
    expect(css).toMatch(/\.campus-nav__list\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.campus-nav__link\s*\{[^}]*min-height: 2\.75rem/);
    // One row from tablet width up, inside the hero's own container.
    expect(css).toMatch(/@container home-hero \(min-width: 34rem\) \{[^}]*\.campus-nav__list[\s\S]*?display: flex/);
    // Identity left, navigation right, vertically centred, from 44rem of hero.
    expect(css).toMatch(/@container home-hero \(min-width: 44rem\) \{[^}]*\.home-pulse__header[\s\S]*?flex-direction: row[\s\S]*?align-items: center/);
    expect(css).toMatch(/\.campus-nav__link:focus-visible\s*\{[^}]*outline: 2px solid var\(--cp-focus\)/);
    expect(css).toMatch(/\.campus-nav__link\[aria-current='page'\]\s*\{/);
    // Active state is more than colour: weight and an underline as well.
    expect(css).toMatch(/\.campus-nav__link\[aria-current='page'\]\s*\{[^}]*font-weight: 680/);
    expect(css).toMatch(/\.campus-nav__link\[aria-current='page'\]::after\s*\{/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.campus-nav__link\s*\{[^}]*transition: none/);
    // Hover lift stays pointer-only; touch keeps the pressed response.
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{[^}]*\.campus-nav__link:hover/);
    expect(css).toMatch(/\.campus-nav__link:active\s*\{/);
  });
});

describe('shared Dropdown (Create menu)', () => {
  const overlays = read('components/ui/overlays.js');
  const feedback = read('app/styles/feedback.css');

  it('portals out of the sidebar stacking context and scrollport', () => {
    expect(overlays).toMatch(/createPortal\([\s\S]*?role="menu"[\s\S]*?document\.body/);
    expect(overlays).toContain('getBoundingClientRect');
    expect(overlays).toContain("window.addEventListener('scroll', reposition, true)");
    expect(overlays).toContain("window.addEventListener('resize', reposition)");
  });

  it('clamps to the viewport, flips when cramped and caps its height', () => {
    expect(overlays).toContain('maxHeight');
    expect(overlays).toContain('flipUp');
    expect(overlays).toContain('overflow-y-auto');
  });

  it('preserves close behaviours and adds real keyboard operation', () => {
    expect(overlays).toContain("event.key === 'Escape'");
    expect(overlays).toContain('focusTrigger()');
    expect(overlays).toContain("document.addEventListener('mousedown', onPointer)");
    expect(overlays).toContain('onClick={close}');
    for (const key of ["'ArrowDown'", "'ArrowUp'", "'Home'", "'End'", "'Tab'"]) {
      expect(overlays).toContain(key);
    }
    // Pointer opens never steal focus; keyboard opens (detail: 0) do.
    expect(overlays).toContain('event.detail === 0');
    expect(overlays).toContain('aria-expanded={open}');
    expect(overlays).toContain('aria-haspopup="menu"');
  });

  it('keeps menu rows distinguishable for hover, focus and press', () => {
    expect(feedback).toMatch(/\.cp-menu-item:focus-visible \{[^}]*box-shadow: inset 0 0 0 2px var\(--cp-focus\)/);
    expect(feedback).toMatch(/\.cp-menu-item:active:not\(:disabled\)/);
    expect(feedback).toMatch(/\.cp-menu \{[^}]*backdrop-filter: blur\(26px\) saturate\(175%\)/);
    expect(feedback).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.cp-menu \{\s*animation: none/);
  });

  it('creates nothing the server did not already permit', () => {
    const createMenu = read('components/layout/CreateMenu.js');
    // The browser still receives a plain, server-built list — no permission
    // logic, no extra destinations, and the width comes from the trigger.
    expect(createMenu).toContain('items.map');
    expect(createMenu).toContain('matchTriggerWidth');
    expect(createMenu).not.toMatch(/can\(|permissions|hasPermission/);
  });
});
