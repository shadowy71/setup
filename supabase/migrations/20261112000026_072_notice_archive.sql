-- Campus+ migration 072 — noticeboard archive
-- =============================================================================
-- A historical noticeboard record is an ordinary row in public.notices with
-- status = 'archived'. That status already keeps it out of every "current"
-- surface: the noticeboard list, the Campus hub, the Home feed and
-- campus_feed() all pin status = 'published'.
--
-- Two things were missing, and this migration adds exactly those two:
--
--   notice_archive_entries   where an archive record came from: a
--                            deterministic source key, its noticeboard section,
--                            the organisation it is attributed to, the category
--                            label used by the source, the period it refers to
--                            and what the source did not preserve, plus a
--                            checksum of the supplied text. public.notices has
--                            no column for any of this, and events /
--                            achievements are the wrong home for a record with
--                            no date or venue.
--
--   notices_select_archive   until now status = 'archived' was readable by
--                            staff only. Students may now read an archived
--                            notice, but only when it is registered in
--                            notice_archive_entries. A notice that staff
--                            archive by hand stays staff-only, as before.
--
-- No existing policy, grant, trigger, column or row is changed.
-- =============================================================================

create table public.notice_archive_entries (
  -- <batch>/<section>/<slug>. The import matches on this key, so re-running an
  -- import can never create a second copy of a record.
  source_key      text primary key
                  check (source_key ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*){2}$'),
  -- SET NULL rather than CASCADE: when staff delete an archive record the key
  -- stays registered, so a later re-run does not quietly bring the record back.
  notice_id       uuid unique references public.notices (id) on delete set null,
  section_key     text not null check (section_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  section_label   text not null check (length(btrim(section_label)) between 2 and 120),
  -- Attribution as text. It is always present; community_id is set only when
  -- the organisation already exists in the club catalogue. `attribution` says
  -- whether the name is a student organisation or cell, or the institution.
  organization    text not null check (length(btrim(organization)) between 2 and 120),
  attribution     text not null check (attribution in ('organization', 'institution')),
  community_id    uuid references public.communities (id) on delete set null,
  -- The category wording of the source, kept verbatim. notices.category holds
  -- the nearest value of the notice_category enum.
  source_category text not null check (length(btrim(source_category)) between 2 and 60),
  -- The year or academic year the record refers to, only where its own text
  -- gives one ('2025', 'AY 2022–23'). A label, deliberately not a date: no
  -- record in the archive has a day, and none may be implied.
  period          text check (period is null or length(btrim(period)) between 2 and 40),
  -- What the source did not preserve (names, figures, dates), in its own words.
  source_note     text check (source_note is null or length(btrim(source_note)) between 5 and 400),
  sort_order      integer not null check (sort_order > 0),
  -- md5(title || E'\n' || body) of the text as supplied. Comparing it with the
  -- live notice shows whether a record still carries its source wording.
  source_checksum text not null check (source_checksum ~ '^[0-9a-f]{32}$'),
  created_at      timestamptz not null default now()
);

create index notice_archive_entries_community_idx on public.notice_archive_entries (community_id);
create index notice_archive_entries_section_idx on public.notice_archive_entries (section_key, sort_order);

comment on table public.notice_archive_entries is
  'Provenance for imported noticeboard archive records. One row per source key; written by migrations only.';

alter table public.notice_archive_entries enable row level security;

-- SECURITY DEFINER because the notices policy below must not depend on the
-- caller's own view of notice_archive_entries: that table's policy looks at
-- notices, and two policies that read each other recurse.
create function public.notice_archive_listed(p_notice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.notice_archive_entries e where e.notice_id = p_notice_id
  );
$$;

comment on function public.notice_archive_listed(uuid) is
  'TRUE when the notice is a registered archive record. Used by notices_select_archive.';

revoke all on function public.notice_archive_listed(uuid) from public, anon;
grant execute on function public.notice_archive_listed(uuid) to authenticated, service_role;

-- Additive: the published and staff policies are untouched, so nothing that was
-- hidden before becomes visible except registered archive records.
create policy notices_select_archive on public.notices
  for select to authenticated
  using (status = 'archived' and public.notice_archive_listed(id));

-- A provenance row is readable exactly when its notice is readable (the
-- sub-select runs under the caller's RLS on notices). Rows whose notice was
-- deleted have no notice to show and are visible to noticeboard staff only.
create policy notice_archive_entries_select on public.notice_archive_entries
  for select to authenticated
  using (
    public.has_permission('manage_notices')
    or exists (select 1 from public.notices n where n.id = notice_archive_entries.notice_id)
  );

-- Read-only for clients: there is no INSERT, UPDATE or DELETE policy and no
-- write grant. Archive records are registered by migrations.
revoke all on public.notice_archive_entries from public, anon, authenticated;
grant select on public.notice_archive_entries to authenticated;
grant all on public.notice_archive_entries to service_role;

-- Attach transactional backup capture to the new table before any row exists.
select public.backup_sync_triggers();
