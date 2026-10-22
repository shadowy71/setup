import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Fast guards for the semantic pairings. The rendered/pixel audit complements
 * these: tokens alone cannot prove contrast under a blend, gradient or canvas. */
const css = fs.readFileSync('app/globals.css', 'utf8');
const tokens = new Map([...css.matchAll(/(--cp-[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));

function splitPair(value) {
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '(') depth += 1;
    if (value[i] === ')') depth -= 1;
    if (value[i] === ',' && depth === 0) return [value.slice(0, i), value.slice(i + 1)];
  }
  throw new Error(`Not a light-dark pair: ${value}`);
}

function color(value, theme, seen = new Set()) {
  const text = value.trim();
  if (text.startsWith('var(')) {
    const name = text.slice(4, -1);
    if (seen.has(name) || !tokens.has(name)) throw new Error(`Invalid token dependency: ${name}`);
    return color(tokens.get(name), theme, new Set([...seen, name]));
  }
  if (text.startsWith('light-dark(')) {
    return color(splitPair(text.slice(11, -1))[theme === 'light' ? 0 : 1], theme, seen);
  }
  if (text.startsWith('#')) {
    let hex = text.slice(1);
    if (hex.length === 3) hex = hex.split('').map((letter) => letter + letter).join('');
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1);
  }
  if (text.startsWith('rgba(')) return text.slice(5, -1).split(',').map(Number);
  throw new Error(`Unsupported color: ${text}`);
}

function read(name, theme) {
  expect(tokens.has(`--cp-${name}`), `Missing semantic token: ${name}`).toBe(true);
  return color(tokens.get(`--cp-${name}`), theme);
}

function composite(foreground, background) {
  return foreground.slice(0, 3).map((channel, i) => channel * foreground[3] + background[i] * (1 - foreground[3])).concat(1);
}

function luminance(value) {
  const linear = value.slice(0, 3).map((channel) => {
    const n = channel / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(a, b) {
  const sorted = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (sorted[1] + 0.05) / (sorted[0] + 0.05);
}

function verifyPair(foreground, background, theme, threshold = 4.5) {
  const fg = read(foreground, theme);
  const bg = read(background, theme);
  const ratio = contrast(composite(fg, bg), bg);
  expect(ratio, `${theme} ${foreground} on ${background}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(threshold);
}

const readingSurfaces = ['bg-page', 'bg-page-deep', 'bg-elevated', 'bg-subtle', 'bg-strong', 'bg-accent-soft', 'bg-accent-tint', 'hover-bg', 'success-bg', 'warning-bg', 'danger-bg', 'info-bg'];
const textRoles = ['text-primary', 'text-secondary', 'text-muted', 'text-subtle'];

for (const theme of ['dark']) {
  describe(`${theme} semantic contrast`, () => {
    it('keeps every text tier readable on reading and status surfaces', () => {
      for (const foreground of textRoles) {
        for (const background of readingSurfaces) verifyPair(foreground, background, theme);
      }
    });

    it('pairs accent/status/selection ink with its fill', () => {
      for (const role of ['success', 'warning', 'danger', 'info', 'selected', 'disabled']) {
        verifyPair(`${role}-text`, `${role}-bg`, theme);
      }
      verifyPair('disabled-selected-text', 'disabled-selected-bg', theme);
      verifyPair('text-accent', 'bg-page', theme);
      verifyPair('text-on-accent-soft', 'bg-accent-soft', theme);
      verifyPair('text-on-accent-soft', 'bg-accent-tint', theme);
      verifyPair('text-on-accent', 'bg-accent', theme);
    });

    it('keeps all primary reveal gradient stops and tactile keys readable', () => {
      for (const background of ['button-bg', 'button-gradient-start', 'button-gradient-mid', 'button-gradient-end']) {
        verifyPair('button-text', background, theme);
      }
      verifyPair('button-delete-text', 'button-delete-bg', theme);
      verifyPair('keycap-text', 'keycap-bg', theme);
      verifyPair('keycap-text', 'keycap-face', theme);
      verifyPair('button-sheen-text', 'button-sheen-bg', theme);
      // Worst-case blend values underneath the sheen backing: fully dark/light.
      for (const underlay of [[0, 0, 0, 1], [255, 255, 255, 1]]) {
        const background = composite(read('button-sheen-backing', theme), underlay);
        expect(contrast(read('button-sheen-text', theme), background)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('keeps typed text and placeholders readable in every field state', () => {
      for (const background of ['input-bg', 'input-focus-bg', 'search-bg-start', 'search-bg-end']) {
        verifyPair('input-text', background, theme);
        verifyPair('input-placeholder', background, theme);
        verifyPair('input-icon', background, theme, 3);
      }
      verifyPair('disabled-text', 'disabled-bg', theme);
    });

    it('bounds decorative search glow so it cannot wash out neighbouring copy', () => {
      for (const surface of ['bg-page', 'bg-elevated', 'bg-subtle']) {
        const base = read(surface, theme);
        const soft = composite(read('search-glow-soft', theme), base);
        const background = composite(read('search-glow', theme), soft);
        for (const text of textRoles) expect(contrast(read(text, theme), background)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('keeps dropdown menus dependable: backed glass, opaque fallback, portalled', () => {
      // The sidebar Create menu's invisibility was never a background-alpha
      // problem: `.side-panel > *` makes every sidebar child a z-index:1
      // stacking context, so the nav rows after the Create wrapper painted
      // OVER the anchored menu, and the panel's overflow clipped it. The
      // menu therefore renders through a body portal now, and its glass is
      // backed: the mix composites to >=90% opaque over ANY underlay, with a
      // fully opaque fallback where backdrop-filter does not exist.
      const feedback = fs.readFileSync('app/styles/feedback.css', 'utf8');
      const mix = feedback.match(/\.cp-menu\s*\{[^}]*background-color: color-mix\(in oklab, var\(--cp-bg-glass-strong\) (\d+)%, var\(--cp-bg-elevated\)\)/);
      expect(mix, '.cp-menu must mix the strong glass token over the opaque elevated token').toBeTruthy();
      expect(feedback).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\)[^{]*\{\s*\.cp-menu \{\s*background-color: var\(--cp-bg-elevated\)/);

      const share = Number(mix[1]) / 100;
      const glassStrong = read('bg-glass-strong', theme);
      const elevated = read('bg-elevated', theme);
      const mixedAlpha = share * glassStrong[3] + (1 - share) * elevated[3];
      expect(mixedAlpha).toBeGreaterThanOrEqual(0.9);
      const mixed = glassStrong
        .slice(0, 3)
        .map((channel, i) => (share * glassStrong[3] * channel + (1 - share) * elevated[3] * elevated[i]) / mixedAlpha)
        .concat(mixedAlpha);
      for (const underlay of [[0, 0, 0, 1], [255, 255, 255, 1]]) {
        const background = composite(mixed, underlay);
        for (const text of textRoles) {
          const ratio = contrast(read(text, theme), background);
          expect(ratio, `${theme} ${text} over menu glass: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        }
      }

      const overlays = fs.readFileSync('components/ui/overlays.js', 'utf8');
      expect(overlays).toContain("'cp-menu fixed z-[80]");
      expect(overlays).not.toContain("'cp-menu absolute");
    });

    it('bounds glass contrast over even the darkest/brightest underlays', () => {
      for (const surface of ['bg-glass', 'bg-glass-soft', 'bg-glass-strong', 'bg-cinematic-glass']) {
        for (const underlay of [[0, 0, 0, 1], [255, 255, 255, 1]]) {
          const background = composite(read(surface, theme), underlay);
          for (const text of textRoles) {
            const ratio = contrast(read(text, theme), background);
            expect(ratio, `${theme} ${text} over ${surface}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    });

    it('pairs inverse, cinematic and toast content independently of page theme', () => {
      verifyPair('text-inverse', 'bg-inverse', theme);
      verifyPair('toast-text', 'toast-bg', theme);
      for (const text of ['sky-text', 'sky-secondary', 'sky-muted']) verifyPair(text, 'sky-bg', theme);
    });

    it('keeps control edges, focus rings and checkmarks distinct', () => {
      for (const surface of ['bg-page', 'bg-elevated', 'bg-subtle', 'bg-strong', 'input-bg', 'input-focus-bg', 'search-bg-start', 'search-bg-end']) {
        verifyPair('border-control', surface, theme, 3);
        verifyPair('focus', surface, theme, 3);
        verifyPair('icon-muted', surface, theme, 3);
      }
      verifyPair('check-mark', 'check-bg', theme, 3);
      verifyPair('switch-thumb', 'switch-track', theme, 3);
      verifyPair('switch-thumb-checked', 'bg-accent', theme, 3);
      verifyPair('poll-fill', 'poll-track', theme, 3);
    });
  });
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

describe('readability architecture guards', () => {
  it('is permanently dark: one palette, with no light or system variant', () => {
    expect(css).toMatch(/:root,\s*\[data-theme='dark'\]\s*\{\s*color-scheme: dark/);
    expect(css).not.toContain("[data-theme='light']");
    expect(css).not.toContain("[data-theme='system']");
    expect(css).not.toContain('light-dark(');
    expect(css).not.toMatch(/@media \(prefers-color-scheme/);
    expect(css).not.toMatch(/color-scheme: light/);
    for (const value of tokens.values()) {
      expect(() => color(value, 'dark')).not.toThrow();
    }
  });

  it('does not introduce raw palette utilities or page-local color literals', () => {
    for (const file of [...walk('app'), ...walk('components')].filter((name) => /\.(js|jsx)$/.test(name))) {
      if (file !== 'app/layout.js') expect(fs.readFileSync(file, 'utf8')).not.toMatch(/#[\da-f]{3,8}\b/i);
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/(?:text|bg|border|placeholder)-(?:white|black|gray|slate|zinc|neutral|stone|blue|red|green|amber)(?:\b|-)/);
    }
  });

  it('never fades foreground labels, placeholders or disabled controls', () => {
    const controls = fs.readFileSync('app/styles/controls.css', 'utf8');
    const interactive = fs.readFileSync('app/styles/interactive.css', 'utf8');
    expect(controls).not.toContain('campus-sheen-text');
    expect(controls).not.toMatch(/(?:\.\w[\w-]*:disabled|::placeholder)[^{]*\{[^}]*opacity:\s*0\./);
    expect(interactive).not.toContain('filter: blur(2px)');
    expect(interactive).not.toContain('opacity: 0.16');
    expect(fs.readFileSync('app/styles/atmosphere.css', 'utf8')).not.toMatch(/\.login-sky\s+\.text-/);
  });

  it('keeps wheel reflection below the transformed foreground', () => {
    const interactive = fs.readFileSync('app/styles/interactive.css', 'utf8');
    expect(interactive).toMatch(/\.wheel__panel::after\s*\{[^}]*z-index:\s*0/);
    expect(interactive).toMatch(/\.wheel__spin\s*\{[^}]*z-index:\s*1/);
  });

  it('keeps native radio focus inside the rotating dial', () => {
    const interactive = fs.readFileSync('app/styles/interactive.css', 'utf8');
    expect(interactive).toMatch(/\.wheel__input\s*\{[^}]*left:\s*calc\(var\(--wheel-left\)\s*\+\s*var\(--wheel-r\)\s*\+\s*var\(--wheel-option-w\)\s*\/\s*2\)/);
    expect(interactive).toMatch(/\.wheel__input\s*\{[^}]*top:\s*50%/);
  });

  it('keeps auth/data/RLS decisions out of presentation changes', () => {
    const brand = fs.readFileSync('components/brand/Brand.js', 'utf8');
    expect(brand).toContain("import pccoeCrest from '@/public/brand/pccoe-crest.webp'");
    expect(brand).toContain('export const CREST_SRC = pccoeCrest.src');
    // The asset is compiled to a public static build URL, not an auth exception.
    expect(fs.readFileSync('proxy.js', 'utf8')).not.toContain('/brand/');
  });
});
