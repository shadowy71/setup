import { getCurrentUser, BLOCKED_STATUSES } from '@/lib/auth/session';
import AppLayout from '@/app/(app)/layout';
import { AppShell } from '@/components/layout/AppShell';

/** Shared chrome for public routes without changing their anonymous access. */
export async function OptionalAppFrame({ children }) {
  const user = await getCurrentUser();
  if (user?.profile && !user.needsProfileSetup && !BLOCKED_STATUSES.includes(user.accountStatus)) {
    return <AppLayout>{children}</AppLayout>;
  }
  return <AppShell>{children}</AppShell>;
}
