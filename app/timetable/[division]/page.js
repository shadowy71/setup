import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DIVISIONS, ROUTES } from '@/lib/constants';
import {
  adjacentDivisions,
  currentTimetableDay,
  getDivisionTimetable,
  TIMETABLE_DAYS,
  TIMETABLE_SOURCE,
} from '@/lib/timetable';
import { divisionTimetableHref } from '@/lib/timetable/meta';
import { DayTabs, DayTimeline, FlaggedNotice, WeekTable } from '@/components/timetable/TimetableViews';
import { Icon } from '@/components/ui/icons';

/**
 * One division's public timetable, e.g. /timetable/o.
 *
 * Public by design: no session work happens here, so the page works signed
 * out, in a fresh tab, on refresh and from a shared link. Uppercase params
 * (/timetable/O) resolve to the same division; anything that is not a
 * single A–R letter is a real 404 (see not-found.js beside this file).
 *
 * Layout: the full-week grid on wide screens; a one-day timeline with
 * `?day=` tabs on phones (defaulting to today in the campus timezone).
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
    description: `Monday–Friday class timetable for first-year Division ${timetable.division} (${programme}), ${TIMETABLE_SOURCE.semester} ${TIMETABLE_SOURCE.academicYear}. Lectures, batch practicals, faculty and rooms as printed in the master timetable.`,
  };
}

export default async function DivisionTimetablePage({ params, searchParams }) {
  const { division } = await params;
  const timetable = getDivisionTimetable(division);
  if (!timetable) notFound();

  const query = (await searchParams) || {};
  const selectedDay = TIMETABLE_DAYS.includes(query.day) ? query.day : currentTimetableDay();
  const mobileDay = timetable.days.find((entry) => entry.day === selectedDay) || timetable.days[0];
  const { previous, next } = adjacentDivisions(timetable.division);

  return (
    <main className="mt-10">
      <nav aria-label="Breadcrumb" className="text-[0.8125rem]">
        <Link href={ROUTES.timetable} className="inline-flex items-center gap-1.5 font-medium text-muted hover:text-ink">
          <Icon name="chevronLeft" size={14} aria-hidden="true" />
          All divisions
        </Link>
      </nav>

      <header className="mt-4 max-w-3xl">
        <p className="t-label">
          {TIMETABLE_SOURCE.department} · {TIMETABLE_SOURCE.semester} · {TIMETABLE_SOURCE.academicYear}
        </p>
        <h1 className="t-display mt-2">Division {timetable.division}</h1>
        <p className="t-secondary mt-2">
          {timetable.label}
          {timetable.friendly ? ` · ${timetable.friendly}` : ''}
        </p>
        <p className="mt-3 max-w-[68ch] text-[0.8125rem] leading-relaxed text-muted">
          How to read practicals: an entry like <span className="text-ink-soft">EG-1/ENG-2/FES-3</span> means the
          three batches are in different rooms at the same time — the [faculty] and [room] lists below it follow
          the same batch order. Lunch is wherever this division&rsquo;s row puts it.
        </p>
      </header>

      {timetable.flagged.length ? (
        <div className="mt-6">
          <FlaggedNotice flagged={timetable.flagged} />
        </div>
      ) : null}

      {/* Desktop: the whole week at once. */}
      <section aria-label={`Full week timetable, Division ${timetable.division}`} className="mt-8 hidden lg:block">
        <WeekTable days={timetable.days} division={timetable.division} />
      </section>

      {/* Mobile: one readable day at a time. */}
      <section aria-label={`Daily timetable, Division ${timetable.division}`} className="mt-8 lg:hidden">
        <DayTabs days={timetable.days} selectedDay={selectedDay} />
        <h2 className="t-section mb-3 mt-5">{mobileDay.day}</h2>
        <DayTimeline day={mobileDay} />
      </section>

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
