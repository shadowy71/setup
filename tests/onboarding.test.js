import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  configured: true,
  user: { needsProfileSetup: true },
  form: { pending: false, error: null, fieldErrors: null },
}));

vi.mock('next/navigation', () => ({ redirect: (to) => { throw new Error(`redirect:${to}`); } }));
vi.mock('@/lib/config', () => ({ isSupabaseConfigured: () => state.configured }));
vi.mock('@/lib/auth/session', () => ({ getCurrentUser: vi.fn(async () => state.user) }));
// The real shell's static artwork imports are Next build assets. Isolate the
// page's composition here; shared-shell disclosure is covered separately.
vi.mock('@/components/layout/PublicShell', () => ({ PublicShell: ({ children }) => children }));
vi.mock('@/lib/actions/auth', () => ({ completeOnboarding: vi.fn() }));
vi.mock('@/lib/forms', () => ({ useFormAction: () => ({ run: vi.fn(), ...state.form }) }));

import OnboardingPage from '@/app/onboarding/page';
import { OnboardingIntro } from '@/components/auth/OnboardingIntro';
import { OnboardingForm } from '@/components/auth/OnboardingForm';
import {
  GUIDE_GROUPS,
  GUIDE_HEADLINE_INK,
  GUIDE_HEADLINE_LEAD,
  GUIDE_OPENING,
  GUIDE_OPENING_SHORT,
} from '@/lib/guide/content';

/**
 * Every page Next actually serves, derived from `app/` (route groups stripped,
 * `[segment]` becoming `:segment`), so this file can only ever assert over
 * destinations that exist.
 */
const PAGE_ROUTES = new Set();
const walkRoutes = (dir, prefix) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const dynamic = /^\[\.?\.{0,2}([^\]]+)\]$/.exec(entry.name);
      const segment = /^\(.*\)$/.test(entry.name) ? prefix : `${prefix}/${dynamic ? `:${dynamic[1]}` : entry.name}`;
      walkRoutes(absolute, segment);
    } else if (entry.name === 'page.js') {
      PAGE_ROUTES.add(prefix === '' ? '/' : prefix);
    }
  }
};
walkRoutes(path.join(process.cwd(), 'app'), '');

const htmlOf = (node) => renderToStaticMarkup(node);

beforeEach(() => {
  state.configured = true;
  state.user = { needsProfileSetup: true };
  state.form = { pending: false, error: null, fieldErrors: null };
});

describe('first-profile onboarding lifecycle', () => {
  it('renders the existing profile form before the introduction and guide', async () => {
    const html = htmlOf(await OnboardingPage());
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    // The headline is the guide's, not a second telling of it.
    expect(html).toContain(`${GUIDE_HEADLINE_LEAD} <span`);
    expect(html).toContain(GUIDE_HEADLINE_INK);
    expect(html.indexOf('</form>')).toBeLessThan(html.indexOf('id="onboarding-heading"'));
    expect(html.indexOf('</form>')).toBeLessThan(html.indexOf('Where do I go first?'));
    expect(html).toContain('<h1 id="profile-heading"');
    expect(html).toContain('<h2 id="onboarding-heading"');
    expect(html).toContain('aria-labelledby="profile-heading"');
  });

  it.each([
    [false, null, '/setup'],
    [true, null, '/login'],
    [true, { needsProfileSetup: false }, '/home'],
  ])('preserves guards (configured=%s, user=%s)', async (configured, user, target) => {
    state.configured = configured;
    state.user = user;
    await expect(OnboardingPage()).rejects.toThrow(`redirect:${target}`);
  });

  it('is imported only by the onboarding route', () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(file) : [file];
    });
    const consumers = [...walk('app'), ...walk('components')]
      .filter((file) => /\.js$/.test(file) && file !== 'components/auth/OnboardingIntro.js')
      .filter((file) => /import .*OnboardingIntro.* from/.test(fs.readFileSync(file, 'utf8')));
    expect(consumers).toEqual(['app/onboarding/page.js']);
    expect(fs.readFileSync('components/layout/PublicShell.js', 'utf8'))
      .toContain('unofficial student project for PCCOE, not affiliated with or endorsed by the college');
  });
});

describe('field notes and orientation', () => {
  /*
   * Both purposes survived the rewrite of the intro into a slice of `/guide`:
   * nothing under the form may lead a student away from the step they are on, and
   * the slice may not become its own account of the product. So the labels and the
   * reasons are read back out of `lib/guide/content.js` — the same source the guide
   * renders — and the only link allowed is the one that works without a profile.
   */
  it('renders the guide as a subset, with no way out of setup', () => {
    const html = htmlOf(React.createElement(OnboardingIntro));
    const primary = GUIDE_GROUPS.filter((group) => group.emphasis === 'primary');
    expect(primary.map((group) => group.label)).toEqual(['Find information', 'Find your people', 'Get involved']);

    for (const group of primary) {
      expect(html).toContain(`<dt>${group.label}</dt>`);
      expect(html, group.why).toContain(group.why);
    }
    // The rest are named, not linked — a map of what is waiting.
    for (const group of GUIDE_GROUPS.filter((item) => item.emphasis !== 'primary')) {
      expect(html, group.label).toContain(group.links[0].label);
    }
    // Exactly one link, and it is the guide. Every app route redirects a student
    // without a profile straight back to this page.
    expect(html.match(/<a\b/g) ?? []).toHaveLength(1);
    expect(html).toContain('href="/guide"');
    expect(html).not.toMatch(/<button\b|<input\b|<li\b/);
    expect(html).toMatch(/you will land on Home/i);
    // Nothing here may name a destination the app does not serve.
    const named = ['/guide', ...primary.map((group) => group.links[0].href)];
    for (const href of named) {
      expect(PAGE_ROUTES.has(href), href).toBe(true);
    }
  });

  it('keeps one source for what Campus+ is', () => {
    const source = fs.readFileSync('components/auth/OnboardingIntro.js', 'utf8');
    // The old locally-written lists are gone for good; the intro may only read.
    expect(source).not.toMatch(/const (NOTES|DESTINATIONS) = /);
    expect(source).toContain("from '@/lib/guide/content'");
    expect(source).toContain('GUIDE_OPENING_SHORT');
    // The short form is a shorter telling of the same claim, not a different claim:
    // both say "searchable", and only the guide has room for the rest.
    const opening = GUIDE_OPENING.join(' ');
    expect(GUIDE_OPENING_SHORT).toContain('searchable');
    expect(opening).toContain('searchable');
    expect(opening.length).toBeGreaterThan(GUIDE_OPENING_SHORT.length);
    // The independence disclosure is not duplicated here — the shared public shell
    // already says it on this page, and the guide repeats it where it stands alone.
    expect(source).not.toMatch(/not an official/i);
  });
});

describe('profile form presentation stays intact', () => {
  it('keeps profile fields, optional choices and required rule consent', () => {
    const html = htmlOf(React.createElement(OnboardingForm));
    for (const field of ['username', 'display_name', 'branch', 'year', 'division', 'bio', 'show_branch_year', 'accept_rules']) {
      expect(html).toContain(`name="${field}"`);
    }
    expect(html).toContain('Prefer not to say');
    expect(html).toMatch(/<button[^>]*disabled=""/);
    // Keep the phone keyboard closed until the student chooses an input.
    expect(html).not.toContain('autofocus');
  });

  it('still displays server field errors and submission errors', () => {
    state.form = { pending: false, error: 'Please check the highlighted fields.', fieldErrors: { username: 'Username is taken.' } };
    const html = htmlOf(React.createElement(OnboardingForm));
    expect(html).toContain('Username is taken.');
    expect(html).toContain('Please check the highlighted fields.');
    expect(html).toContain('aria-invalid="true"');
  });

  it('shows the pending label and disables submission', () => {
    state.form.pending = true;
    const html = htmlOf(React.createElement(OnboardingForm));
    expect(html).toContain('Creating your profile…');
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
});
