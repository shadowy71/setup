import { CLUB_SLUG_REGEX } from '@/lib/constants';

/** Rank only genuinely related, publicly listed records; never infer popularity. */
export function relatedClubs(club, candidates, limit = 3) {
  const tokens = (value) => new Set((Array.isArray(value) ? value.join(' ') : String(value || '')).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((s) => s.length >= 3));
  const aliases = tokens(club.directory_aliases);
  const unique = new Map();
  for (const item of candidates) {
    if (!item || item.id === club.id || item.kind !== 'club' || item.status !== 'published' || item.visibility !== 'public' || !CLUB_SLUG_REGEX.test(item.slug || '')) continue;
    const commonAliases = [...tokens(item.directory_aliases)].filter((word) => aliases.has(word)).length;
    const score = (club.club_category && club.club_category === item.club_category ? 2 : 0) + (club.organization_type && club.organization_type === item.organization_type ? 2 : 0) + Math.min(commonAliases, 2);
    if (score) unique.set(item.slug, { item, score });
  }
  return [...unique.values()].sort((a, b) => b.score - a.score || a.item.slug.localeCompare(b.item.slug)).slice(0, limit).map(({ item }) => item);
}

export function eventStartMs(event) {
  if (event?.status !== 'published' || !/^\d{4}-\d{2}-\d{2}$/.test(event.starts_on || '') || !/^\d{2}:\d{2}(?::\d{2})?$/.test(event.start_time || '')) return null;
  const [y, m, d] = event.starts_on.split('-').map(Number);
  const [h, min, sec = 0] = event.start_time.split(':').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (day.toISOString().slice(0, 10) !== event.starts_on || h > 23 || min > 59 || sec > 59) return null;
  return Date.UTC(y, m - 1, d, h, min, sec) - 330 * 60000;
}

// Recruitment text is not a structured status; avoid turning arbitrary copy
// (including "not recruiting") into an unverified recruitment claim.
export function hasVerifiedRecruitment(club) {
  const info = String(club?.recruitment_info || '').toLowerCase();
  return Boolean(club?.admin_assigned && /\b(recruiting now|currently recruiting|recruitment (?:is )?open|applications (?:are )?open)\b/.test(info) && !/\b(not|no|closed|ended|paused|not currently)\b/.test(info));
}

export function upcomingRelatedEvents(events, currentId, now = Date.now()) {
  return events.filter((event) => {
    const start = eventStartMs(event);
    return event.id !== currentId && start !== null && start > now;
  }).slice(0, 3);
}
