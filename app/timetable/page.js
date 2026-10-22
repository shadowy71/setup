import Link from 'next/link';
import { getDivisionSummaries, TIMETABLE_SOURCE } from '@/lib/timetable';
import { divisionTimetableHref } from '@/lib/timetable/meta';

export const metadata = {
  title: 'Class Timetables — Divisions A to R',
  description:
    'First-year class timetables for divisions A–R, Monday to Friday. Source: MASTER TIME TABLE, Department AS & H, Academic Year 2026–2027, SEM-I. No sign-in needed.',
};

/**
 * The division selector — public, static, and useful before a student even
 * has an account. Every tile is a real link to that division's timetable;
 * the programme abbreviation is the source document's own label, with the
 * expanded name shown only where the source material supplies one.
 */
export default function TimetableIndexPage() {
  const divisions = getDivisionSummaries();

  return (
    <main className="mt-10">
      <header className="max-w-3xl">
        <p className="t-label">First year · {TIMETABLE_SOURCE.semester}</p>
        <h1 className="t-display mt-2">Class timetables</h1>
        <p className="t-secondary mt-3 max-w-[68ch] leading-relaxed">
          Pick your division to see its Monday–Friday timetable — lectures, batch-wise practicals, faculty and
          rooms, exactly as printed in the {TIMETABLE_SOURCE.department} master timetable for{' '}
          {TIMETABLE_SOURCE.academicYear}. No sign-in needed; the link works for anyone you share it with.
        </p>
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-muted">
          Signed in to Campus+? Save your division in Settings → Profile and the Timetable menu will open your
          division directly.
        </p>
      </header>

      <nav aria-label="Divisions A to R" className="mt-8">
        <ul className="tt-tiles">
          {divisions.map(({ division, label, friendly }) => (
            <li key={division}>
              <Link
                href={divisionTimetableHref(division)}
                className="card card-interactive tt-tile"
                aria-label={`Division ${division} (${label}) timetable`}
              >
                <span className="tt-tile__letter">{division}</span>
                <span className="tt-tile__branch">{label}</span>
                <span className="tt-tile__friendly">{friendly || 'First year'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
