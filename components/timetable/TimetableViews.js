import { TIMETABLE_PERIOD_LABELS } from '@/lib/timetable';
import { Notice } from '@/components/ui';
import { SourceLines, VerifyBadge } from '@/components/timetable/EventText';

/**
 * The full-week grid — a server-rendered reference view.
 *
 * The live day view (TimetableLive) is the primary reading: it opens on the
 * institute's weekday and carries the clock, NOW/NEXT status and the day
 * tabs. This grid stays as the "see the whole week at a glance" companion,
 * printed-source style: events span their printed columns, every cell keeps
 * its subject accent edge, and nothing is rewritten.
 */

const KIND_CLASS = {
  batch: 'tt-cell--accent',
  standard: 'tt-cell--accent',
  lunch: 'tt-cell--lunch',
  special: 'tt-cell--special',
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
            {TIMETABLE_PERIOD_LABELS.map(({ period, label }) => (
              <th key={period} scope="col">
                {label}
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
                    style={
                      event.kind === 'standard' || event.kind === 'batch'
                        ? { '--tt-accent': `var(--tt-hue-${event.accent})` }
                        : undefined
                    }
                    className={[KIND_CLASS[event.kind], event.needsVerification ? 'tt-cell--flagged' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {event.kind === 'lunch' ? 'Lunch' : <SourceLines event={event} />}
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
            {event.day} {event.time.label12}: {event.lines.join(' | ')}
          </li>
        ))}
      </ul>
      <p className="mt-1.5">Shown exactly as extracted rather than guessed — please confirm before relying on it.</p>
    </Notice>
  );
}

export { VerifyBadge };
