/**
 * Pieces shared by the server-rendered week grid and the live day view.
 *
 * Presentational only — no data import, so it can be used from either side of
 * the server/client boundary without pulling the semester dataset into a
 * browser bundle.
 */

/** The honest marker for an entry the source extraction could not settle. */
export function VerifyBadge() {
  return (
    <span
      className="badge badge-warning tt-verify"
      title="This entry could not be reconstructed with certainty from the source PDF"
    >
      Needs verification
    </span>
  );
}

/**
 * One event's source lines: the subject/batch allocation first, then the
 * faculty and room lines, verbatim and in printed order. An Empowerment Hour
 * is two printed lines of one label, so it is joined rather than stacked.
 */
export function SourceLines({ event }) {
  if (event.kind === 'special') {
    return (
      <>
        <span className="tt-line tt-line--subject">{event.lines.join(' ')}</span>
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
