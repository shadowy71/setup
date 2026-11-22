# Production migration history and onboarding audit

Read-only audit of project `eooysgxgvhbgohdmomji`, snapshot 2026-11-22. No production migration, history row, profile, grant or policy was modified by this audit.

## Findings and limits

* All **83 repository version timestamps are absent** from `supabase_migrations.schema_migrations`; production lists 32 other versions. Every repository filename/version is listed below. All 83 are missing *from history*, which does **not** mean all 83 are missing from the database.
* Thirty-one history records correspond by name or number to repo migrations 047–050, 052–070 and 072–079; these are **not version matches**. Six (065–070) also have different names. There is one additional production-only record `20261112085952_074_publish_pccoe_noticeboard`, whose relationship to 073/075 is not established here. Migrations 001–046, 051, 071 and 080–083 have no corresponding history name/number. All 32 history versions differ from repository versions.
* For the 31 number/name associations, raw MD5 of `statements[1]` in production was compared to the complete repository file bytes: **11 identical and 20 different**. This is an exact text comparison, not a semantic or security equivalence check; differences may include comments, formatting or real changes. No assumption of equivalence should be made for changed hashes.
* The final column is **one catalog marker inspected per migration**, not proof that its complete SQL was applied. Some markers predate that migration or are intentionally superseded, and a present object may have different definitions/permissions/data. Marker presence cannot establish whether a migration was fully applied; where history is absent, the safe status is **indeterminate** unless a specific missing effect has been demonstrated. No complete classification for 001–082 is claimed from these checks.
* 083 is **partially applied / divergent** as a literal SQL-effects audit: `COMMENT ON COLUMN public.roles.description` from 083 is absent in production (`col_description` returned NULL). Its functional objects listed below are present. This metadata discrepancy alone does not establish a functional failure. A previous assistant's assertion that all of 083 was applied section-by-section was too broad.
* The previous assumption that replaying 080–083 is harmless was not verified and must not be relied on: 080 deletes contributor permissions and updates roles; 083 deletes/replaces visitor permissions. Do not run `supabase db push` against this mismatched history.

## Exact comparison

Every row's local version is missing from production history. `Production version / name` is an association by matching name or migration number, **not** a timestamp match. `Raw SQL` compares MD5 of the history record's sole stored statement with local file bytes; `same`/`different` do not establish current schema behavior. `—` means no corresponding history row. `Marker` is the single catalog object checked and found present, with the limitations above.

| Repo filename | Production version / name | Raw SQL | Production marker present |
|---|---|---|---|
| `20261005000001_001_extensions_and_enums.sql` | — | — | type `account_status` |
| `20261005000002_002_identity_roles.sql` | — | — | table `colleges` |
| `20261005000003_003_blocks.sql` | — | — | table `blocks` |
| `20261005000004_004_communities.sql` | — | — | table `communities` |
| `20261005000005_005_social.sql` | — | — | table `posts` |
| `20261005000006_006_moderation_core.sql` | — | — | table `reports` |
| `20261005000007_007_messaging.sql` | — | — | table `conversations` |
| `20261005000008_008_marketplace.sql` | — | — | table `marketplace_categories` |
| `20261005000009_009_campus.sql` | — | — | function `community_submissions_require_review` |
| `20261005000010_010_random.sql` | — | — | table `random_queue` |
| `20261005000011_011_platform.sql` | — | — | table `platform_settings` |
| `20261005000012_012_auth_hooks.sql` | — | — | table `reserved_usernames` |
| `20261005000013_013_reference_data.sql` | — | — | table `roles` |
| `20261005000014_014_realtime_and_grants.sql` | — | — | function `safe_uuid` |
| `20261005000015_015_column_privileges.sql` | — | — | column `profiles.display_name` |
| `20261005000016_016_staff_actions.sql` | — | — | function `grant_role` |
| `20261005000017_017_marketplace_hardening.sql` | — | — | function `record_listing_interest` |
| `20261005000018_018_function_grants.sql` | — | — | function `current_profile_id` |
| `20261005000019_019_staff_visibility.sql` | — | — | function `is_staff_profile` |
| `20261005000020_020_chat_inbox.sql` | — | — | function `conversation_inbox` |
| `20261005000021_021_marketplace_and_security_fixes.sql` | — | — | function `guard_listing_update` |
| `20261005000022_022_random_views_invoker_fix.sql` | — | — | view `random_session_view` |
| `20261005000023_023_random_chat_flag_retired.sql` | — | — | table `feature_flags` |
| `20261005000024_024_study_partners_and_discovery.sql` | — | — | table `study_partner_posts` |
| `20261005000025_025_gigs_and_clubs.sql` | — | — | type `gig_state` |
| `20261024000001_026_messaging_live_read_model.sql` | — | — | function `conversation_inbox` |
| `20261025000001_027_backup_change_capture.sql` | — | — | table `backup_tracked_tables` |
| `20261025000002_028_backup_admin_processing.sql` | — | — | table `backup_run_leases` |
| `20261026000001_029_feed_realtime_delivery.sql` | — | — | table `posts` |
| `20261027000001_030_random_channel_authorization.sql` | — | — | function `can_access_own_random_session` |
| `20261028000001_031_club_governance.sql` | — | — | index `communities_organization_type_idx` |
| `20261028000002_032_club_catalogue.sql` | — | — | table `communities` |
| `20261029000001_033_unread_count_lookup.sql` | — | — | function `messaging_unread_counts` |
| `20261029000002_034_inbox_membership_lookup.sql` | — | — | function `conversation_inbox` |
| `20261029000003_035_feed_visibility_reconciliation.sql` | — | — | function `campus_feed_post_visibility` |
| `20261029000004_036_admin_dashboard_counts.sql` | — | — | function `campus_admin_dashboard_counts` |
| `20261029000005_037_realtime_authorization_grants.sql` | — | — | function `can_access_own_random_session` |
| `20261101000001_038_post_pin_ordering.sql` | — | — | function `campus_feed` |
| `20261102000001_039_poll_author_may_vote.sql` | — | — | policy `poll_votes_insert_self` |
| `20261102000002_040_busiest_trending.sql` | — | — | index `reactions_recent_post_idx` |
| `20261103000001_041_public_discovery.sql` | — | — | policy `communities_select_public_club` |
| `20261105000001_042_ai_ml_branch.sql` | — | — | table `profiles` |
| `20261110000001_043_profile_storage_foundation.sql` | — | — | table `storage_accounts` |
| `20261110000002_044_storage_admin_summary.sql` | — | — | function `admin_storage_summary` |
| `20261110000003_045_backup_capture_late_tables.sql` | — | — | function `backup_sync_triggers` |
| `20261110000004_046_profile_photo_lifecycle.sql` | — | — | function `storage_reserve_profile_picture` |
| `20261112000001_047_profile_storage_v3.sql` | `20261111124301` `047_profile_storage_v3` | different | function `storage_preserve_gateway_key` |
| `20261112000002_048_post_attachments.sql` | `20261111124337` `048_post_attachments` | different | table `post_attachment_links` |
| `20261112000003_049_post_attachment_order.sql` | `20261111124348` `049_post_attachment_order` | different | function `storage_reorder_post_attachments` |
| `20261112000004_050_post_attachment_drafts.sql` | `20261111124433` `050_post_attachment_drafts` | different | table `post_upload_drafts` |
| `20261112000005_051_marketplace_attachments.sql` | — | — | table `marketplace_attachment_links` |
| `20261112000006_052_team_request_integrity.sql` | `20261111163017` `052_team_request_integrity` | different | function `guard_team_post_request` |
| `20261112000007_053_profile_achievements.sql` | `20261111163034` `053_profile_achievements` | different | table `profile_achievements` |
| `20261112000008_054_ride_kinds.sql` | `20261111163042` `054_ride_kinds` | different | index `ride_posts_kind_date_idx` |
| `20261112000009_055_notice_delete.sql` | `20261111163050` `055_notice_delete` | different | function `delete_official_notice` |
| `20261112000010_056_event_rsvp_guard.sql` | `20261111163057` `056_event_rsvp_guard` | different | policy `event_registrations_update_own` |
| `20261112000011_057_team_invitations.sql` | `20261111163119` `057_team_invitations` | different | table `team_invitations` |
| `20261112000012_058_team_project_link.sql` | `20261111163128` `058_team_project_link` | different | index `team_posts_project_idx` |
| `20261112000013_059_board_staff_visibility.sql` | `20261111163134` `059_board_staff_visibility` | different | policy `housing_select_staff` |
| `20261112000014_060_event_rsvp_capacity.sql` | `20261111163149` `060_event_rsvp_capacity` | different | table `event_rsvp_capacity` |
| `20261112000015_061_remove_storage_quota.sql` | `20261111174958` `061_remove_storage_quota` | same | function `storage_reserve_profile_picture` |
| `20261112000016_062_lost_found_attachments.sql` | `20261111175031` `062_lost_found_attachments` | same | table `lost_found_attachment_links` |
| `20261112000017_063_housing_attachments.sql` | `20261111175107` `063_housing_attachments` | same | table `housing_attachment_links` |
| `20261112000018_064_ride_attachments.sql` | `20261111175150` `064_ride_attachments` | same | table `ride_attachment_links` |
| `20261112000019_065_team_attachments.sql` | `20261112050130` `065_team_attachments_preserve_resource_types` | different | table `team_attachment_links` |
| `20261112000020_066_project_attachments.sql` | `20261112050210` `066_project_attachments_preserve_resource_types` | different | table `project_attachment_links` |
| `20261112000021_067_gig_attachments.sql` | `20261112050242` `067_gig_attachments_preserve_resource_types` | different | table `gig_attachment_links` |
| `20261112000022_068_achievement_attachments.sql` | `20261112050312` `068_achievement_attachments_preserve_resource_types` | different | table `achievement_attachment_links` |
| `20261112000023_069_notice_attachments.sql` | `20261112050343` `069_notice_attachments_preserve_resource_types` | different | table `notice_attachment_links` |
| `20261112000024_070_event_attachments.sql` | `20261112050415` `070_event_attachments_preserve_resource_types` | different | table `event_attachment_links` |
| `20261112000025_071_space_attachments.sql` | — | — | table `space_attachment_links` |
| `20261112000026_072_notice_archive.sql` | `20261112051004` `072_notice_archive` | same | table `notice_archive_entries` |
| `20261112000027_073_pccoe_noticeboard_archive.sql` | `20261112051340` `073_pccoe_noticeboard_archive` | same | table `notice_archive_entries` |
| `20261112000028_074_upload_access_default.sql` | `20261112085721` `074_upload_access_default` | same | function `storage_account_usage` |
| `20261112000029_075_return_pccoe_noticeboard_to_archive.sql` | `20261112092208` `075_return_pccoe_noticeboard_to_archive` | same | table `notice_archive_entries` |
| `20261112000030_076_notice_archive_dates.sql` | `20261112092823` `076_notice_archive_dates` | same | column `notice_archive_entries.occurred_on` |
| `20261112000031_077_pccoe_noticeboard_dates.sql` | `20261112092931` `077_pccoe_noticeboard_dates` | same | table `notice_archive_entries` |
| `20261112000032_078_klipy_gif_references.sql` | `20261112154738` `078_klipy_gif_references` | different | constraint `posts_gif_provider` |
| `20261112000033_079_user_follows.sql` | `20261113074306` `079_user_follows` | same | table `user_follows` |
| `20261122000001_080_external_accounts.sql` | — | — | type `account_type` |
| `20261122000002_081_visitor_permission_grants.sql` | — | — | table `visitor_permission_grants` |
| `20261122000003_082_visitor_year_and_college.sql` | — | — | function `guard_visitor_profile_fields` |
| `20261122000004_083_visitor_vs_contributor.sql` | — | — | function `has_permission` |

The 32nd production record, with **no same-number-and-name repository file**, is `20261112085952_074_publish_pccoe_noticeboard`; its stored statement MD5 is `df098e75c4106ca6c4451e46296252f7`.

## 080–083: additional verified effects

These are catalog observations, not a full independent replay, behavioral/RLS proof, or proof of every historical data update:

* **080 — status indeterminate (many effects present):** enum `account_type`; `profile_private.account_type` non-null/default student, `college_id` nullable, and `profile_private_account_type_college` check; roles `visitor` rank -10 and `external_contributor` rank -5; verified-enabled triggers `auth.users.enforce_verified_email_domain_trigger` and `profile_private_guard_account_type`; read policies `posts_select_visible`, `comments_select_visible`, `notices_select_published` present, with the last requiring `is_institutional()`. Classifier, signup and account-type helpers exist. Historic data backfills, all privileges and every effect not independently established.
* **081 — status indeterminate (many effects present):** `visitor_permission_grants` exists with RLS enabled, select-self/select-staff policies and enabled `visitor_permission_grants_guard`; authenticated can SELECT the grants table but has no table-level INSERT, UPDATE or DELETE privilege; `visitor_grantable_permission`, `admin_external_user_emails`, `admin_list_external_users` and `post_scope_allowed_to_current` are present; post insert and author-update policies include the scope function. Later migrations supersede some functions. We did not compare all constraints, grants and changes or prove complete behavior.
* **082 — status indeterminate (many effects present):** `profiles.visitor_college_name` and `visitor_year`, the expected length/year checks and enabled `profiles_guard_visitor_fields`; `complete_profile(text,text,text,text,text,text,boolean,text,text)` present and executable by authenticated, not anon; authenticated has update privileges on the two visitor columns but no table-wide `UPDATE`; `admin_set_visitor_permissions(uuid,text[])` present. The old seven-argument overload is absent. Other ACL/data effects were not exhaustively evaluated. No real account was used for this audit.
* **083 — partially applied/divergent:** `has_permission`, `is_external_contributor`, `external_standing`, `grant_role`, `external_contributor_permissions` and `public_profiles.is_contributor` exist; the view has `security_invoker=true`; visitor baseline currently includes exactly `manage_own_profile` and `report_content`, and the contributor role currently has no permissions. The `roles.description` column comment requested by 083 is missing. The seven key functions `complete_profile`, `admin_set_visitor_permissions`, `has_permission`, `grant_role`, `external_standing`, `is_external_contributor`, and `external_contributor_permissions` are SECURITY DEFINER with search_path `public, pg_temp`, callable by authenticated but not anon. A catalog check is not a complete RLS or permission behavior audit.

For the latest definitions of the 25 functions introduced/replaced in 080–083, exact production `pg_proc.prosrc` MD5 matched the repository for 16 functions. Of the nine differing raw bodies, eight matched after a simple comment/whitespace removal; the remaining `handle_new_user` differs by an unused `v_username_seed` declaration in the repository. This simple normalization also removes whitespace within SQL string literals, so it is **not proof of behavioral equivalence**. Specifically, `has_permission`, `grant_role`, `complete_profile`, `admin_set_visitor_permissions`, `guard_visitor_profile_fields`, `guard_account_type`, `post_scope_allowed_to_current` and `classify_institutional_email` matched only under this normalization. The exact function signatures, security-definer attributes, privileges, policies, triggers, view definitions and data must all be independently checked before a history repair.

## Stale header investigation

The actual CLI versions come from filenames `20261122000001_080_external_accounts.sql` and `20261122000002_081_visitor_permission_grants.sql`. Their second-line comments instead say `20261005000034_080_external_accounts.sql` and `20261005000035_081_visitor_permission_grants.sql`. Those are comments, not executable SQL or migration version identifiers; the old-looking filenames do not exist in the current migration directory and none of these four versions is recorded in production history. Both inconsistent headers already exist in the checked-out base commit `2b26382`. The checkout is shallow, so the exact renaming history or author intent cannot be established locally. Do not rename or rewrite applied migration files solely to change comments without agreeing on a migration-history strategy.

## Safe reconciliation plan — not executed

1. Freeze production migration deployments and prohibit blind `db push`, replays, or marking versions applied. Snapshot/verify recoverable backups; capture schema, function bodies, grants, RLS policies, triggers, extensions, relevant configuration and non-sensitive data invariants. Obtain authorization for a staging clone and protect user data.
2. Rebuild all 83 local files on an isolated database using the same PostgreSQL/Supabase versions and extensions; compare the resulting effective schema against a production clone. Match exact signatures, SECURITY DEFINER/invoker, search paths, owners, ACLs, RLS definitions/roles, trigger order, constraints/indexes and data effects, accounting for later superseding migrations and deliberate production-only changes. Inspect all 20 differing history SQL records plus the extra 074 record and the completely untracked versions. A one-object marker is not sufficient.
3. Classify each migration and each remaining difference as applied/superseded, partially applied, absent, or deliberately divergent; document evidence and any irreversible data operations. Resolve discrepancies with narrowly scoped, reviewed **forward-only** migrations tested on the clone; do not rerun historical scripts that reset data or role grants. Repair the missing 083 comment only if desired and approved as part of that review.
4. Design a single authoritative baseline/history mapping with the operator, including all pre-047 versions and production-only history. Only after proof and backup, use the supported Supabase CLI migration-repair procedure on individually reviewed versions (and make any needed reviewed forward migrations); never bulk-mark by filename. Verify CLI dry-run/listing, drift, grants/RLS and app behavior afterwards. Explicitly preserve profiles, active permissions, user data and the historical production-only record until their effects are accounted for.

No reconciliation has been performed. Local onboarding tests mock the submission action; they do not prove production signup or profile creation.
