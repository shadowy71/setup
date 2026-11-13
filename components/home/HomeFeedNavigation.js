'use client';

import Link from 'next/link';
import { ROUTES } from '@/lib/constants';

/** Switch between the real feed modes; destination links keep their own routes. */
export function HomeFeedNavigation({ mode = 'for-you', onChange = null }) {
  return (
    <nav className="home-feed-nav" aria-label="Feed navigation">
      <button type="button" className={mode === 'for-you' ? 'home-feed-nav__current' : undefined} aria-pressed={mode === 'for-you'} onClick={() => onChange?.('for-you')}>For you</button>
      <button type="button" className={mode === 'following' ? 'home-feed-nav__current' : undefined} aria-pressed={mode === 'following'} disabled={!onChange} title={!onChange ? 'Unavailable in the demo preview' : undefined} onClick={() => onChange?.('following')}>Following</button>
      <Link href={ROUTES.clubs}>Clubs</Link>
      <Link href="/campus/events">Events</Link>
      <span className="home-feed-nav__sort">{mode === 'for-you' ? 'Pinned, then newest' : 'Newest'}</span>
    </nav>
  );
}
