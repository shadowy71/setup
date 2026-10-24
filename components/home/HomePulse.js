import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { LinkButton } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { SearchEntry } from '@/components/search/SearchEntry';

/**
 * The threshold — the first thing a student sees on Home.
 *
 * Deliberately *not* a card: this is the environment, and the greeting is set
 * as editorial display type directly over it. The band carries:
 *
 *   - who you are and where you are (a small live marker, the greeting, one
 *     line of context),
 *   - the two ways in (Explore, and the search door),
 *   - a thin column of counts, each one a real length of something this page
 *     already loaded — never a fabricated metric.
 *
 * The band is followed immediately by the composer: a student who came to post
 * should not have to pass a deck of shortcuts first. The shortcuts themselves
 * still exist, one screen further down (`HomeAreas`, after the feed).
 *
 * The name is lit from the leading edge and settles into sand by the trailing
 * edge; that gradient is the one place on the page where the brand's three
 * colours meet. `@supports` keeps the plain token colour for anything without
 * text clipping, so the headline can never disappear.
 */

/**
 * The campus areas that exist as routes, offered *after* the feed as the page's
 * "keep going" row. No counts, no invented activity.
 *
 * Clubs and Gigs are deliberately absent: they are the two feature tiles above
 * the feed (`HomeFeatureTiles`), and a destination does not need to be
 * announced twice on the same screen.
 */
const DISCOVERY = [
  { href: ROUTES.explore, label: 'Explore', icon: 'search' },
  { href: '/campus/events', label: 'Events', icon: 'calendar' },
  { href: ROUTES.communities, label: 'Communities', icon: 'users' },
  { href: '/explore/projects', label: 'Projects', icon: 'grid' },
  { href: ROUTES.market, label: 'Marketplace', icon: 'tag' },
];

/**
 * The greeting's gesture. An SVG rather than an emoji: emoji hands render as a
 * completely different illustration on every platform (and on some Linux
 * images as a colour square), whereas this one is drawn in the product's own
 * teal-to-sand light and reads as part of the identity. It is decorative, so
 * it is hidden from assistive technology; the greeting itself says "Hey".
 */
function HandWave() {
  return (
    <span className="home-pulse__wave" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="0.72em" height="0.72em" fill="none" focusable="false">
        <defs>
          <linearGradient id="campus-wave-gradient" x1="4" y1="22" x2="20" y2="4" gradientUnits="userSpaceOnUse">
            <stop offset="0%" style={{ stopColor: 'var(--cp-bg-accent)' }} />
            <stop offset="55%" style={{ stopColor: 'var(--cp-accent-highlight)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--brand-sand)' }} />
          </linearGradient>
        </defs>
        <path
          d="M7.2 11.3V5.4a1.6 1.6 0 0 1 3.2 0v5.1m0-.6V3.8a1.6 1.6 0 0 1 3.2 0v6.4m0-.5V4.9a1.6 1.6 0 0 1 3.2 0v6.2m0-.3V7.4a1.5 1.5 0 0 1 3 0v7.1c0 3.9-2.6 6.6-6.5 6.6-3.1 0-5-1.5-6.4-4.3l-2.5-5a1.6 1.6 0 0 1 2.8-1.5l1.9 3.2"
          stroke="url(#campus-wave-gradient)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function HomePulse({ user, stats = [] }) {
  const name = (user.profile.display_name || user.profile.username).split(' ')[0];
  const context =
    user.profile.branch && user.profile.show_branch_year
      ? `${user.profile.branch} · everything happening on campus, right now`
      : 'Everything happening on campus, right now';

  return (
    <section className="home-pulse" aria-labelledby="home-greeting">
      <span className="home-pulse__aurora" aria-hidden="true" />
      <span className="home-pulse__spark home-pulse__spark--teal" aria-hidden="true" />
      <span className="home-pulse__spark home-pulse__spark--warm" aria-hidden="true" />

      <div className="home-pulse__grid">
        <div className="min-w-0">
          <p className="home-pulse__eyebrow">
            <span className="home-pulse__dot" aria-hidden="true" />
            PCCOE · Campus feed
          </p>
          <h1 id="home-greeting" className="home-pulse__title">
            <span className="home-pulse__greet">Hey,</span>
            <span className="home-pulse__name">
              {name}
              <HandWave />
            </span>
          </h1>
          <p className="home-pulse__lead">{context}</p>

          <div className="home-pulse__actions">
            <LinkButton href={ROUTES.explore} size="md" variant="sheen" icon="search">
              Explore campus
            </LinkButton>
            <div className="home-pulse__search">
              {/* Short enough to survive sharing a row with the Explore button on a
                phone; Explore's own field carries the long form. */}
            <SearchEntry hint="Search…" />
            </div>
          </div>
        </div>

        {stats.length ? (
          <dl className="home-pulse__stats" aria-label="Campus right now">
            {stats.map((stat) => (
              <div className="home-pulse__stat" key={stat.label} data-empty={stat.value === 0 ? 'true' : undefined}>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <span className="home-pulse__horizon" aria-hidden="true" />
    </section>
  );
}

/**
 * The page's "keep going" row: the campus areas that are not already in the
 * primary rail. It sits after the feed so the first screen stays short, and it
 * is a plain list of real destinations — nothing here filters or counts.
 */
export function HomeAreas() {
  return (
    <nav className="home-discover" aria-label="More campus areas">
      <span className="home-discover__label">Keep exploring</span>
      {DISCOVERY.map((item) => (
        <Link key={item.href} href={item.href} className="discover-chip">
          <Icon name={item.icon} size={13} />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * A zone heading: the page's spine. One per movement — the feed, and anything
 * else that needs to announce itself further down.
 */
export function HomeZone({ eyebrow, title, note = null, aside = null, id = null }) {
  return (
    <header className="home-zone">
      <div className="min-w-0">
        <p className="home-zone__eyebrow">{eyebrow}</p>
        <h2 id={id} className="home-zone__title">
          {title}
        </h2>
      </div>
      {note ? <p className="home-zone__note">{note}</p> : null}
      {aside}
    </header>
  );
}

/**
 * The page's exit: a rule, one line of plain speaking, and nothing else. It
 * exists so the feed ends deliberately rather than trailing off into the shell.
 */
export function HomeCoda({ children }) {
  return (
    <p className="home-coda">
      <span>{children}</span>
    </p>
  );
}
