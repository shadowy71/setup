import { NextResponse } from 'next/server';
import { getDivisionTimetable } from '@/lib/timetable';
import { buildSnapshot } from '@/lib/timetable/offline';
import { listDivisionLetters } from '@/lib/timetable/batch';

/**
 * GET /api/timetable/[division]
 *
 * The offline snapshot for one division, straight from the same view model the
 * page renders (`getDivisionTimetable`) — there is no second timetable here,
 * and nothing is invented: the response is the printed week, serialised.
 *
 * Public, like the pages it feeds. The timetable carries no personal data and
 * no session is read, so this route asks for nothing and returns the same body
 * to a signed-in student, a signed-out one and a shared link alike. That is
 * also why it may be HTTP-cached where almost nothing else in Campus+ is: see
 * `PRIVATE_HEADERS` on the authenticated routes in `app/api/`.
 *
 * The service worker deliberately does *not* cache this response. The offline
 * copy is owned by IndexedDB (`lib/timetable/offline-store.js`) because a
 * student's saved batch has to survive a browser update, be validated before it
 * replaces the previous copy, and be deletable per batch — none of which
 * CacheStorage can do.
 */

// The dataset is a repository file, so a build is the only thing that can
// change it — except that one week a year: while the special sheet is in
// effect (2026-11-23 → 2026-11-27, Asia/Kolkata) the response must serve its
// events, and the boundary takes effect at midnight without a redeploy.
// Hence a per-request render with short cache lifetimes, keyed by date.
export const dynamic = 'force-dynamic';

export const dynamicParams = false;

export function generateStaticParams() {
  return listDivisionLetters().map((letter) => ({ division: letter.toLowerCase() }));
}

const PUBLIC_HEADERS = {
  // A timetable changes when the department reposts it — normally a deploy,
  // but the special week starts and ends at midnight with no deploy. Cache
  // lifetimes stay short so the boundary flips within minutes, not days.
  'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Accept-Encoding',
};

export async function GET(_request, { params }) {
  const { division } = await params;
  const timetable = getDivisionTimetable(division);
  if (!timetable) {
    return NextResponse.json({ ok: false, error: 'division-not-found' }, { status: 404, headers: PUBLIC_HEADERS });
  }

  const snapshot = buildSnapshot({ ...timetable, source: timetable.source, generatedAt: new Date().toISOString() });
  if (!snapshot) {
    return NextResponse.json({ ok: false, error: 'snapshot-unavailable' }, { status: 500, headers: PUBLIC_HEADERS });
  }

  // The ETag is the snapshot's own checksum: an unchanged week revalidates to a
  // 304 rather than re-downloading, and a changed one cannot match by accident.
  return NextResponse.json({ ok: true, snapshot }, {
    headers: { ...PUBLIC_HEADERS, ETag: `"${snapshot.checksum}"` },
  });
}
