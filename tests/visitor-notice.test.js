import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  VISITOR_NOTICE_COOKIE,
  VISITOR_NOTICE_WINDOW_SECONDS,
  consumeVisitorNoticeCookie,
  showsVisitorNotice,
  visitorNoticeValue,
} from '@/lib/auth/visitor-notice';

/**
 * The Visitor sign-in notice (migration 080, `app/auth/callback/route.js`).
 *
 * The mechanism has to satisfy four properties at once, and each one is a way
 * this feature can go wrong in production:
 *
 *   1. it appears only for an external account, and only when the server said
 *      so — never because a URL said so;
 *   2. it appears once per sign-in: not on every navigation, not on refresh;
 *   3. it says what the account can and cannot do, and offers no Student/Visitor
 *      choice (the classification is not the person's to make);
 *   4. it cannot be resurrected by a visitor who re-adds the cookie value, and
 *      a forged value does nothing.
 *
 * The sandbox has no browser, so the component is exercised through the
 * server renderer plus a stubbed `document.cookie` — the same functions the
 * client component calls.
 */

/** Minimal `document.cookie` stand-in that supports both read and delete. */
function withCookieJar(initial = '') {
  let jar = initial;
  globalThis.document = {
    get cookie() {
      return jar;
    },
    set cookie(assignment) {
      const [pair] = assignment.split(';');
      const [name, value = ''] = pair.split('=');
      const cleared = /Max-Age=0/i.test(assignment) || value === '';
      const rest = jar
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith(`${name.trim()}=`));
      jar = cleared ? rest.join('; ') : [...rest, `${name.trim()}=${value}`].join('; ');
    },
  };
  return () => jar;
}

afterEach(() => {
  delete globalThis.document;
  vi.restoreAllMocks();
});

describe('the one-shot indicator', () => {
  it('only accepts the exact value the callback writes', () => {
    expect(visitorNoticeValue()).toBe('1');
    expect(showsVisitorNotice('1')).toBe(true);
    for (const forged of ['', '0', 'true', 'visitor', '1 ', 'yes', null, undefined]) {
      expect(showsVisitorNotice(forged), `forged value ${JSON.stringify(forged)}`).toBe(false);
    }
  });

  it('expires quickly, so an abandoned tab cannot spring it later', () => {
    expect(VISITOR_NOTICE_WINDOW_SECONDS).toBeLessThanOrEqual(300);
  });

  it('is consumed on read, so a refresh cannot re-show it', () => {
    const jar = withCookieJar(`${VISITOR_NOTICE_COOKIE}=1`);
    expect(consumeVisitorNoticeCookie()).toBe(true);
    expect(jar()).not.toContain(VISITOR_NOTICE_COOKIE);
    // Second read: already gone.
    expect(consumeVisitorNoticeCookie()).toBe(false);
  });

  it('discards a malformed indicator instead of keeping it around', () => {
    const jar = withCookieJar(`${VISITOR_NOTICE_COOKIE}=tampered`);
    expect(consumeVisitorNoticeCookie()).toBe(false);
    expect(jar()).not.toContain(VISITOR_NOTICE_COOKIE);
  });

  it('does nothing when there is no indicator', () => {
    withCookieJar('theme=dark');
    expect(consumeVisitorNoticeCookie()).toBe(false);
  });

  it('never touches a cookie during server rendering', () => {
    expect(consumeVisitorNoticeCookie()).toBe(false);
  });
});

/** Read the component source with comments removed, so assertions target code. */
async function componentCode() {
  const fs = await import('node:fs');
  const raw = fs.readFileSync(new URL('../components/auth/VisitorNotice.js', import.meta.url), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the notice component', () => {
  /** The component is client-side; render it once to read the real markup. */
  async function render(props) {
    const { VisitorNotice } = await import('@/components/auth/VisitorNotice');
    return renderToStaticMarkup(React.createElement(VisitorNotice, props));
  }

  it('renders nothing when the notice has not been opened', async () => {
    withCookieJar('');
    const html = await render({ email: 'someone@gmail.com', accountType: 'visitor' });
    expect(html).toBe('');
  });

  it('renders nothing at all for an institutional account, cookie or not', async () => {
    withCookieJar(`${VISITOR_NOTICE_COOKIE}=1`);
    for (const accountType of ['student', null, undefined, '']) {
      const html = await render({ email: 'aarav@pccoepune.org', accountType });
      expect(html, `accountType=${accountType}`).toBe('');
    }
  });

  it('names every visitor ability and both limits', async () => {
    // The dialog only paints after the effect opens it, which needs a client
    // runtime. Source-level assertions keep the copy honest without one.
    const source = await componentCode();
    for (const required of [
      'Welcome to Campus+!',
      'non-institutional',
      'Explore publicly available Campus+ content',
      'View public campus events and clubs',
      'Browse public communities and profiles',
      'Manage your own basic profile',
      'Publishing posts, comments, listings and other content is disabled by default.',
      'Additional permissions may be granted by a Campus+ administrator.',
      'Got it, continue',
    ]) {
      expect(source, `missing copy: ${required}`).toContain(required);
    }
  });

  it('offers no way to choose a role or ask for one', async () => {
    const source = await componentCode();
    // A choice here would be a promise the system does not keep: the account
    // type is decided by the verified address, not by a button.
    expect(source).not.toMatch(/request\s+(?:student\s+)?access/i);
    expect(source).not.toMatch(/become\s+a\s+student/i);
    expect(source).not.toMatch(/<select|type="radio"/);
    expect(source).not.toMatch(/switch\s+to\s+student/i);
  });

  it('shows the authenticated email, not anything from the URL', async () => {
    const source = await componentCode();
    expect(source).not.toMatch(/useSearchParams|searchParams|location\.search/);
    expect(source).toMatch(/break-anywhere text-sm font-medium text-ink">\{email \|\|/);
  });
});
