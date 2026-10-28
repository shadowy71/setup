import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';

/**
 * The two doors — Clubs and Gigs as first-class destinations on Home.
 *
 * These are navigation tiles, not content: they carry no counts, no member
 * numbers, no earnings and no invented activity, because the honest claim is
 * simply that these places exist and are worth a tap. Each whole card is one
 * link to the real destination (`ROUTES.clubs`, `ROUTES.gigs` — the same
 * values the sidebar and the discovery row use).
 *
 * Placement: in the Home hero, alongside the personalized greeting when
 * there is room and after it on smaller screens.
 *
 * Material: tier-3 featured glass (`.glass-featured`, surfaces.css) — the same
 * sheet the composer is made of — with the tile's own light layered in
 * home.css: Clubs is lit teal from its leading corner, Gigs carries the
 * restrained sand counter-glow. The material refinements (hover lift on
 * pointer devices, pressed response, focus ring, responsive stacking and the
 * reduced-motion path) all live in `.feature-tile` in home.css; this component
 * is composition only.
 */

const TILES = [
  {
    href: ROUTES.clubs,
    name: 'Clubs',
    title: 'Find your people.',
    copy: 'Discover technical, cultural, sports, arts, entrepreneurship and social clubs around campus.',
    short: 'Technical, cultural, sports, arts and social clubs.',
    cta: 'Explore clubs',
    icon: 'star',
    tone: 'clubs',
  },
  {
    href: ROUTES.gigs,
    name: 'Gigs',
    title: 'Put your skills to work.',
    copy: 'Explore paid and unpaid student gigs, find opportunities and discover work offered by other students.',
    short: 'Paid and unpaid work offered by other students.',
    cta: 'Explore gigs',
    icon: 'briefcase',
    tone: 'gigs',
  },
];

export function HomeFeatureTiles() {
  return (
    <section className="home-features" aria-labelledby="home-features-title">
      <h2 id="home-features-title" className="home-features__title">
        Get involved
      </h2>
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
              <Icon name={tile.icon} size={20} />
            </span>
            <span className="feature-tile__body">
              <span className="feature-tile__eyebrow">{tile.name}</span>
              <span className="feature-tile__title">{tile.title}</span>
              {/* Two lengths of the same claim: the full sentence on a single
                  card, the shorter version when paired. Only one is
                  rendered at a time (home.css), so a screen reader never hears
                  the copy twice. */}
              <span className="feature-tile__copy feature-tile__copy--long">{tile.copy}</span>
              <span className="feature-tile__copy feature-tile__copy--short">{tile.short}</span>
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
