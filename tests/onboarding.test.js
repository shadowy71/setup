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
  it('renders the first question, progress and inherited login scene', async () => {
    const html = htmlOf(await OnboardingPage());
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('What should we call you?');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('login-ghost-layer');
    expect(html).toContain('not affiliated with');
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

  it('uses the same guided form in the real route and development preview', () => {
    const real = fs.readFileSync('app/onboarding/page.js', 'utf8');
    const preview = fs.readFileSync('app/onboarding-preview/page.js', 'utf8');
    expect(real).toContain('<OnboardingForm storageId=');
    expect(preview).toContain('<OnboardingForm preview');
    expect(preview).toContain("process.env.NODE_ENV !== 'development'");
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

describe('guided profile form', () => {
  it('keeps all existing fields in the guided flow and validates with the existing schema', () => {
    const source = fs.readFileSync('components/auth/OnboardingForm.js', 'utf8');
    for (const field of ['username', 'display_name', 'branch', 'year', 'division', 'bio', 'show_branch_year', 'accept_rules']) {
      expect(source).toContain(`field: '${field}'`);
    }
    expect(source).toContain('validate(values, onboardingSchema)');
    expect(source).toContain('completeOnboarding');
    expect(source).toContain('localStorage');
    expect(source).toContain('Skip for now');
  });

  it('still displays submission errors and disables pending submission', () => {
    state.form = { pending: true, error: 'Please try again.', fieldErrors: null };
    const html = htmlOf(React.createElement(OnboardingForm));
    expect(html).toContain('Please try again.');
    expect(html).toContain('Saving…');
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });
});
