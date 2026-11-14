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

  it('keeps the personalized greeting compact and removes the wave', () => {
    const pulse = read('components/home/HomePulse.js');
    expect(pulse).toContain('home-pulse__greet');
    expect(pulse).toContain('home-pulse__name-text');
    expect(pulse).not.toContain('<HandWave');
    expect(css).toMatch(/\.home-stage \.home-pulse__greet,[\s\S]*?display: inline;/);
  });

  it('uses Midnight Copper glass islands for the Home composition', () => {
    for (const color of ['#202A37', '#455466', '#92715A', '#BE9671']) expect(css).toContain(color);
    expect(css).toContain('--home-copper-gradient');
    expect(css).toContain('blur(18px) saturate(130%)');
    expect(css).toContain('.home-stage .home-composer');
    expect(css).toContain('.home-stage .rail-island');
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
