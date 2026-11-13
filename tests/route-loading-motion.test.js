import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('route loading motion', () => {
  it('slows the Campus+ route loader without changing other orbital loaders', () => {
    const loading = read('app/(shell)/(app)/loading.js');
    const css = read('app/styles/feedback.css');

    expect(loading).toMatch(/className="route-loading [^"]*"/);
    expect(loading).toContain('<Spinner label="Loading Campus+…"');
    expect(css).toMatch(/\.route-loading \.orb-loader__dot\s*\{\s*animation-duration: 1\.5s;/);
    expect(css).toMatch(/\.route-loading \.orb-loader__dot:nth-child\(2\)\s*\{\s*animation-duration: 2\.1s;/);
    expect(css).toMatch(/\.route-loading \.orb-loader__dot:nth-child\(3\)\s*\{\s*animation-duration: 2\.7s;/);
  });

  it('continues to respect reduced motion', () => {
    const css = read('app/styles/controls.css');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration: 0\.001ms !important/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-iteration-count: 1 !important/);
  });
});
