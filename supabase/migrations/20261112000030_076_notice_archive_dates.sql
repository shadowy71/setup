-- Campus+ migration 076 — dates for noticeboard archive records
-- =============================================================================
-- An archive record describes something that happened in the past, and its
-- source, a poster on a noticeboard, often says when. Four columns on
-- notice_archive_entries hold that:
--
--   occurred_on          the day it happened, or its first day
--   occurred_until       its last day, when it ran for more than one
--   date_is_approximate  true when only the year is known. occurred_on is then
--                        1 January of that year: a placeholder that keeps the
--                        year in a date column, not a day on which anything
--                        happened. It is shown as the year alone.
--   date_note            where the date comes from, when that needs saying
--                        (a year taken from an edition title, for example)
--
-- A record with no recoverable date leaves all four empty. The period column
-- keeps the labels that are not calendar dates, such as an academic year.
--
-- Nothing reads these columns to decide what is current. Archive records are
-- archived notices, which no latest list, feed, event calendar or notification
-- includes; the date is provenance, shown beside the record.
--
-- No policy, grant or trigger changes. The table stays read-only for clients,
-- and backup capture records whole rows, so the new columns are captured.
-- =============================================================================

alter table public.notice_archive_entries
  add column occurred_on         date,
  add column occurred_until      date,
  add column date_is_approximate boolean not null default false,
  add column date_note           text;

alter table public.notice_archive_entries
  -- A last day needs a first day before it.
  add constraint notice_archive_entries_date_range_check
    check (occurred_until is null or (occurred_on is not null and occurred_until > occurred_on)),
  -- A placeholder is 1 January of the known year and nothing more precise.
  add constraint notice_archive_entries_date_placeholder_check
    check (
      not date_is_approximate
      or (
        occurred_on is not null
        and occurred_until is null
        and extract(month from occurred_on) = 1
        and extract(day from occurred_on) = 1
      )
    ),
  add constraint notice_archive_entries_date_note_check
    check (date_note is null or length(btrim(date_note)) between 5 and 400);

comment on column public.notice_archive_entries.occurred_on is
  'Day the recorded activity happened (its first day). When date_is_approximate is true this is 1 January of the known year: a placeholder, never a real day.';
comment on column public.notice_archive_entries.occurred_until is
  'Last day of an activity that ran for more than one day. Exact dates only.';
comment on column public.notice_archive_entries.date_is_approximate is
  'True when only the year is known. occurred_on then holds 1 January of that year and must be shown as the year alone.';
comment on column public.notice_archive_entries.date_note is
  'Where the date comes from, when that needs saying.';
