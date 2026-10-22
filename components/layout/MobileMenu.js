'use client';

/**
 * The mobile "everything else" sheet.
 *
 * The bottom bar carries Home, Explore, Market, Chat and Profile, so this holds
 * the rest: communities, campus, notifications, settings and creation shortcuts,
 * plus the staff panels when they apply.
 *
 * It is a real dialog (portalled, focus-managed, Escape and backdrop close) that
 * becomes a bottom sheet on phones.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { IdentityMark, Sheet, StaffDot } from '@/components/ui';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { openCommandPalette } from '@/components/search/CommandPalette';
import { getTimetableHref } from '@/lib/timetable/meta';

function SheetLink({ href, icon, label, count = 0, onNavigate }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-[0.875rem] font-medium text-ink transition-colors hover:bg-surface-2 hover:no-underline"
    >
      <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface text-muted">
        <Icon name={icon} size={16} />
      </span>
      <span className="flex-1">{label}</span>
      {count > 0 ? <span className="nav-count">{count > 99 ? '99+' : count}</span> : null}
    </Link>
  );
}

export function MobileMenu({ user = null, isStaff = false, canModerate = false, canAdmin = false, createItems = [] }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="icon-btn lg:hidden">
        <Icon name="dots" size={20} />
      </button>

      <Sheet open={open} onClose={close} title="Menu" size="sm">
        <div className="mt-3 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              close();
              openCommandPalette();
            }}
            className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-[0.875rem] font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface text-muted">
              <Icon name="grid" size={16} />
            </span>
            <span className="flex-1">Quick actions</span>
            <span className="text-2xs text-muted-soft">⌘K</span>
          </button>
          <SheetLink href={ROUTES.gigs} icon="briefcase" label="Gigs" onNavigate={close} />
          <SheetLink href={ROUTES.clubs} icon="star" label="Clubs" onNavigate={close} />
          <SheetLink href={ROUTES.communities} icon="users" label="Communities" onNavigate={close} />
          <SheetLink href={ROUTES.campus} icon="building" label="Campus" onNavigate={close} />
          <SheetLink href={getTimetableHref(user?.division)} icon="calendar" label="Timetable" onNavigate={close} />
          <SheetLink href={ROUTES.study} icon="book" label="Study finder" onNavigate={close} />
          <SheetLink href={ROUTES.notifications} icon="bell" label="Notifications" onNavigate={close} />
          <SheetLink href={ROUTES.settings} icon="settings" label="Settings" onNavigate={close} />
          {canModerate ? <SheetLink href={ROUTES.moderator} icon="shield" label="Moderation" onNavigate={close} /> : null}
          {canAdmin ? <SheetLink href={ROUTES.admin} icon="eye" label="Admin" onNavigate={close} /> : null}
        </div>

        {createItems.length ? (
          <div className="mt-4">
            <p className="t-label mb-2">Create</p>
            <div className="flex flex-col gap-1">
              {createItems.map((item) => (
                <SheetLink key={item.href} href={item.href} icon={item.icon} label={item.label} onNavigate={close} />
              ))}
            </div>
          </div>
        ) : null}

        {user ? (
          <div className="mt-4 border-t border-line pt-3">
            <Link href={ROUTES.profile} onClick={close} className="flex items-center gap-2.5 hover:no-underline">
              <IdentityMark name={user.displayName || user.username} size={32} tone="accent" square={false} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 truncate text-[0.8125rem] font-semibold">
                  {user.displayName || `@${user.username}`}
                  {isStaff ? <StaffDot label={user.staffLabel || 'Staff member'} /> : null}
                </span>
                <span className="block truncate text-2xs text-muted">@{user.username}</span>
              </span>
            </Link>
            <div className="mt-3">
              <SignOutButton variant="secondary" />
            </div>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
