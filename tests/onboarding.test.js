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
    expect(html).toContain('Campus life, a little less');
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
  it('names all six real destinations without sending students out of setup', () => {
    const html = htmlOf(React.createElement(OnboardingIntro));
    for (const route of ['Home', 'Explore', 'Communities', 'Campus', 'Market', 'Chat']) {
      expect(html).toContain(`<dt>${route}</dt>`);
      expect(fs.existsSync(`app/(app)/${route.toLowerCase()}/page.js`)).toBe(true);
    }
    expect(html).toContain('you&#x27;ll land on Home');
    expect(html).not.toMatch(/<a\b|<button\b|<input\b/);
    expect(html.match(/<li\b/g)).toHaveLength(3);
    expect(html).toContain('Reports go to human moderators');
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
