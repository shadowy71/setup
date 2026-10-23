import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { formatUnread, UNREAD_CAP } from '@/lib/notifications/format';
import { toShellUser } from '@/lib/identity/shell-user';

/**
 * The unread indicator.
 *
 * One count is measured per request (the RLS-scoped `notifications` head count
 * in app/(app)/layout.js) and every surface — header bell, sidebar row, mobile
 * menu row — renders it through `formatUnread()`. These tests pin the badge
 * rules (0 = none, 1 and 99 exact, 100 = `99+`) and the accessible names, then
 * render the real components to prove the same number reaches all three.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

describe('formatUnread', () => {
  it('hides the badge at zero', () => {
    for (const value of [0, null, undefined, -3, Number.NaN]) {
      const unread = formatUnread(value);
      expect(unread.count).toBe(0);
      expect(unread.visible).toBe(false);
      expect(unread.aria).toBe('no unread');
      expect(unread.label).toBe('Notifications');
    }
  });

  it('shows an exact count up to the cap', () => {
    expect(formatUnread(1)).toMatchObject({ count: 1, text: '1', visible: true, aria: '1 unread' });
    expect(formatUnread(2)).toMatchObject({ count: 2, text: '2', visible: true });
    expect(formatUnread(UNREAD_CAP)).toMatchObject({ count: 99, text: '99', visible: true, aria: '99 unread' });
  });

  it('caps the badge at 99+ but keeps the real number in the accessible name', () => {
    const unread = formatUnread(100);
    expect(unread.text).toBe('99+');
    expect(unread.aria).toBe('100 unread');
    expect(unread.label).toBe('Notifications, 100 unread');
    expect(formatUnread(4210).aria).toBe('4210 unread');
  });

  it('floors fractional counts rather than rendering decimals', () => {
    expect(formatUnread(3.7).text).toBe('3');
  });
});

describe('the same count reaches header, sidebar and menu', () => {
  let ShellHeader;
  let Sidebar;
  let MobileMenuBody;
  const user = toShellUser({
    profile: { username: 'asha_e2e', display_name: 'Asha Patil', division: 'A' },
    roles: ['student'],
  });

  beforeAll(async () => {
    ({ ShellHeader } = await import('@/components/layout/ShellHeader'));
    ({ Sidebar } = await import('@/components/layout/Sidebar'));
    ({ MobileMenuBody } = await import('@/components/layout/MobileMenu'));
  });

  const render = (element) => renderToStaticMarkup(element);

  it('shows 99+ with the true count in the accessible name at 100 unread', () => {
    const header = render(React.createElement(ShellHeader, { user, unreadNotifications: 100 }));
    const sidebar = render(React.createElement(Sidebar, { user, unreadNotifications: 100 }));
    const menu = render(React.createElement(MobileMenuBody, { user, unreadNotifications: 100 }));

    for (const html of [header, sidebar, menu]) {
      expect(html).toContain('99+');
      expect(html).toContain('100 unread');
    }
    expect(header).toContain('aria-label="Notifications, 100 unread"');
  });

  it('shows an exact count of 1', () => {
    for (const html of [
      render(React.createElement(ShellHeader, { user, unreadNotifications: 1 })),
      render(React.createElement(Sidebar, { user, unreadNotifications: 1 })),
      render(React.createElement(MobileMenuBody, { user, unreadNotifications: 1 })),
    ]) {
      expect(html).toContain('1 unread');
    }
  });

  it('renders no badge at zero, and keeps the destination reachable', () => {
    const header = render(React.createElement(ShellHeader, { user, unreadNotifications: 0 }));
    const sidebar = render(React.createElement(Sidebar, { user, unreadNotifications: 0 }));
    const menu = render(React.createElement(MobileMenuBody, { user, unreadNotifications: 0 }));

    expect(header).toContain('aria-label="Notifications"');
    expect(header).not.toContain('notification-badge');
    expect(sidebar).not.toContain('nav-count');
    expect(menu).toContain('href="/notifications"');
    // The mobile entry point is the header bell: two of them (mobile + desktop
    // header rows) plus the menu row, and the dock deliberately has none.
    expect(header.match(/href="\/notifications"/g)).toHaveLength(2);
    expect(sidebar).toContain('href="/notifications"');
  });
});

describe('structural guarantees', () => {
  it('measures the unread count in exactly one place', async () => {
    const fs = await import('node:fs/promises');
    const { execFileSync } = await import('node:child_process');
    const hits = execFileSync('grep', ['-rl', "from('notifications')", 'app', 'components', 'lib'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
    // The layout owns the count; lib/notifications/index.js writes rows.
    expect(hits).toContain('app/(app)/layout.js');
    const layout = await fs.readFile('app/(app)/layout.js', 'utf8');
    expect(layout.match(/\.from\('notifications'\)/g)).toHaveLength(1);
    expect(layout).toContain("select('id', { count: 'exact', head: true })");
    expect(layout).toContain(".is('read_at', null)");
  });

  it('does not query or badge the bottom dock', async () => {
    const fs = await import('node:fs/promises');
    const dock = await fs.readFile('components/layout/BottomNav.js', 'utf8');
    expect(dock).not.toContain('unreadNotifications');
    expect(dock).not.toContain("icon === 'bell'");
    expect(dock).not.toContain('notification-badge');
    // Five destinations, unchanged.
    const constants = await fs.readFile('lib/constants.js', 'utf8');
    const block = constants.slice(constants.indexOf('export const MOBILE_NAV'));
    expect(block.slice(0, block.indexOf('];'))).toMatch(/label:/g);
    expect((block.slice(0, block.indexOf('];')).match(/label:/g) || [])).toHaveLength(5);
  });

  it('routes every badge through the shared formatter', async () => {
    const fs = await import('node:fs/promises');
    for (const file of ['components/layout/ShellHeader.js', 'components/layout/Sidebar.js', 'components/layout/MobileMenu.js']) {
      const source = await fs.readFile(file, 'utf8');
      expect(source, file).toContain("from '@/lib/notifications/format'");
      expect(source, file).not.toMatch(/> 99 \? '99\+'/);
    }
  });
});
