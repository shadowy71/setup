import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(file, 'utf8');
describe('shared Midnight Copper surfaces', () => {
  const css = read('app/styles/midnight-copper.css');
  it('loads after the shared shell and keeps all four requested colours', () => {
    const global = read('app/globals.css');
    expect(global.indexOf("@import './styles/midnight-copper.css';")).toBeGreaterThan(global.indexOf("@import './styles/shell-frame.css';"));
    for (const color of ['#202A37', '#455466', '#92715A', '#BE9671']) expect(css).toContain(color);
  });
  it('leaves Home in control of its existing treatment and protects readability', () => {
    expect(css).toContain(':not(.home-stage *)');
    expect(css).toContain("[data-theme='dark']");
    expect(css).toContain('prefers-reduced-transparency: reduce');
    expect(css).toContain('var(--color-paper-2)');
    expect(css).not.toMatch(/\bbody\s*\{/);
  });
  it('themes route surfaces without touching the map drawing or product images', () => {
    for (const selector of ['.page-head', '.club-card', '.market-product', '.market-placeholder', '.cm-shell', '.cm-mapcard', '.tt-shell']) expect(css).toContain(selector);
    expect(css).not.toContain('.cm-stage');
    expect(css).not.toContain('.market-cover__image');
  });
});
