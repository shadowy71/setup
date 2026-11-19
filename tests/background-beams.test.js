import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (rel) => readFileSync(join(root, rel), 'utf8');

describe('background beams ambience & quick navigation upgrades', () => {
  it('mounts BackgroundBeams globally in RootLayout without overriding the base dark/light palettes', () => {
    const layout = read('app/layout.js');
    const beams = read('components/atmosphere/BackgroundBeams.js');
    const beamsCss = read('app/styles/background-beams.css');
    const globals = read('app/globals.css');

    expect(layout).toContain("import { BackgroundBeams } from '@/components/atmosphere/BackgroundBeams'");
    expect(layout).toContain('<BackgroundBeams />');

    expect(beams).toContain('fixed inset-0 pointer-events-none z-0');
    expect(beams).toContain('aria-hidden="true"');
    expect(beams).toContain('Array.from({ length: 48 }');
    expect(beams).not.toContain('bg-neutral-950');

    expect(globals).toContain("@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));");
    expect(globals).toContain("@import './styles/background-beams.css';");

    expect(beamsCss).toContain('--beam-opacity: 0.18');
    expect(beamsCss).toContain('--beam-opacity: 0.45');
    expect(beamsCss).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('elevates interactive shell containers, feed items, and cards to z-10 above the z-0 beams', () => {
    const shellFiles = [
      'components/layout/GalacticIntro.js',
      'components/layout/AppShell.js',
      'components/layout/ShellFrame.js',
      'components/layout/PublicShell.js',
      'components/layout/PublicFrame.js',
      'components/ui/surfaces.js',
      'components/posts/PostCard.js',
      'components/content/ContentCard.js',
      'components/home/StreamItem.js',
      'components/home/HomeFeatureTiles.js',
    ];

    for (const file of shellFiles) {
      expect(read(file)).toContain('relative z-10');
    }

    expect(read('app/styles/night.css')).toMatch(/\.shell-root\s*\{[\s\S]*z-index:\s*10;/);
  });

  it('applies soft translucent container surfaces with backdrop blur for dark and light modes', () => {
    const aurora = read('app/styles/aurora.css');
    const dashboard = read('app/styles/home-dashboard.css');
    const shellFrame = read('app/styles/shell-frame.css');

    expect(aurora).toContain(":root[data-theme='dark'] .card");
    expect(aurora).toContain('rgb(255 255 255 / 0.02)');
    expect(aurora).toContain(":root[data-theme='light'] .card");
    expect(aurora).toContain('rgb(255 255 255 / 0.4)');
    expect(aurora).toContain('backdrop-filter: blur(4px)');

    expect(dashboard).toContain(":root[data-theme='dark'] .home-stage .stream-card");
    expect(dashboard).toContain(":root[data-theme='light'] .home-stage .stream-card");
    expect(dashboard).toContain('backdrop-filter: blur(4px)');

    expect(shellFrame).toContain('backdrop-filter: blur(12px)');
  });

  it('styles all six Quick Navigation tiles with dark/light micro-gradients and animated 19px icons', () => {
    const tilesJsx = read('components/home/HomeFeatureTiles.js');
    const dashboard = read('app/styles/home-dashboard.css');

    expect(tilesJsx).toContain('transition-all duration-200');
    expect(tilesJsx).toContain('<Icon name={tile.icon} size={19} className="transition-all duration-200" />');

    for (const tone of ['noticeboard', 'events', 'timetable', 'clubs', 'market', 'gigs']) {
      expect(dashboard).toContain(`:root[data-theme='dark'] .home-stage .feature-tile--${tone}`);
      expect(dashboard).toContain(`:root[data-theme='dark'] .home-stage .feature-tile--${tone}:hover`);
      expect(dashboard).toContain(`:root[data-theme='light'] .home-stage .feature-tile--${tone}`);
      expect(dashboard).toContain(`:root[data-theme='light'] .home-stage .feature-tile--${tone}:hover`);
    }
  });
});
