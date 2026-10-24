import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

let MessagingProvider;
let Sidebar;
let BottomNav;

beforeAll(async () => {
  ({ MessagingProvider } = await import('@/components/layout/MessagingProvider'));
  ({ Sidebar } = await import('@/components/layout/Sidebar'));
  ({ BottomNav } = await import('@/components/layout/BottomNav'));
});

function render(Component, unread) {
  return renderToStaticMarkup(
    React.createElement(
      MessagingProvider,
      { userId: 'me', initialUnread: unread },
      React.createElement(Component),
    ),
  );
}

const counts = (first, second = 0) => [
  { conversation_id: 'c1', unread_count: first, last_read_at: null },
  { conversation_id: 'c2', unread_count: second, last_read_at: null },
];

describe('message unread badge on desktop and mobile navigation', () => {
  it('shows the total across conversations on both layouts', () => {
    const desktop = render(Sidebar, counts(2, 3));
    const mobile = render(BottomNav, counts(2, 3));
    for (const html of [desktop, mobile]) {
      expect(html).toContain('5 unread');
      expect(html).toContain('>5</span>');
    }
    expect(desktop).toContain('href="/chat"');
    expect(mobile).toContain('href="/chat"');
  });

  it('uses 99+ only for presentation while preserving the exact accessible count', () => {
    for (const html of [render(Sidebar, counts(60, 40)), render(BottomNav, counts(60, 40))]) {
      expect(html).toContain('99+');
      expect(html).toContain('100 unread');
    }
  });

  it('hides the badge at zero without removing the Chat destination', () => {
    const desktop = render(Sidebar, counts(0));
    const mobile = render(BottomNav, counts(0));
    expect(desktop).not.toContain('nav-count');
    expect(mobile).not.toContain('notification-badge');
    expect(desktop).toContain('Messages');
    expect(mobile).toContain('Chat');
  });
});
