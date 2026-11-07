import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => createElement('a', { href, ...props }, children) }));
vi.mock('@/components/brand/Brand', () => ({ BrandLockup: () => null }));
vi.mock('@/components/ui/icons', () => ({ Icon: () => null }));
vi.mock('@/components/ui', () => ({ GlassSurface: ({ as, children, ...props }) => createElement(as, props, children) }));
vi.mock('@/components/layout/AccountMenu', () => ({ AccountMenu: () => null }));
vi.mock('@/components/layout/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/layout/MobileMenu', () => ({ MobileMenu: () => null }));
vi.mock('@/components/layout/ShellSearch', () => ({ ShellSearch: () => createElement('form', { role: 'search' }) }));
vi.mock('@/components/search/CommandPalette', () => ({ CommandPaletteTrigger: () => null }));

const { ShellHeader } = await import('@/components/layout/ShellHeader');

describe('mobile header search', () => {
  it('starts closed and uses a button instead of navigating straight to Explore', () => {
    const html = renderToStaticMarkup(createElement(ShellHeader));
    expect(html).toMatch(/<button[^>]*aria-label="Search Campus\+"[^>]*aria-expanded="false"/);
    expect(html).not.toMatch(/<a[^>]*aria-label="Search Campus\+"/);
    expect(html).not.toContain('Close search');
  });
});
