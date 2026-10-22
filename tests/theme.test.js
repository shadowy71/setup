import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Campus+ is permanently dark.
 *
 * There is one designed night palette and no way to leave it: no light mode,
 * no "follow the device", no appearance setting, and no cookie/saved
 * preference that can resurrect one. These guards pin that decision the same
 * way tests/intro.test.js pins the intro's architecture — by reading the
 * sources, so a reintroduced toggle, theme cookie or light palette fails
 * here instead of shipping.
 */

const read = (file) => fs.readFileSync(file, 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const appSources = [...walk('app'), ...walk('components'), ...walk('lib')].filter((name) =>
  /\.(js|css)$/.test(name),
);

describe('permanent dark theme', () => {
  it('always renders the root as dark, with the dark browser chrome color', () => {
    const layout = read('app/layout.js');
    expect(layout).toContain('<html lang="en" data-theme="dark">');
    expect(layout).toContain("themeColor: '#07151d'");
    // Nothing about the root is chosen at runtime any more.
    expect(layout).not.toContain('readTheme');
    expect(layout).not.toContain('prefers-color-scheme');
    expect(layout).not.toContain('data-theme={');
  });

  it('ships exactly one palette, keyed to a dark color-scheme', () => {
    const globals = read('app/globals.css');
    expect(globals).toMatch(/:root,\s*\[data-theme='dark'\]\s*\{\s*color-scheme: dark/);
    expect(globals).not.toMatch(/color-scheme: light/);
    expect(globals).not.toContain("[data-theme='light']");
    expect(globals).not.toContain("[data-theme='system']");
    expect(globals).not.toContain('light-dark(');
    expect(globals).not.toMatch(/@media \(prefers-color-scheme/);
    // The canonical Teal Sand night palette is the one that ships.
    expect(globals).toContain('--cp-bg-page: #07151d');
    expect(globals).toContain('--cp-text-primary: #f8faf7');
  });

  it('has no light-theme overrides left in component CSS', () => {
    for (const file of walk('app/styles')) {
      if (!file.endsWith('.css')) continue;
      expect(read(file), file).not.toContain("[data-theme='light']");
      expect(read(file), file).not.toContain("[data-theme='system']");
    }
  });

  it('has deleted the theme machinery instead of hiding it', () => {
    for (const file of [
      'components/ui/theme.js',
      'components/profile/AppearancePanel.js',
      'lib/theme.js',
      'app/styles/theme-switch.css',
    ]) {
      expect(fs.existsSync(file), file).toBe(false);
    }
  });

  it('offers no theme switch or appearance setting anywhere in the UI', () => {
    for (const file of appSources) {
      const source = read(file);
      expect(source, file).not.toContain('ThemeSwitch');
      expect(source, file).not.toContain('theme-switch');
      expect(source, file).not.toContain('AppearancePanel');
      expect(source, file).not.toContain('applyTheme');
    }
    const settings = read('app/(app)/settings/page.js');
    expect(settings).not.toContain("'appearance'");
    expect(settings).not.toContain('Appearance');
    // An old ?tab=appearance link resolves through the same allow-list as any
    // unknown tab, landing on Profile rather than a dead section.
    expect(settings).toContain("TABS.some((item) => item.key === params?.tab) ? params.tab : 'profile'");
  });

  it('cannot be reactivated by a legacy preference cookie', () => {
    for (const file of appSources) {
      expect(read(file), file).not.toContain('campus_theme');
    }
  });

  it('never consults the operating system colour scheme in client code', () => {
    for (const file of appSources.filter((name) => name.endsWith('.js'))) {
      expect(read(file), file).not.toContain('prefers-color-scheme');
    }
  });
});
