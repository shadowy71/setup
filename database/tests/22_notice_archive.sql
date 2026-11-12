-- =============================================================================
-- Campus+ database tests — 22 noticeboard archive: visibility and provenance
-- =============================================================================
-- Migration 072 lets students read an archived notice only when it is
-- registered in notice_archive_entries. This suite proves the boundary from
-- each side with real roles and RLS enabled:
--
--   * a registered archive record is readable by a student, and only there;
--   * a notice that staff archive by hand stays staff-only;
--   * no archive record can reach campus_feed(), the "current" read path;
--   * provenance is read-only for clients and closed to anon;
--   * deleting a record keeps its source key registered;
--   * the new table is covered by transactional backup capture.
--
-- The fixtures are independent of any imported batch.
-- =============================================================================

select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

insert into auth.users (id, email) values
  ('a2200000-0000-4000-a000-000000000001', 'archive.staff@pccoepune.org'),
  ('a2200000-0000-4000-a000-000000000002', 'archive.student@pccoepune.org')
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', 'a2200000-0000-4000-a000-000000000001', false);
select public.complete_profile('archive_staff', 'Archive Staff');
select set_config('request.jwt.claim.sub', 'a2200000-0000-4000-a000-000000000002', false);
select public.complete_profile('archive_student', 'Archive Student');
select set_config('request.jwt.claim.sub', '', false);
-- The moderator role carries manage_notices.
select public.grant_role((select id from public.profiles where username = 'archive_staff'), 'moderator');

insert into public.notices (id, title, body, status, created_by, published_at)
select fixture.id, fixture.title, fixture.body, fixture.status::public.content_status,
       (select id from public.profiles where username = 'archive_staff'),
       case when fixture.status = 'published' then now() end
from (values
  ('a2200000-0000-4000-b000-000000000001'::uuid, 'Archive suite: current notice',
   'A current announcement that belongs on the noticeboard.', 'published'),
  ('a2200000-0000-4000-b000-000000000002'::uuid, 'Archive suite: registered record',
   'A historical record registered in the noticeboard archive.', 'archived'),
  ('a2200000-0000-4000-b000-000000000003'::uuid, 'Archive suite: archived by hand',
   'Staff archived this notice themselves; it is not an archive record.', 'archived'),
  ('a2200000-0000-4000-b000-000000000004'::uuid, 'Archive suite: registered draft',
   'Registered in the archive, then pulled back to draft by staff.', 'draft'),
  ('a2200000-0000-4000-b000-000000000005'::uuid, 'Archive suite: record to delete',
   'A registered record that staff will delete.', 'archived')
) as fixture(id, title, body, status);

insert into public.notice_archive_entries
  (source_key, notice_id, section_key, section_label, organization, attribution, source_category,
   period, source_note, sort_order, source_checksum)
select fixture.source_key, fixture.notice_id, 'records', 'Suite records', 'Suite organisation', 'organization',
       'Technical / Workshop', '2025', 'Names and figures were not preserved.', fixture.sort_order,
       coalesce((select md5(n.title || chr(10) || n.body) from public.notices n where n.id = fixture.notice_id),
                md5('deleted before this suite'))
from (values
  ('suite-22/records/registered',      'a2200000-0000-4000-b000-000000000002'::uuid, 1),
  ('suite-22/records/draft',           'a2200000-0000-4000-b000-000000000004'::uuid, 2),
  ('suite-22/records/to-delete',       'a2200000-0000-4000-b000-000000000005'::uuid, 3),
  ('suite-22/records/already-deleted', null::uuid,                                   4)
) as fixture(source_key, notice_id, sort_order);

-- -----------------------------------------------------------------------------
-- 1. Catalog contract
-- -----------------------------------------------------------------------------
do $$
begin
  perform public.test_assert(
    (select relrowsecurity from pg_class where oid = 'public.notice_archive_entries'::regclass),
    '1. RLS is enabled on notice_archive_entries'
  );
  perform public.test_assert(
    (select array_agg(policyname::text || ':' || cmd order by policyname)
       from pg_policies where schemaname = 'public' and tablename = 'notice_archive_entries')
      = array['notice_archive_entries_select:SELECT'],
    '1. provenance has exactly one policy, and it is a SELECT'
  );
  perform public.test_assert(
    (select array_agg(policyname::text order by policyname)
       from pg_policies where schemaname = 'public' and tablename = 'notices' and cmd = 'SELECT')
      = array['notices_select_archive', 'notices_select_published', 'notices_select_staff'],
    '1. notices keeps its two SELECT policies and gains only the archive one'
  );
  perform public.test_assert(
    has_table_privilege('authenticated', 'public.notice_archive_entries', 'SELECT')
    and not has_table_privilege('authenticated', 'public.notice_archive_entries', 'INSERT')
    and not has_table_privilege('authenticated', 'public.notice_archive_entries', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.notice_archive_entries', 'DELETE'),
    '1. authenticated holds SELECT on provenance and nothing else'
  );
  perform public.test_assert(
    not has_table_privilege('anon', 'public.notice_archive_entries', 'SELECT')
    and not has_function_privilege('anon', 'public.notice_archive_listed(uuid)', 'EXECUTE'),
    '1. anon can neither read provenance nor call the archive predicate'
  );
  perform public.test_assert(
    exists (select 1 from pg_trigger
            where tgrelid = 'public.notice_archive_entries'::regclass
              and tgname = 'backup_capture' and not tgisinternal and tgenabled = 'O')
    and exists (select 1 from public.backup_tracked_tables
                where schema_name = 'public' and table_name = 'notice_archive_entries'
                  and capture and snapshot and key_columns = array['source_key']),
    '1. provenance is tracked and captured by the backup outbox'
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Constraints that keep the registry deterministic
-- -----------------------------------------------------------------------------
select public.test_assert_denied(
  $sql$insert into public.notice_archive_entries
         (source_key, section_key, section_label, organization, attribution, source_category, sort_order, source_checksum)
       values ('Suite 22/Bad Key', 'records', 'Suite records', 'Suite organisation', 'organization', 'Other', 9, md5('x'))$sql$,
  '2. a source key must be <batch>/<section>/<slug> in lower-case slug form'
);
select public.test_assert_denied(
  $sql$insert into public.notice_archive_entries
         (source_key, section_key, section_label, organization, attribution, source_category, sort_order, source_checksum)
       values ('suite-22/records/registered', 'records', 'Suite records', 'Suite organisation', 'organization', 'Other', 9, md5('x'))$sql$,
  '2. a source key can be registered only once'
);
select public.test_assert_denied(
  $sql$insert into public.notice_archive_entries
         (source_key, notice_id, section_key, section_label, organization, attribution, source_category, sort_order, source_checksum)
       values ('suite-22/records/second-copy', 'a2200000-0000-4000-b000-000000000002', 'records',
               'Suite records', 'Suite organisation', 'organization', 'Other', 9, md5('x'))$sql$,
  '2. one notice cannot be registered under two source keys'
);
select public.test_assert_denied(
  $sql$insert into public.notice_archive_entries
         (source_key, section_key, section_label, organization, attribution, source_category, sort_order, source_checksum)
       values ('suite-22/records/odd-attribution', 'records', 'Suite records', 'Suite organisation', 'sponsor', 'Other', 9, md5('x'))$sql$,
  '2. attribution is an organisation or the institution, nothing else'
);

-- A valid row with the same shape is accepted, so the four denials above fail
-- for the reason each one names and not for a missing column.
insert into public.notice_archive_entries
  (source_key, section_key, section_label, organization, attribution, source_category, sort_order, source_checksum)
values ('suite-22/records/shape-check', 'records', 'Suite records', 'Suite organisation', 'institution', 'Other', 9, md5('x'));
delete from public.notice_archive_entries where source_key = 'suite-22/records/shape-check';

-- -----------------------------------------------------------------------------
-- 3. A student reads registered archive records, and nothing else that is hidden
-- -----------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'a2200000-0000-4000-a000-000000000002', false);

do $$
declare
  v_notices text[];
  v_entries text[];
begin
  select array_agg(right(id::text, 1) order by id) into v_notices
  from public.notices where id::text like 'a2200000-0000-4000-b000-%';
  perform public.test_assert(v_notices = array['1', '2', '5'],
    '3. a student sees the published notice and the registered archive records only: '
      || coalesce(v_notices::text, 'null'));

  select array_agg(source_key order by sort_order) into v_entries
  from public.notice_archive_entries where source_key like 'suite-22/%';
  perform public.test_assert(
    v_entries = array['suite-22/records/registered', 'suite-22/records/to-delete'],
    '3. a student sees provenance only for records they can read: ' || coalesce(v_entries::text, 'null'));

  perform public.test_assert(
    public.notice_archive_listed('a2200000-0000-4000-b000-000000000002')
    and not public.notice_archive_listed('a2200000-0000-4000-b000-000000000003'),
    '3. the archive predicate is true for registered notices only');
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. No archive record reaches the current feed, on any page
-- -----------------------------------------------------------------------------
do $$
declare
  v_offset integer := 0;
  v_rows integer;
  v_page uuid[];
  v_seen uuid[] := '{}';
begin
  loop
    select count(*), coalesce(array_agg(id) filter (where item_type = 'notice'), '{}')
      into v_rows, v_page
    from public.campus_feed(50, v_offset, 'newest');
    exit when v_rows = 0 or v_offset > 5000;
    v_seen := v_seen || v_page;
    v_offset := v_offset + 50;
  end loop;

  perform public.test_assert(
    'a2200000-0000-4000-b000-000000000001'::uuid = any (v_seen),
    '4. the published notice is in the current feed');
  perform public.test_assert(
    not (v_seen && array[
      'a2200000-0000-4000-b000-000000000002', 'a2200000-0000-4000-b000-000000000003',
      'a2200000-0000-4000-b000-000000000004', 'a2200000-0000-4000-b000-000000000005']::uuid[]),
    '4. no archived or draft notice appears in the current feed');
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Students cannot write to the archive
-- -----------------------------------------------------------------------------
select public.test_assert_denied(
  $sql$insert into public.notice_archive_entries
         (source_key, notice_id, section_key, section_label, organization, attribution, source_category, sort_order, source_checksum)
       values ('suite-22/records/self-registered', 'a2200000-0000-4000-b000-000000000003', 'records',
               'Suite records', 'Suite organisation', 'organization', 'Other', 9, md5('x'))$sql$,
  '5. a student must not register a hidden notice as an archive record'
);
select public.test_assert_denied(
  $sql$update public.notice_archive_entries set organization = 'Someone else'
        where source_key = 'suite-22/records/registered'$sql$,
  '5. a student must not rewrite the attribution of a record'
);
select public.test_assert_denied(
  $sql$delete from public.notice_archive_entries where source_key = 'suite-22/records/registered'$sql$,
  '5. a student must not unregister a record'
);
select public.test_assert_denied(
  $sql$select public.delete_official_notice('a2200000-0000-4000-b000-000000000002')$sql$,
  '5. a student must not delete an archive record'
);

do $$
declare
  v_changed integer;
begin
  update public.notices set body = 'Rewritten by a student who should not be able to.'
   where id = 'a2200000-0000-4000-b000-000000000002';
  get diagnostics v_changed = row_count;
  perform public.test_assert(v_changed = 0, '5. a student cannot edit an archive record');
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. anon has no path to the archive
-- -----------------------------------------------------------------------------
reset role;
set role anon;
select set_config('request.jwt.claim.role', 'anon', false);
select set_config('request.jwt.claim.sub', '', false);

select public.test_assert_denied(
  $sql$select count(*) from public.notice_archive_entries$sql$,
  '6. anon must not read provenance'
);
select public.test_assert_denied(
  $sql$select public.notice_archive_listed('a2200000-0000-4000-b000-000000000002')$sql$,
  '6. anon must not call the archive predicate'
);

-- -----------------------------------------------------------------------------
-- 7. Noticeboard staff see everything, including keys whose notice is gone
-- -----------------------------------------------------------------------------
reset role;
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'a2200000-0000-4000-a000-000000000001', false);

do $$
begin
  perform public.test_assert(
    (select count(*) from public.notices where id::text like 'a2200000-0000-4000-b000-%') = 5,
    '7. staff see all five fixture notices');
  perform public.test_assert(
    (select count(*) from public.notice_archive_entries where source_key like 'suite-22/%') = 4,
    '7. staff see every registered key, including one with no notice');
  perform public.test_assert(
    public.delete_official_notice('a2200000-0000-4000-b000-000000000005'),
    '7. staff can delete an archive record through the audited path');
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Deleting a record keeps its key registered, and the change is captured
-- -----------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_ops text[];
begin
  perform public.test_assert(
    not exists (select 1 from public.notices where id = 'a2200000-0000-4000-b000-000000000005'),
    '8. the deleted record is gone from notices');
  perform public.test_assert(
    (select notice_id is null from public.notice_archive_entries
      where source_key = 'suite-22/records/to-delete'),
    '8. its source key stays registered with no notice, so a re-run cannot restore it');

  select array_agg(operation order by id) into v_ops
  from public.backup_change_log
  where table_name = 'notice_archive_entries'
    and row_pk ->> 'source_key' = 'suite-22/records/to-delete';
  perform public.test_assert(v_ops = array['insert', 'update'],
    '8. registering and detaching a record each produce one backup event: ' || coalesce(v_ops::text, 'null'));
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', 'a2200000-0000-4000-a000-000000000002', false);

select public.test_assert(
  (select array_agg(source_key order by sort_order) from public.notice_archive_entries
    where source_key like 'suite-22/%') = array['suite-22/records/registered'],
  '8. a student no longer sees provenance for the deleted record'
);

reset role;
select set_config('request.jwt.claim.role', '', false);
select set_config('request.jwt.claim.sub', '', false);
