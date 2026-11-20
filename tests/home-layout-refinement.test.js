import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(file, 'utf8');
const css = read('app/styles/home-dashboard.css');

describe('Home layout refinement', () => {
  it('loads the composition sheet only on Home and its development preview', () => {
    for (const layout of [
      'app/(shell)/(app)/home/layout.js',
      'app/home-preview/layout.js',
    ]) {
      expect(read(layout)).toContain("import '@/app/styles/home-dashboard.css';");
    }
    expect(read('app/globals.css')).not.toContain('home-dashboard.css');
    expect(read('app/layout.js')).not.toContain('home-dashboard.css');
  });

  it('stacks the real greeting in the PR 110 layout', () => {
    expect(css).toMatch(/\.home-stage \.home-pulse__greet\s*\{[^}]*display: block;[^}]*font-weight: 700;/);
    expect(css).toMatch(/\.home-stage \.home-pulse__name\s*\{[^}]*display: flex;[^}]*align-items: center;[^}]*margin: 0\.125rem 0 0;[^}]*font-weight: 700;/);
    expect(read('components/home/HomePulse.js')).toContain('home-pulse__name-text');
    expect(css).toMatch(/\.home-stage \.home-pulse__lead\s*\{[^}]*margin-top: 0\.625rem;/);
  });

  it('keeps the page-level bands flat and the interactive islands glass', () => {
    // Page-level bands stay flat. `.home-pulse` is the greeting/stats band and
    // `.home-composer` is the band wrapper around the composer: both are pure
    // layout, so they keep no plate of their own. The *interactive* islands
    // inside them (the composer form, the rail modules, the feed rows) are
    // glass and must NOT be flattened to `transparent`, which was the paper
    // design's rule and left them without any visible material at all.
    for (const section of ['.home-pulse', '.home-composer']) {
      expect(css).toMatch(new RegExp(`\\.home-stage \\${section}\\s*\\{[^}]*border: 0;[^}]*border-radius: 0;[^}]*background: transparent;[^}]*box-shadow: none;`));
    }
    // Rail modules: surface-tier glass.
    expect(css).toMatch(/\.home-stage \.rail-island\s*\{[^}]*background-color: color-mix\([^}]*glass-surface-tint[^}]*\);[^}]*backdrop-filter: var\(--glass-surface-blur\);/);
    // The composer form: floating-tier glass.
    expect(css).toMatch(/\.home-stage \.home-composer > form\s*\{[^}]*background-color: color-mix\([^}]*glass-floating-tint[^}]*\);[^}]*backdrop-filter: var\(--glass-floating-blur\);/);
    // The collapsed trigger is a well, not a plate.
    expect(css).toMatch(/\.home-stage \.home-composer__open\s*\{[^}]*background-color: var\(--cp-glass-well-tint\);[^}]*box-shadow: var\(--glass-well-shadow\);/);
    expect(css).toMatch(/\.home-stage \.stream-card\s*\{[^}]*border-radius: var\(--radius-md\);/);
    expect(css).toMatch(/\.home-stage \.feature-tile\s*\{[^}]*border-radius: var\(--radius-xs\);/);
  });

  it('uses a layered 1px fade between major sections and between present rail modules', () => {
    expect(css).toContain('--home-separator: linear-gradient(90deg, var(--home-rule-stops))');
    expect(css).toContain('--home-separator-vertical: linear-gradient(180deg, var(--home-rule-stops))');
    expect(css).toContain('filter: var(--home-rule-edge, none)');
    expect(css).toMatch(/\.home-stage \.home-pulse::after,\s*:root \.home-stage \.home-composer::after\s*\{[^}]*height: 1px;[^}]*background: var\(--home-separator\);/);
    expect(css).toMatch(/\.home-stage \.rail-island::after\s*\{[^}]*height: 1px;[^}]*background: var\(--home-separator\);/);
    expect(css).toContain('.home-stage .rail-island--market::after');
    expect(css).toContain('.home-stage .home-body__rail:not(:has(.rail-island--market)) .rail-island--events::after');
  });

  it('preserves the two-column breakpoint and stacks below it', () => {
    expect(css).toMatch(/@media \(min-width: 1100px\)\s*\{\s*:root \.home-stage \.home-body\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(15rem, 19rem\);/);
    expect(css).toMatch(/:root \.home-stage \.home-body\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).toMatch(/:root \.home-stage \.home-body__rail\s*\{[^}]*position: static;[^}]*overflow: visible;/);
  });

  it('scopes shared primitive overrides to the Home stage', () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map((chunk) => chunk.slice(0, chunk.indexOf('{')).trim())
      .filter((selector) => selector && !selector.startsWith('@'));
    for (const selector of selectors) {
      expect(selector).toMatch(/\.home-stage|home-explore-flow|^\d+%,?|^from$|^to$/);
    }
  });
});
