/**
 * Explicit column projections for the anonymous discovery layer.
 *
 * Migration 041 grants `anon` SELECT on *these columns only*. A public reader
 * must never use `select('*')`: doing so would fail closed (which is good) but
 * would also make an accidental grant silently widen what a public page can
 * render. Every projection below is written out so the database and the page
 * agree on what "public information" means.
 *
 * Deliberately excluded from clubs: `created_by`, `approved_by`, `approved_at`
 * (administrator identity / provenance), `catalogue_key` (internal import key),
 * `subject`, `branch`, `year` (study-group fields).
 * Deliberately excluded from events: `created_by`, `updated_by`, `updated_at`,
 * `discussion_post_id`, `search_vector` (internal provenance / plumbing).
 * Deliberately excluded from posts: `author_id`, `moderated_by`, `gif`, and
 * every moderation field (student identity and private club content).
 */

export const PUBLIC_CLUB_COLUMNS =
  'id, kind, name, slug, description, club_category, organization_type, meeting_info, ' +
  'recruitment_info, contact_info, external_url, visibility, join_policy, status, ' +
  'is_official, verification_status, source_label, source_url, directory_aliases, ' +
  'admin_assigned, member_count, post_count, created_at, updated_at';

/** Club identity only — for legacy UUID → slug redirects and event club links. */
export const PUBLIC_CLUB_IDENTITY_COLUMNS = 'id, kind, name, slug, status, visibility';

export const PUBLIC_EVENT_COLUMNS =
  'id, title, description, starts_on, ends_on, start_time, end_time, location, ' +
  'organizer, capacity, show_attendees, club_id, category, status, is_official, ' +
  'published_at, created_at';

/** Event detail adds the two intentionally-public registration fields. */
export const PUBLIC_EVENT_DETAIL_COLUMNS =
  `${PUBLIC_EVENT_COLUMNS}, registration_info, registration_url`;

/** Public club announcements — no author identity, no moderation fields. */
export const PUBLIC_CLUB_POST_COLUMNS =
  'id, community_id, title, body, kind, visibility, status, is_official, created_at';
