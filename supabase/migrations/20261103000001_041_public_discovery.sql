-- Campus+ migration 041 — public discovery: clubs by slug, public events
-- =============================================================================
-- Product rule: public discovery, private student data, authenticated
-- participation, controlled administration. This migration opens *reads* for
-- three very narrow projections and opens no writes at all.
--
-- ── The visibility decision (explicit, not silent) ─────────────────────────
-- Migration 032 imported 35 published catalogue clubs with
-- `visibility = 'campus'`. In the existing model `campus` means "readable by
-- signed-in campus accounts"; `public` means "readable by everyone on Campus+";
-- `community` / `private` are member-only. Making every `campus` row visible to
-- the anonymous key would also expose private study groups and unrelated
-- communities, so that is NOT what this migration does.
--
-- Instead, the 35 source-roster catalogue entries are *explicitly* moved from
-- `campus` to `public`, and the anonymous SELECT policy below additionally
-- requires `kind = 'club'` and `status = 'published'`. For clubs, `public` now
-- also means "listed on the open web" (the club settings form says so). Every
-- other `campus`, `community` and `private` row keeps its existing boundary:
-- anon has no policy that can return it. Published/unpublished status stays
-- authoritative too — a club that is hidden, removed or archived drops out of
-- the public directory immediately.
--
-- Affected records: exactly the 35 `catalogue_key` values seeded by migration
-- 032, listed in the UPDATE below. Clubs created through the staff workflow or
-- an approved request keep their `campus` default until a manager explicitly
-- chooses "Public on the web"; that is a deliberate, auditable choice, not a
-- side effect of creating a club. Nothing else is rewritten.
--
-- ── Column projections ─────────────────────────────────────────────────────
-- Migration 014/018 revoke ALL table privileges from `anon`. This migration
-- grants SELECT on named columns only (never `select *`), so even a mistake in
-- a public page cannot read an administrator's profile id, a moderation note,
-- an author id or an attendee row. `information_schema.role_table_grants` stays
-- empty for anon; the audit script checks `column_privileges` explicitly.
--
-- ── Mutations ──────────────────────────────────────────────────────────────
-- No INSERT/UPDATE/DELETE policy is created for anon, no write column is
-- granted, and no function EXECUTE is granted (migration 018's blanket revoke
-- stays in force). RLS therefore denies every anonymous mutation, including
-- join requests, memberships, RSVPs, event/club writes and management RPCs.
-- =============================================================================

-- Snapshot the effective anon EXECUTE surface BEFORE this migration changes
-- anything, so section 5 can prove the migration added no new callable
-- function. Earlier migrations left a few SECURITY DEFINER *trigger* functions
-- reachable through PUBLIC's default EXECUTE; those are pre-existing, are not
-- RPCs (they need a NEW/OLD row and are only invoked by triggers), and are
-- deliberately left untouched here. What matters is that public discovery does
-- not widen that surface by a single function.
create temp table __anon_exec_before_041 as
select p.oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and has_function_privilege('anon', p.oid, 'EXECUTE');

-- ---------------------------------------------------------------------------
-- 1. Documented visibility change for the published club catalogue
-- ---------------------------------------------------------------------------

update public.communities
   set visibility = 'public'
 where kind = 'club'
   and status = 'published'
   and visibility = 'campus'
   and catalogue_key in (
     'team-red-baron', 'team-kratos-racing-electric', 'team-solarium',
     'team-ambush', 'team-automatons', 'team-maverick-india', 'team-anantam',
     'coding-club', 'devcorps', 'cybsec', 'foss', 'gdg-campus',
     'cesa', 'mesa', 'etsa', 'ciesa', 'itsa', 'aimsa', 'cresa', 'mcasa',
     'acm-pccoe', 'acm-w-pccoe', 'csi-pccoe', 'iet-pccoe', 'iste-pccoe',
     'codechef-pccoe', 'owasp-pccoe', 'ieee-pccoe', 'iete-pccoe',
     'swaad', 'pac', 'nss', 'games-and-sports', 'samvaad', 'campus-plus'
   );

comment on column public.communities.visibility is
  'public = listed on the open web (clubs only for anon, see migration 041); '
  'campus = signed-in campus accounts; community/private = member-only. '
  'The anonymous policy additionally requires kind = club and status = published.';

-- ---------------------------------------------------------------------------
-- 2. Column-level anonymous reads — explicit allow-lists, never whole tables
-- ---------------------------------------------------------------------------

-- Clubs: public profile fields only. No created_by / approved_by / approved_at
-- (administrator identity), no catalogue_key (internal import provenance), no
-- study-group fields. `id` is needed to associate published events with a club;
-- it is not used as a public URL identifier (the slug is).
grant select (
  id, kind, name, slug, description, club_category, organization_type,
  meeting_info, recruitment_info, contact_info, external_url, visibility,
  join_policy, status, is_official, verification_status, source_label,
  source_url, directory_aliases, admin_assigned, member_count, post_count,
  created_at, updated_at
) on public.communities to anon;

-- Events: public listing/detail fields only. No created_by / updated_by /
-- updated_at / discussion_post_id / search_vector. `registration_info` and
-- `registration_url` are intentionally public fields (migration 009) and are
-- rendered as plain text/external links on a published event page.
grant select (
  id, title, description, starts_on, ends_on, start_time, end_time, location,
  organizer, registration_info, registration_url, capacity, show_attendees,
  club_id, category, status, is_official, published_at, created_at
) on public.events to anon;

-- Posts: only the columns needed to show a public club announcement. No
-- author_id, no moderation columns, no poll/vote state, no gif payload.
-- `deleted_at`, `visibility`, `status`, `community_id`, `kind` and
-- `is_official` are needed by the policy/predicate below, not by the page.
grant select (
  id, community_id, title, body, kind, visibility, status, is_official,
  created_at, deleted_at
) on public.posts to anon;

-- ---------------------------------------------------------------------------
-- 3. Narrow anonymous SELECT policies
-- ---------------------------------------------------------------------------

create policy communities_select_public_club on public.communities
  for select to anon
  using (
    kind = 'club'
    and status = 'published'
    and visibility = 'public'
  );

comment on policy communities_select_public_club on public.communities is
  'Anonymous catalogue reads only. Private, campus-only, unpublished, removed '
  'and non-club communities are excluded; see migration 041.';

create policy events_select_public_published on public.events
  for select to anon
  using (status = 'published');

comment on policy events_select_public_published on public.events is
  'Anonymous reads are limited to published events. Drafts, cancelled, '
  'rejected, review notes and attendee rows have no anonymous policy.';

create policy posts_select_public_club_announcement on public.posts
  for select to anon
  using (
    status = 'published'
    and deleted_at is null
    and visibility = 'public'
    and community_id is not null
    and exists (
      select 1 from public.communities c
       where c.id = community_id
         and c.kind = 'club'
         and c.status = 'published'
         and c.visibility = 'public'
    )
  );

comment on policy posts_select_public_club_announcement on public.posts is
  'A public club does not make every post public. Only a published, explicitly '
  'public, undeleted announcement in a published publicly listed club is '
  'readable anonymously. No author identity is projected.';

-- ---------------------------------------------------------------------------
-- 4. Search results link to the canonical slug URL
-- ---------------------------------------------------------------------------
-- `global_search()` (migration 024, replacing 011) still builds the pre-section
-- `/campus/clubs/<uuid>` address. That address redirects twice today; rewrite
-- the single expression in the current function definition instead of copying
-- 280 lines of SQL. `pg_get_functiondef` returns a runnable CREATE OR REPLACE
-- statement, so the function body, grants, volatility and SECURITY INVOKER
-- behaviour are all preserved. If a deployment has a custom definition that no
-- longer contains the exact expression, leave it alone and warn: the legacy
-- URL still resolves through the permanent redirect in app/(public)/clubs/[id].
-- Distinct dollar-quote tags: the inner literals contain SQL string quotes, so
-- nesting the same tag inside the outer block would terminate it early.
do $patch_search$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'global_search';

  v_new := replace(v_def, $old_url$'/campus/clubs/' || c.id::text$old_url$, $new_url$'/c/' || c.slug$new_url$);
  if v_def is null or v_new = v_def then
    raise notice 'global_search club URL expression not found; legacy redirect remains in place.';
  else
    execute v_new;
  end if;
end $patch_search$;

-- `create or replace function` keeps the old ACL, but make the existing
-- contract explicit anyway: the search RPC is authenticated-only.
revoke all on function public.global_search(text, text, integer, integer) from public, anon;
grant execute on function public.global_search(text, text, integer, integer) to authenticated, service_role;

-- Migration 031 created five SECURITY DEFINER trigger functions *after* 018 had
-- revoked PUBLIC's default EXECUTE, so they reappeared with PUBLIC EXECUTE and
-- `anon` inherited it. They are trigger functions rather than RPCs, but an
-- anonymous visitor has no reason to hold EXECUTE on any definer function.
-- EXECUTE on a trigger function is checked when the trigger is created (all
-- five triggers already exist), and the bodies run with the owner's privileges,
-- so this revoke does not change any application behaviour.
revoke all on function public.guard_club_creation_request_insert() from public, anon;
revoke all on function public.notify_club_request_admins() from public, anon;
revoke all on function public.sync_club_admin_assignment() from public, anon;
revoke all on function public.guard_community_membership_write() from public, anon;
revoke all on function public.guard_club_linked_content() from public, anon;
grant execute on function public.guard_club_creation_request_insert() to authenticated, service_role;
grant execute on function public.notify_club_request_admins() to authenticated, service_role;
grant execute on function public.sync_club_admin_assignment() to authenticated, service_role;
grant execute on function public.guard_community_membership_write() to authenticated, service_role;
grant execute on function public.guard_club_linked_content() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Self-verification: the migration refuses to leave a wider hole behind
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad_policies text;
  v_bad_grants text;
  v_bad_columns text;
begin
  -- Every anon policy must be a SELECT with a real predicate, on one of the
  -- three intended tables. (pg_policies.qual is the USING expression.)
  select string_agg(format('%s.%s (%s)', tablename, policyname, cmd), '; ')
    into v_bad_policies
    from pg_policies
   where schemaname = 'public'
     and 'anon' = any(roles)
     and (
       cmd <> 'SELECT'
       or tablename not in ('communities', 'events', 'posts')
       or coalesce(qual, '') in ('', 'true')
     );
  if v_bad_policies is not null then
    raise exception 'Unexpected anonymous policy: %', v_bad_policies;
  end if;

  -- No table-level privileges for anon (only column-level SELECT was granted).
  select string_agg(format('%s:%s', table_name, privilege_type), '; ')
    into v_bad_grants
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon';
  if v_bad_grants is not null then
    raise exception 'anon must not hold table-level privileges: %', v_bad_grants;
  end if;

  -- No anonymous write privilege on any column, and no SELECT outside the
  -- three public projections.
  select string_agg(format('%s.%s:%s', table_name, column_name, privilege_type), '; ')
    into v_bad_columns
    from information_schema.column_privileges
   where table_schema = 'public' and grantee = 'anon'
     and (privilege_type <> 'SELECT'
          or table_name not in ('communities', 'events', 'posts'));
  if v_bad_columns is not null then
    raise exception 'Unexpected anonymous column privilege: %', v_bad_columns;
  end if;

  -- Belt and braces: NO new function became executable by anon as a result of
  -- this migration. Comparing against the snapshot taken at the top is both
  -- stricter and more portable than hard-coding a list of legacy functions.
  select string_agg(p.proname, '; ')
    into v_bad_grants
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and not exists (select 1 from __anon_exec_before_041 b where b.oid = p.oid);
  if v_bad_grants is not null then
    raise exception 'public discovery granted anon EXECUTE on a new function: %', v_bad_grants;
  end if;
end $$;

drop table __anon_exec_before_041;
