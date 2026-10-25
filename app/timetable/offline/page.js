import { PLATFORM } from '@/lib/constants';
import TimetableOfflineShell from '@/components/timetable/TimetableOfflineShell';

/**
 * `/timetable/offline` — the app shell the service worker precaches.
 *
 * It is a real route rather than markup inside the worker, so the view it
 * renders is the same `TimetableLive` the online page uses: one implementation,
 * one stylesheet, one set of tests. The worker serves *this* document when a
 * saved batch is opened with no network and no cached copy of the page (see
 * `handleDocument` in `lib/timetable/sw-entry.mjs`).
 *
 * Nothing here reads the network or a session — the content comes from
 * IndexedDB on the device — and `force-static` keeps it a single cached
 * document with no server work behind the offline open.
 */

export const dynamic = 'force-static';

export const metadata = {
  title: 'Saved timetable',
  description: `The offline copy of your saved Campus+ class timetable for ${PLATFORM.collegeName}.`,
  robots: { index: false, follow: false },
};

export default function TimetableOfflinePage() {
  return (
    <main className="mt-6">
      <TimetableOfflineShell />
    </main>
  );
}
