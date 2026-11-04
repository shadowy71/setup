import { SITE_URL } from '@/lib/seo';

/**
 * Public discovery is indexable; everything student-only is not.
 *
 * The root layout still defaults to `noindex` — each indexable public page
 * overrides it through `lib/seo.js#publicMetadata`. This file adds a second,
 * crawler-facing boundary: management, creation, moderation and personal
 * routes are disallowed explicitly, even though they are already behind auth.
 */
export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/clubs', '/c/', '/campus/events'],
        disallow: [
          '/api/',
          '/home',
          '/chat',
          '/admin',
          '/moderator',
          '/onboarding',
          '/account-status',
          '/profile',
          '/user/',
          '/post/',
          '/market',
          '/gigs',
          '/communities',
          '/explore',
          '/auth/',
          '/login',
          '/setup',
          '/campus/housing',
          '/campus/lost-found',
          '/campus/noticeboard',
          '/campus/rides',
          '/campus/study',
          '/campus/teams',
          '/campus/utilities',
          '/settings',
          '/notifications',
          '/clubs/new',
          '/clubs/request',
          '/clubs/*/manage',
          '/clubs/*/edit',
          '/campus/events/new',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
