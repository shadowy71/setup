import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { HomeZone } from '@/components/home/HomePulse';

/**
 * The two doors — Clubs and Gigs as first-class destinations on Home.
 *
 * These are navigation tiles, not content: they carry no counts, no member
 * numbers, no earnings and no invented activity, because the honest claim is
 * simply that these places exist and are worth a tap. Each whole card is one
 * link to the real destination (`ROUTES.clubs`, `ROUTES.gigs` — the same
 * values the sidebar and the discovery deck use).
 *
 * Material: tier-3 featured glass (`.glass-featured`, surfaces.css) — the
 * same sheet the composer is made of — with the tile's own light layered in
 * home.css: Clubs is lit teal from its leading corner, Gigs carries the
 * restrained sand counter-glow. The material refinements (hover lift on
 * pointer devices, pressed response, focus ring, responsive stacking and
 * the reduced-motion path) all live in `.feature-tile` in home.css; this
 * component is composition only.
 */

const TILES = [
  {
    href: ROUTES.clubs,
    name: 'Clubs',
    title: 'Find your people.',
    copy: 'Discover technical, cultural, sports, arts, entrepreneurship and social clubs around campus.',
    cta: 'Explore clubs',
    icon: 'star',
    tone: 'clubs',
  },
  {
    href: ROUTES.gigs,
    name: 'Gigs',
    title: 'Put your skills to work.',
    copy: 'Explore paid and unpaid student gigs, find opportunities and discover work offered by other students.',
    cta: 'Explore gigs',
    icon: 'briefcase',
    tone: 'gigs',
  },
];

export function HomeFeatureTiles() {
  return (
    <section className="home-features" aria-labelledby="home-features-title">
      <HomeZone
        id="home-features-title"
        eyebrow="Discover"
        title="Two ways into campus life"
        note="The clubs you could join and the work you could pick up — one tap away."
      />
      <div className="home-features__grid">
        {TILES.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className={`feature-tile feature-tile--${tile.tone} glass-featured hover:no-underline`}
            aria-label={`${tile.name} — ${tile.title}`}
          >
            <span className="feature-tile__glow" aria-hidden="true" />
            <span className="feature-tile__icon" aria-hidden="true">
              <Icon name={tile.icon} size={22} />
            </span>
            <span className="feature-tile__body">
              <span className="feature-tile__eyebrow">{tile.name}</span>
              <span className="feature-tile__title">{tile.title}</span>
              <span className="feature-tile__copy">{tile.copy}</span>
              <span className="feature-tile__cta">
                {tile.cta}
                <Icon name="arrowUpRight" size={14} className="feature-tile__arrow" aria-hidden="true" />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
