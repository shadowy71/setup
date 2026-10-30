import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('Home intro prefetch boundary', () => {
  it('does not pull Home-only intro CSS/fonts into other cold routes', () => {
    expect(read('components/layout/BottomNav.js')).toContain("prefetch={item.href === ROUTES.home ? false : undefined}");
    expect(read('components/layout/Sidebar.js')).toContain("prefetch={item.href === ROUTES.home ? false : undefined}");
    expect(read('components/brand/Brand.js')).toContain("prefetch={href === ROUTES.home || href === '/' ? false : undefined}");
  });

  it('keeps every destination and all non-Home prefetch behavior intact', () => {
    const dock = read('components/layout/BottomNav.js');
    const rail = read('components/layout/Sidebar.js');
    expect(dock).toContain('MOBILE_NAV.map');
    // The rail maps the shared ordered list; that list is built from
    // PRIMARY_NAV, so every destination is still rendered exactly once.
    expect(rail).toContain('primary.map');
    expect(read('lib/navigation/primary.js')).toContain('PRIMARY_NAV.map');
    // The conditional is scoped to Home; it is not a global prefetch={false}.
    expect(dock).not.toContain('<Link\n                key={item.href}\n                href={item.href}\n                prefetch={false}');
    expect(rail).toContain('ROUTES.chat');
    expect(rail).toContain('ROUTES.notifications');
  });
});
