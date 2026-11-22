import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { getTimetableHref } from '@/lib/timetable/meta';
import { Icon } from '@/components/ui/icons';

/**
 * Compact navigation to real campus destinations, with no invented activity.
 *
 * `institutional` is false for an external account. The noticeboard is a
 * campus-internal surface (migration 080), so it is not offered to someone who
 * could only ever see the explanation on the page itself.
 */
export function HomeFeatureTiles({ division, institutional = true }) {
  const tiles = [
    {
      href: '/campus/noticeboard',
      name: 'Noticeboard',
      copy: 'Updates, announcements & important notices.',
      icon: 'megaphone',
      tone: 'noticeboard',
    },
    {
      href: '/campus/events',
      name: 'Events',
      copy: "Discover what's happening around campus.",
      icon: 'calendar',
      tone: 'events',
    },
    {
      href: getTimetableHref(division),
      name: 'Timetable',
      copy: institutional ? 'Your classes and daily schedule.' : 'Class timetables by division.',
      icon: 'clock',
      tone: 'timetable',
    },
    {
      href: ROUTES.clubs,
      name: 'Clubs',
      copy: 'Find your people and explore campus communities.',
      icon: 'users',
      tone: 'clubs',
    },
    {
      href: ROUTES.market,
      name: 'Market',
      copy: 'Buy and sell on campus.',
      icon: 'tag',
      tone: 'market',
    },
    {
      href: ROUTES.gigs,
      name: 'Gigs',
      copy: 'Find campus opportunities.',
      icon: 'briefcase',
      tone: 'gigs',
    },
  ];

  const visible = institutional
    ? tiles
    : tiles.filter((tile) => tile.href !== '/campus/noticeboard');

  return (
    <section className="home-features relative z-10" aria-labelledby="home-features-title">
      <h2 id="home-features-title" className="home-features__title">Quick navigation</h2>
      <div className="home-features__grid">
        {visible.map((tile) => {
          const NavigationLink = tile.tone === 'timetable' ? 'a' : Link;
          return (
            <NavigationLink
              key={tile.name}
              href={tile.href}
              aria-label={tile.name}
              title={tile.name}
              className={`feature-tile feature-tile--${tile.tone} transition-all duration-200`}
            >
              <span className="feature-tile__top" aria-hidden="true">
                <span className="feature-tile__icon">
                  <Icon name={tile.icon} size={19} className="transition-all duration-200" />
                </span>
                <Icon name="arrowUpRight" size={15} className="feature-tile__arrow" />
              </span>
              <span className="feature-tile__title">{tile.name}</span>
              <span className="feature-tile__copy">{tile.copy}</span>
            </NavigationLink>
          );
        })}
      </div>
    </section>
  );
}
