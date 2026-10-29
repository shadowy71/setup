import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ROUTES } from '@/lib/constants';

const read = (file) => fs.readFileSync(file, 'utf8');

describe('home quick-access tiles', () => {
  const tiles = read('components/home/HomeFeatureTiles.js');
  const page = read('app/(app)/home/page.js');
  const feedClient = read('components/home/HomeFeedClient.js');
  const pulse = read('components/home/HomePulse.js');
  const css = read('app/styles/home.css');

  it('links the four tiles in order to existing destinations', () => {
    const names = ["name: 'Noticeboard'", "name: 'Events'", "name: 'Timetable'", "name: 'Clubs'"];
    const positions = names.map((name) => tiles.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(tiles).toContain("href: '/campus/noticeboard'");
    expect(tiles).toContain("href: '/campus/events'");
    expect(tiles).toContain('href: getTimetableHref(division)');
    expect(tiles).toContain('href: ROUTES.clubs');
    expect(ROUTES.clubs).toBe('/clubs');
    expect(tiles).toMatch(/<Link[\s\S]*?feature-tile/);
  });

  it('places the grid in the hero and keeps Gigs accessible after the feed', () => {
    expect(page).toContain('heroFeatures={<HomeFeatureTiles division={profile.division} />}');
    expect(page).toContain('afterFeed={<HomeAreas />}');
    const hero = feedClient.indexOf('<HomePulse user={user} stats={stats}>{heroFeatures}</HomePulse>');
    expect(hero).toBeGreaterThan(-1);
    expect(feedClient.indexOf('home-composer')).toBeGreaterThan(hero);
    expect(feedClient.indexOf('id="home-stream-title"')).toBeGreaterThan(hero);
    expect(pulse).toContain("href: ROUTES.gigs, label: 'Gigs'");
    expect(page).toContain("href: ROUTES.gigs, label: 'Gigs'");
    expect(pulse).toContain('aria-label="Campus right now"');
  });

  it('uses equal responsive grid tracks, accessible focus, and reduced motion', () => {
    expect(css).toContain('@container home-hero (min-width: 52rem)');
    expect(css).toMatch(/@container home-features \(min-width: 19rem\) \{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toContain('grid-auto-rows: 1fr');
    for (const tone of ['noticeboard', 'events', 'timetable', 'clubs']) {
      if (tone !== 'noticeboard') expect(css).toContain(`.feature-tile--${tone}`);
      expect(tiles).toContain(`tone: '${tone}'`);
    }
    expect(css).toMatch(/\.feature-tile:focus-visible\s*\{[^}]*outline: 2px solid var\(--cp-focus\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.feature-tile:hover/);
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
