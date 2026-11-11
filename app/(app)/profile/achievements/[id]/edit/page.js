import { AchievementGallery } from '@/components/campus/AchievementGallery';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { UUID_REGEX } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { AchievementForm } from '@/components/profile/AchievementForm';
export const metadata = { title: 'Edit achievement' };
export default async function EditAchievement({ params }) {
  const { id } = await params; if (!UUID_REGEX.test(id)) notFound();
  const user = await requireUser(); const db = await getServerClient();
  const { data: item, error } = await db.from('profile_achievements').select('id,title,description,category,achieved_on,status').eq('id', id).eq('owner_id', user.profile.id).maybeSingle();
  if (error || !item) notFound();
  return <div className="flex flex-col gap-4"><PageHeader title="Edit achievement" back={{ href: '/profile', label: 'Profile' }} />{item.status !== 'published' ? <Notice tone="warning">Editing does not change moderation status.</Notice> : null}<AchievementGallery postId={id} manage username={user.profile.username} /><AchievementForm item={item} /></div>;
}
