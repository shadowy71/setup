'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MOBILE_NAV } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { GlassSurface } from '@/components/ui';

/**
 * Mobile navigation: Home · Explore · Market · Chat · Profile.
 *
 * The same routes render on both form factors — this is one responsive
 * codebase, not a separate mobile app. The bar is a floating glass pill
 * suspended above the environment: the page scrolls visibly *under* it, the
 * safe area is respected, and the thumb always lands on the same five targets.
 *
 * Each tab is a large touch target (44px minimum). The active tab is marked
 * three ways — a lit icon, a soft teal wash, and a short blade of light along
 * the top edge — so the current section survives colour-vision differences and
 * greyscale. The marker is a shape, not only a hue.
 */
export function BottomNav({ unreadNotifications = 0 }) {
  const pathname = usePathname();

  return (
    <div className="bottom-dock fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      <GlassSurface
        as="nav"
        tone="floating"
        aria-label="Primary"
        className="bottom-dock__bar mx-auto flex max-w-md rounded-[1.6rem] border border-glass-border"
      >
        {/* The gutter is the focus ring's room: 2px offset + 2px ring, plus
            breathing space, so the dock's rounded clip never eats it. */}
        <div className="flex w-full items-stretch px-1.5 py-1.5">
          {MOBILE_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="tab-item rounded-2xl"
              >
                <span className="relative">
                  <Icon name={item.icon} size={20} className="tab-icon" />
                  {item.icon === 'bell' && unreadNotifications > 0 ? <span className="unread-dot absolute -right-1.5 -top-1" /> : null}
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </GlassSurface>
    </div>
  );
}
