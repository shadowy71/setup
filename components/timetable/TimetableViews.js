import Link from 'next/link';
import { TIMETABLE_PERIODS } from '@/lib/timetable';
import { Notice } from '@/components/ui';

/**
 * Timetable rendering (server components — no client JavaScript).
 *
 * Two readings of the same source rows:
 *   - `WeekTable`: the full Mon–Fri grid for wide screens, events spanning
 *     their source columns, sticky period header and day rail.
 *   - `DayTimeline`: one day as a vertical list for phones, chosen with
 *     plain `?day=` links (`DayTabs`) so back/forward and refresh behave
 *     like any other navigation.
 *
 * Nothing here rewrites source text. Batch allocations render as their
 * three source lines kept together (subjects / faculty / rooms, in batch
 * order), blanks stay visibly blank, and entries the source flags carry a
 * "Needs verification" badge instead of a guess.
 */

function VerifyBadge() {
  return (
    <span className="badge badge-warning tt-verify" title="This entry could not be reconstructed with certainty from the source PDF">
      Needs verification
    </span>
  );
}

/** One event's source lines: subject first, then faculty/room lines. */
function EventLines({ event }) {
  if (event.kind === 'special') {
    // 'Empowerment' / 'Hour' are two printed lines of one label; both are
    // shown with subject emphasis, in source order.
    return (
      <>
        {event.lines.map((line) => (
          <span key={line} className="tt-line tt-line--subject">
            {line}
          </span>
        ))}
        {event.needsVerification ? <VerifyBadge /> : null}
      </>
    );
  }
  return (
    <>
      {event.lines.map((line, index) => (
        <span key={`${index}-${line}`} className={index === 0 ? 'tt-line tt-line--subject' : 'tt-line tt-line--meta'}>
          {line}
        </span>
      ))}
      {event.needsVerification ? <VerifyBadge /> : null}
    </>
  );
}

const KIND_CLASS = {
  batch: 'tt-cell--batch',
  lunch: 'tt-cell--lunch',
  special: 'tt-cell--special',
  standard: '',
};

export function WeekTable({ days, division }) {
  return (
    <div className="tt-scroll">
      <table className="tt-table">
        <caption className="sr-only">
          Full-week timetable for Division {division}, Monday to Friday. Columns are the printed period times;
          practical entries span two periods and list batch-wise subjects, faculty and rooms.
        </caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {TIMETABLE_PERIODS.map((period) => (
              <th key={period} scope="col">
                {period}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map(({ day, slots }) => (
            <tr key={day}>
              <th scope="row">{day}</th>
              {slots.map((slot, index) => {
                if (slot.type === 'covered') return null;
                if (slot.type === 'blank') {
                  return (
                    <td key={index} className="tt-cell--blank">
                      <span className="sr-only">Blank in source timetable</span>
                    </td>
                  );
                }
                const { event } = slot;
                return (
                  <td
                    key={index}
                    colSpan={event.span > 1 ? event.span : undefined}
                    className={[KIND_CLASS[event.kind], event.needsVerification ? 'tt-cell--flagged' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {event.kind === 'lunch' ? 'Lunch' : <EventLines event={event} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DayTabs({ days, selectedDay }) {
  return (
    <nav className="tt-daytabs" aria-label="Choose a day">
      {days.map(({ day }) => (
        <Link
          key={day}
          href={`?day=${day}`}
          scroll={false}
          aria-current={day === selectedDay ? 'true' : undefined}
          className="tt-daytab"
        >
          {day.slice(0, 3)}
        </Link>
      ))}
    </nav>
  );
}

const SLOT_KIND_CLASS = {
  batch: 'tt-slot--batch',
  lunch: 'tt-slot--lunch',
  special: 'tt-slot--special',
  standard: '',
};

export function DayTimeline({ day }) {
  return (
    <div className="tt-timeline" role="list" aria-label={`${day.day} timetable`}>
      {day.slots.map((slot, index) => {
        if (slot.type === 'covered') return null;
        if (slot.type === 'blank') {
          return (
            <div key={index} role="listitem" className="tt-slot tt-slot--blank">
              <span className="tt-slot__time">{TIMETABLE_PERIODS[index]}</span>
              <span>Blank in source</span>
            </div>
          );
        }
        const { event } = slot;
        return (
          <div
            key={index}
            role="listitem"
            className={['tt-slot', SLOT_KIND_CLASS[event.kind], event.needsVerification ? 'tt-slot--flagged' : '']
              .filter(Boolean)
              .join(' ')}
          >
            <span className="tt-slot__time">{event.time.label}</span>
            <span className="min-w-0">{event.kind === 'lunch' ? 'Lunch' : <EventLines event={event} />}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The honest footnote: entries the source extraction could not settle. */
export function FlaggedNotice({ flagged }) {
  if (!flagged.length) return null;
  return (
    <Notice tone="warning" icon="flag" className="max-w-3xl">
      <p className="font-semibold">
        {flagged.length === 1 ? 'One entry needs' : `${flagged.length} entries need`} manual verification against the
        department PDF:
      </p>
      <ul className="mt-1.5 list-inside list-disc">
        {flagged.map((event) => (
          <li key={`${event.day}-${event.start}`}>
            {event.day} {event.time.label}: {event.lines.join(' | ')}
          </li>
        ))}
      </ul>
      <p className="mt-1.5">Shown exactly as extracted rather than guessed — please confirm before relying on it.</p>
    </Notice>
  );
}
