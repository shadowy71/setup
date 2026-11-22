// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const formAction = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/actions/auth', () => ({ completeOnboarding: vi.fn() }));
vi.mock('@/lib/forms', () => ({ useFormAction: () => ({ run: formAction.run, pending: false, error: null, fieldErrors: null }) }));
vi.mock('@/components/atmosphere/GhostScene', () => ({ GhostScene: () => null }));
vi.mock('@/components/brand/Brand', () => ({ BrandLockup: () => null }));
vi.mock('@/components/brand/IndependenceNotice', () => ({ IndependenceNotice: () => null }));
vi.mock('@/components/layout/ThemeToggle', () => ({ ThemeToggle: () => null }));

import { OnboardingForm } from '@/components/auth/OnboardingForm';

let container;
let root;

async function mount(accountType) {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(React.StrictMode, null, React.createElement(OnboardingForm, { storageId: 'test-account', accountType })));
  });
}

async function typeInto(input, value) {
  await act(async () => {
    // React tracks programmatic value assignments; use the native setter to
    // simulate a real browser input event rather than changing that tracker.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(selector) {
  await act(async () => container.querySelector(selector).click());
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  formAction.run.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('onboarding interaction', () => {
  it.each(['visitor', 'student'])('accepts typing and keeps the current step for a %s, including after reload', async (accountType) => {
    const key = `campus:onboarding:v1:test-account:${accountType}`;
    await mount(accountType);
    await typeInto(container.querySelector('#display_name'), 'Campus Person');
    await click('button[type="submit"]');
    expect(container.textContent).toContain('Pick your @username.');

    const input = container.querySelector('#username');
    input.focus();
    for (const value of ['a', 'ab', 'abc', 'abc_d']) {
      await typeInto(input, value);
      expect(container.querySelector('#username')).toBe(input);
      expect(input.value).toBe(value);
      expect(document.activeElement).toBe(input);
      expect(container.textContent).toContain('Pick your @username.');
    }
    expect(JSON.parse(localStorage.getItem(key))).toMatchObject({ step: 1, values: { display_name: 'Campus Person', username: 'abc_d' } });

    await act(async () => root.unmount());
    root = null;
    await mount(accountType);
    expect(container.querySelector('#username').value).toBe('abc_d');
    await typeInto(container.querySelector('#username'), 'abc_de');
    expect(container.querySelector('#username').value).toBe('abc_de');
    await click('button[type="submit"]');
    expect(container.textContent).toContain(accountType === 'visitor' ? 'Which college do you attend?' : 'Which branch are you in?');
    expect(JSON.parse(localStorage.getItem(key)).step).toBe(2);
    // Even an unrelated parent re-render under StrictMode must not rehydrate
    // and jump backwards after Continue.
    await act(async () => root.render(React.createElement(React.StrictMode, null, React.createElement(OnboardingForm, { storageId: 'test-account', accountType }))));
    expect(container.textContent).toContain(accountType === 'visitor' ? 'Which college do you attend?' : 'Which branch are you in?');
    expect(JSON.parse(localStorage.getItem(key)).step).toBe(2);
  });

  it('explains an invalid username, then proceeds through the complete visitor flow', async () => {
    await mount('visitor');
    await typeInto(container.querySelector('#display_name'), 'Campus Person');
    await click('button[type="submit"]');
    await typeInto(container.querySelector('#username'), 'ab');
    await click('button[type="submit"]');
    expect(container.querySelector('[role="alert"]').textContent).toContain('at least 3 characters');
    expect(container.querySelector('#username')).not.toBeNull();
    expect(formAction.run).not.toHaveBeenCalled();

    await typeInto(container.querySelector('#username'), 'campus_person');
    await click('button[type="submit"]');
    expect(container.textContent).toContain('Which college do you attend?');
    await typeInto(container.querySelector('#visitor_college_name'), 'My College');
    await click('button[type="submit"]');
    await act(async () => container.querySelector('input[name="visitor_year"][value="Second Year"]').click());
    await click('button[type="submit"]');
    expect(container.textContent).toContain('Anything you’d like to share?');
    await click('.onboarding-skip');
    await act(async () => container.querySelector('input[type="checkbox"]').click());
    await click('button[type="submit"]');
    expect(formAction.run).toHaveBeenCalledOnce();
    const formData = formAction.run.mock.calls[0][0];
    expect(formData.get('username')).toBe('campus_person');
    expect(formData.get('visitor_college_name')).toBe('My College');
    expect(formData.get('visitor_year')).toBe('Second Year');
    expect(formData.get('accept_rules')).toBe('true');
  });

  it('restores a visitor draft with their own college and year at the correct step', async () => {
    localStorage.setItem('campus:onboarding:v1:test-account:visitor', JSON.stringify({
      step: 4,
      values: { display_name: 'Campus Person', username: 'campus_person', visitor_college_name: 'My College', visitor_year: 'Second Year' },
    }));
    await mount('visitor');
    expect(container.textContent).toContain('Anything you’d like to share?');
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('campus:onboarding:v1:test-account:visitor')).values.visitor_college_name).toBe('My College');
  });
});
