import { CLUB_CATEGORIES, CLUB_ORGANIZATION_TYPES, CLUB_SLUG_REGEX, UUID_REGEX } from '@/lib/constants';
import { eventStartMs } from '@/lib/discovery/public';

/** Fail closed even if a cached reader ever returns an unexpected record. */
export function publicClubs(items) {
  return (items || []).filter((club) => club?.kind === 'club' && club.status === 'published' && club.visibility === 'public' && CLUB_SLUG_REGEX.test(club.slug || ''));
}

// Curate across categories in stable directory order, not popularity scores.
export function selectClubs(clubs, limit = 3) {
  const chosen = [];
  const categories = new Set();
  for (const club of clubs) {
    if (club.club_category && !categories.has(club.club_category)) {
      categories.add(club.club_category);
      chosen.push(club);
      if (chosen.length === limit) return chosen;
    }
  }
  for (const club of clubs) {
    if (!chosen.includes(club)) chosen.push(club);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

export function upcomingEvents(items, now = Date.now()) {
  return (items || []).filter((event) => {
    if (event?.status !== 'published' || !UUID_REGEX.test(event.id || '')) return false;
    // With no time, only show dates that have not begun in IST. A missing
    // time is never invented for display or used to claim an event is live.
    const start = eventStartMs({ ...event, start_time: event.start_time || '00:00' });
    return start !== null && start > now;
  }).slice(0, 4);
}

export function interestLinks(clubs) {
  const present = new Set(clubs.map((club) => club.club_category));
  const categories = CLUB_CATEGORIES.filter((category) => present.has(category.value)).map((category) => ({ label: category.label, href: `/clubs?category=${encodeURIComponent(category.value)}` }));
  // Only offer a keyword when it actually appears in the bounded public sample.
  const types = new Set(clubs.map((club) => club.organization_type));
  const organizations = CLUB_ORGANIZATION_TYPES.filter((type) => types.has(type.value)).map((type) => ({ label: type.label, href: `/clubs?type=${encodeURIComponent(type.value)}` }));
  const text = clubs.map((club) => [club.name, club.description, club.directory_aliases].filter(Boolean).join(' ')).join(' ').toLowerCase();
  const keywords = ['Robotics', 'Programming', 'Cybersecurity', 'Design'].filter((word) => text.includes(word.toLowerCase())).map((word) => ({ label: word, href: `/clubs?q=${encodeURIComponent(word)}` }));
  return [...categories, ...organizations, ...keywords];
}
