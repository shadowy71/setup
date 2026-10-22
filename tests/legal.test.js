import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Legal & Institutional Independence (`/legal`).
 *
 * These guards pin the *cautious* shape of the notice, so a future edit cannot
 * quietly upgrade it into a claim the project cannot support. They read the
 * sources the same way tests/intro.test.js and tests/theme.test.js do: the
 * required statements must be present, the required negations must be
 * present, and the forbidden shortcuts must be absent.
 */

const read = (file) => fs.readFileSync(file, 'utf8');
const page = read('app/legal/page.js');

describe('/legal — institutional independence notice', () => {
  it('states the independence position verbatim at the top', () => {
    expect(page).toContain('Legal Notice &amp; Institutional Independence');
    expect(page).toContain(
      'Campus+ is an independent student-run project. It is not owned, operated, maintained, sponsored,',
    );
    expect(page).toContain('approved or endorsed by Pimpri Chinchwad College of Engineering (PCCOE) or Pimpri');
    expect(page).toContain(
      'Nothing on this website is intended to represent Campus+ as an official institutional',
    );
  });

  it('covers every required section with a matching table-of-contents anchor', () => {
    const toc = [...page.matchAll(/\[\s*'([\w-]+)',\s*'([^']+)'\]/g)].map((m) => [m[1], m[2]]);
    const sections = [...page.matchAll(/<Section id="([\w-]+)"/g)].map((m) => m[1]);
    expect(sections.length).toBeGreaterThanOrEqual(12);
    expect(toc.map(([id]) => id)).toEqual(sections);
    const labels = toc.map(([, label]) => label);
    for (const required of [
      'Domain Name & Institutional Naming',
      'Third-Party Names, Logos & Trademarks',
      'Intellectual Property & Concerns',
      'Good-faith resolution & communication',
      'User-generated content & moderation',
      'Privacy & account information',
      'Applicable law & legal information',
    ]) {
      expect(labels).toContain(required);
    }
  });

  it('keeps the mandatory legal cautions', () => {
    // Openness to negotiate, stated expressly and in the agreed principle.
    expect(page).toContain('open to negotiations');
    expect(page).toContain('open to a respectful discussion to understand the concern and');
    expect(page).toContain('explore reasonable, mutually agreed solutions');
    expect(page).toContain('negotiated domain transfer');
    // The limits of disclaimers and of the crest placement, stated plainly.
    expect(page).toContain('Small size alone does not guarantee lawful use');
    expect(page).toContain('A disclaimer alone does not guarantee that confusion or infringement cannot occur');
    expect(page).toContain('not a legal opinion');
    expect(page).toContain('not a promise of unconditional domain transfer');
    expect(page).toContain('does not prevent another party from exercising lawful remedies');
    // Domain honesty: distinct rights, neither shortcut claimed.
    expect(page).toContain('Domain-name registration and trademark rights are distinct legal matters');
    expect(page).toContain('automatically owns every domain');
    // Dated and maintained.
    expect(page).toMatch(/Last updated: \{LAST_UPDATED\}/);
    expect(page).toMatch(/const LAST_UPDATED = '\d{1,2} [A-Z][a-z]+ \d{4}'/);
  });

  it('never claims permission, ownership or legal immunity', () => {
    expect(page).not.toMatch(/is protected by fair (use|dealing)/i);
    expect(page).not.toContain('immune from');
    expect(page).not.toContain('guarantees immunity');
    expect(page).not.toContain('with the permission of PCCOE');
    expect(page).not.toContain('with the permission of PCET');
    // No specific domain is claimed as owned/purchased — the acronym domain
    // from the brief is not named as an asset anywhere on the page.
    expect(page).not.toContain('pccoe.in');
    // No invented governing-law/arbitration venue.
    expect(page).not.toMatch(/governed by the laws of/i);
    expect(page).not.toMatch(/courts of [A-Z]/);
  });

  it('links only to verified official legal sources', () => {
    for (const href of [
      'https://www.registry.in/domaindisputeresolution',
      'https://ipindia.gov.in/tm-act-1999',
      'https://www.indiacode.nic.in/',
      'https://www.pccoepune.com/disclaimer-pccoe.php',
    ]) {
      expect(page).toContain(href);
    }
    expect(page).toContain('rel="noreferrer"');
  });

  it('is reachable without signing in', () => {
    const proxy = read('proxy.js');
    expect(proxy).toContain("'/legal'");
    // The page itself performs no session work.
    expect(page).not.toContain('requireUser');
    expect(page).not.toContain('getCurrentUser');
  });

  it('never invents a contact address: it is configuration or an honest gap', () => {
    expect(page).toContain('legalContact.email');
    expect(page).not.toMatch(/mailto:[a-z0-9._%+-]+@[a-z0-9.-]+/i);
    expect(read('lib/config.js')).toContain('process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL');
    expect(read('.env.example')).toContain('NEXT_PUBLIC_LEGAL_CONTACT_EMAIL');
  });
});

describe('sign-in independence disclosure', () => {
  const login = read('app/login/page.js');
  const notice = read('components/brand/IndependenceNotice.js');

  it('shows the disclosure in reading size beside the controls, linked to /legal', () => {
    expect(notice).toContain(
      'Independent student project — not affiliated with, operated by, or endorsed by PCCOE or PCET.',
    );
    expect(notice).toContain('Legal &amp; Institutional Independence');
    expect(notice).toContain('href={ROUTES.legal}');
    expect(notice).toContain('text-[0.8125rem]');
    expect(login).toContain('<IndependenceNotice');
  });

  it('keeps the crest a single, small, secondary placement separate from the wordmark', () => {
    // The login page no longer renders the crest in its brand area; its one
    // placement is inside the disclosure component, below MIN_SIZE legibility
    // floor rules in Brand.js.
    expect(login).not.toContain('CollegeCrest');
    expect(notice.match(/CollegeCrest/g)).toHaveLength(2); // import + the one render
    expect(notice).toContain('size={44}');
    expect(login).not.toContain('official PCCOE login');
    // Alt text comes from the shared crest component.
    expect(read('components/brand/Brand.js')).toContain("label = 'PCCOE crest'");
  });

  it('is also linked from the shared public footer', () => {
    const shell = read('components/layout/PublicShell.js');
    expect(shell).toContain('href={ROUTES.legal}');
    expect(shell).toContain('Legal &amp; Institutional Independence');
    expect(read('lib/constants.js')).toContain("legal: '/legal'");
  });
});
