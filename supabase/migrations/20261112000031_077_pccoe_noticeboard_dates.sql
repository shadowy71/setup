-- Campus+ migration 077 — dates of the PCCOE noticeboard batch
-- =============================================================================
-- Dates read from the original noticeboard posters, for the records imported by
-- migration 073. Each line of the manifest names one record by its source key
-- (<section>/<slug> inside the batch) and gives what the poster gives:
--
--   day, last_day   an exact date, or the first and last day of an activity
--   year            the year alone. Stored as 1 January of that year with
--                   date_is_approximate = true: a placeholder, never the day
--   period          a label that is not a calendar date (an academic year, a
--                   span of years). Stored as text; no date is derived from it
--   note            where the date comes from, when that needs saying
--
-- Rules the manifest follows:
--   * a date is recorded only where the poster states it;
--   * a year is never turned into a day, and no date is inferred from a title,
--     from another record or from the current year;
--   * an academic-year label is not a date;
--   * a record that is not listed keeps no date. It stays in the archive in
--     full, as undated material. 27 records are not listed.
--
-- One date on the boards is not recorded: a framed webinar record of the
-- Entrepreneurship & Innovation Cell dated 13 October 2023 could not be matched
-- to any one of that section's seven records.
--
-- Only records that carry no date yet are written, so a date that is already
-- there is never changed and a second run writes nothing. Titles, descriptions,
-- categories, organisations and notices are not touched. Where the batch is not
-- registered, nothing is written.
-- =============================================================================

do $dates$
declare
  c_batch constant text := 'pccoe-noticeboard-2026-11';
  c_dates constant jsonb := $json$[
    {"key": "itsa/ai-workshop", "day": "2025-07-21"},
    {"key": "itsa/induction-25", "day": "2025-07-30"},
    {"key": "itsa/techpulse-2k25", "day": "2025-07-30"},
    {"key": "itsa/techroom-2-0", "day": "2025-08-18"},
    {"key": "itsa/teachers-day", "day": "2025-09-09"},
    {"key": "itsa/swc-meditation", "day": "2025-09-12"},
    {"key": "itsa/abhidnya-2-0-bruteforge", "day": "2025-09-16", "last_day": "2025-09-17"},
    {"key": "itsa/akshardhara", "day": "2025-10-13"},
    {"key": "itsa/praxis", "day": "2026-01-23", "last_day": "2026-01-24"},
    {"key": "itsa/innoveda-24", "day": "2024-10-22", "last_day": "2024-10-23"},
    {"key": "itsa/farewell-25", "day": "2025-04-17", "note": "The day and month are from the poster; the year comes from the edition title."},
    {"key": "itsa/induction-24", "day": "2024-08-29"},

    {"key": "mlsc/techroom", "day": "2025-08-25"},
    {"key": "mlsc/aiquest", "day": "2025-09-17"},
    {"key": "mlsc/project-development", "day": "2025-11-11"},
    {"key": "mlsc/bluebit-4-0", "day": "2026-03-16"},

    {"key": "higher-studies/gre-readiness", "day": "2025-08-05"},
    {"key": "higher-studies/mock-gate", "day": "2025-09-17"},
    {"key": "higher-studies/higher-education-lecture-on-ai", "day": "2025-09-20"},

    {"key": "ieee/invent-pitch", "day": "2025-08-07"},
    {"key": "ieee/iot-workshop", "day": "2025-01-22", "note": "The day and month are from the poster; the year comes from the edition title, IoT Workshop '25."},
    {"key": "ieee/membership-drive", "day": "2025-09-24"},
    {"key": "ieee/resume-building-interview-skills", "day": "2026-02-16"},
    {"key": "ieee/ieee-awards-and-achievements", "period": "2022–2025", "note": "Award years: Nupur Kulkarni — 2022; Rakshit Jain — 2024; Disha Kamalskar — 2024; Vaishnavi Nimse — 2025; Darrel Chong Student Activity Award — 2025."},

    {"key": "nss-isr/energy-conservation", "day": "2025-08-13"},
    {"key": "nss-isr/donation-initiatives", "day": "2025-08-24", "note": "Date of the Community Donation & E-Waste Collection Drive."},
    {"key": "nss-isr/e-waste-collection", "day": "2025-08-24", "note": "Date of the Community Donation & E-Waste Collection Drive."},
    {"key": "nss-isr/road-safety-awareness", "day": "2025-08-24"},

    {"key": "art-circle/firodiya-karandak-2024", "year": 2024},
    {"key": "art-circle/vinodattam", "year": 2024},
    {"key": "art-circle/akshardhara", "year": 2025},
    {"key": "art-circle/social-activity-workshop", "year": 2025},
    {"key": "art-circle/firodiya-karandak-2026", "year": 2026},
    {"key": "art-circle/diya-painting", "period": "AY 2025–26"},
    {"key": "art-circle/digital-poster-drawing-competition", "period": "AY 2025–26"},
    {"key": "art-circle/kavi-sammelan", "year": 2026},
    {"key": "art-circle/swartarang", "year": 2026}
  ]$json$::jsonb;
  v_registered integer;
  v_written    integer;
begin
  -- The manifest is checked as a whole before anything is written.
  if exists (
    select 1
    from jsonb_to_recordset(c_dates) as d(key text, day date, last_day date, year integer, period text, note text)
    where d.key is null
       or d.key !~ '^[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*$'
       -- a day or a year, never both
       or (d.day is not null and d.year is not null)
       or (d.last_day is not null and (d.day is null or d.last_day <= d.day))
       or (d.year is not null and d.year not between 1990 and 2100)
       -- a line that says nothing
       or (d.day is null and d.year is null and d.period is null and d.note is null)
  ) then
    raise exception 'The noticeboard date manifest is malformed.';
  end if;

  if (select count(*) <> count(distinct d.key) from jsonb_to_recordset(c_dates) as d(key text)) then
    raise exception 'The noticeboard date manifest names a record twice.';
  end if;

  select count(*) into v_registered
  from public.notice_archive_entries
  where source_key like c_batch || '/%';

  if v_registered = 0 then
    raise notice 'Noticeboard batch % is not registered here: no dates recorded.', c_batch;
    return;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(c_dates) as d(key text)
    where not exists (
      select 1 from public.notice_archive_entries e where e.source_key = c_batch || '/' || d.key
    )
  ) then
    raise exception 'The noticeboard date manifest names a record that is not registered.';
  end if;

  update public.notice_archive_entries as e
     set occurred_on = coalesce(d.day, make_date(d.year, 1, 1)),
         occurred_until = d.last_day,
         date_is_approximate = d.year is not null,
         period = coalesce(e.period, d.period),
         date_note = d.note
    from jsonb_to_recordset(c_dates) as d(key text, day date, last_day date, year integer, period text, note text)
   where e.source_key = c_batch || '/' || d.key
     -- only a record that carries no date yet
     and e.occurred_on is null
     and e.occurred_until is null
     and not e.date_is_approximate
     and e.date_note is null
     -- and only when there is something to write
     and (d.day is not null or d.year is not null or d.note is not null or e.period is null);
  get diagnostics v_written = row_count;

  raise notice 'Noticeboard batch %: dates recorded for % of % registered records.',
    c_batch, v_written, v_registered;
end
$dates$;
