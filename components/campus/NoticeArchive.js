import Link from 'next/link';
import { Badge, Card, EmptyState, LinkButton, Notice, SectionHeader } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { ROUTES } from '@/lib/constants';
import { formatDate, formatRecordDate } from '@/lib/utils';

/**
 * The noticeboard archive (historical records) is a separate view from the
 * noticeboard (current announcements). These components are the whole of its
 * presentation, so the two can never be confused by accident:
 *
 *   NoticeboardViews     the one switch between "Current" and "Archive"
 *   NoticeArchiveList    the archive, grouped by noticeboard section
 *   NoticeArchiveRecord  one record, with its attribution
 *
 * Text only. A record shows what it was given — a title, a written summary, an
 * organisation and a category — and never a venue or image it was not.
 *
 * Its date is the one on the original poster, shown by `formatRecordDate`: the
 * full date when the poster gives one, the year alone when only the year is
 * known (the stored 1 January is a placeholder and is never shown), and
 * "Date unavailable" otherwise. Records keep their recorded order; nothing
 * here sorts by date or reads a date to decide what is recent.
 */

const DATE_RULE =
  'A date is the one printed on the poster; where only the year could be read, only the year is shown.';
const SUMMARY_NOTE =
  `These are written summaries of what the noticeboards displayed, not copies of the original posters. ${DATE_RULE}`;

/** The date label of a list record or of a provenance row. */
function recordDate(source) {
  return formatRecordDate({
    on: source.occurredOn ?? source.occurred_on,
    until: source.occurredUntil ?? source.occurred_until,
    approximate: (source.dateIsApproximate ?? source.date_is_approximate) === true,
    period: source.period,
  });
}

/** Current notices and the archive: the only way between the two views. */
export function NoticeboardViews({ active = 'current' }) {
  const archive = active === 'archive';
  return (
    <>
      <LinkButton
        href={ROUTES.noticeboard}
        size="sm"
        variant={archive ? 'ghost' : 'secondary'}
        aria-current={archive ? undefined : 'page'}
      >
        Current
      </LinkButton>
      <LinkButton
        href={ROUTES.noticeArchive()}
        size="sm"
        icon="archive"
        variant={archive ? 'secondary' : 'ghost'}
        aria-current={archive ? 'page' : undefined}
      >
        Archive
      </LinkButton>
    </>
  );
}

function recordCount(count) {
  return `${count} ${count === 1 ? 'record' : 'records'}`;
}

/**
 * The archive list. `sections` is the result of `listNoticeArchive`;
 * `activeSection` narrows the page to one noticeboard section.
 */
export function NoticeArchiveList({ sections = [], activeSection = null, unavailable = false }) {
  const active = activeSection && sections.some((section) => section.key === activeSection) ? activeSection : null;
  const visible = active ? sections.filter((section) => section.key === active) : sections;

  return (
    <>
      <Card className="flex flex-wrap items-center gap-1.5 p-3">
        <NoticeboardViews active="archive" />
        {sections.length ? (
          <>
            <span className="rule mx-1 h-5 w-px" aria-hidden="true" />
            <Link href={ROUTES.noticeArchive()} className="chip" data-active={!active}>
              Everything
            </Link>
            {sections.map((section) => (
              <Link
                key={section.key}
                href={ROUTES.noticeArchive(section.key)}
                className="chip"
                data-active={active === section.key}
              >
                {section.name}
              </Link>
            ))}
          </>
        ) : null}
      </Card>

      <Notice tone="info" icon="history">
        <strong className="text-ink">Past activity, kept for reference.</strong> Nothing in the archive is a
        current announcement. {SUMMARY_NOTE}
      </Notice>

      {unavailable ? (
        <Notice tone="warning" icon="flag">
          The archive could not be loaded right now.
        </Notice>
      ) : null}

      {!unavailable && !sections.length ? (
        <EmptyState
          icon="archive"
          title="Nothing in the archive yet"
          description="Records of past noticeboard activity appear here once they are added."
        />
      ) : null}

      {visible.map((section) => (
        <section key={section.key} aria-labelledby={`archive-${section.key}`} className="flex flex-col gap-3">
          <SectionHeader
            id={`archive-${section.key}`}
            title={section.label}
            description={`${recordCount(section.records.length)} · ${section.organization}`}
            action={
              section.club ? (
                <Link href={ROUTES.club(section.club.slug)} className="text-2xs text-muted underline hover:text-ink">
                  Club page
                </Link>
              ) : null
            }
          />
          {section.records.map((record) => (
            <ContentCard
              key={record.id}
              href={ROUTES.notice(record.id)}
              title={record.title}
              description={record.body}
              fullDescription
              icon="archive"
              badges={[{ label: 'Archive' }, { label: record.sourceCategory }]}
              meta={[record.organization, recordDate(record)]}
              footer={
                record.note ? (
                  <span className="mt-1.5 block text-2xs text-muted">Source note: {record.note}</span>
                ) : null
              }
            />
          ))}
        </section>
      ))}
    </>
  );
}

/**
 * One archive record: the summary in full, then where it came from. `entry` is
 * the result of `getNoticeArchiveEntry`.
 */
export function NoticeArchiveRecord({ notice, entry }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge icon="archive">Archive</Badge>
        <Badge>{entry.source_category}</Badge>
      </div>

      <Notice tone="info" icon="history">
        <strong className="text-ink">Archive record, not a current announcement.</strong> This is a written
        summary of a noticeboard display, not a copy of the original poster. {DATE_RULE}
      </Notice>

      <Card className="flex flex-col gap-4 p-4">
        <p className="user-text whitespace-pre-wrap text-[0.9375rem] leading-relaxed">
          <LinkifiedText text={notice.body} />
        </p>
        {entry.source_note ? (
          <p className="text-[0.8125rem] leading-relaxed text-muted">
            <span className="text-ink">Source note.</span> {entry.source_note}
          </p>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[0.8125rem]">
          {/* Page headings are set in lower case; names such as "DHC-4" are
              repeated here exactly as recorded. */}
          <dt className="text-muted">Title</dt>
          <dd>{notice.title}</dd>
          <dt className="text-muted">Organisation</dt>
          <dd>
            {entry.club ? (
              <Link href={ROUTES.club(entry.club.slug)} className="underline hover:text-ink">
                {entry.organization}
              </Link>
            ) : (
              entry.organization
            )}
          </dd>
          <dt className="text-muted">Noticeboard</dt>
          <dd>{entry.section_label}</dd>
          <dt className="text-muted">Category</dt>
          <dd>{entry.source_category}</dd>
          <dt className="text-muted">When</dt>
          <dd>
            {recordDate(entry)}
            {entry.date_note ? <span className="block text-2xs text-muted">{entry.date_note}</span> : null}
          </dd>
          <dt className="text-muted">Added to the archive</dt>
          <dd>{formatDate(entry.created_at)}</dd>
        </dl>
      </Card>
    </>
  );
}
