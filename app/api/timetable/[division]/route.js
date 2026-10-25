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
// change it: every division is generated at build time and an unknown letter
// 404s instead of reaching a render.
export const dynamicParams = false;

export function generateStaticParams() {
  return listDivisionLetters().map((letter) => ({ division: letter.toLowerCase() }));
}

const PUBLIC_HEADERS = {
  // Long `s-maxage`: a timetable changes when the department reposts it, which
  // is a deploy. `stale-while-revalidate` keeps a slow origin from being felt.
  'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Accept-Encoding',
};

export async function GET(_request, { params }) {
  const { division } = await params;
  const timetable = getDivisionTimetable(division);
  if (!timetable) {
    return NextResponse.json({ ok: false, error: 'division-not-found' }, { status: 404, headers: PUBLIC_HEADERS });
  }

  const snapshot = buildSnapshot({ ...timetable, generatedAt: new Date().toISOString() });
  if (!snapshot) {
    return NextResponse.json({ ok: false, error: 'snapshot-unavailable' }, { status: 500, headers: PUBLIC_HEADERS });
  }

  // The ETag is the snapshot's own checksum: an unchanged week revalidates to a
  // 304 rather than re-downloading, and a changed one cannot match by accident.
  return NextResponse.json({ ok: true, snapshot }, {
    headers: { ...PUBLIC_HEADERS, ETag: `"${snapshot.checksum}"` },
  });
}
