'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { BrandLockup, CollegeCrest } from '@/components/brand/Brand';
import { CreateMenu } from '@/components/layout/CreateMenu';
import { getTimetableHref } from '@/lib/timetable/meta';
import { formatUnread } from '@/lib/notifications/format';
import { resolveActiveHref } from '@/lib/navigation/active';
import { primaryNavigation } from '@/lib/navigation/primary';
import { MessageUnreadBadge } from '@/components/layout/MessageUnreadBadge';

/**
 * Desktop navigation: a suspended sheet of frosted glass carrying the Campus+
 * identity at the top, one clear primary group, the secondary destinations
 * (messages, notifications and staff panels). Account access lives in the header.
 *
 * The panel floats (it is inset from the viewport edges, with its own rounded
 * corners and shadow) so the ambient teal and sunset light reads *behind* it:
 * the chrome is a layer in the room, not a wall. The material comes from
 * `.glass-floating`; the light inside it from `.side-panel__glow`.
 *
 * It is a client component only because it highlights the active route; it
 * renders no data of its own.
 */
export function Sidebar({ user = null, unreadNotifications = 0, canModerate = false, canAdmin = false, createItems = [], onNavigate, mobile = false, onClose }) {
  const pathname = usePathname();

  const unread = formatUnread(unreadNotifications);
  const secondary = [
    { href: ROUTES.chat, label: 'Messages', icon: 'chat' },
    { href: ROUTES.notifications, label: 'Notifications', icon: 'bell', unread },
  ];
  const timetableHref = getTimetableHref(user?.division);
  // One ordered list of campus destinations. The order
  // lives in `primaryNavigation()` so it is asserted once and reused.
  const primary = primaryNavigation(timetableHref);

  // One pass over every destination decides which single row is current. A
  // nested route (`/gigs/abc`, `/clubs/abc`) lights its own section and nothing
  // else; if two rows ever matched, the more specific one wins.
  const current = resolveActiveHref(pathname, [
    ...primary.map((item) => item.href),
    ...secondary.map((item) => item.href),
    ...(canModerate ? [ROUTES.moderator] : []),
    ...(canAdmin ? [ROUTES.admin] : []),
  ]);
  const active = (href) => current === href;

  return (
    <aside id="app-sidebar" aria-label="Campus navigation" role={mobile ? "dialog" : undefined} aria-modal={mobile ? "true" : undefined} tabIndex={-1} className="side-panel glass-floating fixed inset-y-3 left-3 z-50 flex w-[15.5rem] flex-col overflow-y-auto" onClick={(event) => {
      if (event.target.closest('a[href]')) onNavigate?.();
    }}>
      <span className="side-panel__glow" aria-hidden="true" />
      {mobile ? <button type="button" className="sidebar-close" aria-label="Close sidebar" onClick={onClose}><Icon name="close" size={18} /></button> : null}
      <BrandLockup className="px-2" />

      <div className="mt-4">
        <CreateMenu items={createItems} />
      </div>

      <nav aria-label="Primary" className="nav-panel mt-4 flex flex-col gap-0.5">
        <p className="nav-group-label mb-1.5">Campus</p>
        {primary.map((item) => (
          <div key={item.href} className="nav-destination">
            <Link href={item.href} prefetch={item.href === ROUTES.home ? false : undefined} aria-current={active(item.href) ? 'page' : undefined} className="nav-item">
              <Icon name={item.icon} size={18} className="nav-icon" />
              {item.label}
            </Link>
          </div>
        ))}
      </nav>

      <div className="side-panel__rule my-3" aria-hidden="true" />

      <nav aria-label="Secondary" className="nav-panel flex flex-col gap-0.5">
        <p className="nav-group-label mb-1.5">Direct</p>
        {secondary.map((item) => (
          <div key={item.href} className="nav-destination">
            <Link href={item.href} aria-current={active(item.href) ? 'page' : undefined} className="nav-item">
              <Icon name={item.icon} size={18} className="nav-icon" />
              <span className="flex-1">{item.label}</span>
              {item.href === ROUTES.chat ? <MessageUnreadBadge /> : null}
              {item.unread?.visible ? (
                <span className="nav-count" aria-label={item.unread.aria}>
                  {item.unread.text}
                </span>
              ) : null}
            </Link>
          </div>
        ))}

        {canModerate || canAdmin ? <p className="nav-group-label mb-1.5 mt-3">Staff</p> : null}

        {canModerate ? (
          <div className="nav-destination">
            <Link href={ROUTES.moderator} aria-current={active(ROUTES.moderator) ? 'page' : undefined} className="nav-item">
              <Icon name="shield" size={18} className="nav-icon" />
              Moderation
            </Link>
          </div>
        ) : null}

        {canAdmin ? (
          <div className="nav-destination">
            <Link href={ROUTES.admin} aria-current={active(ROUTES.admin) ? 'page' : undefined} className="nav-item">
              <Icon name="eye" size={18} className="nav-icon" />
              Admin
            </Link>
          </div>
        ) : null}
      </nav>

      <div className="mt-auto pt-4">
        {!user ? (
          <Link href="/login" className="nav-item">
            Sign in
          </Link>
        ) : null}
        <div className="flex items-start gap-3 px-2 pt-3">
          <CollegeCrest size={44} />
          <p className="text-2xs leading-relaxed text-muted-soft">
            Unofficial student project. Not affiliated with PCCOE.
          </p>
        </div>
      </div>
    </aside>
  );
}
