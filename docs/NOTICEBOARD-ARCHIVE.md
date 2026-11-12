# Noticeboard archive

The archive holds historical noticeboard records: a title, a written summary,
where it came from and, where the source gives it, when it happened. It is
separate from current notices and is never shown as a current or upcoming item.

## What a record is

A record is two rows (migration 072):

| Row | Holds |
| --- | --- |
| `public.notices` | Title and description exactly as supplied, `status = 'archived'`, not pinned, `importance = 'normal'`, no `published_at` or `expires_at`. |
| `public.notice_archive_entries` | Provenance: `source_key` (primary key, `<batch>/<section>/<slug>`), section, organisation as named in the source, an optional link to an existing club, the source's own category wording, the period and source note where the source gives one, display order, and `source_checksum` (md5 of title, newline, body, as imported). |

Both halves are required. A notice that staff archive by hand has no entry and
stays staff-only, as before. Nothing is written to `events` or
`academic_calendar`: an archive record is past activity, not something to
attend, and none has a venue.

## Dates

A record's date is on its `notice_archive_entries` row (migration 076), never in
`notices.published_at`, which stays empty.

| The source gives | Stored | Shown |
| --- | --- | --- |
| A day | `occurred_on` | The date in full |
| A first and last day | `occurred_on`, `occurred_until` | Both dates |
| A year only | `occurred_on` = 1 January of that year, `date_is_approximate = true` | The year alone |
| A label that is not a calendar date (an academic year, a span of years) | `period` | The label |
| Nothing | all empty | "Date unavailable" |

- The 1 January of a year-only record is a placeholder. A check constraint
  allows `date_is_approximate` only on a 1 January with no last day, and
  `formatRecordDate` (`lib/utils.js`) prints the year for it. A real 1 January
  has the flag off and prints in full.
- `date_note` says where a date comes from when that needs stating, for example
  a year taken from an edition title.
- No date is derived from a title, from another record or from today's date.
- Nothing reads these columns to decide what is current or recent. The archive
  lists records in their recorded order (`sort_order`), not by date, and the
  current surfaces never include an archived notice.

## Who can read it

- Signed-in users read archived notices only when they are registered:
  policy `notices_select_archive` is `status = 'archived' and notice_archive_listed(id)`.
  The published and staff policies are unchanged.
- `notice_archive_entries` is read-only for clients (SELECT for `authenticated`,
  no write grant or write policy). Entries are registered by migrations.
- `anon` has no access to either table or to `notice_archive_listed(uuid)`.
- The table is tracked for backups with `source_key` as its key.

## In the app

- `/campus/noticeboard/archive` lists records by section, with `?section=<key>`
  to show one section. `/campus/noticeboard` and `/campus` link to it.
- `/campus/noticeboard/<id>` shows a record with its attribution and its date.
  Records are text only; the attachment gallery of current notices is not
  rendered.
- Current surfaces (`listNotices`, the home feed, `campus_feed`, the published
  count) pin `status = 'published'`, so a record cannot appear there.
- Code: `listNoticeArchive` and `getNoticeArchiveEntry` in `lib/data/campus.js`,
  `components/campus/NoticeArchive.js`.

## Batch `pccoe-noticeboard-2026-11` (migration 073)

64 records in 11 sections: ITSA 12, MLSC 9, IEEE Student Chapter 5, Higher
Studies & Competitive Exams Cell 4, NSS / ISR 7, Entrepreneurship & Innovation
Cell 7, Art Circle 10, and four institutional sections attributed to PCCOE
(sports 1, Alphabyte hackathon 1, placement 4, departmental 4).

- The descriptions are written summaries of noticeboard displays, stored
  verbatim. Some include wording addressed to whoever maintains the archive
  ("Preserve the original title…"); it was kept rather than rewritten.
- A section is linked to a club only when exactly one published club in the
  catalogue matches. ITSA matched. The other six bodies are attributed by name;
  no organisation, user or membership was created.
- Every section and entry in the migration carries a digest of its own fields.
  The import checks all of them before writing and refuses to run if the text
  has changed, so do not edit the manifest in 073.
- The records are created by a fixed publisher profile. In a database without
  that profile (local, CI) the import reports this and writes nothing.

### Re-running

A registered `source_key` is skipped. A second run creates nothing and changes
nothing, including records staff have since edited or deleted.

### Dates of the batch (migration 077)

The dates were read from the original posters and supplied as a list. 077 holds
them as a manifest keyed by source key and writes only records that carry no
date yet, so a second run writes nothing and an existing date is never changed.

| | Records |
| --- | --- |
| Exact date (3 of them over two days) | 27 |
| Year only | 7 |
| Label only: four placement academic years, two Art Circle records for AY 2025–26, the IEEE award years 2022–2025 | 7 |
| No date | 23 |

- Farewell '25 and the IEEE IoT Workshop take their day and month from the
  poster and their year from the edition title; `date_note` says so.
- The NSS poster "Community Donation & E-Waste Collection Drive" (24 August
  2025) dates both "Donation Initiatives" and "E-Waste Collection"; `date_note`
  names the drive.
- One date is not recorded: a framed webinar record of the Entrepreneurship &
  Innovation Cell dated 13 October 2023 could not be matched to any one of that
  section's seven records.

## Maintaining records

Staff with `manage_notices` edit or delete a record from the usual notice edit
page. An edited record stays in the archive while its status stays `archived`;
`source_checksum` keeps the digest of the text as imported, so an edit is
detectable. Deleting the notice keeps the entry row with `notice_id` null, which
is why a re-run does not bring the record back. Setting the status to
`published` turns the record into a current notice and takes it out of the
archive list.

## Adding another batch

Add a new migration with a new batch name and its own manifest, following 073.
Give every entry a stable slug: the source key is the identity of the record.
Do not append to 073. Record dates the way 077 does: an exact day where the
source has one, a year where that is all it has, and nothing otherwise.

## Connected-project migration history note

Migrations 072 and 073 were applied to the connected project
`eooysgxgvhbgohdmomji` through the Supabase connector on 2026-11-12. The
connector registered generated versions `20261112051004` (072) and
`20261112051340` (073) rather than the repository filename versions, and stored
the exact text of each file.

The project's history has no row for `071_space_attachments`, so it runs from
070 to 072. That is a gap in the history only: the tables, functions, trigger
and feature flag of 071 were already on the project when 072 and 073 were
applied (the flag row dates from 2026-11-11), without having been registered.
072 and 073 do not depend on 071. The caution in `docs/GOOGLE-DRIVE-STORAGE.md`
about `supabase db push` applies here too.

Later the same day:

| History entry | Version | Repository file |
| --- | --- | --- |
| `074_publish_pccoe_noticeboard` | `20261112085952` | none |
| `075_return_pccoe_noticeboard_to_archive` | `20261112092208` | 075, same text |
| `076_notice_archive_dates` | `20261112092823` | 076, same text |
| `077_pccoe_noticeboard_dates` | `20261112092931` | 077, same text |

`074_publish_pccoe_noticeboard` set the 64 records to `published` with a
publication time at 08:59 UTC. They then led the noticeboard, the latest-notice
lists and the home feed as new announcements, until 075 returned them to the
archive at 09:22 UTC. The publishing step is not part of this repository. The
history also holds an unrelated `074_upload_access_default`, which is
`20261112000028_074_upload_access_default.sql` here.

## Checks

- `tests/notice-archive.test.js`: the manifest (titles, digests, no invented
  figures or links), the dates against the supplied list, the SQL shape of 072,
  073 and 075 to 077, the data functions, `formatRecordDate` and the rendered
  markup.
- `database/tests/22_notice_archive.sql`: constraints (including the date
  placeholder), visibility for students, staff and `anon`, exclusion from
  `campus_feed`, delete behaviour, backup capture.
- `scripts/dev/validate-migrations.mjs` replays the import, a no-op re-run, a
  re-run after a staff edit and a staff delete, the return to the archive after
  a publication, and the dates with their re-runs. It checks that nothing
  reaches the feed and that no notification, event or calendar entry is created.
