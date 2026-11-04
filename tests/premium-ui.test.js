import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokens = fs.readFileSync('app/tokens.css', 'utf8');
const css = fs.readFileSync('app/styles/lumen.css', 'utf8');
const light = tokens.match(/:root,\s*:root\[data-theme='light'\]\s*\{([^}]*)\}/)?.[1];
const dark = tokens.match(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/)?.[1];

describe('restrained two-theme surface polish', () => {
  it('has independent depth and ambient values in both existing palettes', () => {
    for (const palette of [light, dark]) {
      for (const token of ['depth-1', 'depth-2', 'depth-3', 'ambient-accent', 'ambient-warm']) {
        expect(palette).toContain(`--${token}:`);
      }
    }
    // Nothing in this treatment replaces the existing semantic colour roles.
    expect(css).toContain('background-color: var(--color-paper);');
    expect(css).toContain('background: var(--color-paper-2);');
  });

  it('limits ambient light to the Home stage and blur to floating menus', () => {
    expect(css).toMatch(/:root \.home-stage\s*\{[^}]*background-image:\s*radial-gradient\([^}]*var\(--ambient-accent\)/);
    expect(css).toMatch(/@media \(min-width: 768px\)\s*\{\s*:root \.cp-menu,\s*:root \.command-palette\s*\{/);
  });

  it('keeps hover elevation to fine pointers and honours reduced motion', () => {
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*:root a\.card:hover/);
    expect(css).toMatch(/:root \.feature-tile:hover[^}]*transform: translateY\(-2px\)/);
    expect(css).toContain(':root .search-pill__shell:focus-within');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: 0\.01ms !important/);
  });
});
