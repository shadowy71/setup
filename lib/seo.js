import 'server-only';
import { PLATFORM, CLUB_ORGANIZATION_TYPE_LABELS } from '@/lib/constants';
import { SITE_URL, absoluteUrl } from '@/lib/canonical';
export { SITE_URL, absoluteUrl };

export const SOCIAL_IMAGE = absoluteUrl('/timetable/social-preview.png');

// Record descriptions are public text, but can still contain contact details.
// Avoid repeating personal contact details in search and social snippets.
export function publicDescription(text, fallback = `${PLATFORM.name} — public club and event directory for ${PLATFORM.collegeName}.`) {
  const clean = (value) => typeof value === 'string' ? value
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, (value) => value.replace(/\D/g, '').length >= 10 ? '' : value)
    .replace(/\s+/g, ' ').trim() : '';
  const value = clean(text) || clean(fallback);
  return value.length > 155 ? `${value.slice(0, 152).trimEnd()}…` : value;
}

export function publicMetadata({ title, description, canonical, index = true, type = 'website', imageUrl = SOCIAL_IMAGE, imageAlt = 'Campus+ — clubs and campus events' } = {}) {
  const safeDescription = publicDescription(description);
  const socialTitle = `${title} | Campus+`;
  const image = { url: imageUrl, width: 1200, height: 630, alt: imageAlt };
  return {
    title,
    description: safeDescription,
    alternates: canonical ? { canonical } : undefined,
    robots: { index, follow: true, googleBot: { index, follow: true } },
    openGraph: { title: socialTitle, description: safeDescription, url: canonical ? absoluteUrl(canonical) : undefined, siteName: PLATFORM.name, type, locale: 'en_IN', images: [image] },
    twitter: { card: 'summary_large_image', title: socialTitle, description: safeDescription, images: [{ url: imageUrl, alt: image.alt }] },
  };
}

export function noindexMetadata(title = 'Campus+') {
  return { title, robots: { index: false, follow: false, googleBot: { index: false, follow: false } } };
}

export function clubMetadata(club) {
  const kind = CLUB_ORGANIZATION_TYPE_LABELS[club.organization_type] || 'Student organization';
  const category = club.club_category ? `${club.club_category} · ` : '';
  const description = publicDescription(`${category}${kind}. ${club.description || `${club.name} is listed on Campus+.`}`);
  return publicMetadata({ title: `${publicDescription(club.name)} | PCCOE Student Organization`, description, canonical: `/c/${club.slug}`, imageUrl: absoluteUrl(`/api/public/club-image/${club.slug}`), imageAlt: `${publicDescription(club.name)} — Campus+ club` });
}

export function eventMetadata(event, club) {
  const details = [event.starts_on, event.start_time, event.location, club?.name ? `Hosted by ${club.name}` : null].filter(Boolean).join(' · ');
  const description = publicDescription([details, event.description].filter(Boolean).join(' — '), `${event.title} — event details on Campus+.`);
  return publicMetadata({ title: `${publicDescription(event.title)} | PCCOE Events`, description, canonical: `/campus/events/${event.id}`, imageUrl: absoluteUrl(`/api/public/event-image/${event.id}`), imageAlt: `${publicDescription(event.title)} — Campus+ event` });
}

// Event dates are calendar dates and local wall-clock times at PCCOE (IST).
// A missing time remains date-only rather than inventing midnight.
export function eventDate(date, time) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) return undefined;
  if (!time) return date;
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match || +match[1] > 23 || +match[2] > 59 || +(match[3] || 0) > 59) return date;
  return `${date}T${match[1]}:${match[2]}:${match[3] || '00'}+05:30`;
}

export function breadcrumbs(items) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name: publicDescription(name), item: absoluteUrl(path) })) };
}

export function clubSchema(club) {
  return { '@context': 'https://schema.org', '@type': 'Organization', name: publicDescription(club.name), description: publicDescription(club.description, `${club.name} — student organization on Campus+.`), url: absoluteUrl(`/c/${club.slug}`) };
}

export function eventSchema(event, club) {
  const start = eventDate(event.starts_on, event.start_time);
  if (!start) return null;
  const end = event.ends_on ? eventDate(event.ends_on, event.end_time) : (event.end_time ? eventDate(event.starts_on, event.end_time) : undefined);
  const schema = { '@context': 'https://schema.org', '@type': 'Event', name: publicDescription(event.title), description: publicDescription(event.description, `${event.title} — event details on Campus+.`), startDate: start, url: absoluteUrl(`/campus/events/${event.id}`), image: [SOCIAL_IMAGE] };
  if (end && end >= start) schema.endDate = end;
  if (event.location && !/online|virtual|https?:\/\//i.test(event.location)) schema.location = { '@type': 'Place', name: publicDescription(event.location) };
  if (club?.name && club?.slug) schema.organizer = { '@type': 'Organization', name: publicDescription(club.name), url: absoluteUrl(`/c/${club.slug}`) };
  return schema;
}

export function serializeJsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
