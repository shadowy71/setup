import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/config';
import { Icon } from '@/components/ui/icons';
import { PublicShell } from '@/components/layout/PublicShell';
import { OnboardingForm } from '@/components/auth/OnboardingForm';
import { OnboardingIntro } from '@/components/auth/OnboardingIntro';
import styles from '@/components/auth/OnboardingIntro.module.css';

export const metadata = { title: 'Set up your profile' };

/**
 * First login (spec §8): pick a username and fill in the public profile.
 *
 * Only fields the schema actually stores are asked for. No PRN and no password,
 * and no email to confirm — Google already proved the address.
 */
export default async function OnboardingPage() {
  if (!isSupabaseConfigured()) redirect('/setup');

  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.needsProfileSetup) redirect('/home');

  return (
    <main className={styles.page}>
      <PublicShell width="lg">
        <section className={styles.profile} aria-labelledby="profile-heading">
          <h1 id="profile-heading">Make yourself at home</h1>
          <p className={styles.profileCopy}>
            Start with your profile. Your public username is how students find and mention you.
            Your email stays private from other students.
          </p>
          <div className="card p-4 sm:p-5">
            <OnboardingForm />
          </div>
        </section>

        <ul className="mt-7 flex flex-col gap-2.5 text-[0.8125rem] text-muted">
          <li className="flex items-start gap-2">
            <Icon name="user" size={16} className="mt-0.5 shrink-0" />
            Usernames use lowercase letters, numbers and underscores (3–24 characters).
          </li>
          <li className="flex items-start gap-2">
            <Icon name="settings" size={16} className="mt-0.5 shrink-0" />
            You can change it later from Settings, subject to the platform cooldown.
          </li>
        </ul>
        <OnboardingIntro />
      </PublicShell>
    </main>
  );
}
