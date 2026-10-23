import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DIVISIONS, ROUTES } from '@/lib/constants';
import { adjacentDivisions, getDivisionTimetable } from '@/lib/timetable';
import { getCampusTime, normalizeTimetableDay, timetableDayFor } from '@/lib/timetable/clock';
import { divisionTimetableHref } from '@/lib/timetable/meta';
import TimetableLive from '@/components/timetable/TimetableLive';
import { FlaggedNotice, WeekTable } from '@/components/timetable/TimetableViews';
import { Icon } from '@/components/ui/icons';

/**
 * One division's public timetable, e.g. /timetable/o.
 *
 * Public by design: no session work happens here, so the page works signed
 * out, in a fresh tab, on refresh and from a shared link. Uppercase params
 * (/timetable/O) resolve to the same division; anything that is not a
 * single A–R letter is a real 404 (see not-found.js beside this file).
 *
 * The server resolves "today" in Asia/Kolkata and hands the client that
 * instant plus the requested day, so the first paint already shows the right
 * weekday and clock. Everything after that — the ticking clock, NOW/NEXT
 * moving between periods, crossing midnight — happens in TimetableLive.
 */

// Only A–R exist (both cases, so /timetable/O works like /timetable/o);
// anything else is a router-level 404 into not-found.js.
export const dynamicParams = false;

export function generateStaticParams() {
  return DIVISIONS.flatMap((division) => [{ division: division.toLowerCase() }, { division }]);
}

export async function generateMetadata({ params }) {
  const { division } = await params;
  const timetable = getDivisionTimetable(division);
  if (!timetable) return { title: 'Timetable not found' };
  const programme = timetable.friendly ? `${timetable.label} (${timetable.friendly})` : timetable.label;
  return {
    title: `Division ${timetable.division} timetable — ${programme}`,
    description: `Monday–Friday class timetable for first-year Division ${timetable.division} (${programme}) with the live class for Asia/Kolkata time. Lectures, batch practicals, faculty and rooms as printed in the master timetable.`,
  };
}

export default async function DivisionTimetablePage({ params, searchParams }) {
  const { division } = await params;
  const timetable = getDivisionTimetable(division);
  if (!timetable) notFound();

  const query = (await searchParams) || {};
  // An explicit ?day= is a deliberate (and shareable) choice; otherwise the
  // page opens on the institute's real weekday — or the weekend state. A day
  // that does not exist in the source is ignored here and stripped from the
  // address bar after hydration, so a stale link cannot keep lying about
  // which day is on screen.
  const requestedDay = normalizeTimetableDay(query.day);

  const now = new Date();
  const campus = getCampusTime(now);
  const today = timetableDayFor(campus.weekday);
  const initialDay = requestedDay ?? today;
  // Naming today in the URL is not a preference: the page keeps following
  // the calendar (and can roll into the weekend) until a different day is
  // chosen explicitly.
  const initialPinned = Boolean(requestedDay && requestedDay !== today);

  // Only what the live view needs: the week grid keeps its slots server-side.
  const liveDays = timetable.days.map(({ day, events, freeRanges }) => ({ day, events, freeRanges }));
  const { previous, next } = adjacentDivisions(timetable.division);

  return (
    <main className="mt-10">
      <nav aria-label="Breadcrumb" className="text-[0.8125rem]">
        <Link href={ROUTES.timetable} className="inline-flex items-center gap-1.5 font-medium text-muted hover:text-ink">
          <Icon name="chevronLeft" size={14} aria-hidden="true" />
          All divisions
        </Link>
      </nav>

      <TimetableLive
        division={timetable.division}
        label={timetable.label}
        friendly={timetable.friendly}
        days={liveDays}
        subjects={timetable.subjects}
        initialDay={initialDay}
        initialPinned={initialPinned}
        initialNow={now.toISOString()}
      >
        {timetable.flagged.length ? (
          <div className="mt-8">
            <FlaggedNotice flagged={timetable.flagged} />
          </div>
        ) : null}

        <details className="tt-week">
          <summary>See the full week at a glance</summary>
          <div className="tt-week__body">
            <WeekTable days={timetable.days} division={timetable.division} />
          </div>
        </details>
      </TimetableLive>

      <nav aria-label="Neighbouring divisions" className="mt-10 flex flex-wrap items-center justify-between gap-3">
        {previous ? (
          <Link
            href={divisionTimetableHref(previous)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-line px-3.5 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-line-strong hover:no-underline"
          >
            <Icon name="chevronLeft" size={14} aria-hidden="true" />
            Division {previous}
          </Link>
        ) : (
          <span />
        )}
        <Link href={ROUTES.timetable} className="text-[0.8125rem] font-medium text-muted underline hover:text-ink">
          All divisions A–R
        </Link>
        {next ? (
          <Link
            href={divisionTimetableHref(next)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-line px-3.5 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-line-strong hover:no-underline"
          >
            Division {next}
            <Icon name="chevronRight" size={14} aria-hidden="true" />
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
