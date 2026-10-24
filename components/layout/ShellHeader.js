'use client';

/**
 * The application header.
 *
 * Desktop: search on the left, then notifications and the account control.
 * Mobile: the brand, search, notifications and account, with the
 * "everything else" sheet behind the menu button.
 *
 * It is a floating sheet of glass — not a full-bleed bar. The wrapper is
 * transparent and sticky, and the glass inside is inset with its own rounded
 * corners, so content scrolling underneath passes *behind* a visibly separate
 * plane and the teal light of the environment shows at the edges. See
 * `.shell-header` in app/styles/navigation.css.
 */

import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { BrandLockup } from '@/components/brand/Brand';
import { Icon } from '@/components/ui/icons';
import { GlassSurface } from '@/components/ui';
import { AccountMenu } from '@/components/layout/AccountMenu';
import { MobileMenu } from '@/components/layout/MobileMenu';
import { ShellSearch } from '@/components/layout/ShellSearch';
import { CommandPaletteTrigger } from '@/components/search/CommandPalette';
import { formatUnread } from '@/lib/notifications/format';

/**
 * The bell is the mobile entry point to notifications (the dock keeps its five
 * destinations) and the desktop one. Badge rules live in `formatUnread` so the
 * header, the sidebar and the mobile menu cannot drift apart.
 */
function NotificationBell({ unreadNotifications = 0 }) {
  const unread = formatUnread(unreadNotifications);
  return (
    <Link href={ROUTES.notifications} aria-label={unread.label} className="icon-btn icon-btn--glass relative">
      {/* The badge anchors to the glyph, not to the 44px hit area — otherwise it
          paints over the bell on narrow headers. */}
      <span className="relative flex">
        <Icon name="bell" size={19} />
        {unread.visible ? <span className="notification-badge">{unread.text}</span> : null}
      </span>
    </Link>
  );
}

export function ShellHeader({ user = null, unreadNotifications = 0, isStaff = false, canModerate = false, canAdmin = false, createItems = [] }) {
  return (
    /* Level-2 floating glass — the header is chrome, not a page surface. */
    <div className="shell-header sticky top-0 z-30 px-3 pt-3 lg:px-4 lg:pt-4">
      <GlassSurface as="header" tone="floating" className="shell-header__bar mx-auto w-full">
        {/* Mobile */}
        <div className="flex h-14 items-center gap-1.5 px-2 lg:hidden">
          <MobileMenu
            user={user}
            unreadNotifications={unreadNotifications}
            isStaff={isStaff}
            canModerate={canModerate}
            canAdmin={canAdmin}
            createItems={createItems}
          />
          <BrandLockup size="sm" subtitle={null} wordClass="text-[0.9375rem]" />
          <div className="ml-auto flex items-center gap-0.5">
            <Link href={ROUTES.explore} aria-label="Search Campus+" className="icon-btn icon-btn--glass">
              <Icon name="search" size={19} />
            </Link>
            <NotificationBell unreadNotifications={unreadNotifications} />
            <AccountMenu user={user} isStaff={isStaff} />
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden h-16 items-center gap-3 px-4 lg:flex">
          <ShellSearch />
          <CommandPaletteTrigger />
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell unreadNotifications={unreadNotifications} />
            <span className="shell-header__divider" aria-hidden="true" />
            <AccountMenu user={user} isStaff={isStaff} />
          </div>
        </div>
      </GlassSurface>
    </div>
  );
}
