'use client';

/**
 * The offline app shell.
 *
 * This is the page the service worker serves when a timetable navigation
 * cannot reach Campus+ *and* no cached copy of that document exists — for
 * example a saved batch opened from the installed icon with the radio off,
 * after the browser has dropped the HTTP cache entry. It renders the same
 * `TimetableLive` view model from the snapshot in IndexedDB, so what a student
 * sees is the timetable, not an error page: the day tabs, the current-day
 * marker, NOW/NEXT, the legend and the flagged entries all keep working,
 * because the snapshot carries the times and the labels, not a picture.
 *
 * Two things follow from the design and are worth stating where they are done:
 *
 *   - batch links here are plain `<a href>` elements, not `<Link>`. Offline, a
 *     client-side navigation would fetch an RSC payload that cannot arrive and
 *     land on the error boundary; a real navigation is answered by the worker
 *     from cache, which is exactly the path this page exists to serve.
 *   - the division is read from the *current* URL at runtime, never from a
 *     query parameter: the worker serves this document under `/timetable/j`, so
 *     the address is the request, and the address is what the manifest's
 *     `start_url` and the student's bookmark both point at.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import TimetableLive from '@/components/timetable/TimetableLive';
import { TimetableInstallSheet, TimetableOfflinePill } from '@/components/timetable/TimetableOfflineUi';
import { TimetableOfflineProvider } from '@/components/timetable/TimetableOfflineProvider';
import { Button } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { batchName, listBatches } from '@/lib/timetable/batch';
import { formatSavedAgo } from '@/lib/timetable/offline';
import { listSavedBatches, loadBatch } from '@/lib/timetable/offline-store';
import { getCampusTime } from '@/lib/timetable/clock';
import { resolveAutoDay } from '@/lib/timetable/auto-day';
import { ROUTES } from '@/lib/constants';

/** `/timetable/o` → 'O'. Anything else (including this page's own address) → null. */
export function divisionFromPathname(pathname) {
  const match = /^\/timetable\/([a-zA-Z])$/.exec(String(pathname || ''));
  return match ? match[1].toUpperCase() : null;
}

function SavedBatchList({ batches, active }) {
  if (!batches.length) return null;
  return (
    <nav aria-label="Saved timetables" className="tt-shell__batches">
      <p className="t-label">Saved on this device</p>
      <ul className="tt-shell__chips">
        {batches.map((batch) => (
          <li key={batch.division}>
            <a
              href={ROUTES.timetableDivision(batch.division.toLowerCase())}
              className={`tt-shell__chip${batch.division === active ? ' tt-shell__chip--active' : ''}`}
              aria-current={batch.division === active ? 'page' : undefined}
            >
              <span className="tt-shell__chip-letter">{batch.division}</span>
              {batch.label}
              <span className="tt-shell__chip-age">{formatSavedAgo(batch.savedAt, new Date())}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function TimetableOfflineShell() {
  const [division, setDivision] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [savedList, setSavedList] = useState([]);
  const [state, setState] = useState('reading');
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const requested = divisionFromPathname(window.location.pathname);
      const all = await listSavedBatches();
      if (!alive) return;
      setSavedList(all?.batches ?? []);

      const wanted = requested || all?.batches?.[0]?.division || null;
      setDivision(wanted);
      if (!wanted) {
        setState('empty');
        return;
      }

      const stored = await loadBatch(wanted);
      if (!alive) return;
      if (stored?.snapshot) {
        setSnapshot(stored.snapshot);
        setSavedAt(stored.snapshot.savedAt || stored.snapshot.generatedAt);
        setState('saved');
        return;
      }
      setState(requested ? 'missing' : 'empty');
    })();

    return () => {
      alive = false;
    };
  }, []);

  const retry = useCallback(() => {
    // A real navigation, not a router call: the worker answers it from cache
    // when there is no network and from the origin when there is one.
    window.location.reload();
  }, []);

  const knownBatches = useMemo(() => listBatches(), []);

  if (state === 'reading') {
    return (
      <div className="tt-shell__panel card">
        <p className="t-secondary">
          <Icon name="refresh" size={14} /> Reading the saved timetable…
        </p>
      </div>
    );
  }

  if (state !== 'saved') {
    return (
      <div className="tt-shell__panel card">
        <p className="t-label">Offline</p>
        <h1 className="t-display mt-2">Nothing saved for this timetable yet</h1>
        <p className="t-secondary mt-3 max-w-[62ch]">
          {state === 'missing'
            ? `${batchName(division)} was not saved on this device, so it cannot be opened without a connection.`
            : 'A timetable has to be opened once while online to be saved. After that it opens with no signal at all.'}
        </p>
        {savedList.length ? (
          <>
            <p className="t-secondary mt-3">These are already on this device:</p>
            <SavedBatchList batches={savedList} active={division} />
          </>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2.5">
          <Button variant="primary" onClick={retry}>
            Try again
          </Button>
          <Button variant="secondary" as="a" href={ROUTES.timetable}>
            All divisions
          </Button>
        </div>
        <details className="tt-shell__details">
          <summary>Every division Campus+ can show</summary>
          <ul className="tt-shell__all">
            {knownBatches.map((entry) => (
              <li key={entry.division}>
                <a href={entry.href}>{entry.division}</a>
              </li>
            ))}
          </ul>
        </details>
      </div>
    );
  }

  // This branch is painted only after IndexedDB has answered, so resolving the
  // schedule-aware day here is a client-only decision: the saved timetable opens
  // on the same day the online page would (today until its last lecture ends,
  // then the next day with classes), with no flash of Monday first. The instant
  // is passed down as `initialNow`, so the first client render already agrees
  // with itself.
  const opened = new Date();
  const campus = getCampusTime(opened);
  const initialDay = resolveAutoDay({
    days: snapshot.days,
    weekday: campus.weekday,
    nowMinutes: campus.minutesOfDay,
  }).day;

  return (
    <TimetableOfflineProvider division={division}>
      <div className="tt-shell__saved">
        <div className="tt-shell__banner card" role="status">
          <span className="tt-shell__banner-mark" aria-hidden="true">
            <Icon name="wifiOff" size={16} />
          </span>
          <div className="min-w-0">
            <p className="tt-shell__banner-title">Saved timetable · offline</p>
            <p className="t-secondary">
              {batchName(division)}, last synced {formatSavedAgo(savedAt, new Date())}. Nothing here changed since it was
              saved; a schedule change only arrives when the page can reach Campus+.
            </p>
          </div>
          <div className="tt-shell__banner-actions">
            <Button variant="secondary" size="sm" onClick={retry}>
              Check for updates
            </Button>
          </div>
        </div>

        <SavedBatchList batches={savedList} active={division} />

        <TimetableLive
          division={snapshot.division}
          label={snapshot.label}
          friendly={snapshot.friendly}
          days={snapshot.days}
          subjects={snapshot.subjects}
          initialDay={initialDay}
          initialNow={opened.toISOString()}
          offlineSlot={<TimetableOfflinePill />}
        />

        {snapshot.flagged?.length ? (
          <div className="card tt-shell__flagged">
            <p className="t-label">Needed verification when this was saved</p>
            <ul className="mt-2 space-y-1 t-secondary">
              {snapshot.flagged.map((entry, index) => (
                <li key={`${entry.day}-${entry.start}-${index}`}>
                  {entry.day} {entry.label12}: {entry.lines.join(' | ')}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <TimetableInstallSheet />
      </div>
    </TimetableOfflineProvider>
  );
}
