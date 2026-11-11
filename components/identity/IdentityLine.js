import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/constants';
import { IdentityMark, StaffDot } from '@/components/ui';
import { relativeTime } from '@/lib/utils';

/**
 * The single identity line used everywhere a person is shown.
 *
 * A same-origin profile photo is shown when available, otherwise initials. The staff marker comes from `public_profiles.is_staff`; students show
 * nothing at all. There is intentionally no online/presence indicator.
 */
export function IdentityLine({
  username,
  displayName = null,
  isStaff = false,
  size = 'md',
  timestamp = null,
  linkToProfile = true,
  className = '',
  badge = null,
}) {
  const name = displayName || (username ? `@${username}` : 'Unknown');
  const pixels = size === 'sm' ? 24 : size === 'lg' ? 40 : 32;

  const body = (
    <>
      <IdentityMark name={name} username={username} size={pixels} square={size === 'lg'} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate font-semibold text-ink', size === 'sm' ? 'text-[0.8125rem]' : 'text-[0.875rem]')}>
            {name}
          </span>
          {isStaff ? <StaffDot label={isStaff === true ? 'Staff member' : isStaff} /> : null}
          {badge}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted">
          {username ? <span className="truncate">@{username}</span> : null}
          {timestamp ? <span aria-hidden="true">·</span> : null}
          {timestamp ? <time dateTime={timestamp}>{relativeTime(timestamp)}</time> : null}
        </span>
      </span>
    </>
  );

  if (linkToProfile && username) {
    return (
      <Link href={ROUTES.user(username)} className={cn('flex min-w-0 items-center gap-2.5 hover:no-underline', className)}>
        {body}
      </Link>
    );
  }
  return <div className={cn('flex min-w-0 items-center gap-2.5', className)}>{body}</div>;
}

/** Small role label shown on staff profiles ("Moderator", "Admin"). */
export function RoleLabel({ role, className = '' }) {
  const labels = {
    moderator: 'Moderator',
    admin: 'Administrator',
    super_admin: 'Super Admin',
  };
  if (!labels[role]) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-2xs font-semibold text-muted',
        className,
      )}
    >
      {labels[role]}
    </span>
  );
}
