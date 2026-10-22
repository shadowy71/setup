import './globals.css';
import { LandingIntro } from '@/components/layout/GalacticIntro';

import localFont from 'next/font/local';
import { PLATFORM } from '@/lib/constants';

/* The Campus+ After Dark typefaces, self-hosted from the reference
   repository's assets (aminotkartik/loginpage). They are loaded once, here,
   and exposed as CSS variables on <body> so every screen can reach for them:

     --font-display → Boldonse, used only for cinematic entry headings
     --font-micro   → DM Mono, used only for short technical micro-labels

   Body copy stays on the Inter/UI stack: a display face at reading size would
   hurt the everyday feed, and a monospace face at paragraph size would hurt
   legibility more than it would add atmosphere. Both faces are `swap`, so a
   slow font never blocks first paint. */
const displayFont = localFont({
  src: './fonts/Boldonse-Regular.ttf',
  variable: '--font-display',
  display: 'swap',
});

const microFont = localFont({
  src: [
    { path: './fonts/DMMono-Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/DMMono-Medium.ttf', weight: '500', style: 'normal' },
  ],
  variable: '--font-micro',
  display: 'swap',
});

/**
 * Campus+ — root layout.
 *
 * One reading family (Inter → platform UI) plus two deliberately rationed
 * atmospheric faces: a display face for cinematic entry points and a monospace
 * face for micro-labels. No icon webfont. The application frame (sidebar /
 * bottom navigation) is applied per-route group so the sign-in and setup
 * screens can stay deliberately plain.
 *
 * Campus+ is permanently dark: the root always renders `data-theme="dark"`
 * with a dark `color-scheme`, so the very first paint is the night palette —
 * no cookie, saved preference or operating-system setting can select anything
 * else, and there is never a flash of light.
 *
 * The reading stack prefers Inter (then Geist) and falls back to the platform
 * UI font. Inter is not fetched at build time on purpose: a build that depends
 * on a third-party CDN cannot be reproduced offline. To self-host it, drop the
 * woff2 files into app/fonts/ and switch to next/font/local — see
 * docs/DEPLOYMENT.md.
 */

export const metadata = {
  title: {
    default: `${PLATFORM.name} — ${PLATFORM.collegeName}`,
    template: `%s · ${PLATFORM.name}`,
  },
  description: `${PLATFORM.tagline} An unofficial, text-first platform for ${PLATFORM.collegeName} students.`,
  applicationName: PLATFORM.name,
  // No images, no social preview cards: Campus+ is text-first and stores no media.
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // The one Campus+ theme color (--cp-bg-page); it never follows the device.
  themeColor: '#07151d',
};

export default function RootLayout({ children }) {
  /* The landing animation is route-gated, not document-global: <LandingIntro>
     renders it only on the home page (`/home`, plus the `/` redirect that leads
     there) and only for a document that was opened there. Every other route —
     `/login`, `/setup`, `/profile`, `/market`, `/communities`, `/chat`,
     `/settings`, `/campus`, … — renders its children directly, with no
     overlay and no inert wrapper. The intro's font preloads therefore live in
     `app/(app)/home/layout.js`, so no route that cannot show the intro pays for
     them (and browsers do not warn about unused preloads). */
  return (
    <html lang="en" data-theme="dark">
      <body className={`${displayFont.variable} ${microFont.variable} min-h-dvh bg-canvas text-ink antialiased`}>
        <LandingIntro>{children}</LandingIntro>
      </body>
    </html>
  );
}
