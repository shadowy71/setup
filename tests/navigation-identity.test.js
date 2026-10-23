import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { toShellUser, staffLabelFor, isStaffRoles, handleOf } from '@/lib/identity/shell-user';
import { getTimetableHref } from '@/lib/timetable/meta';
import { ROUTES } from '@/lib/constants';

/**
 * The shell identity contract.
 *
 * Every surface in the chrome — sidebar, mobile menu, account menu, header —
 * reads the same five fields produced by `toShellUser()`. These tests pin that
 * contract and render the real components against it, so a future change to one
 * surface cannot quietly reintroduce `@undefined`, an empty name, or a second
 * normalization rule.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

const sessionUser = (profile, roles = ['student']) => ({
  id: 'auth-user-1',
  email: 'asha@pccoepune.org',
  permissions: ['manage_everything'],
  roles,
  profile,
});

describe('toShellUser', () => {
  it('keeps a complete student identity', () => {
    const shell = toShellUser(sessionUser({ username: 'asha_e2e', display_name: 'Asha Patil', division: null }));
    expect(shell).toEqual({
      username: 'asha_e2e',
      displayName: 'Asha Patil',
      division: null,
      roles: ['student'],
      staffLabel: null,
    });
  });

  it('falls back to the username when the display name is missing, blank or whitespace', () => {
    for (const display_name of [undefined, null, '', '   ']) {
      const shell = toShellUser(sessionUser({ username: 'asha_e2e', display_name }));
      expect(shell.displayName).toBe('asha_e2e');
      expect(shell.displayName).not.toContain('undefined');
    }
  });

  it('never renders an empty handle', () => {
    expect(handleOf(toShellUser(sessionUser({ username: 'asha_e2e', display_name: 'Asha' })))).toBe('@asha_e2e');
    expect(handleOf(toShellUser(sessionUser({ username: null, display_name: 'Asha' })))).toBe('');
    expect(handleOf(null)).toBe('');
  });

  it('keeps a missing division as null and sends the timetable shortcut to the selector', () => {
    const shell = toShellUser(sessionUser({ username: 'asha_e2e', display_name: 'Asha' }));
    expect(shell.division).toBeNull();
    expect(getTimetableHref(shell.division)).toBe(ROUTES.timetable);

    const withDivision = toShellUser(sessionUser({ username: 'asha_e2e', display_name: 'Asha', division: 'A' }));
    expect(withDivision.division).toBe('A');
    expect(getTimetableHref(withDivision.division)).not.toBe(ROUTES.timetable);
  });

  it('labels staff by their strongest role', () => {
    expect(toShellUser(sessionUser({ username: 'mod', display_name: 'Mod' }, ['student', 'moderator'])).staffLabel).toBe('Moderator');
    expect(toShellUser(sessionUser({ username: 'adm', display_name: 'Adm' }, ['admin'])).staffLabel).toBe('Administrator');
    expect(toShellUser(sessionUser({ username: 'sup', display_name: 'Sup' }, ['super_admin', 'admin'])).staffLabel).toBe('Administrator');
    expect(toShellUser(sessionUser({ username: 'stu', display_name: 'Stu' }, ['student'])).staffLabel).toBeNull();
    expect(staffLabelFor(undefined)).toBeNull();
    expect(isStaffRoles(['moderator'])).toBe(true);
    expect(isStaffRoles(['student'])).toBe(false);
  });

  it('returns null without a profile', () => {
    expect(toShellUser(null)).toBeNull();
    expect(toShellUser(undefined)).toBeNull();
    expect(toShellUser({ id: 'auth-only', roles: [] })).toBeNull();
    expect(toShellUser({ profile: null, roles: ['student'] })).toBeNull();
  });

  it('forwards five fields and nothing private', () => {
    const shell = toShellUser(sessionUser({ username: 'asha_e2e', display_name: 'Asha', division: 'B' }, ['student']));
    expect(Object.keys(shell).sort()).toEqual(['displayName', 'division', 'roles', 'staffLabel', 'username']);
    const serialized = JSON.stringify(shell);
    expect(serialized).not.toContain('pccoepune.org');
    expect(serialized).not.toContain('auth-user-1');
    expect(serialized).not.toContain('manage_everything');
  });

  it('tolerates a non-array roles field', () => {
    const shell = toShellUser({ profile: { username: 'x_y_z', display_name: 'X' }, roles: 'admin' });
    expect(shell.roles).toEqual([]);
    expect(shell.staffLabel).toBeNull();
  });
});

describe('shell surfaces render the adapter identity', () => {
  let Sidebar;
  let AccountMenu;
  let MobileMenuBody;

  beforeAll(async () => {
    ({ Sidebar } = await import('@/components/layout/Sidebar'));
    ({ AccountMenu } = await import('@/components/layout/AccountMenu'));
    ({ MobileMenuBody } = await import('@/components/layout/MobileMenu'));
  });

  const render = (element) => renderToStaticMarkup(element);

  it('renders the display name and handle in the sidebar', () => {
    const user = toShellUser(sessionUser({ username: 'asha_e2e', display_name: 'Asha Patil', division: 'A' }));
    const html = render(React.createElement(Sidebar, { user }));
    expect(html).toContain('Asha Patil');
    expect(html).toContain('@asha_e2e');
    expect(html).not.toContain('undefined');
  });

  it('renders the fallback handle as the name when the display name is missing', () => {
    const user = toShellUser(sessionUser({ username: 'asha_e2e', display_name: null }));
    for (const html of [
      render(React.createElement(Sidebar, { user })),
      render(React.createElement(AccountMenu, { user })),
      render(React.createElement(MobileMenuBody, { user })),
    ]) {
      expect(html).toContain('asha_e2e');
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('@undefined');
    }
  });

  it('marks staff in every surface that is visible while closed', () => {
    const user = toShellUser(sessionUser({ username: 'mod_one', display_name: 'Mod One' }, ['moderator']));
    // The account dropdown only renders its panel once opened, so its staff dot
    // is asserted through the two always-visible surfaces; the adapter's label
    // (asserted above) is the single source all three read.
    for (const html of [
      render(React.createElement(Sidebar, { user, isStaff: true })),
      render(React.createElement(MobileMenuBody, { user, isStaff: true })),
    ]) {
      expect(html).toContain('Moderator');
    }
    expect(render(React.createElement(AccountMenu, { user, isStaff: true }))).toContain('Mod One');
  });

  it('does not render the account block for a null identity', () => {
    const html = render(React.createElement(Sidebar, { user: null }));
    expect(html).toContain('Sign in');
    expect(html).not.toContain('@undefined');
  });
});

describe('layout forwards the adapter, not the session', () => {
  it('derives the shell identity once and passes no email or permissions', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile('app/(app)/layout.js', 'utf8'));
    expect(source).toContain("import { toShellUser } from '@/lib/identity/shell-user'");
    expect(source).toMatch(/const shellUser = toShellUser\(user\);/);
    expect(source).toContain('user={shellUser}');
    expect(source).not.toContain('display_name: user.profile');
    expect(source).not.toMatch(/user=\{\{[^}]*permissions/);
    expect(source).not.toMatch(/user=\{\{[^}]*email/);
  });

  it('keeps one identity adapter in the codebase', async () => {
    const fs = await import('node:fs/promises');
    const files = ['app/(app)/layout.js', 'components/layout/Sidebar.js', 'components/layout/MobileMenu.js', 'components/layout/AccountMenu.js', 'components/layout/ShellHeader.js', 'components/layout/AppShell.js'];
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      // No surface normalizes `display_name` or invents its own name fallback.
      expect(source, file).not.toContain('display_name');
      expect(source, file).not.toMatch(/displayName \|\| `@\$\{/);
    }
  });
});
