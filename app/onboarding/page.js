import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/config';
import { OnboardingForm } from '@/components/auth/OnboardingForm';
import '@/app/styles/login.css';
import '@/app/styles/onboarding.css';

export const metadata = { title: 'Set up your profile' };

export default async function OnboardingPage() {
  if (!isSupabaseConfigured()) redirect('/setup');
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.needsProfileSetup) redirect('/home');
  // The account type decides which questions are asked: an external account is
  // never shown the institutional ones (and the database refuses to store them).
  return <OnboardingForm storageId={user.profile?.id || user.id} accountType={user.accountType} />;
}
