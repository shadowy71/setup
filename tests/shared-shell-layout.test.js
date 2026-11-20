import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(file, 'utf8');

describe('shared application shell route boundary', () => {
  it('keeps app, public discovery and map below the same optional frame', () => {
    expect(read('app/(shell)/layout.js')).toContain('<OptionalAppFrame>{children}</OptionalAppFrame>');
    for (const route of ['(app)', '(public)', 'map']) {
      expect(existsSync(`app/(shell)/${route}/layout.js`)).toBe(true);
      expect(read(`app/(shell)/${route}/layout.js`)).not.toContain('<OptionalAppFrame>');
    }
  });

  it('preserves the protected account gate and the static offline boundary', () => {
    expect(read('app/(shell)/(app)/layout.js')).toContain('await requireUser()');
    expect(read('app/timetable/offline/page.js')).toContain("dynamic = 'force-static'");
    expect(existsSync('app/(shell)/timetable/offline/page.js')).toBe(false);
  });
});

describe('shared sidebar layout ownership', () => {
  it('shows the sidebar toggle only in the desktop header and keeps the mobile menu', () => {
    const header = read('components/layout/ShellHeader.js');
    const mobile = header.slice(header.indexOf('{/* Mobile */}'), header.indexOf('{/* Desktop */}'));
    const desktop = header.slice(header.indexOf('{/* Desktop */}'));
    expect(mobile).not.toContain('{sidebarToggle}');
    expect(mobile).toContain('<MobileMenu');
    expect(desktop).toContain('{sidebarToggle}');
    const menu = read('components/layout/MobileMenu.js');
    expect(menu).toContain('getTimetableHref(user?.division)');
    expect(menu).toContain('ROUTES.map');
    expect(menu).toContain('createItems.map');
  });

  it('keeps desktop shell spacing controlled by the sidebar state, not route material sheets', () => {
    const css = read('app/styles/shell-frame.css');
    expect(css).toMatch(/:root \.app-frame \.shell-root\s*\{\s*padding-left:\s*0/);
    expect(css).toMatch(/data-sidebar-open='true'\] \.shell-root\s*\{\s*padding-left:\s*17rem/);
    for (const sheet of ['app/styles/lumen.css', 'app/styles/aurora.css']) {
      expect(read(sheet)).not.toMatch(/:root \.shell-root\s*\{[^}]*padding-left/s);
    }
  });
});

/**
 * Regression guard for the reported "the sidebar renders but nothing in it
 * responds" defect.
 *
 * The rail is `position: fixed`, but a fixed box still belongs to its parent's
 * stacking context. `.shell-root` (the content column) is `relative`,
 * `z-index: 10`, `isolation: isolate`, and comes AFTER the rail's wrapper in
 * the DOM. So the wrapper must be lifted above `10` — otherwise the panel is
 * flattened to the same `z-index` at document level, the content column paints
 * over it and silently swallows every click on the rail. The rail keeps
 * rendering, which is why the failure looked like a "frozen" panel rather than
 * a missing one, and why the header buttons (inside `.shell-root`) were fine.
 */
describe('the desktop rail cannot be buried by the content column', () => {
  it('lifts the rail wrapper above the content column and keeps no stacking-context utility on it', () => {
    const css = read('app/styles/shell-frame.css');
    const hostRule = css.match(/(?:^|\n)\.sidebar-host\s*\{([^}]*)\}/s);
    expect(hostRule, '.sidebar-host must own the rail wrapper stacking').toBeTruthy();
    const body = hostRule[1];
    const zIndex = Number(/z-index:\s*(-?\d+)/s.exec(body)?.[1]);
    // `.shell-root` is z-index: 10 (night.css); the wrapper has to be above it.
    expect(zIndex).toBeGreaterThan(10);
    // The backdrop sits under the open rail, so the rail stays clickable on
    // mobile while the scrim dims the page behind it.
    const backdrop = Number(/\.sidebar-backdrop\s*\{[^}]*z-index:\s*(-?\d+)/s.exec(css)?.[1]);
    expect(backdrop).toBeLessThan(zIndex);

    const frame = read('components/layout/ShellFrame.js');
    const wrapper = frame.slice(frame.indexOf('className="sidebar-host'), frame.indexOf('<Sidebar'));
    expect(wrapper).not.toMatch(/\bz-\d+\b|\bz-\[/);
  });
});
