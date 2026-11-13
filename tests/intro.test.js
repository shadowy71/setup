import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shouldShowLandingIntro } from '../components/layout/GalacticIntro.js';

const read = (file) => fs.readFileSync(file, 'utf8');
const source = read('components/layout/GalacticIntro.js');
const css = read('components/layout/GalacticIntro.module.css');
const layout = read('app/layout.js');
const homeLayout = read('app/(shell)/(app)/home/layout.js');

// Minimal TrueType/OpenType reader: the table directory plus the `fvar` weight
// axis. Enough to prove whether these files are variable and what their real
// weight range is, without adding a font-parsing dependency.
const sfntTables = (buffer) => {
  const tables = new Map();
  const count = buffer.readUInt16BE(4);
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    tables.set(buffer.toString('ascii', record, record + 4), {
      offset: buffer.readUInt32BE(record + 8),
    });
  }
  return tables;
};
const fixed = (buffer, offset) => buffer.readInt32BE(offset) / 65536;
const weightAxis = (file) => {
  const buffer = fs.readFileSync(file);
  const tables = sfntTables(buffer);
  if (!tables.has('fvar')) return null;
  const fvar = tables.get('fvar').offset;
  const axisSize = buffer.readUInt16BE(fvar + 10);
  const axisCount = buffer.readUInt16BE(fvar + 8);
  for (let index = 0; index < axisCount; index += 1) {
    const axis = fvar + buffer.readUInt16BE(fvar + 4) + index * axisSize;
    if (buffer.toString('ascii', axis, axis + 4) !== 'wght') continue;
    return {
      min: fixed(buffer, axis + 4),
      default: fixed(buffer, axis + 8),
      max: fixed(buffer, axis + 12),
    };
  }
  return null;
};

describe('document-level galactic intro architecture', () => {
  it('keeps the restored cinematic intro behind the original root route gate', () => {
    expect(layout).toContain("import { LandingIntro } from '@/components/layout/GalacticIntro'");
    expect(layout).toContain('<LandingIntro>{children}</LandingIntro>');
    expect(layout).not.toContain('<GalacticIntro');
    expect(read('app/(shell)/(app)/home/layout.js')).not.toContain('HomeLaunchGate');
  });

  it('shows the animation only on the home page reached as the landing route', () => {
    // `/` is the redirect-only root; `/home` is the page it lands on.
    expect(source).toContain("const HOME_ROUTE = '/home'");
    expect(source).toContain("const ROOT_ROUTE = '/'");
    expect(source).toContain(
      'const HOME_ENTRY_ROUTES = new Set([ROOT_ROUTE, HOME_ROUTE])',
    );
    expect(source).toContain('window.location.pathname');
    expect(source).toContain('const show = shouldShowLandingIntro({');
    expect(source).toContain(
      'return <GalacticIntro enabled={show}>{children}</GalacticIntro>',
    );

    const visible = (pathname, entryPath, extra = {}) =>
      shouldShowLandingIntro({ pathname, entryPath, ...extra });

    // Landing routes: a fresh document at `/` or `/home`.
    expect(visible('/home', '/home')).toBe(true);
    expect(visible('/home', '/')).toBe(true);
    // `/` paints nothing (it is a redirect), so it renders no overlay itself.
    expect(visible('/', '/')).toBe(false);
    expect(visible('/login', '/')).toBe(false);

    // Client-side navigation to /home from any other page.
    for (const from of [
      '/profile',
      '/settings',
      '/communities',
      '/market',
      '/chat',
      '/campus/events',
      '/rules',
      '/login',
    ]) {
      expect(visible('/home', from)).toBe(false);
    }

    // Every other route, however it is entered.
    for (const pathname of [
      '/login',
      '/setup',
      '/onboarding',
      '/rules',
      '/profile',
      '/settings',
      '/communities',
      '/market',
      '/chat',
      '/campus',
      '/campus/events',
      '/explore',
      '/notifications',
      '/moderator',
      '/admin',
      '/dashboard',
      '/marketplace',
      '/events',
    ]) {
      expect(visible(pathname, pathname)).toBe(false);
      expect(visible(pathname, '/')).toBe(false);
    }

    // Document memory: once finished, a later return to /home cannot replay.
    expect(visible('/home', '/home', { done: true })).toBe(false);
  });

  it('does no animation work at all when the route gate is closed', () => {
    expect(source).toContain('export default function GalacticIntro({ children, enabled = true })');
    expect(source).toContain('if (!enabled) return undefined;');
    expect(source).toContain('}, [enabled]);');
    expect(source).toContain("const visible = enabled && phase !== 'done';");
  });

  it('never uses persistent playback state or application routing', () => {
    expect(source).not.toMatch(
      /sessionStorage|localStorage|document\.cookie|router\.|supabase|location\.reload|location\.href|location\.assign|location\.replace|next\/navigation.*redirect/,
    );
    expect(source).toContain('let completed = false');
    expect(source).toContain('inert={visible ? true : undefined}');
  });

  it('declares the real variable-font metadata and matching CSS/JS names', () => {
    // Both self-hosted files are variable fonts. The CSS ranges below are only
    // valid if they match the `fvar` weight axis exactly.
    const syne = weightAxis('public/fonts/Syne.ttf');
    const space = weightAxis('public/fonts/SpaceGrotesk.ttf');
    expect(syne).toEqual({ min: 400, default: 400, max: 800 });
    expect(space).toEqual({ min: 300, default: 300, max: 700 });
    // The route needs a small Latin/UI subset, not two complete desktop font
    // distributions. Keep the original variable axes while bounding the bytes.
    expect(fs.statSync('public/fonts/Syne.ttf').size).toBeLessThan(60_000);
    expect(fs.statSync('public/fonts/SpaceGrotesk.ttf').size).toBeLessThan(60_000);
    expect(css).toContain("font-family: 'Campus Galactic Syne'");
    expect(css).toContain("src: url('/fonts/Syne.ttf')");
    expect(css).toContain(`font-weight: ${syne.min} ${syne.max}`);
    expect(css).toContain("font-family: 'Campus Galactic Space'");
    expect(css).toContain("src: url('/fonts/SpaceGrotesk.ttf')");
    expect(css).toContain(`font-weight: ${space.min} ${space.max}`);

    // The Font Loading API must ask for the exact family descriptors used by
    // the @font-face rules above.
    expect(source).toContain("const SYNE_FAMILY = 'Campus Galactic Syne'");
    expect(source).toContain("const SPACE_FAMILY = 'Campus Galactic Space'");
    expect(source).toContain('fonts.load(SYNE_FONT, SYNE_GLYPHS)');
    expect(source).toContain('fonts.load(SPACE_FONT, SPACE_GLYPHS)');
  });

  it('verifies loaded faces and glyphs instead of trusting a fixed delay', () => {
    expect(source).toContain('const SYNE_FONT = `800 84px "${SYNE_FAMILY}"`');
    expect(source).toContain('const SPACE_FONT = `400 13px "${SPACE_FAMILY}"`');
    expect(source).toContain('const SYNE_GLYPHS = `${CAMPUS_TEXT}${PLUS_TEXT}`');
    expect(source).toContain(
      'const SPACE_GLYPHS = `${TAGLINE_TEXT}${SKIP_LABEL}`',
    );
    expect(source).toContain("face.status === 'loaded'");
    expect(source).toContain('await fonts.ready');
    expect(source).toContain('fonts.check(SYNE_FONT, SYNE_GLYPHS)');
    expect(source).toContain('fonts.check(SPACE_FONT, SPACE_GLYPHS)');
    expect(source).toContain('const FONT_WAIT_MS = 3000');
    expect(source).toContain('const fontWaitMs = compact ? MOBILE_FONT_WAIT_MS : FONT_WAIT_MS');
    expect(source).toContain('later(() => settle(true), fontWaitMs)');
    // The old 400 ms race must not come back.
    expect(source).not.toContain('later(start, 400)');
    expect(source).not.toMatch(/setTimeout\([^)]*,\s*400\)/);
  });

  it('has a single guarded startup and a whole-intro fallback', () => {
    expect(source).toContain('let settled = false');
    expect(source).toContain('let started = false');
    expect(source).toContain(
      'if (disposed || settled || started || finished || completed) return',
    );
    expect(source).toContain(
      'if (disposed || started || finished || completed) return',
    );
    expect(source).toContain('lockTypography(fallback)');
    expect(source).toContain(
      "stage.current.dataset.typography = fallback ? 'fallback' : 'loaded'",
    );
    for (const className of ['campus', 'plus', 'tagline', 'skip']) {
      expect(css).toContain(
        `.stage[data-typography='fallback'] .${className}`,
      );
    }
  });

  it('measures once, after typography is final, and applies both positions', () => {
    expect(source).toContain('positionLockup()');
    expect(source).toContain('textAdvance(campus.current)');
    expect(source).toContain('textAdvance(plus.current)');
    expect(source).toContain('760 - campusLength - 24 - plusLength');
    expect(source).toContain("campus.current.setAttribute('x'");
    expect(source).toContain("plus.current.setAttribute('x'");
    expect(source).toContain('await nextPaint()');
    // No measurement may happen before the font decision.
    expect(source.indexOf('lockTypography(fallback);')).toBeLessThan(
      source.indexOf('positionLockup();'),
    );
  });

  it('preserves the SVG proportions and the CSS choreography delays', () => {
    expect(source).toContain('viewBox="0 0 760 110"');
    expect(source).toContain('const FADE_AT_MS = 3100');
    expect(source).toContain('const FINISH_AT_MS = 3500');
    expect(css).toContain(
      'draw 1.25s cubic-bezier(0.77, 0, 0.175, 1) 0.55s',
    );
    expect(css).toContain('draw 0.65s cubic-bezier(0.77, 0, 0.175, 1) 1.3s');
    expect(css).toContain('fill 0.75s ease 1.65s');
    expect(css).toContain('fill 0.7s ease 1.7s');
    expect(css).toContain('tagIn 0.55s ease 2.25s');
    expect(css).toContain('breathe 3s ease 2.5s');
    expect(css).toContain('flare 1.8s ease 0.1s');
  });

  it('keeps the identity but compresses the phone choreography and font budget', () => {
    expect(source).toContain('const MOBILE_FONT_WAIT_MS = 1000');
    expect(source).toContain('const MOBILE_FADE_AT_MS = 1300');
    expect(source).toContain('const MOBILE_FINISH_AT_MS = 1700');
    expect(source).toContain("window.matchMedia('(max-width: 767px)')");
    expect(source).toContain('const fadeAtMs = compact ? MOBILE_FADE_AT_MS : FADE_AT_MS');
    expect(source).toContain('const finishAtMs = compact ? MOBILE_FINISH_AT_MS : FINISH_AT_MS');
    expect(source).toContain('later(end, finishAtMs)');
    expect(css).toContain('@media (max-width: 767px) and (prefers-reduced-motion: no-preference)');
    expect(css).toContain('draw 0.55s cubic-bezier(0.77, 0, 0.175, 1) 0.1s');
    expect(css).toContain('fill 0.35s ease 0.65s');
    expect(css).toContain('tagIn 0.35s ease 1s');
    // Reduced motion still takes the immediate existing exit, not this sequence.
    expect(source).toContain('later(end, 100)');
  });

  it('aligns the independent JS and CSS safety deadlines', () => {
    expect(source).toContain('const SAFETY_DEADLINE_MS = FONT_WAIT_MS + FINISH_AT_MS + 550');
    expect(source).toContain(
      'const SAFETY_CSS_DELAY_MS = SAFETY_DEADLINE_MS + 300',
    );
    expect(source).toContain('later(end, SAFETY_DEADLINE_MS)');
    expect(source).toContain("'--intro-safety-delay'");
    expect(css).toContain('var(--intro-safety-delay, 7.35s)');
  });

  it('owns exactly the dark scene tokens regardless of the document theme', () => {
    const tokens = read('app/tokens.css');
    const dark = tokens.match(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/)?.[1];
    const stage = css.match(/\.stage\s*\{([^}]*)\}/)?.[1];
    expect(dark).toBeDefined();
    expect(stage).toContain('color-scheme: dark');
    for (const token of [
      'paper', 'paper-2', 'ink', 'ink-2', 'rule-2',
      'accent', 'accent-2', 'accent-ink',
    ]) {
      const name = `--color-${token}`;
      const value = dark.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]+)`))?.[1];
      expect(value, `${name} should exist in the dark theme`).toBeDefined();
      expect(stage).toContain(`${name}: ${value};`);
    }
    expect(stage).toContain('--intro-secondary: var(--color-accent-2)');
    expect(stage).toContain('--intro-edge: var(--color-accent-ink)');
    expect(stage).toContain('--intro-glow: var(--color-accent-ink)');
    expect(css).not.toMatch(/:global\(:root\[data-theme=/);
    // The scene geometry and choreography remain shared by both themes.
    expect(css).toContain('ellipse 78% 60% at 22% 20%');
    expect(css).toContain('transparent 60%');
    expect(css).toContain('var(--intro-edge) 88%');
    expect(css).toContain('var(--intro-edge) 100%');
    expect(css).toContain('color-mix(in oklab, var(--color-accent) 13%, transparent)');
  });

  it('preloads the exclusive cinematic faces only on the Home route', () => {
    expect(layout).not.toContain('preload(');
    expect(homeLayout).toContain("preload('/fonts/Syne.ttf'");
    expect(homeLayout).toContain("preload('/fonts/SpaceGrotesk.ttf'");
    expect(homeLayout).toContain("from 'react-dom'");
  });

  it('cleans up timers, frames, motion and keyboard listeners', () => {
    for (const text of [
      'timers.forEach(clearTimeout)',
      'cancelAnimationFrame',
      "removeEventListener('change'",
      "removeEventListener('keydown'",
    ]) {
      expect(source).toContain(text);
    }
  });

  it('has independent deadlines, immediate skip, and reduced motion', () => {
    expect(source).toContain('onClick={finish}');
    expect(source).toContain('prefers-reduced-motion: reduce');
    expect(source).toContain('later(end, 100)');
    expect(source).toContain('event.key === \'Escape\'');
    expect(css).toContain(':focus-visible');
    expect(css).not.toMatch(/(?:html|body)\s*\{/);
  });
});
