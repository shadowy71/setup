-- Campus+ migration 075 — return the PCCOE noticeboard batch to the archive
-- =============================================================================
-- The 64 records imported by migration 073 are historical. On the connected
-- project they were published as current notices on 12 November 2026 (history
-- entry 074_publish_pccoe_noticeboard, which has no file in this repository).
-- Published, they led the noticeboard, the latest-notice lists and the home
-- feed as if they were new announcements.
--
-- Every record of the batch that is still as that step left it (published, with
-- a publication time, never saved by staff) goes back to
--
--   status        'archived'
--   published_at  null
--
-- which is how migration 073 writes it. Nothing else is written: titles,
-- descriptions, categories and provenance are untouched.
--
-- A record that staff have saved since keeps the state staff gave it. Where the
-- batch was never published nothing matches, and a second run changes nothing.
-- =============================================================================

do $archive$
declare
  c_batch    constant text := 'pccoe-noticeboard-2026-11';
  v_returned integer;
begin
  update public.notices as n
     set status = 'archived',
         published_at = null
    from public.notice_archive_entries as e
   where e.notice_id = n.id
     and e.source_key like c_batch || '/%'
     and n.status = 'published'
     and n.published_at is not null
     and n.updated_by is null;
  get diagnostics v_returned = row_count;

  raise notice 'Noticeboard batch %: % records returned to the archive.', c_batch, v_returned;
end
$archive$;
