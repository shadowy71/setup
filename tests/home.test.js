import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ROUTES } from '@/lib/constants';

/**
 * Home feature tiles + the shared Dropdown contract.
 *
 * Two behaviours are pinned here because both regressed the same way once:
 * quietly, at the surface layer, while every individual file still "looked
 * right".
 *
 *   1. Clubs and Gigs must stay first-class on Home: real routes from the
 *      ROUTES catalogue, prominent tiles between the greeting and the
 *      composer, and no invented metrics to make them look busy.
 *   2. The Create dropdown must stay OUT of the sidebar's stacking/clipping
 *      trap: portalled to the body, viewport-clamped, scrollable, and
 *      keyboard-operable — an anchored menu inside `.side-panel` paints
 *      behind the nav rows that follow it in the DOM.
 */

const read = (file) => fs.readFileSync(file, 'utf8');

describe('home feature tiles (Clubs & Gigs)', () => {
  const tiles = read('components/home/HomeFeatureTiles.js');
  const page = read('app/(app)/home/page.js');
  const pulse = read('components/home/HomePulse.js');

  it('links whole tiles to the real destinations from the route catalogue', () => {
    expect(ROUTES.clubs).toBe('/clubs');
    expect(ROUTES.gigs).toBe('/gigs');
    expect(tiles).toContain('href: ROUTES.clubs');
    expect(tiles).toContain('href: ROUTES.gigs');
    expect(tiles).not.toMatch(/href:\s*['"]\//);
    // The entire card is the link.
    expect(tiles).toMatch(/<Link[\s\S]*?feature-tile/);
  });

  it('carries the discovery copy with no invented metrics', () => {
    expect(tiles).toContain('Find your people.');
    expect(tiles).toContain('Put your skills to work.');
    expect(tiles).toContain('technical, cultural, sports, arts, entrepreneurship and social clubs');
    expect(tiles).toContain('paid and unpaid student gigs');
    // No fake counts, earnings, members or "live" numbers anywhere in the tile.
    expect(tiles).not.toMatch(/\d+\s*(\+|members|students|clubs|gigs|active|live)/i);
    expect(tiles).not.toContain('₹');
  });

  it('sits between the greeting and the composer/feed', () => {
    const greeting = page.indexOf('<HomePulse');
    const doors = page.indexOf('<HomeFeatureTiles');
    const composer = page.indexOf('home-composer');
    expect(greeting).toBeGreaterThan(-1);
    expect(doors).toBeGreaterThan(greeting);
    expect(composer).toBeGreaterThan(doors);
  });

  it('replaces — not duplicates — the Clubs and Gigs discovery chips', () => {
    for (const kept of ["label: 'Explore'", "label: 'Events'", "label: 'Communities'", "label: 'Projects'", "label: 'Marketplace'"]) {
      expect(pulse).toContain(kept);
    }
    expect(pulse).not.toContain("label: 'Clubs'");
    expect(pulse).not.toContain("label: 'Gigs'");
    // The rail keypad covers both destinations as secondary shortcuts.
    expect(page).toContain("href: ROUTES.clubs, label: 'Clubs'");
    expect(page).toContain("href: ROUTES.gigs, label: 'Gigs'");
  });

  it('is responsive, focus-visible and reduced-motion safe', () => {
    const css = read('app/styles/home.css');
    expect(css).toMatch(/\.home-features__grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toMatch(/@media \(min-width: 640px\) \{[^}]*\.home-features__grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
    expect(css).toMatch(/\.feature-tile:focus-visible\s*\{[^}]*outline: 2px solid var\(--cp-focus\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.feature-tile:hover/);
    // Decorative layers never take the click.
    expect(css).toMatch(/\.feature-tile__glow \{[^}]*pointer-events: none/);
    // Hover lift is pointer-only; touch keeps a pressed response.
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\.feature-tile:hover/);
    expect(css).toMatch(/\.feature-tile:active\s*\{/);
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
