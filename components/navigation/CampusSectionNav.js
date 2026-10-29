'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { getTimetableHref } from '@/lib/timetable/meta';
import { resolveActiveHref } from '@/lib/navigation/active';

/**
 * The campus feed's section navigation: the four places a student actually
 * goes from the top of Home.
 *
 * It is a plain list of real destinations — no counts, no badges, no second
 * navigation tree. Every href is a canonical `ROUTES` entry (or the public
 * timetable selector for a student with no saved division), so the row can
 * never drift from the page it points at.
 *
 * Timetable is the one destination that is personalised: a saved division opens
 * that division's week directly, exactly as the rail's own Timetable row does.
 * Without one, it opens the public selector — the same honest fallback, never a
 * guessed division.
 *
 * Icons are the product's own inline glyph set (`components/ui/icons`), so no
 * icon dependency is introduced. Each icon is decorative: the label already
 * names the destination, so `aria-hidden` keeps a screen reader from hearing
 * "users Clubs".
 */

/** The four destinations, in the order the header presents them. */
export function campusSectionLinks(division = null) {
  return [
    { href: ROUTES.clubs, label: 'Clubs', icon: 'users' },
    { href: getTimetableHref(division), label: 'Timetable', icon: 'clock' },
    { href: '/campus/events', label: 'Events', icon: 'calendar' },
    { href: '/campus/noticeboard', label: 'Noticeboard', icon: 'megaphone' },
  ];
}

export function CampusSectionNav({ division = null, className = '' }) {
  const pathname = usePathname();
  const links = campusSectionLinks(division);
  // `resolveActiveHref` picks the single most specific destination, so a nested
  // route (`/campus/events/42`) lights its section and nothing else. On the feed
  // itself none of the four is the current page, so nothing is lit.
  const current = resolveActiveHref(pathname, links.map((link) => link.href));

  return (
    <nav className={`campus-nav ${className}`.trim()} aria-label="Campus sections">
      <ul className="campus-nav__list">
        {links.map((link) => {
          const active = link.href === current;
          return (
            <li key={link.href} className="campus-nav__item">
              <Link
                href={link.href}
                className="campus-nav__link"
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={link.icon} size={15} className="campus-nav__icon" />
                <span className="campus-nav__label">{link.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
