import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { MOBILE_NAV, PRIMARY_NAV, ROUTES } from '@/lib/constants';
import { primaryNavigation } from '@/lib/navigation/primary';
import { NAVIGATION_HELP, navigationHelpFor } from '@/lib/navigation/help';
import {
  buildNavigationTourSteps,
  markNavigationTour,
  NAVIGATION_TOUR_EVENT,
  NAVIGATION_TOUR_KEY,
  readNavigationTour,
  shouldOfferNavigationTour,
} from '@/lib/guide/navigation-tour';
import { GUIDE_SEEN_KEY } from '@/lib/guide/first-visit';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function servedRoutes() {
  const routes = new Set();
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const segment = /^\(.*\)$/u.test(entry.name) ? prefix : `${prefix}/${entry.name.replace(/\[(\.\.\.)?([^\]]+)\]$/u, ':$2')}`;
        walk(absolute, segment);
      } else if (entry.name === 'page.js' || entry.name === 'page.jsx') {
        routes.add(prefix || '/');
      }
    }
  };
  walk(path.join(ROOT, 'app'), '');
  return routes;
}

const ROUTE_SET = servedRoutes();
function routeExists(href) {
  if (ROUTE_SET.has(href)) return true;
  const segments = href.split('/').filter(Boolean);
  for (const route of ROUTE_SET) {
    const parts = route.split('/').filter(Boolean);
    if (parts.length !== segments.length) continue;
    if (parts.every((part, index) => part.startsWith(':') || part === segments[index])) return true;
  }
  return false;
}

const storageStub = ({ value = null, throws = false } = {}) => {
  const store = new Map(value === null ? [] : [[NAVIGATION_TOUR_KEY, value]]);
  return {
    store,
    getItem(key) {
      if (throws) throw new Error('storage blocked');
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, next) {
      if (throws) throw new Error('quota exceeded');
      store.set(key, next);
    },
  };
};

describe('contextual navigation help', () => {
  it('explains only real destinations and never invents a parallel navigation tree', () => {
    expect(Object.keys(NAVIGATION_HELP).length).toBeGreaterThanOrEqual(12);
    for (const [href, body] of Object.entries(NAVIGATION_HELP)) {
      expect(routeExists(href), href).toBe(true);
      expect(body.length, href).toBeGreaterThan(60);
    }
    expect(navigationHelpFor('/not-a-real-destination')).toBeNull();
    expect(navigationHelpFor(ROUTES.clubs)).toMatch(/only authorized staff/i);
    expect(navigationHelpFor(ROUTES.chat)).toMatch(/private messages/i);
  });

  it('uses a sibling button and a portalled non-modal dialog with all dismissal modes', () => {
    const component = read('components/navigation/NavigationHelp.js');
    expect(component).toContain('createPortal');
    expect(component).toContain('role="dialog"');
    expect(component).not.toContain('aria-modal=');
    expect(component).toContain('aria-haspopup="dialog"');
    expect(component).toContain('aria-expanded={open}');
    expect(component).toContain('onFocus=');
    expect(component).toContain('onPointerEnter=');
    expect(component).toContain("event.key !== 'Escape'");
    expect(component).toContain("document.addEventListener('pointerdown'");
    expect(component).toContain("window.addEventListener('scroll'");
    expect(component).toContain('viewportWidth - width - margin');
    expect(component).toContain('flipUp');
  });

  it('restores keyboard focus on dismissal without treating it as a new focus-open gesture', () => {
    const component = read('components/navigation/NavigationHelp.js');
    expect(component).toContain('suppressFocusOpen.current = true');
    expect(component).toContain('if (suppressFocusOpen.current) return;');
    expect(component).toContain('restoreTriggerFocus();');
    expect(component).toContain("triggerRef.current?.focus({ preventScroll: true })");
  });

  it('is wired into desktop and touch navigation without changing either destination set', () => {
    expect(read('components/layout/Sidebar.js')).toContain('<NavigationHelp');
    expect(read('components/layout/MobileMenu.js')).toContain('<NavigationHelp');
    expect(read('components/layout/BottomNav.js')).not.toContain('NavigationHelp');
    expect(PRIMARY_NAV).toHaveLength(8);
    expect(MOBILE_NAV).toHaveLength(5);
    const css = read('app/styles/navigation.css');
    expect(css).toContain('.sheet-destination .nav-help__trigger');
    expect(css).toContain('width: min(18rem, calc(100vw - 1rem))');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/u);
  });
});

describe('the primary rail order', () => {
  it('shows Timetable where Profile used to be, and Profile directly after it', () => {
    const items = primaryNavigation('/timetable/o');

    expect(items.map((item) => item.label)).toEqual([
      'Home',
      'Explore',
      'Market',
      'Gigs',
      'Clubs',
      'Communities',
      'Campus',
      'Timetable',
      'Profile',
    ]);
    expect(items.find((item) => item.label === 'Timetable').href).toBe('/timetable/o');
    expect(items.find((item) => item.label === 'Profile').href).toBe(ROUTES.profile);

    // A reorder, not a redesign: every destination keeps its label and icon,
    // and nothing is added or lost.
    expect(items).toHaveLength(PRIMARY_NAV.length + 1);
    for (const item of PRIMARY_NAV) {
      expect(items.some((entry) => entry.href === item.href && entry.icon === item.icon && entry.label === item.label)).toBe(true);
    }
  });

  it('falls back to the public selector and keeps the Timetable explanation', () => {
    const items = primaryNavigation();
    const timetable = items.find((item) => item.label === 'Timetable');

    expect(timetable.href).toBe(ROUTES.timetable);
    // The help topic is the public selector even when the row opens a division.
    expect(timetable.helpTopic).toBe(ROUTES.timetable);
    expect(timetable.icon).toBe('calendar');
    for (const item of items.filter((entry) => entry.label !== 'Timetable')) {
      expect(item.helpTopic, item.label).toBe(item.href);
    }
  });

  it('is what the rail renders — one list, in order, with the same link chrome', () => {
    const sidebar = read('components/layout/Sidebar.js');

    expect(sidebar).toContain('const primary = primaryNavigation(timetableHref);');
    expect(sidebar).toContain('{primary.map((item) => (');
    expect(sidebar).not.toContain('PRIMARY_NAV.map');
    // Hover, active state, icon and prefetch behaviour are unchanged.
    expect(sidebar).toContain("aria-current={active(item.href) ? 'page' : undefined}");
    expect(sidebar).toContain('className="nav-item"');
    expect(sidebar).toContain('className="nav-icon"');
    expect(sidebar).toContain('prefetch={item.href === ROUTES.home ? false : undefined}');
    expect(sidebar).toContain('<NavigationHelp topic={item.helpTopic} label={item.label} />');
  });

  it('keeps Timetable ahead of Profile on mobile, and the dock at five tabs', () => {
    const menu = read('components/layout/MobileMenu.js');
    const timetableAt = menu.indexOf('label="Timetable"');
    const profileAt = menu.indexOf('href={ROUTES.profile}');

    // On a phone both rows live in the same sheet: Timetable, then the
    // signed-in student's Profile at the foot of it.
    expect(timetableAt).toBeGreaterThan(-1);
    expect(profileAt).toBeGreaterThan(-1);
    expect(timetableAt).toBeLessThan(profileAt);

    // The bottom dock is untouched: Timetable is not a sixth tab, Profile
    // keeps its place there.
    expect(MOBILE_NAV).toHaveLength(5);
    expect(MOBILE_NAV.map((item) => item.label)).toEqual(['Home', 'Explore', 'Market', 'Chat', 'Profile']);
  });
});

describe('the optional navigation tour', () => {
  it('is five short, unique steps with role-aware final and creation steps', () => {
    const student = buildNavigationTourSteps();
    expect(student).toHaveLength(5);
    expect(new Set(student.map((step) => step.id)).size).toBe(5);
    for (const step of student) {
      expect(step.title.length).toBeGreaterThan(8);
      expect(step.body.length).toBeGreaterThan(80);
    }
    expect(student[4].body).toMatch(/ordinary students cannot make an official club directly/i);
    expect(student.map((step) => step.body).join(' ')).not.toMatch(/Your Moderation|Your Admin/);

    const moderator = buildNavigationTourSteps({ canModerate: true, isStaff: true });
    expect(moderator[4].body).toContain('Your Moderation link appears');
    expect(moderator[4].body).not.toContain('Admin');
    expect(moderator[4].body).toMatch(/Club roles still apply only to their own club/i);

    const admin = buildNavigationTourSteps({ canModerate: true, canAdmin: true, isStaff: true, canCreate: true });
    expect(admin[4].body).toContain('Moderation and Admin');
    expect(admin[3].title).toBe('Create from your available actions');
    expect(student[3].title).toBe('Participate without extra privileges');
  });

  it('keeps a separate, namespaced device key with no identity or content', () => {
    expect(NAVIGATION_TOUR_KEY).toBe('campusplus:navigation-tour-v1');
    expect(NAVIGATION_TOUR_KEY).not.toBe(GUIDE_SEEN_KEY);
    const storage = storageStub();
    expect(markNavigationTour(storage, 'completed', '2026-10-28T00:00:00.000Z')).toBe(true);
    expect(storage.store.get(NAVIGATION_TOUR_KEY)).toBe('completed:2026-10-28T00:00:00.000Z');
    expect(readNavigationTour(storage)).toBe('completed');
    expect(markNavigationTour(storage, 'dismissed', '2026-10-28T01:00:00.000Z')).toBe(true);
    expect(readNavigationTour(storage)).toBe('dismissed');
  });

  it('distinguishes unseen, seen and unavailable storage without throwing', () => {
    expect(readNavigationTour(storageStub())).toBe('unseen');
    expect(readNavigationTour(storageStub({ value: 'completed:any-old-stamp' }))).toBe('completed');
    expect(readNavigationTour(storageStub({ value: 'legacy-answer' }))).toBe('dismissed');
    expect(readNavigationTour(storageStub({ value: '' }))).toBe('unseen');
    expect(readNavigationTour(undefined)).toBeNull();
    expect(readNavigationTour({})).toBeNull();
    expect(readNavigationTour(storageStub({ throws: true }))).toBeNull();
    expect(markNavigationTour(storageStub({ throws: true }))).toBe(false);
    expect(markNavigationTour(undefined)).toBe(false);
  });

  it('offers itself only on Home and never after a stored answer or local dismissal', () => {
    expect(shouldOfferNavigationTour({ status: 'unseen', onHome: true })).toBe(true);
    expect(shouldOfferNavigationTour({ status: null, onHome: true })).toBe(true);
    expect(shouldOfferNavigationTour({ status: 'dismissed', onHome: true })).toBe(false);
    expect(shouldOfferNavigationTour({ status: 'completed', onHome: true })).toBe(false);
    expect(shouldOfferNavigationTour({ status: 'unseen', onHome: false })).toBe(false);
    expect(shouldOfferNavigationTour({ status: 'unseen', onHome: true, hidden: true })).toBe(false);
    expect(shouldOfferNavigationTour()).toBe(false);
  });

  it('opens only from an explicit choice and can be reopened from existing menus', () => {
    const host = read('components/navigation/NavigationTour.js');
    expect(host).toContain('useState(false)');
    expect(host).toContain('onClick={start}');
    expect(host).toContain('onClose={dismiss}');
    expect(host).toContain('Skip tour');
    expect(host).toContain('Finish');
    expect(host).toContain('window.addEventListener(NAVIGATION_TOUR_EVENT');
    expect(read('components/layout/AppShell.js')).toContain('<NavigationTour');
    expect(read('components/layout/AccountMenu.js')).toContain('onClick={requestNavigationTour}');
    expect(read('components/layout/MobileMenu.js')).toContain('window.setTimeout(requestNavigationTour, 0)');
    expect(NAVIGATION_TOUR_EVENT).toBe('campusplus:open-navigation-tour');
    // This remains a device concern; no schema or account setting was added.
    expect(fs.readdirSync(path.join(ROOT, 'supabase/migrations')).some((file) => /tour/iu.test(file))).toBe(false);
  });
});
