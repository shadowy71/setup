import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HomePulse } from '@/components/home/HomePulse';

// The real search form's router is exercised by the browser check. Server
// rendering here only needs the existing search entry's position in the hero.
vi.mock('@/components/search/SearchEntry', () => ({ SearchEntry: () => null }));

const read = (file) => fs.readFileSync(file, 'utf8');
const profile = {
  display_name: 'Yash Patil',
  username: 'yash_p',
  branch: 'Computer Engineering',
  show_branch_year: true,
};
const render = (props = {}) => renderToStaticMarkup(React.createElement(HomePulse, {
  user: { profile },
  ...props,
}));

describe('Home presentation refinement', () => {
  it('keeps the greeting separate and the real first name beside the interactive hand', () => {
    const html = render();
    expect(html).toContain('aria-labelledby="home-greeting"');
    expect(html).toContain('<span class="home-pulse__greet">Hey,</span>');
    expect(html).toMatch(/home-pulse__name"><span class="home-pulse__name-text" title="Yash">Yash<\/span><button/);
    expect(html).toContain('aria-label="Wave hello"');
    expect(html).toContain('Computer Engineering · everything happening on campus, right now');
    expect(html).toContain('href="/explore"');
  });

  it('does not hard-code the preview identity or reveal a hidden department', () => {
    const html = render({ user: { profile: { ...profile, display_name: '', username: 'meera_j', show_branch_year: false } } });
    expect(html).toContain('title="meera_j">meera_j</span>');
    expect(html).not.toContain('Yash');
    expect(html).not.toContain('Computer Engineering');
    expect(html).toContain('Everything happening on campus, right now');
  });

  it('retains the full name for accessible text and the long-name tooltip', () => {
    const html = render({ user: { profile: { ...profile, display_name: 'Chandrasekharan' } } });
    expect(html).toContain('title="Chandrasekharan">Chandrasekharan</span>');
    const css = read('app/styles/home.css');
    expect(css).toMatch(/\.home-pulse__name-text\s*\{[^}]*min-width: 0;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  });

  it('renders only supplied statistics, with equal tracks for their actual count', () => {
    expect(render()).not.toContain('<dl');
    const stats = [{ label: 'On the feed', value: 10 }, { label: 'Events ahead', value: 3 }];
    const html = render({ stats });
    expect(html).toContain('style="--home-stat-count:2"');
    expect(html).toContain('aria-label="Campus right now"');
    expect(html).toContain('<dt>On the feed</dt><dd>10</dd>');
    expect(html).not.toContain('Market listings');
    expect(render({ stats: [{ label: 'On the feed', value: 0 }] })).toContain('data-empty="true"');
  });

  it('uses real local bold weights, a centered non-wrapping heading, and shared columns', () => {
    const css = read('app/styles/home.css');
    const layout = read('app/layout.js');
    expect(layout).toContain("{ path: './fonts/Geist-Bold.woff2', weight: '700', style: 'normal' }");
    expect(layout).toContain("{ path: './fonts/Geist-SemiBold.woff2', weight: '600', style: 'normal' }");
    expect(css).toMatch(/\.home-pulse__name\s*\{[^}]*display: inline-flex;[^}]*align-items: center;[^}]*flex-wrap: nowrap;[^}]*font-weight: 700;/);
    expect(css.match(/grid-template-columns: var\(--home-columns\)/g)).toHaveLength(2);
    expect(css).toContain('@container home-page (min-width: 52rem)');
    expect(css).toContain('@container home-hero (max-width: 21rem)');
    expect(css).not.toContain('!important');
  });
});
