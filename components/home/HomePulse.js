import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { LinkButton } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { SearchEntry } from '@/components/search/SearchEntry';
import { HandWave } from '@/components/home/HandWave';

/**
 * The threshold combines the personalized greeting with campus shortcuts.
 * The counts remain sourced from the loaded feed.
 */

/**
 * The campus areas that exist as routes, offered *after* the feed as the page's
 * "keep going" row. No counts, no invented activity.
 *
 * Gigs remains here after moving out of the hero; the four primary shortcuts
 * are offered above the feed instead.
 */
const DISCOVERY = [
  { href: ROUTES.explore, label: 'Explore', icon: 'search' },
  { href: ROUTES.gigs, label: 'Gigs', icon: 'briefcase' },
  { href: ROUTES.communities, label: 'Communities', icon: 'users' },
  { href: '/explore/projects', label: 'Projects', icon: 'grid' },
  { href: ROUTES.market, label: 'Marketplace', icon: 'tag' },
];

export function HomePulse({ user, stats = [], children }) {
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
        <div className="home-pulse__intro min-w-0">
          <p className="home-pulse__eyebrow">
            <span className="home-pulse__dot" aria-hidden="true" />
            PCCOE · Campus feed
          </p>
          <h1 id="home-greeting" className="home-pulse__title">
            <span className="home-pulse__greet">Hey,</span>
            <span className="home-pulse__name">
              <span className="home-pulse__name-text" title={name}>{name}</span>
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
          {stats.length ? (
            <dl
              className="home-pulse__stats"
              style={{ '--home-stat-count': stats.length }}
              aria-label="Campus right now"
            >
              {stats.map((stat) => (
                <div className="home-pulse__stat" key={stat.label} data-empty={stat.value === 0 ? 'true' : undefined}>
                  <dt>{stat.label}</dt>
                  <dd>{stat.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>

        {children}
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
