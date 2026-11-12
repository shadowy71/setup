'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/icons';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { openCommandPalette } from '@/components/search/CommandPalette';

/**
 * The Campus Map page's horizontal navigation bar.
 *
 * It reuses the existing navigation system — every destination is a real
 * route, the search pill opens the existing quick-actions palette and the
 * theme toggle is the shared one — composed in the order the campus map
 * dashboard specifies: Home, Timetable, Map, Noticeboard, Event, Clubs,
 * Profile, with Map lit in orange while the reader is on this page.
 */
const MAP_NAV = [
  { href: '/home', label: 'Home', icon: 'home' },
  { href: '/timetable', label: 'Timetable', icon: 'calendar' },
  { href: '/map', label: 'Map', icon: 'mapPin' },
  { href: '/campus/noticeboard', label: 'Noticeboard', icon: 'megaphone' },
  { href: '/campus/events', label: 'Event', icon: 'star' },
  { href: '/clubs', label: 'Clubs', icon: 'users' },
  { href: '/profile', label: 'Profile', icon: 'user' },
];

export function MapTopNav() {
  const pathname = usePathname();
  const isActive = (href) => (href === '/map' ? pathname === '/map' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <nav className="cmnav" aria-label="Primary">
      <Link href="/home" className="cmnav__brand" aria-label="PCCOE home">
        <svg viewBox="0 0 32 32" className="cmnav__mark" aria-hidden="true">
          <defs>
            <linearGradient id="cmnav-mark" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" className="cm-stop-mark-a" />
              <stop offset="1" className="cm-stop-mark-b" />
            </linearGradient>
          </defs>
          <path d="M16 3 29 27H3Z" fill="url(#cmnav-mark)" />
          <path d="M16 11 22.5 24h-13Z" className="cm-mark-cut" />
        </svg>
        <span>PCCOE</span>
      </Link>

      <ul className="cmnav__links">
        {MAP_NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} className="cmnav__link" data-active={active ? 'true' : undefined} aria-current={active ? 'page' : undefined}>
                <Icon name={item.icon} size={16} className={item.icon === 'mapPin' ? 'cmnav__pin' : undefined} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="cmnav__tools">
        <button type="button" className="cmnav__search" onClick={() => openCommandPalette()} aria-label="Search (Command K)">
          <Icon name="search" size={15} />
          <span>Search...</span>
        </button>
        <span className="cmnav__theme">
          <ThemeToggle />
        </span>
      </div>
    </nav>
  );
}
