import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  THEME_PALETTES,
  THEME_PREHYDRATION_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  normalizeTheme,
  readTheme,
  syncThemeChrome,
  writeTheme,
} from '@/lib/theme';

const read = (file) => fs.readFileSync(file, 'utf8');
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const appSources = [...walk('app'), ...walk('components'), ...walk('lib')].filter((name) =>
  /\.(js|css)$/.test(name),
);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function fakeRoot() {
  const attributes = new Map();
  return {
    attributes,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
  };
}

describe('two-theme appearance architecture', () => {
  it('defines the exact requested light and dark foundations', () => {
    expect(DEFAULT_THEME).toBe('dark');
    expect(THEME_PALETTES).toEqual({
      light: { background: '#E9E3D9', section: '#F7F3EC', accent: '#8DBCE3', text: '#292725' },
      dark: { background: '#14181E', section: '#1D232B', accent: '#92C3EA', text: '#F2F1EC' },
    });
    const tokens = read('app/tokens.css');
    for (const value of ['#E9E3D9', '#F7F3EC', '#8DBCE3', '#292725', '#14181E', '#1D232B', '#92C3EA', '#F2F1EC']) {
      expect(tokens).toContain(value);
    }
    expect(tokens).toContain(":root[data-theme='dark']");
    expect(tokens).toContain('color-scheme: light');
    expect(tokens).toContain('color-scheme: dark');
    expect(read('app/globals.css')).toContain('--cp-bg-page: var(--color-paper)');
    expect(read('app/globals.css')).toContain('--cp-text-primary: var(--color-ink)');
  });

  it('renders dark first and restores an explicit choice before paint', () => {
    const layout = read('app/layout.js');
    expect(layout).toContain('<html lang="en" data-theme="dark" suppressHydrationWarning>');
    expect(layout).toContain('<meta name="theme-color" content="#14181E" suppressHydrationWarning />');
    expect(layout).toContain('THEME_PREHYDRATION_SCRIPT');
    expect(layout).toContain('<ThemeChrome />');
    expect(read('components/layout/ThemeChrome.js')).toContain('syncThemeChrome');
    expect(layout).not.toContain('campusplus-device-colors');
    expect(layout).not.toContain('DEVICE_COLOR_PREHYDRATION_SCRIPT');
    expect(layout).not.toContain('prefers-color-scheme');
  });

  it('validates and persists only light or dark in browser storage', () => {
    const storage = memoryStorage();
    expect(readTheme(storage)).toBe('dark');
    expect(normalizeTheme('system')).toBeNull();
    expect(normalizeTheme('dark')).toBe('dark');
    expect(writeTheme(storage, 'dark')).toBe(true);
    expect(readTheme(storage)).toBe('dark');
    expect(writeTheme(storage, 'blue')).toBe(false);
    expect(readTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'blue' }))).toBe('dark');
    expect(readTheme({ getItem() { throw new Error('blocked'); } })).toBe('dark');
  });

  it('restores the saved theme in the pre-paint script without an OS lookup', () => {
    const root = fakeRoot();
    globalThis.window = { localStorage: memoryStorage({ [THEME_STORAGE_KEY]: 'light' }) };
    globalThis.document = { documentElement: root };
    new Function(THEME_PREHYDRATION_SCRIPT)();
    expect(root.getAttribute('data-theme')).toBe('light');

    const invalidRoot = fakeRoot();
    globalThis.window = { localStorage: memoryStorage({ [THEME_STORAGE_KEY]: 'system' }) };
    globalThis.document = { documentElement: invalidRoot };
    new Function(THEME_PREHYDRATION_SCRIPT)();
    expect(invalidRoot.getAttribute('data-theme')).toBe('dark');

    const emptyRoot = fakeRoot();
    globalThis.window = { localStorage: memoryStorage() };
    globalThis.document = { documentElement: emptyRoot };
    new Function(THEME_PREHYDRATION_SCRIPT)();
    expect(emptyRoot.getAttribute('data-theme')).toBe('dark');
  });

  it('leaves React-owned browser chrome for post-hydration synchronization', () => {
    const root = fakeRoot();
    const meta = { content: '#14181E', setAttribute(name, value) { this[name] = value; } };
    globalThis.window = { localStorage: memoryStorage({ [THEME_STORAGE_KEY]: 'light' }) };
    globalThis.document = {
      documentElement: root,
      querySelector: () => meta,
      querySelectorAll: () => [meta],
    };
    new Function(THEME_PREHYDRATION_SCRIPT)();
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(meta.content).toBe('#14181E');
    syncThemeChrome(root, 'light');
    expect(meta.content).toBe('#E9E3D9');
  });

  it('updates the root and browser chrome without a reload', () => {
    const root = fakeRoot();
    const meta = { setAttribute(name, value) { this[name] = value; } };
    globalThis.document = { querySelector: () => meta };
    expect(applyTheme(root, 'dark')).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(meta.content).toBe('#14181E');
    expect(applyTheme(root, 'invalid')).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(meta.content).toBe('#14181E');
  });

  it('synchronizes every nested browser-chrome meta tag', () => {
    const first = { setAttribute(name, value) { this[name] = value; } };
    const second = { setAttribute(name, value) { this[name] = value; } };
    globalThis.document = {
      querySelectorAll: () => [first, second],
      querySelector: () => first,
    };
    applyTheme(fakeRoot(), 'light');
    expect(first.content).toBe('#E9E3D9');
    expect(second.content).toBe('#E9E3D9');

    syncThemeChrome(fakeRoot(), 'dark');
    expect(first.content).toBe('#14181E');
    expect(second.content).toBe('#14181E');
  });

  it('keeps timetable install metadata without a second live browser-chrome value', () => {
    expect(read('app/timetable/layout.js')).not.toContain('themeColor:');
    const manifest = read('app/timetable/manifest/[division]/route.js');
    expect(manifest).toContain('theme_color: TIMETABLE_CANVAS_COLOR');
    expect(manifest).toContain('background_color: TIMETABLE_CANVAS_COLOR');
  });

  it('places the accessible switch immediately before the account menu on both layouts', () => {
    const header = read('components/layout/ShellHeader.js');
    expect(header.match(/<ThemeToggle \/>/g)).toHaveLength(2);
    expect(header).toMatch(/<ThemeToggle \/>\s*<AccountMenu/);
    const toggle = read('components/layout/ThemeToggle.js');
    expect(toggle).toContain('aria-label={`Switch to ${nextTheme} mode`}');
    expect(toggle).toContain('writeTheme');
    expect(toggle).toContain('applyTheme');
    expect(toggle).not.toContain('fetch(');
    expect(toggle).not.toContain('supabase');
  });

  it('removes device-specific customization and leaves only the two-theme control', () => {
    const settings = read('app/(app)/settings/page.js');
    expect(settings).not.toContain("key: 'appearance'");
    expect(settings).not.toContain('DeviceColorSettings');
    const account = read('components/layout/AccountMenu.js');
    expect(account).not.toContain('Customize colors');
    expect(account).not.toContain('Customise colors');
    expect(account).not.toContain('<Modal');
    expect(account).not.toContain('DeviceColorSettings');
    for (const file of [
      'components/settings/DeviceColorSettings.js',
      'components/settings/DeviceColorSettings.module.css',
      'lib/device-colors.js',
      'app/styles/device-colors.css',
      'tests/device-colors.test.js',
    ]) {
      expect(fs.existsSync(file), file).toBe(false);
    }
    const source = appSources.map((file) => read(file)).join('\n');
    for (const retired of [
      'device-colors',
      'DeviceColor',
      'data-device-colors',
      'campusplus:device-colors-v1',
      'Customize colors',
      'Customise colors',
    ]) {
      expect(source, retired).not.toContain(retired);
    }
  });

  it('keeps theme persistence local-only and removes custom-color synchronization', () => {
    const theme = read('lib/theme.js');
    expect(theme).toContain('localStorage');
    expect(theme).not.toContain('document.cookie');
    expect(theme).not.toContain('supabase');
    expect(theme).not.toContain('fetch(');
    const toggle = read('components/layout/ThemeToggle.js');
    expect(toggle).not.toContain('clearDeviceColorOverrides');
    expect(toggle).not.toContain('readDeviceColors');
    expect(toggle).not.toContain('DEVICE_COLOR_STORAGE_KEY');
    expect(toggle).toContain('writeTheme');
    expect(toggle).toContain('applyTheme');
  });

  it('has no system theme variant or legacy cookie reactivation', () => {
    for (const file of appSources) {
      const source = read(file);
      expect(source, file).not.toContain("[data-theme='system']");
      expect(source, file).not.toContain('campus_theme');
      if (file.endsWith('.js')) expect(source, file).not.toContain('prefers-color-scheme');
    }
  });
});
