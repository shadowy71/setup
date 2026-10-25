import { NextResponse } from 'next/server';
import { getDivisionTimetable } from '@/lib/timetable';
import {
  TIMETABLE_APP_ID_PREFIX,
  TIMETABLE_CANVAS_COLOR,
  TIMETABLE_SCOPE,
  batchAppName,
  batchShortName,
  describeBatch,
  listDivisionLetters,
} from '@/lib/timetable/batch';

/**
 * GET /timetable/manifest/[division]
 *
 * One web app manifest per batch, which is what makes the install
 * batch-specific: the manifest's `id`, `name` and `start_url` are the identity
 * Chromium keys an installed web app by, so `Division O` and `Division J`
 * install as two apps that launch two different timetables instead of two
 * shortcuts to the same one.
 *
 * `id` and `start_url` are derived from the division letter alone
 * (`campusplus-timetable-o` → `/timetable/o`), never from the display label or
 * a query parameter: a label can be reworded in a future copy pass without
 * orphaning every install already on a phone.
 *
 * `scope` is `/timetable/` on purpose. The installed app *is* the timetable, so
 * leaving for `/home` opens a browser tab — the honest behaviour for a
 * timetable shortcut, and it keeps an offline app icon from becoming a way to
 * wander into signed-in screens with no chrome around them.
 *
 * Served under `/timetable/` so it needs no change to the auth proxy: that path
 * prefix is already public, and the timetable is public by design.
 */

const ICONS = [
  { src: '/brand/timetable-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/brand/timetable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/brand/timetable-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: '/brand/timetable-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  // iOS ignores the manifest for its icon and uses this instead; it is already
  // generated for the tab bar, so the home-screen tile matches the favicon.
  { src: '/apple-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
];

export const dynamicParams = false;

export function generateStaticParams() {
  return listDivisionLetters().map((letter) => ({ division: letter.toLowerCase() }));
}

export async function GET(_request, { params }) {
  const { division } = await params;
  const batch = describeBatch(division);
  const timetable = getDivisionTimetable(division);
  if (!batch || !timetable) {
    return NextResponse.json({ error: 'division-not-found' }, { status: 404 });
  }

  const programme = batch.friendly ? `${batch.label} · ${batch.friendly}` : batch.label;
  const manifest = {
    id: `${TIMETABLE_APP_ID_PREFIX}-${batch.slug}`,
    // `Campus+` is in the name so a launcher full of "Division O" still says
    // whose Division O it is.
    name: `${batchAppName(batch.division)} — Campus+`,
    short_name: batchShortName(batch.division),
    description:
      `First-year Division ${batch.division} (${programme}) class timetable, ${batch.semester} ${batch.academicYear}. ` +
      'Opens offline once you have saved it. An unofficial student project, not an official PCCOE service.',
    start_url: batch.href,
    scope: TIMETABLE_SCOPE,
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui', 'browser'],
    orientation: 'any',
    lang: 'en-IN',
    dir: 'ltr',
    categories: ['education', 'productivity'],
    // One constant, shared with the viewport export and the Apple metadata: the
    // splash behind a launched icon and the browser toolbar have to be the colour
    // the page actually opens with, and no route may drift from it.
    theme_color: TIMETABLE_CANVAS_COLOR,
    background_color: TIMETABLE_CANVAS_COLOR,
    prefer_related_applications: false,
    icons: ICONS,
  };

  return new NextResponse(JSON.stringify(manifest, null, 2), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      // Same story as the data route: a build is the only thing that changes it.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
