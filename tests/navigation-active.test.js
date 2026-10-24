import { describe, it, expect } from 'vitest';
import { isActivePath, resolveActiveHref, normalizePath } from '@/lib/navigation/active';
import { PRIMARY_NAV, MOBILE_NAV, ROUTES } from '@/lib/constants';

/**
 * Active-destination resolution.
 *
 * The rail and the dock must agree, a nested route must light exactly one row,
 * and a similarly-spelled route must not (`/gigstore` ≠ `/gigs`).
 */

describe('isActivePath', () => {
  it('matches the destination itself and its children', () => {
    expect(isActivePath('/home', '/home')).toBe(true);
    expect(isActivePath('/gigs/abc', '/gigs')).toBe(true);
    expect(isActivePath('/clubs/abc/edit', '/clubs')).toBe(true);
    expect(isActivePath('/market/listing/123', '/market')).toBe(true);
    expect(isActivePath('/chat/123', '/chat')).toBe(true);
  });

  it('does not match siblings, prefixes or the root', () => {
    expect(isActivePath('/gigstore', '/gigs')).toBe(false);
    expect(isActivePath('/homework', '/home')).toBe(false);
    expect(isActivePath('/marketplace', '/market')).toBe(false);
    expect(isActivePath('/explore', '/')).toBe(false);
    expect(isActivePath('/anything', '')).toBe(false);
  });

  it('ignores a trailing slash', () => {
    expect(normalizePath('/gigs/')).toBe('/gigs');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
    expect(isActivePath('/gigs/', '/gigs')).toBe(true);
  });
});

describe('resolveActiveHref', () => {
  it('returns the single most specific destination', () => {
    expect(resolveActiveHref('/gigs/abc', ['/gigs', '/market'])).toBe('/gigs');
    expect(resolveActiveHref('/clubs/abc', ['/clubs', '/communities'])).toBe('/clubs');
    expect(resolveActiveHref('/campus/events/42', ['/campus', '/campus/events'])).toBe('/campus/events');
    expect(resolveActiveHref('/explore/projects/42', ['/explore', '/explore/projects'])).toBe('/explore/projects');
  });

  it('returns null when nothing matches', () => {
    expect(resolveActiveHref('/nowhere', ['/home', '/explore'])).toBeNull();
    expect(resolveActiveHref('/home', [])).toBeNull();
  });

  it('lights exactly one primary destination for every primary route', () => {
    for (const item of PRIMARY_NAV) {
      const matches = PRIMARY_NAV.filter((candidate) => isActivePath(item.href, candidate.href));
      expect(matches.map((match) => match.href), item.href).toEqual([item.href]);
      expect(resolveActiveHref(item.href, PRIMARY_NAV.map((nav) => nav.href))).toBe(item.href);
    }
  });

  it('keeps Gigs and Clubs first-class in both navigation surfaces', () => {
    const primaryHrefs = PRIMARY_NAV.map((item) => item.href);
    expect(primaryHrefs).toContain(ROUTES.gigs);
    expect(primaryHrefs).toContain(ROUTES.clubs);
    // The dock stays five destinations; Gigs/Clubs remain reachable from the
    // rail and the "everything else" sheet.
    expect(MOBILE_NAV).toHaveLength(5);
    expect(MOBILE_NAV.map((item) => item.href)).toEqual(['/home', '/explore', '/market', '/chat', '/profile']);
    // Deep links for a gig and a club resolve to their own sections.
    expect(resolveActiveHref(ROUTES.gig('abc'), primaryHrefs)).toBe(ROUTES.gigs);
    expect(resolveActiveHref(ROUTES.club('abc'), primaryHrefs)).toBe(ROUTES.clubs);
  });

  it('sends a signed-in student reading a post to no primary row', () => {
    // A post detail is not inside a nav section, so nothing is falsely lit.
    expect(resolveActiveHref('/post/abc', PRIMARY_NAV.map((item) => item.href))).toBeNull();
    expect(resolveActiveHref('/notifications', PRIMARY_NAV.map((item) => item.href))).toBeNull();
  });
});
