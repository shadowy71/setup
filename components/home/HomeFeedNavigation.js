import Link from 'next/link';
import { ROUTES } from '@/lib/constants';

/** Home has one database-ordered feed; other destinations remain real links. */
export function HomeFeedNavigation() {
  return (
    <nav className="home-feed-nav" aria-label="Feed navigation">
      <span className="home-feed-nav__current" aria-current="page">For you</span>
      <span className="home-feed-nav__unavailable" aria-disabled="true" title="Following feed is not available">Following</span>
      <Link href={ROUTES.clubs}>Clubs</Link>
      <Link href="/campus/events">Events</Link>
      <span className="home-feed-nav__sort">Pinned, then newest</span>
    </nav>
  );
}
