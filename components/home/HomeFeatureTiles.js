import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { getTimetableHref } from '@/lib/timetable/meta';
import { Icon } from '@/components/ui/icons';

/** Compact navigation to real campus destinations, with no invented activity. */
export function HomeFeatureTiles({ division }) {
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
      copy: 'Your classes and daily schedule.',
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
  ];

  return (
    <section className="home-features" aria-labelledby="home-features-title">
      <h2 id="home-features-title" className="home-features__title">Your campus, at a glance</h2>
      <div className="home-features__grid">
        {tiles.map((tile) => (
          <Link key={tile.name} href={tile.href} className={`feature-tile feature-tile--${tile.tone}`}>
            <span className="feature-tile__top" aria-hidden="true">
              <span className="feature-tile__icon"><Icon name={tile.icon} size={19} /></span>
              <Icon name="arrowUpRight" size={15} className="feature-tile__arrow" />
            </span>
            <span className="feature-tile__title">{tile.name}</span>
            <span className="feature-tile__copy">{tile.copy}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
