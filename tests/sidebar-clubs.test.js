import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ROUTES } from '@/lib/constants';

/**
 * Regression guard for the reported "Clubs is missing from the sidebar" defect.
 *
 * The Clubs destination is not a separate navigation tree: it lives in the one
 * ordered list `primaryNavigation()` returns, which the desktop rail renders, and
 * it is repeated once in the mobile "everything else" sheet — the surface a phone
 * actually uses, because the rail is a desktop-only panel there (see
 * tests/shared-shell-layout.test.js). These assertions pin that contract to the
 * *rendered* markup, so a future reorder or filter cannot quietly drop the row.
 */

// The sidebar marks the current row from `usePathname()`; the tests move it.
const currentPath = { value: ROUTES.home };

vi.mock('next/navigation', () => ({
  usePathname: () => currentPath.value,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

let Sidebar;
let MobileMenuBody;

beforeAll(async () => {
  ({ Sidebar } = await import('@/components/layout/Sidebar'));
  ({ MobileMenuBody } = await import('@/components/layout/MobileMenu'));
});

const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props));

/** Every anchor in a chunk of markup, in document order. */
function anchors(markup) {
  return [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gu)].map(([, attributes, inner]) => ({
    href: /href="([^"]*)"/u.exec(attributes)?.[1] ?? null,
    current: /aria-current="page"/u.test(attributes),
    label: inner.replace(/<[^>]+>/gu, '').trim(),
  }));
}

/** The primary rail only — the "Direct" group and the footer are not this list. */
function primaryRail() {
  const html = render(Sidebar, {});
  const start = html.indexOf('<nav aria-label="Primary"');
  expect(start).toBeGreaterThan(-1);
  return anchors(html.slice(start, html.indexOf('</nav>', start)));
}

function mobileSheet() {
  return anchors(render(MobileMenuBody, { onNavigate: () => {} }));
}

const labelOrder = (items) => items.map((item) => item.label);

describe('the Clubs destination in the sidebar', () => {
  it('renders once in the desktop rail, between Gigs and Communities', () => {
    const rail = primaryRail();
    const clubs = rail.filter((item) => item.href === ROUTES.clubs);

    expect(clubs).toHaveLength(1);
    expect(clubs[0].label).toBe('Clubs');
    expect(labelOrder(rail)).toEqual([
      'Home',
      'Explore',
      'Market',
      'Gigs',
      'Clubs',
      'Communities',
      'Campus',
      'Timetable',
      'Map',
    ]);
    // Every other Campus destination keeps its own row: one is neither added nor lost.
    expect(new Set(rail.map((item) => item.href)).size).toBe(rail.length);
  });

  it('marks Clubs current on the directory and on a canonical club profile', () => {
    for (const path of [ROUTES.clubs, '/c/robotics-club', `${ROUTES.clubs}/`]) {
      currentPath.value = path;
      const rail = primaryRail();
      expect(rail.filter((item) => item.current).map((item) => item.href), path).toEqual([ROUTES.clubs]);
    }
    currentPath.value = ROUTES.home;
  });

  it('is reachable on a phone through the menu sheet, in the same position', () => {
    const sheet = mobileSheet();
    const clubs = sheet.filter((item) => item.href === ROUTES.clubs);

    expect(clubs).toHaveLength(1);
    expect(clubs[0].label).toBe('Clubs');
    const labels = labelOrder(sheet);
    expect(labels.indexOf('Clubs')).toBe(labels.indexOf('Gigs') + 1);
    expect(labels.indexOf('Clubs')).toBe(labels.indexOf('Communities') - 1);
  });
});
