import { deviceStorage } from '@/lib/guide/first-visit';

/** A device preference, separate from both onboarding and the long guide. */
export const NAVIGATION_TOUR_KEY = 'campusplus:navigation-tour-v1';
export const NAVIGATION_TOUR_EVENT = 'campusplus:open-navigation-tour';

/**
 * @returns {'unseen'|'dismissed'|'completed'|null} null means storage cannot
 * answer, not that the student dismissed the tour.
 */
export function readNavigationTour(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const value = storage.getItem(NAVIGATION_TOUR_KEY);
    if (!value) return 'unseen';
    if (/^completed:/u.test(value)) return 'completed';
    if (/^dismissed:/u.test(value)) return 'dismissed';
    // Any older non-empty answer counts as seen rather than renewing a prompt.
    return 'dismissed';
  } catch {
    return null;
  }
}

export function markNavigationTour(storage, outcome = 'dismissed', stamp = new Date().toISOString()) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    const state = outcome === 'completed' ? 'completed' : 'dismissed';
    storage.setItem(NAVIGATION_TOUR_KEY, `${state}:${stamp}`);
    return true;
  } catch {
    return false;
  }
}

/** Unknown storage gets the same non-blocking offer as a genuinely new device. */
export function shouldOfferNavigationTour({ status, onHome = false, hidden = false } = {}) {
  if (!onHome || hidden) return false;
  return status === 'unseen' || status === null;
}

export function navigationTourStorage() {
  return deviceStorage();
}

/** A small event keeps the account/menu controls decoupled from the tour host. */
export function requestNavigationTour() {
  if (typeof window === 'undefined') return false;
  window.dispatchEvent(new CustomEvent(NAVIGATION_TOUR_EVENT));
  return true;
}

/**
 * Five short steps, with the last one tailored from server-derived shell
 * capabilities. The browser receives booleans, never a permission resolver or
 * a session, and these explanations grant no access by themselves.
 */
export function buildNavigationTourSteps({ canModerate = false, canAdmin = false, canCreate = false, isStaff = false } = {}) {
  const staffTools = [canModerate ? 'Moderation' : null, canAdmin ? 'Admin' : null].filter(Boolean);
  const workspace = staffTools.length
    ? `Your ${staffTools.join(' and ')} ${staffTools.length === 1 ? 'link appears' : 'links appear'} only because this account has the corresponding platform permission. Club roles still apply only to their own club.`
    : isStaff
      ? 'Your staff label describes your account, while each tool still checks its own permission. Profile and Settings remain the place for your personal details and preferences.'
      : 'Profile and Settings hold your public details and preferences. Use Clubs to request an organization; ordinary students cannot make an official club directly.';

  return [
    {
      id: 'destinations',
      icon: 'home',
      title: 'Start with the main destinations',
      body: 'Home, Explore, Market, Messages and Profile stay in the mobile dock. On desktop, the sidebar also shows the wider campus sections. The small information buttons explain a destination without opening it.',
    },
    {
      id: 'find',
      icon: 'search',
      title: 'Find before you dig',
      body: 'Use Explore or Quick Actions to search across the product. On a keyboard, Command K or Control K opens Quick Actions; every result still leads to its normal page.',
    },
    {
      id: 'people',
      icon: 'users',
      title: 'Choose clubs or communities',
      body: 'Browse the club catalogue for established organizations and Communities for student-created groups. Club profiles show recruitment and membership states only when the underlying data supports them.',
    },
    {
      id: 'participate',
      icon: 'plus',
      title: canCreate ? 'Create from your available actions' : 'Participate without extra privileges',
      body: canCreate
        ? 'Your Create menu lists only actions available to this account. Messages and notifications stay in their usual places, and submitting content never turns a student submission into an official announcement.'
        : 'You can read, respond and participate through the controls on each page. Messages and notifications stay in their usual places; no special club or staff role is needed to take the tour.',
    },
    {
      id: 'workspace',
      icon: staffTools.length ? 'shield' : 'user',
      title: staffTools.length ? 'Your staff tools stay scoped' : 'Make the space yours',
      body: workspace,
    },
  ];
}
