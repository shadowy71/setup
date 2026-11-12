# Noticeboard archive

The archive holds historical noticeboard records: a title, a written summary and
where it came from. It is separate from current notices and is never shown as a
current or upcoming item.

## What a record is

A record is two rows (migration 072):

| Row | Holds |
| --- | --- |
| `public.notices` | Title and description exactly as supplied, `status = 'archived'`, not pinned, `importance = 'normal'`, no `published_at` or `expires_at`. |
| `public.notice_archive_entries` | Provenance: `source_key` (primary key, `<batch>/<section>/<slug>`), section, organisation as named in the source, an optional link to an existing club, the source's own category wording, the period and source note where the source gives one, display order, and `source_checksum` (md5 of title, newline, body, as imported). |

Both halves are required. A notice that staff archive by hand has no entry and
stays staff-only, as before. Nothing is written to `events` or
`academic_calendar`: both need a real date and venue, and archive records have
neither.

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
- `/campus/noticeboard/<id>` shows a record with its attribution. Records are
  text only; the attachment gallery of current notices is not rendered.
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
Do not append to 073.

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

## Checks

- `tests/notice-archive.test.js`: the manifest (titles, digests, no invented
  figures, links or dates), the SQL shape of 072 and 073, the data functions and
  the rendered markup.
- `database/tests/22_notice_archive.sql`: constraints, visibility for students,
  staff and `anon`, exclusion from `campus_feed`, delete behaviour, backup capture.
- `scripts/dev/validate-migrations.mjs` replays the import, a no-op re-run, and
  a re-run after a staff edit and a staff delete.
