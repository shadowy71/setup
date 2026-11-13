import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { listBlockedUsers } from '@/lib/blocks';
import { ROUTES, BRANCHES, YEARS, DIVISIONS, LIMITS, DEFAULT_PLATFORM_SETTINGS } from '@/lib/constants';
import { Button, Card, EmptyState, LinkButton, Notice, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { ProfileActions } from '@/components/profile/ProfileActions';
import { FileUpload } from '@/components/storage/FileUpload';
import { updateProfile, changeUsername, deactivateAccount, reactivateAccount } from '@/lib/actions/profile';
import { markAllNotificationsRead } from '@/lib/actions/notifications';
import { formatDate, daysBetween } from '@/lib/utils';

export const metadata = { title: 'Settings' };

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'username', label: 'Username' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'privacy', label: 'Privacy' },
  { key: 'blocked', label: 'Blocked users' },
  { key: 'account', label: 'Account' },
];

/**
 * Settings (spec §49).
 *
 * Profile, username, privacy, blocked users and account state — the preferences
 * that actually exist in the database. Notification controls are limited to
 * what the platform really does (in-app notifications, mark all read,
 * per-thread mute in chat); nothing here pretends to send email or push, and
 * no preference is stored that the system would not honour.
 */
export default async function SettingsPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const params = await searchParams;
  const tab = TABS.some((item) => item.key === params?.tab) ? params.tab : 'profile';

  // The session load already read this row (see lib/auth/session.js) — no second read.
  const profile = user.profile;
  const storageUsage = tab === 'profile' ? await supabase.rpc('storage_account_usage', { p_user: profile.id }) : null;
  const uploadEnabled = !storageUsage?.error && Boolean(storageUsage?.data?.[0]?.upload_enabled);
  const uploadAvailable = process.env.CAMPUS_PROFILE_UPLOADS_ENABLED === '1' && !storageUsage?.error;
  const blocked =
    tab === 'blocked' ? await listBlockedUsers(supabase, user.profile.id, { limit: 100 }) : [];

  // The cooldown is a platform setting (staff-readable); students see the
  // configured value when it is public, otherwise the documented default.
  const { data: cooldownSetting } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'username_change_cooldown_days')
    .maybeSingle();
  const configuredCooldown = Number(cooldownSetting?.value);
  const cooldownDays = Number.isFinite(configuredCooldown) && configuredCooldown > 0
    ? configuredCooldown
    : DEFAULT_PLATFORM_SETTINGS.username_change_cooldown_days;

  const usernameChangedAt = user.profile.username_changed_at || null;
  const daysSinceChange = usernameChangedAt ? daysBetween(usernameChangedAt) : null;
  const cooldownRemaining = daysSinceChange !== null ? Math.max(0, cooldownDays - daysSinceChange) : 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Settings"
        description={`Signed in as @${profile.username}`}
        action={<SignOutButton />}
      />

      <Card className="flex flex-wrap gap-1.5 p-3">
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={`${ROUTES.settings}?tab=${item.key}`}
            aria-current={tab === item.key ? 'page' : undefined}
            data-active={tab === item.key}
            className="chip"
          >
            {item.label}
          </Link>
        ))}
      </Card>

      {tab === 'profile' ? (
        <>
        <FileUpload username={profile.username} name={profile.display_name || profile.username} enabled={uploadEnabled} available={uploadAvailable} />
        <ActionForm
          action={updateProfile}
          submitLabel="Save profile"
          successMessage="Profile updated."
          resetOnSuccess={false}
          fields={[
            { name: 'display_name', label: 'Display name', required: true, maxLength: LIMITS.displayName.max, defaultValue: profile.display_name || '' },
            { name: 'bio', label: 'Bio', type: 'textarea', rows: 3, maxLength: LIMITS.bio.max, defaultValue: profile.bio || '', hint: 'Up to 280 characters. No contact details — people can message you here.' },
            { name: 'branch', label: 'Branch', type: 'select', defaultValue: profile.branch || '', options: BRANCHES.map((branch) => ({ value: branch, label: branch })) },
            { name: 'year', label: 'Year', type: 'select', defaultValue: profile.year || '', options: YEARS.map((year) => ({ value: year, label: year })) },
            { name: 'division', label: 'Division', type: 'select', defaultValue: profile.division || '', options: DIVISIONS.map((division) => ({ value: division, label: division })) },
            { name: 'show_branch_year', label: 'Show my branch and year', type: 'switch', hint: 'Visible on your profile and next to your posts.', defaultChecked: profile.show_branch_year !== false },
            { name: 'allow_dms_from_everyone', label: 'Allow any student to message me', type: 'switch', hint: 'Off means only people you have messaged before can start a conversation.', defaultChecked: profile.allow_dms_from_everyone !== false },
          ]}
        />
        </>
      ) : null}

      {tab === 'username' ? (
        <div className="flex flex-col gap-3">
          <Card className="flex flex-col gap-2 p-4">
            <p className="text-[0.8125rem]">
              Your username is your public identity: <strong>@{profile.username}</strong>. Your institutional
              email is never shown to anyone.
            </p>
            <p className="text-2xs text-muted">
              {cooldownRemaining > 0
                ? `You can change it again in ${cooldownRemaining} day${cooldownRemaining === 1 ? '' : 's'}.`
                : `You can change your username about once every ${cooldownDays} days.`}
            </p>
            {usernameChangedAt ? <p className="text-2xs text-muted">Last changed {formatDate(usernameChangedAt)}.</p> : null}
          </Card>
          <ActionForm
            action={changeUsername}
            submitLabel="Change username"
            pendingLabel="Checking…"
            successMessage="Username changed."
            cancelHref={`${ROUTES.settings}?tab=profile`}
            fields={[
              {
                name: 'username',
                label: 'New username',
                required: true,
                maxLength: LIMITS.username.max,
                placeholder: 'lowercase_letters_numbers',
                hint: '3–24 characters: a–z, 0–9 and underscores.',
              },
            ]}
          />
          {cooldownRemaining > 0 ? (
            <Notice tone="warning" icon="clock">
              The cooldown is enforced by the database — an early attempt will be refused there too.
            </Notice>
          ) : null}
        </div>
      ) : null}

      {tab === 'notifications' ? (
        <div className="flex flex-col gap-3">
          <Card className="flex flex-col gap-2 p-4">
            <h2 className="text-sm font-semibold">How Campus+ notifies you</h2>
            <p className="text-[0.8125rem] leading-relaxed text-muted">
              Notifications are in-app only: replies, mentions, messages, marketplace interest, moderation
              outcomes and official updates. Campus+ does not send email or push notifications, so there is
              no preference to configure that the platform would honour.
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <LinkButton href={ROUTES.notifications} size="sm" variant="secondary">
                Open notifications
              </LinkButton>
              <form action={markAllNotificationsRead}>
                <Button type="submit" size="sm" variant="secondary" icon="check">
                  Mark all as read
                </Button>
              </form>
            </div>
          </Card>
          <Card className="flex flex-col gap-2 p-4">
            <h2 className="text-sm font-semibold">Muting</h2>
            <p className="text-[0.8125rem] text-muted">
              Mute any conversation from its thread. Muted conversations stop counting towards your unread
              badge; you can unmute any time.
            </p>
            <LinkButton href={ROUTES.chat} size="sm" variant="secondary">
              Go to messages
            </LinkButton>
          </Card>
        </div>
      ) : null}

      {tab === 'privacy' ? (
        <div className="flex flex-col gap-3">
          <Card className="flex flex-col gap-2 p-4">
            <h2 className="text-sm font-semibold">What other students can see</h2>
            <ul className="flex list-inside list-disc flex-col gap-1 text-[0.8125rem] text-muted">
              <li>Your display name, username and bio.</li>
              <li>
                Your branch and year — currently {profile.show_branch_year === false ? 'hidden' : 'visible'}. Toggle
                this on the Profile tab.
              </li>
              <li>Posts, comments and marketplace listings you publish.</li>
              <li>
                Direct messages from other students — currently{' '}
                {profile.allow_dms_from_everyone === false ? 'restricted' : 'allowed'}. Toggle this on the Profile tab.
              </li>
            </ul>
            <p className="text-2xs text-muted">
              Nobody can see your email, your PRN, your account status or your sessions. Blocks are invisible
              to the person blocked.
            </p>
          </Card>
          <Card className="flex flex-col gap-2 p-4">
            <h2 className="text-sm font-semibold">Blocking</h2>
            <p className="text-[0.8125rem] text-muted">
              Blocking hides you from each other across the feed, search, marketplace and messages. Manage
              your list in the Blocked users tab.
            </p>
            <LinkButton href={`${ROUTES.settings}?tab=blocked`} size="sm" variant="secondary">
              Blocked users
            </LinkButton>
          </Card>
        </div>
      ) : null}

      {tab === 'blocked' ? (
        <div className="flex flex-col gap-3">
          {blocked.length ? (
            <ul className="card divide-y divide-line">
              {blocked.map((person) => (
                <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="min-w-0">
                    <span className="block text-[0.875rem] font-medium">{person.display_name || `@${person.username}`}</span>
                    <span className="block text-2xs text-muted">
                      @{person.username} · blocked {formatDate(person.created_at)}
                      {person.reason ? ` · ${person.reason}` : ''}
                    </span>
                  </span>
                  <ProfileActions
                    profileId={person.id}
                    username={person.username}
                    isBlocked
                    canBlock
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon="lock"
              title="Nobody is blocked"
              description="Blocking someone hides their content from you and yours from them. They are never told."
            />
          )}
        </div>
      ) : null}

      {tab === 'account' ? (
        <div className="flex flex-col gap-3">
          <Card className="flex flex-col gap-2 p-4">
            <h2 className="text-sm font-semibold">Account</h2>
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
              <dd>Status: {user.profile.account_status}</dd>
              <dd>Joined {formatDate(profile.created_at)}</dd>
              <dd>Roles: {(user.roles || ['student']).join(', ')}</dd>
            </dl>
            {user.profile.account_status === 'suspended' ? (
              <Notice tone="warning" icon="clock">
                Your account is suspended{user.profile.suspended_until ? ` until ${formatDate(user.profile.suspended_until)}` : ''}.
                {user.profile.status_reason ? ` Reason: ${user.profile.status_reason}` : ''}
              </Notice>
            ) : null}
          </Card>

          {user.profile.account_status === 'deactivated' ? (
            <ActionForm
              action={reactivateAccount}
              submitLabel="Reactivate my account"
              successMessage="Welcome back."
              cancelHref={ROUTES.profile}
              fields={[]}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <Notice tone="warning" icon="flag">
                Deactivating hides your profile and content from everyone. Your account is not deleted and
                your username stays reserved.
              </Notice>
              <ActionForm
                action={deactivateAccount}
                submitLabel="Deactivate my account"
                pendingLabel="Deactivating…"
                successMessage="Your account is deactivated."
                cancelHref={ROUTES.profile}
                fields={[{ name: 'reason', label: 'Reason (optional)', maxLength: 300 }]}
              />
            </div>
          )}

          <Card className="flex flex-col gap-2 p-4">
            <h2 className="text-sm font-semibold">Session</h2>
            {/* One sign-out control for the whole page — the header action above,
                visible on every tab — not a second button repeated here. */}
            <p className="text-[0.8125rem] text-muted">
              Use <strong>Sign out</strong> at the top of this page any time. Signing out clears this device only.
            </p>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
