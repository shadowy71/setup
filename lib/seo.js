/**
 * Public-page SEO — one source of truth for the deployment origin.
 *
 * `SITE_URL` is a *server* setting (not NEXT_PUBLIC_*): metadata, canonical URLs
 * and the sitemap are generated on the server, so the origin never needs to be
 * shipped to the browser. The ShareButton uses `window.location.origin` instead,
 * which is always the address the visitor actually opened.
 *
 * The default is the Campus+ production origin from the product brief. A
 * preview or staging deployment can override it without a rebuild of the
 * browser bundle. Invalid values fall back to the default rather than emitting
 * a broken canonical URL.
 */

import 'server-only';
import { PLATFORM } from '@/lib/constants';

const DEFAULT_SITE_URL = 'https://pccoe.in';

function siteOrigin() {
  const raw = process.env.SITE_URL;
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_SITE_URL;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_SITE_URL;
    return url.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/** Absolute origin, with no trailing slash (e.g. `https://pccoe.in`). */
export const SITE_URL = siteOrigin();

/** Absolute URL for a same-origin path such as `/c/coding-club`. */
export function absoluteUrl(path) {
  return new URL(path, `${SITE_URL}/`).toString();
}

/** Short, honest description used when a record has no description of its own. */
export function publicDescription(text, fallback = `${PLATFORM.name} — public club and event directory for ${PLATFORM.collegeName}.`) {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!value) return fallback;
  return value.length > 155 ? `${value.slice(0, 152).trimEnd()}…` : value;
}

/**
 * The metadata every indexable public page shares. Individual pages pass their
 * own title/description/canonical; `robots` is `index: true` only for records
 * that are genuinely public (published + publicly listed).
 */
export function publicMetadata({ title, description, canonical, index = true, type = 'website' } = {}) {
  const safeDescription = publicDescription(description);
  return {
    title,
    description: safeDescription,
    alternates: canonical ? { canonical } : undefined,
    robots: {
      index,
      follow: index,
      googleBot: { index, follow: index },
    },
    openGraph: {
      title,
      description: safeDescription,
      url: canonical ? absoluteUrl(canonical) : undefined,
      siteName: PLATFORM.name,
      type,
      locale: 'en_IN',
    },
    twitter: {
      card: 'summary',
      title,
      description: safeDescription,
    },
  };
}

/** Metadata that must never be indexed (drafts, private or member-only rows). */
export function noindexMetadata(title = 'Campus+') {
  return {
    title,
    robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  };
}
