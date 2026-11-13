import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/config';
import { ROUTES } from '@/lib/constants';

/**
 * Root route (spec §5).
 *
 * No marketing page: unauthenticated visitors go to sign-in, configured
 * deployments with a session go straight to Home, and an unconfigured
 * deployment explains what is missing instead of crashing.
 */
export default async function RootPage() {
  if (!isSupabaseConfigured()) {
    // Show the existing, clearly labelled sample-data shell in local previews.
    if (process.env.NODE_ENV === 'development') redirect('/home-preview');
    redirect('/setup');
  }

  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.needsProfileSetup) redirect('/onboarding');
  redirect(ROUTES.home);
}
