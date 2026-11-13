import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { PageHeader, Notice } from '@/components/ui';
import { AchievementForm } from '@/components/profile/AchievementForm';
export const metadata = { title: 'Add achievement' };
export default async function NewAchievement() {
  const user = await requireUser(); const db = await getServerClient();
  const flag = await db.rpc('feature_enabled', { p_key: 'achievements' });
  if (flag.error || flag.data !== true) notFound();
  return <div className="flex flex-col gap-4"><PageHeader title="Add achievement" back={{ href: '/profile', label: 'Profile' }} /><Notice tone="neutral">This will be shown as a self-reported achievement to signed-in students.</Notice><AchievementForm username={user.profile.username} /></div>;
}
