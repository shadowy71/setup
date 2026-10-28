import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import {
  listUsers,
  listRoles,
  listPermissions,
  listRolePermissions,
  listPlatformSettings,
  listFeatureFlags,
  listAuditLogs,
  listOfficialContent,
  getOperationalCounts,
  getAdminOverview,
} from '@/lib/data/admin';
import { listReports } from '@/lib/data/moderation';
import { ROUTES, PAGE_SIZE, ROLE_ORDER, CLUB_ORGANIZATION_TYPE_LABELS } from '@/lib/constants';
import { Badge, Button, Card, EmptyState, LinkButton, Notice, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { saveNotice, saveEvent, saveCampusContent } from '@/lib/actions/campus';
import {
  GrantRoleForm,
  RevokeRoleForm,
  AccountStatusForm,
  PlatformSettingForm,
  FeatureFlagToggle,
} from '@/components/admin/AdminPanels';
import { ModerationActions, ResolveReportForm } from '@/components/moderation/ModerationPanels';
import { formatDateTime, relativeTime } from '@/lib/utils';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { getBackupStatus, getBackupConfiguration } from '@/lib/data/backup';
import { BackupActionButtons, RetryBackupButton } from '@/components/admin/BackupPanels';
import { listClubCreationRequests, listUnassignedClubs } from '@/lib/data/clubs';
import { AssignClubAdminForm, ClubRequestReview } from '@/components/clubs/ClubRequestPanels';
import { ExternalLink } from '@/components/content/ExternalLink';
import { DISASTER_RECOVERY_NOTICE, PRODUCTION_DRIVE_REDIRECT_URI } from '@/lib/backup/constants.js';

export const metadata = { title: 'Administration' };

/**
 * Administration (spec §51, §53–§55).
 *
 * Every tab is a real read of the database and every control writes through a
 * SECURITY DEFINER function or a permission-checked policy. Two tables are
 * deliberately read-only here: `roles` and `role_permissions` have their UPDATE
 * grant revoked from the client roles (migration 015), and `official_resources`
 * / `opportunities` do not grant UPDATE on `status`, so those approvals are an
 * operator path documented in docs/DEPLOYMENT.md rather than a fake button.
 */

const TABS = [
  { key: 'users', label: 'Users', permission: 'manage_users' },
  { key: 'roles', label: 'Roles', permission: 'manage_roles' },
  { key: 'permissions', label: 'Permissions', permission: 'manage_permissions' },
  { key: 'reports', label: 'Reports', permission: 'review_reports' },
  { key: 'content', label: 'Official content', permission: 'manage_official_content' },
  { key: 'clubs', label: 'Clubs', permission: 'manage_clubs' },
  { key: 'marketplace', label: 'Marketplace', permission: 'moderate_marketplace' },
  { key: 'events', label: 'Events', permission: 'manage_events' },
  { key: 'settings', label: 'Settings', permission: 'manage_platform_settings' },
  { key: 'flags', label: 'Feature flags', permission: 'manage_feature_flags' },
  { key: 'audit', label: 'Audit logs', permission: 'view_audit_logs' },
  { key: 'counts', label: 'Operational counts', permission: 'view_admin_overview' },
  { key: 'backups', label: 'Backups', permission: 'manage_backups' },
];

const CONTENT_TABLES = [
  { key: 'notices', label: 'Noticeboard' },
  { key: 'campus_deals', label: 'Campus deals' },
  { key: 'campus_locations', label: 'Directory & locations' },
  { key: 'campus_services', label: 'Services' },
  { key: 'transport_information', label: 'Transport' },
  { key: 'cafeteria_information', label: 'Cafeteria' },
  { key: 'academic_calendar', label: 'Academic calendar' },
  { key: 'official_links', label: 'Forms & links' },
  { key: 'help_contacts', label: 'Help hub' },
  { key: 'official_resources', label: 'Resources (read only)' },
  { key: 'opportunities', label: 'Opportunities (read only)' },
];

const COUNT_LABELS = {
  profiles: 'Students',
  posts: 'Posts',
  comments: 'Comments',
  reactions: 'Reactions',
  communities: 'Communities & groups',
  marketplace_listings: 'Marketplace listings',
  gigs: 'Gigs',
  events: 'Events',
  notices: 'Notices',
  reports: 'Reports',
  messages: 'Messages',
  random_sessions: 'Random sessions',
};

function isTabAllowed(actor, tab) {
  if (!tab) return false;
  // Backups expose operational health and Drive connection state: only the
  // explicit manage_backups permission (Super Admin by default) opens it.
  // `moderate_all` must not implicitly grant access to backup tooling.
  if (tab.permission === 'manage_backups') return can(actor, 'manage_backups');
  if (can(actor, 'moderate_all') && tab.permission !== 'view_admin_overview') return true;
  return can(actor, tab.permission);
}

export default async function AdminPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;

  const allowed = TABS.filter((tab) => isTabAllowed(actor, tab));

  if (!allowed.length) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Administration" />
        <Notice tone="warning" icon="lock">
          Administration tools are not available for your account.
        </Notice>
      </div>
    );
  }

  const requested = typeof params?.tab === 'string' ? params.tab : null;
  const activeTab = allowed.some((tab) => tab.key === requested) ? requested : allowed[0].key;

  const q = typeof params?.q === 'string' && params.q.trim() ? params.q.trim().slice(0, 80) : null;
  const offset = Number.isFinite(Number(params?.offset)) && Number(params.offset) > 0 ? Number(params.offset) : 0;
  const contentTable = CONTENT_TABLES.some((item) => item.key === params?.table) ? params.table : 'notices';

  const overview =
    activeTab === 'counts' && isTabAllowed(actor, TABS.find((tab) => tab.key === 'counts'))
      ? await getAdminOverview(supabase)
      : null;

  const users =
    activeTab === 'users' ? await listUsers(supabase, { q, limit: PAGE_SIZE.admin, offset }) : null;
  const roles = activeTab === 'users' || activeTab === 'roles' ? await listRoles(supabase) : [];
  const permissions =
    activeTab === 'permissions' || activeTab === 'roles' ? await listPermissions(supabase) : [];
  const rolePermissions = activeTab === 'permissions' ? await listRolePermissions(supabase) : [];
  const reports =
    activeTab === 'reports' ? await listReports(supabase, { status: ['pending', 'reviewing'], limit: PAGE_SIZE.admin }) : null;
  const content = activeTab === 'content' ? await listOfficialContent(supabase, { table: contentTable }) : null;
  const marketplace =
    activeTab === 'marketplace' ? await listOfficialContent(supabase, { table: 'marketplace_listings' }) : null;
  const events = activeTab === 'events' ? await listOfficialContent(supabase, { table: 'events' }) : null;
  const settings = activeTab === 'settings' ? await listPlatformSettings(supabase) : [];
  const flags = activeTab === 'flags' ? await listFeatureFlags(supabase) : [];
  const audit = activeTab === 'audit' ? await listAuditLogs(supabase, { limit: 40, offset }) : [];
  const counts = activeTab === 'counts' ? await getOperationalCounts(supabase) : null;
  const backups = activeTab === 'backups' ? await getBackupStatus(supabase) : null;
  const backupConfig = activeTab === 'backups' ? getBackupConfiguration() : [];
  const [pendingClubRequests, clubRequestHistory, unassignedClubs] = activeTab === 'clubs'
    ? await Promise.all([
        listClubCreationRequests(supabase, { status: 'pending', limit: 60 }),
        listClubCreationRequests(supabase, { limit: 30 }),
        listUnassignedClubs(supabase),
      ])
    : [null, null, null];

  const settingsByGroup = new Map();
  for (const setting of settings) {
    const group = setting.category || 'general';
    if (!settingsByGroup.has(group)) settingsByGroup.set(group, []);
    settingsByGroup.get(group).push(setting);
  }
  const flagsByGroup = new Map();
  for (const flag of flags) {
    const group = flag.group_name || 'general';
    if (!flagsByGroup.has(group)) flagsByGroup.set(group, []);
    flagsByGroup.get(group).push(flag);
  }

  return (
    <div className="page-grid">
      <PageHeader
        title="Administration"
        description="Accounts, roles, official content, platform configuration and the audit trail."
      />

      <Card className="flex flex-wrap gap-1.5 p-3">
        {allowed.map((tab) => (
          <Link
            key={tab.key}
            href={`${ROUTES.admin}?tab=${tab.key}`}
            className="chip"
            data-active={activeTab === tab.key}
          >
            {tab.label}
          </Link>
        ))}
      </Card>

      {/* ---------------------------------------------------------------- users */}
      {activeTab === 'users' && users ? (
        <section aria-label="Users" className="flex flex-col gap-3">
          <form method="get" action={ROUTES.admin} className="card flex flex-wrap items-end gap-2 p-3">
            <input type="hidden" name="tab" value="users" />
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
              <span className="field-label">Username</span>
              <input
                name="q"
                defaultValue={q || ''}
                maxLength={80}
                placeholder="Search usernames"
                className="control control-input h-9"
              />
            </label>
            <Button type="submit" size="sm" variant="secondary" icon="search">
              Search
            </Button>
          </form>

          {users.unavailable ? (
            <Notice tone="warning" icon="flag">Accounts could not be loaded. Refresh to try again.</Notice>
          ) : null}
          {!users.unavailable && users.items.length === 0 ? (
            <EmptyState icon="users" title="No accounts matched" description={q ? 'Try another username.' : 'No students have signed in yet.'} />
          ) : null}

          {users.items.map((row) => (
            <Card key={row.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={ROUTES.user(row.username)} className="text-[0.875rem] font-medium underline-offset-2 hover:underline">
                  {row.display_name || `@${row.username}`}
                </Link>
                <span className="text-2xs text-muted">@{row.username}</span>
                <Badge tone={row.account_status === 'active' ? 'success' : 'warning'}>{row.account_status}</Badge>
                {(row.roles.length ? row.roles : ['student']).map((role) => (
                  <Badge key={role} tone={role === 'student' ? 'neutral' : 'danger'}>{role}</Badge>
                ))}
              </div>
              <p className="text-2xs text-muted">
                Joined {formatDateTime(row.created_at)}
                {row.status_reason ? ` · ${row.status_reason}` : ''}
                {row.suspended_until ? ` · until ${formatDateTime(row.suspended_until)}` : ''}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <GrantRoleForm userId={row.id} roles={roles} currentRoles={row.roles} />
                {row.roles
                  .filter((role) => role !== 'student' && role !== 'super_admin')
                  .map((role) => (
                    <RevokeRoleForm
                      key={role}
                      userId={row.id}
                      role={role}
                      label={role.replace(/_/g, ' ')}
                    />
                  ))}
                <AccountStatusForm userId={row.id} currentStatus={row.account_status} />
              </div>
            </Card>
          ))}

          {users.total > PAGE_SIZE.admin ? (
            <nav className="flex items-center justify-between text-2xs text-muted" aria-label="Account pages">
              {offset > 0 ? (
                <Link className="underline" href={`${ROUTES.admin}?tab=users&offset=${Math.max(0, offset - PAGE_SIZE.admin)}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
                  Newer
                </Link>
              ) : <span />}
              <span>
                {offset + 1}–{Math.min(offset + PAGE_SIZE.admin, users.total)} of {users.total}
              </span>
              {offset + PAGE_SIZE.admin < users.total ? (
                <Link className="underline" href={`${ROUTES.admin}?tab=users&offset=${offset + PAGE_SIZE.admin}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
                  Older
                </Link>
              ) : <span />}
            </nav>
          ) : null}
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- roles */}
      {activeTab === 'roles' ? (
        <section aria-label="Roles" className="flex flex-col gap-3">
          <Notice tone="neutral" icon="lock">
            Role definitions and permission mappings are configuration: they change through migrations so
            that every change is reviewed and versioned. Granting a role to a person is done from the Users tab.
          </Notice>
          {roles.map((role) => (
            <Card key={role.key} className="flex flex-col gap-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.875rem] font-medium">{role.label}</span>
                <Badge tone={role.key === 'student' ? 'neutral' : 'danger'}>{role.key}</Badge>
                <Badge>rank {role.rank}</Badge>
                {role.is_system ? <Badge>system</Badge> : null}
              </div>
              <p className="text-2xs text-muted">{role.description}</p>
            </Card>
          ))}
        </section>
      ) : null}

      {/* ---------------------------------------------------------- permissions */}
      {activeTab === 'permissions' ? (
        <section aria-label="Permissions" className="flex flex-col gap-3">
          <Notice tone="neutral" icon="lock">
            Read-only: <code>role_permissions</code> is not client-writable (migration 015). Apply changes with
            the operator SQL in docs/DEPLOYMENT.md.
          </Notice>
          {permissions.map((permission) => {
            const holders = rolePermissions
              .filter((row) => row.permission_key === permission.key)
              .map((row) => row.role_key)
              .sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
            return (
              <Card key={permission.key} className="flex flex-col gap-1 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.8125rem] font-medium">{permission.label}</span>
                  <span className="font-mono text-2xs text-muted">{permission.key}</span>
                  <Badge>{permission.group_name}</Badge>
                </div>
                <p className="text-2xs text-muted">{permission.description}</p>
                <p className="text-2xs text-muted">Granted to: {holders.length ? holders.join(', ') : 'no role yet'}</p>
              </Card>
            );
          })}
        </section>
      ) : null}

      {/* -------------------------------------------------------------- reports */}
      {activeTab === 'reports' && reports ? (
        <section aria-label="Reports" className="flex flex-col gap-3">
          <p className="text-2xs text-muted">
            {reports.items.length} open report{reports.items.length === 1 ? '' : 's'}. The full queue, including
            Random reports and history, lives on the moderation surface.
          </p>
          <LinkButton href={`${ROUTES.moderator}?tab=reports`} size="sm">Open the moderation queue</LinkButton>
          {reports.items.length === 0 ? <EmptyState icon="flag" title="Nothing to review" description="No reports are waiting." /> : null}
          {reports.items.map((report) => (
            <Card key={report.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={report.status === 'pending' ? 'warning' : 'accent'}>{report.status}</Badge>
                <Badge>{report.target_type.replace(/_/g, ' ')}</Badge>
                <Badge>{report.reason}</Badge>
                <span className="text-2xs text-muted">{relativeTime(report.created_at)}</span>
              </div>
              <p className="text-[0.875rem] font-medium">
                {report.summary || (report.random_session_id ? 'Random session' : `Target ${report.target_id}`)}
              </p>
              {report.details ? <p className="user-text text-[0.8125rem] text-muted"><LinkifiedText text={report.details} /></p> : null}
              <p className="text-2xs text-muted">
                Reporter @{report.reporter_username || 'unknown'}
                {report.moderator_url ? (
                  <>
                    {' · '}
                    <Link href={report.moderator_url} className="underline">Open the content</Link>
                  </>
                ) : null}
              </p>
              {report.target_type !== 'random_session' ? (
                <>
                  <ModerationActions targetType={report.target_type} targetRef={report.target_id} reportId={report.id} />
                  <ResolveReportForm reportId={report.id} />
                </>
              ) : (
                <LinkButton href={`${ROUTES.moderator}?tab=random`} size="sm" variant="secondary">
                  Review on the moderation surface
                </LinkButton>
              )}
            </Card>
          ))}
        </section>
      ) : null}

      {/* ------------------------------------------------------- official content */}
      {activeTab === 'content' && content ? (
        <section aria-label="Official content" className="flex flex-col gap-3">
          <Card className="flex flex-wrap gap-1.5 p-3">
            {CONTENT_TABLES.map((item) => (
              <Link
                key={item.key}
                href={`${ROUTES.admin}?tab=content&table=${item.key}`}
                className="chip"
                data-active={contentTable === item.key}
              >
                {item.label}
              </Link>
            ))}
          </Card>

          {contentTable === 'notices' ? (
            <ActionForm
              action={saveNotice}
              submitLabel="Publish notice"
              pendingLabel="Publishing…"
              successMessage="Notice saved. It appears on the noticeboard."
              resetOnSuccess
              fields={[
                { name: 'title', label: 'Title', required: true, maxLength: 140 },
                { name: 'body', label: 'Notice', type: 'textarea', required: true, maxLength: 4000 },
                {
                  name: 'category',
                  label: 'Category',
                  type: 'select',
                  defaultValue: 'general',
                  options: [
                    { value: 'general', label: 'General' },
                    { value: 'academic', label: 'Academic' },
                    { value: 'examination', label: 'Examination' },
                    { value: 'placement', label: 'Placement' },
                    { value: 'event', label: 'Event' },
                    { value: 'administrative', label: 'Administrative' },
                    { value: 'emergency', label: 'Emergency' },
                  ],
                },
                {
                  name: 'importance',
                  label: 'Importance',
                  type: 'select',
                  defaultValue: 'normal',
                  options: [
                    { value: 'low', label: 'Low' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'high', label: 'High' },
                    { value: 'critical', label: 'Critical' },
                  ],
                },
                { name: 'expires_at', label: 'Expires', type: 'date' },
                { name: 'pinned', label: 'Pin to the top of the noticeboard', type: 'checkbox' },
                {
                  name: 'status',
                  label: 'Status',
                  type: 'select',
                  defaultValue: 'published',
                  options: [
                    { value: 'published', label: 'Published' },
                    { value: 'draft', label: 'Draft' },
                    { value: 'archived', label: 'Archived' },
                  ],
                },
              ]}
            />
          ) : (
            <ActionForm
              action={saveCampusContent}
              hidden={{ table: contentTable }}
              submitLabel="Save entry"
              successMessage="Campus information saved."
              resetOnSuccess
              encTypeNote="Campus+ is text only: no photos, files or map widgets. Locations are described in words."
              fields={[
                { name: 'title', label: 'Title', required: true, maxLength: 140 },
                { name: 'description', label: 'Description', type: 'textarea', maxLength: 4000 },
                { name: 'category', label: 'Category', maxLength: 80 },
                { name: 'location', label: 'Location (text)', maxLength: 200 },
                { name: 'contact_info', label: 'Contact', maxLength: 300 },
                { name: 'url', label: 'Link', placeholder: 'https://…' },
                { name: 'valid_from', label: 'Valid from', type: 'date' },
                { name: 'valid_until', label: 'Valid until', type: 'date' },
                { name: 'starts_on', label: 'Starts on', type: 'date' },
                { name: 'ends_on', label: 'Ends on', type: 'date' },
                { name: 'deadline', label: 'Deadline', type: 'date' },
              ]}
            />
          )}

          {content.items.length === 0 ? (
            <EmptyState icon="file" title="Nothing published here yet" description="Add the first entry with the form above." />
          ) : (
            <ul className="flex flex-col gap-2">
              {content.items.map((row) => (
                <li key={row.id} className="card flex flex-wrap items-center gap-2 p-3">
                  <span className="text-[0.875rem] font-medium">{row.title || row.name || row.route_name}</span>
                  {row.status ? <Badge tone={row.status === 'published' ? 'success' : 'warning'}>{row.status}</Badge> : null}
                  {row.is_official === false ? <Badge>community submitted</Badge> : null}
                  {row.category || row.type || row.entry_type ? <Badge>{row.category || row.type || row.entry_type}</Badge> : null}
                  <span className="text-2xs text-muted">
                    {row.published_at ? `Published ${relativeTime(row.published_at)}` : `Created ${relativeTime(row.created_at)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {contentTable === 'official_resources' || contentTable === 'opportunities' ? (
            <Notice tone="neutral" icon="flag">
              Community submissions of resources and opportunities are reviewed by an operator: the client roles
              have no UPDATE grant on their <code>status</code> column, so approval runs through the SQL in
              docs/DEPLOYMENT.md instead of a button that would silently fail.
            </Notice>
          ) : null}
        </section>
      ) : null}

      {/* ----------------------------------------------------------------- clubs */}
      {activeTab === 'clubs' ? (
        <section aria-label="Club requests and administrator assignments" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Club governance</h2>
              <p className="mt-1 text-[0.8125rem] text-muted">Review requests, assign real initial administrators, and preserve club-scoped ownership.</p>
            </div>
            <LinkButton href={ROUTES.clubNew} size="sm" variant="secondary" icon="plus">Create with an administrator</LinkButton>
          </div>
          <Notice tone="neutral" icon="lock">
            Approval is atomic and retry-safe. A club owner or moderator manages only that club; no platform role is granted here.
          </Notice>

          <section className="flex flex-col gap-3" aria-labelledby="pending-club-requests">
            <h3 id="pending-club-requests" className="text-sm font-semibold">Pending club requests ({pendingClubRequests.items.length})</h3>
            {pendingClubRequests.unavailable || clubRequestHistory.unavailable || unassignedClubs.unavailable ? (
              <Notice tone="warning">Some club governance records could not be loaded. Refresh before making a decision.</Notice>
            ) : null}
            {!pendingClubRequests.items.length ? (
              <EmptyState icon="checkCircle" title="No pending club requests" description="New student requests will appear here for review." />
            ) : null}
            {pendingClubRequests.items.map((request) => (
              <Card key={request.id} className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-[0.9375rem] font-semibold">{request.name}</h4>
                    <p className="mt-1 text-2xs text-muted">
                      Requested by {request.requester_display_name || 'Student'}
                      {request.requester_username ? ` (@${request.requester_username})` : ''} · {formatDateTime(request.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>{request.club_category}</Badge>
                    <Badge>{CLUB_ORGANIZATION_TYPE_LABELS[request.organization_type] || request.organization_type}</Badge>
                    <Badge tone="warning">pending</Badge>
                  </div>
                </div>
                <p className="user-text text-[0.8125rem] leading-relaxed text-muted"><LinkifiedText text={request.description} /></p>
                <p className="text-2xs text-muted">Preferred link: <code>{request.slug}</code></p>
                {request.source_url ? (
                  <ExternalLink url={request.source_url} className="text-2xs underline">
                    Source: {request.source_label || request.source_url}
                  </ExternalLink>
                ) : <p className="text-2xs text-muted">No public source supplied. Verification remains pending.</p>}
                <ClubRequestReview request={request} />
              </Card>
            ))}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="unassigned-clubs">
            <h3 id="unassigned-clubs" className="text-sm font-semibold">Administrator assignment needed ({unassignedClubs.items.length})</h3>
            <p className="text-[0.8125rem] text-muted">These real catalogue pages cannot accept join requests until an active owner is assigned.</p>
            {!unassignedClubs.items.length ? (
              <EmptyState icon="users" title="Every visible club has an administrator" description="No imported club is waiting for an initial owner." />
            ) : null}
            {unassignedClubs.items.map((club) => (
              <details key={club.id} className="card p-4">
                <summary className="cursor-pointer text-[0.875rem] font-medium">
                  {club.name} <span className="font-normal text-muted">· {club.club_category || 'Club'} · assign initial admin</span>
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  <p className="text-2xs text-muted">
                    {club.source_label ? `Source: ${club.source_label}` : 'Public source pending'} · {club.verification_status === 'source_checked' ? 'Source checked' : 'Verification pending'}
                  </p>
                  <AssignClubAdminForm club={club} />
                </div>
              </details>
            ))}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="club-request-history">
            <h3 id="club-request-history" className="text-sm font-semibold">Recent request history</h3>
            {clubRequestHistory.items.filter((request) => request.status !== 'pending').slice(0, 15).map((request) => (
              <Card key={request.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="text-[0.8125rem] font-medium">{request.name}</span>
                <Badge tone={request.status === 'approved' ? 'success' : request.status === 'rejected' ? 'danger' : 'neutral'}>{request.status}</Badge>
                <span className="w-full text-2xs text-muted">
                  {request.reviewed_at ? formatDateTime(request.reviewed_at) : formatDateTime(request.updated_at)}
                  {request.reviewer_username ? ` · reviewed by @${request.reviewer_username}` : ''}
                  {request.community_id ? <> · <Link href={ROUTES.club(request.community_id)} className="underline">Open club</Link></> : null}
                </span>
              </Card>
            ))}
          </section>
        </section>
      ) : null}

      {/* ---------------------------------------------------------- marketplace */}
      {activeTab === 'marketplace' ? (
        <section aria-label="Marketplace" className="flex flex-col gap-3">
          <Notice tone="neutral" icon="flag">
            Review, approve, hide, restore and remove listings on the moderation surface — the audit trail lives there.
          </Notice>
          <LinkButton href={`${ROUTES.moderator}?tab=marketplace`} size="sm">Open marketplace moderation</LinkButton>
          {marketplace && (marketplace.items.length ? (
            <ul className="flex flex-col gap-2">
              {marketplace.items.map((row) => (
                <li key={row.id} className="card flex flex-wrap items-center gap-2 p-3">
                  <span className="text-[0.875rem] font-medium">{row.title}</span>
                  {row.status ? <Badge tone={row.status === 'active' ? 'success' : 'warning'}>{row.status}</Badge> : null}
                  <span className="text-2xs text-muted">{relativeTime(row.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="tag" title="No listings yet" description="Nothing has been listed on the marketplace." />
          ))}
        </section>
      ) : null}

      {/* --------------------------------------------------------------- events */}
      {activeTab === 'events' ? (
        <section aria-label="Events" className="flex flex-col gap-3">
          <ActionForm
            action={saveEvent}
            submitLabel="Publish event"
            pendingLabel="Publishing…"
            successMessage="Event saved."
            resetOnSuccess
            fields={[
              { name: 'title', label: 'Title', required: true, maxLength: 140 },
              { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: 2000 },
              { name: 'starts_on', label: 'Date', type: 'date', required: true },
              { name: 'ends_on', label: 'Ends on', type: 'date' },
              { name: 'start_time', label: 'Start time', type: 'time' },
              { name: 'end_time', label: 'End time', type: 'time' },
              { name: 'location', label: 'Location', required: true, maxLength: 140 },
              { name: 'organizer', label: 'Organizer', maxLength: 120 },
              { name: 'capacity', label: 'Capacity', type: 'number', min: 1, max: 100000 },
              { name: 'registration_info', label: 'Registration details', type: 'textarea', maxLength: 500 },
              { name: 'registration_url', label: 'Registration link', placeholder: 'https://…' },
              { name: 'show_attendees', label: 'Show the attendee list to students', type: 'checkbox', defaultChecked: true },
              {
                name: 'status',
                label: 'Status',
                type: 'select',
                defaultValue: 'published',
                options: [
                  { value: 'published', label: 'Published' },
                  { value: 'draft', label: 'Draft' },
                  { value: 'cancelled', label: 'Cancelled' },
                  { value: 'completed', label: 'Completed' },
                ],
              },
            ]}
          />
          {events && (events.items.length ? (
            <ul className="flex flex-col gap-2">
              {events.items.map((row) => (
                <li key={row.id} className="card flex flex-wrap items-center gap-2 p-3">
                  <Link href={ROUTES.event(row.id)} className="text-[0.875rem] font-medium underline-offset-2 hover:underline">
                    {row.title}
                  </Link>
                  {row.status ? <Badge tone={row.status === 'published' ? 'success' : 'warning'}>{row.status}</Badge> : null}
                  <span className="text-2xs text-muted">
                    {row.starts_on} {row.start_time || ''} {row.location ? `· ${row.location}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="calendar" title="No events yet" description="Publish the first campus event with the form above." />
          ))}
        </section>
      ) : null}

      {/* ------------------------------------------------------------- settings */}
      {activeTab === 'settings' ? (
        <section aria-label="Platform settings" className="flex flex-col gap-3">
          <Notice tone="neutral" icon="flag">
            Values are JSON. Every change is written through <code>admin_set_platform_setting()</code> and audited.
          </Notice>
          {[...settingsByGroup.entries()].map(([group, rows]) => (
            <Card key={group} className="flex flex-col gap-3 p-4">
              <h2 className="text-[0.875rem] font-semibold capitalize">{group.replace(/_/g, ' ')}</h2>
              {rows.map((setting) => (
                <div key={setting.key} className="border-t border-line pt-3">
                  <PlatformSettingForm settingKey={setting.key} value={setting.value} description={setting.description} />
                  <p className="mt-1 text-2xs text-muted">
                    {setting.is_public ? 'Public value' : 'Private value'} · updated {relativeTime(setting.updated_at)}
                  </p>
                </div>
              ))}
            </Card>
          ))}
          {settings.length === 0 ? (
            <EmptyState icon="settings" title="No settings rows" description="The platform settings table is empty." />
          ) : null}
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- flags */}
      {activeTab === 'flags' ? (
        <section aria-label="Feature flags" className="flex flex-col gap-3">
          {[...flagsByGroup.entries()].map(([group, rows]) => (
            <Card key={group} className="flex flex-col gap-3 p-4">
              <h2 className="text-[0.875rem] font-semibold capitalize">{group.replace(/_/g, ' ')}</h2>
              {rows.map((flag) => (
                <div key={flag.key} className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
                  <div className="min-w-0">
                    <p className="text-[0.8125rem] font-medium">{flag.label || flag.key}</p>
                    {flag.description ? <p className="text-2xs text-muted">{flag.description}</p> : null}
                    <p className="font-mono text-2xs text-muted">{flag.key}</p>
                  </div>
                  <FeatureFlagToggle flagKey={flag.key} enabled={flag.enabled} />
                </div>
              ))}
            </Card>
          ))}
          {flags.length === 0 ? (
            <EmptyState icon="flag" title="No feature flags" description="The feature flags table is empty." />
          ) : null}
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- audit */}
      {activeTab === 'audit' ? (
        <section aria-label="Audit logs" className="flex flex-col gap-3">
          {audit.length === 0 ? (
            <EmptyState icon="history" title="No audit entries" description="Staff actions appear here as they happen." />
          ) : (
            <ul className="flex flex-col gap-2">
              {audit.map((entry) => (
                <li key={entry.id} className="card flex flex-wrap items-center gap-2 p-3">
                  <span className="font-mono text-2xs text-muted">{entry.action}</span>
                  <Badge>{entry.target_type ? entry.target_type.replace(/_/g, ' ') : 'system'}</Badge>
                  {entry.visibility === 'sensitive' ? <Badge tone="danger">sensitive</Badge> : null}
                  <span className="text-2xs text-muted">
                    {entry.actor_username ? `@${entry.actor_username}` : 'system'} · {formatDateTime(entry.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <nav className="flex items-center justify-between text-2xs text-muted" aria-label="Audit pages">
            {offset > 0 ? (
              <Link className="underline" href={`${ROUTES.admin}?tab=audit&offset=${Math.max(0, offset - 40)}`}>Newer</Link>
            ) : <span />}
            <span>Showing {offset + 1}–{offset + audit.length}</span>
            {audit.length === 40 ? (
              <Link className="underline" href={`${ROUTES.admin}?tab=audit&offset=${offset + 40}`}>Older</Link>
            ) : <span />}
          </nav>
        </section>
      ) : null}

      {/* -------------------------------------------------------------- backups */}
      {activeTab === 'backups' && backups ? (
        <section aria-label="Encrypted Drive backups" className="flex flex-col gap-3">
          {params?.backup_notice === 'connected' ? (
            <Notice tone="success" icon="checkCircle">Google Drive connected. The private folder is ready for encrypted exports.</Notice>
          ) : null}
          {params?.backup_error ? (
            <Notice tone="danger" icon="flag">
              Drive connection failed ({String(params.backup_error).slice(0, 40)}). Check the registered callback URL and server logs.
            </Notice>
          ) : null}
          {backups.unavailable ? (
            <Notice tone="warning" icon="flag">Backup status could not be loaded. Apply migration 027 and check the server configuration.</Notice>
          ) : null}

          <Notice tone="neutral" icon="lock">
            Supabase Postgres is the only primary database. Drive is written by a background worker, never during a student request, and is never read per record as a fallback.
          </Notice>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-3">
              <p className="t-label">Connection</p>
              <p className="mt-1 text-[0.875rem] font-medium">{backups.connection?.status || 'not connected'}</p>
              <p className="text-2xs text-muted">{backups.connection?.account_label || 'No Drive account'}</p>
            </Card>
            <Card className="p-3">
              <p className="t-label">Last successful export</p>
              <p className="mt-1 text-[0.875rem] font-medium">
                {backups.checkpoint?.last_success_at ? formatDateTime(backups.checkpoint.last_success_at) : 'Never'}
              </p>
              <p className="text-2xs text-muted">Verified change #{backups.checkpoint?.last_change_id ?? 0}</p>
            </Card>
            <Card className="p-3">
              <p className="t-label">Queue depth</p>
              <p className="t-section t-numeric mt-1">{backups.queue_depth ?? 0}</p>
              <p className="text-2xs text-muted">
                {backups.oldest_pending_at ? `oldest ${relativeTime(backups.oldest_pending_at)}` : 'nothing pending'}
              </p>
            </Card>
            <Card className="p-3">
              <p className="t-label">Errors / jobs</p>
              <p className="t-section t-numeric mt-1">{backups.failed_batches ?? 0}</p>
              <p className="text-2xs text-muted">{backups.pending_jobs ?? 0} queued job(s)</p>
            </Card>
          </div>

          {backups.admin?.unavailable ? (
            <Notice tone="warning" icon="flag">
              Live job state is unavailable. Apply migration 028 to enable admin-triggered processing, job states and run history.
            </Notice>
          ) : null}

          <Card className="flex flex-col gap-3 p-4">
            <h2 className="t-card">Queue states</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Queued', backups.admin?.jobs?.queued ?? 0, 'neutral', 'waiting for a run'],
                ['Processing', backups.admin?.jobs?.processing ?? 0, 'accent', 'lease held by a run'],
                ['Verified', backups.admin?.jobs?.verified ?? 0, 'success', 'jobs closed by a run'],
                ['Failed', backups.admin?.jobs?.failed ?? 0, 'danger', 'see errors below'],
              ].map(([label, count, tone, caption]) => (
                <div key={label} className="rounded-[var(--radius-md)] border border-line p-2">
                  <p className="t-label">{label}</p>
                  <p className="t-section t-numeric mt-1">{count}</p>
                  <Badge tone={tone}>{label.toLowerCase()}</Badge>
                  <p className="mt-1 text-2xs text-muted">{caption}</p>
                </div>
              ))}
            </div>
            <p className="text-2xs text-muted">
              A closed job either uploaded a verified object or found nothing
              left to export; the run results below show what actually reached
              Drive. {backups.admin?.batches?.uploading ?? 0} batch(es) uploading ·{' '}
              {backups.admin?.batches?.retry_waiting ?? 0} waiting for automatic retry ·{' '}
              {backups.admin?.jobs_by_kind?.incremental?.queued ?? 0} incremental job(s) and{' '}
              {backups.admin?.jobs_by_kind?.snapshot?.queued ?? 0} snapshot job(s) queued.
            </p>
            {backups.admin?.active ? (
              <Notice tone="warning" icon="clock">A backup run is currently processing. Buttons are disabled until it finishes or its lease expires.</Notice>
            ) : null}
            {backups.admin?.batches?.next_retry_at ? (
              <p className="text-2xs text-muted">Next automatic retry: {formatDateTime(backups.admin.batches.next_retry_at)}.</p>
            ) : null}
          </Card>

          <Card className="flex flex-col gap-3 p-4">
            <h2 className="t-card">Authorized actions</h2>
            <p className="text-2xs text-muted">
              These buttons PROCESS eligible queued work now, in bounded batches, on the server. They do not enqueue another job. Each object is encrypted, uploaded to the restricted Drive folder and re-downloaded for SHA-256 verification before anything is marked successful. A failed batch keeps its backoff and leaves untouched jobs queued.
            </p>
            <BackupActionButtons connected={backups.connection?.status === 'active'} admin={backups.admin} />
            <p className="font-mono text-2xs text-muted">Callback: {PRODUCTION_DRIVE_REDIRECT_URI}</p>
          </Card>

          <Card className="flex flex-col gap-2 p-4">
            <h2 className="t-card">Recent runs and jobs</h2>
            {(backups.admin?.last_runs?.length || 0) === 0 && (backups.admin?.recent_jobs?.length || 0) === 0 ? (
              <p className="text-2xs text-muted">No runs recorded yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {(backups.admin?.last_runs || []).slice(0, 5).map((run) => (
                  <li key={run.id || `${run.kind}-${run.created_at}`} className="flex flex-wrap items-center gap-2 border-t border-line pt-1.5 text-2xs">
                    <Badge tone={run.status === 'verified' || run.status === 'drained' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'}>{run.status}</Badge>
                    <span className="font-mono">{run.kind}</span>
                    <span className="text-muted">
                      {formatDateTime(run.created_at)}
                      {run.record?.verified ? ` · ${run.record.verified} verified` : ''}
                      {run.record?.failed ? ` · ${run.record.failed} failed` : ''}
                    </span>
                    {run.record?.diagnostics?.length ? (
                      <span className="w-full text-muted">[{run.record.diagnostics.map((entry) => entry.code).join(', ')}]</span>
                    ) : null}
                  </li>
                ))}
                {(backups.admin?.recent_jobs || []).slice(0, 8).map((job) => (
                  <li key={job.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-1.5 text-2xs">
                    <Badge tone={job.status === 'done' ? 'success' : job.status === 'failed' ? 'danger' : job.status === 'running' ? 'accent' : 'warning'}>
                      {job.status === 'done' ? 'verified' : job.status === 'running' ? 'processing' : job.status}
                    </Badge>
                    <span className="font-mono">{job.kind}</span>
                    <span className="text-muted">{formatDateTime(job.created_at)}{job.last_error ? ` · ${String(job.last_error).slice(0, 120)}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-2 p-4">
            <h2 className="t-card">Errors and authorized retries</h2>
            {backups.errors.length === 0 ? (
              <p className="text-2xs text-muted">No failed batches.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {backups.errors.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
                    <span className="min-w-0 text-2xs text-muted">
                      <span className="font-mono">{entry.range_key}</span> · attempt {entry.attempt_count} · {formatDateTime(entry.updated_at)}
                      <br />{entry.last_error || 'unknown error'}
                    </span>
                    <RetryBackupButton batchId={entry.id} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-2 p-4">
            <h2 className="t-card">Backup history</h2>
            {backups.history.length === 0 ? (
              <p className="text-2xs text-muted">No verified exports yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {backups.history.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-1.5 text-2xs">
                    <Badge tone={entry.verified_at ? 'success' : 'warning'}>{entry.verified_at ? 'verified' : 'failed'}</Badge>
                    <span className="font-mono">{entry.range_key}</span>
                    <span className="text-muted">
                      {entry.verified_at ? formatDateTime(entry.verified_at) : formatDateTime(entry.updated_at || entry.created_at)}
                      {entry.byte_size ? ` · ${Math.round(entry.byte_size / 1024)} KB encrypted` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-2 p-4">
            <h2 className="t-card">Full snapshots</h2>
            {backups.snapshots.length === 0 ? (
              <p className="text-2xs text-muted">No full snapshot has been verified yet. Incremental exports alone are not a complete restore base.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {backups.snapshots.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2 border-t border-line pt-1.5 text-2xs">
                    <Badge tone={entry.status === 'verified' ? 'success' : 'warning'}>{entry.status}</Badge>
                    <span className="font-mono">watermark #{entry.watermark}</span>
                    <span className="text-muted">
                      {entry.verified_at ? formatDateTime(entry.verified_at) : formatDateTime(entry.created_at)}
                      {entry.byte_size ? ` · ${Math.round(entry.byte_size / 1024)} KB encrypted` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-2 p-4">
            <h2 className="t-card">Server configuration (presence only)</h2>
            <ul className="flex flex-col gap-1">
              {backupConfig.map((item) => (
                <li key={item.key} className="flex flex-wrap items-center gap-2 text-2xs">
                  <Badge tone={item.configured ? 'success' : 'warning'}>{item.configured ? 'set' : 'missing'}</Badge>
                  <span className="font-mono">{item.key}</span>
                  <span className="text-muted">{item.note}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Notice tone="warning" icon="flag">
            {DISASTER_RECOVERY_NOTICE}
          </Notice>
        </section>
      ) : null}

      {/* --------------------------------------------------------------- counts */}
      {activeTab === 'counts' && counts ? (
        <section aria-label="Operational counts" className="flex flex-col gap-3">
          <Notice tone="neutral" icon="flag">
            Real row counts only. Campus+ has no analytics product and does not invent statistics.
          </Notice>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Object.entries(counts.counts).map(([table, value]) => (
              <Card key={table} className="p-3">
                <p className="t-label">{COUNT_LABELS[table] || table}</p>
                <p className="t-section t-numeric mt-1">{value}</p>
              </Card>
            ))}
          </div>
          {overview ? (
            <Card className="flex flex-col gap-2 p-4">
              <h2 className="t-card">Queue health</h2>
              <p className="text-2xs text-muted">
                {overview.pendingReports} pending reports · {overview.pendingListings} listings awaiting approval ·{' '}
                {overview.suspended} suspended accounts · {overview.disabledFlags} disabled feature flags
              </p>
              <p className="text-2xs text-muted">
                Daily active users are not tracked: Campus+ stores no analytics or presence data.
              </p>
            </Card>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
