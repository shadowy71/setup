import { getCurrentUser } from '@/lib/auth/session';
import { ClassReminderPopup } from '@/components/reminders/ClassReminderPopup';

/** Keep the controller mounted even when preference/division changes later. */
export async function ClassReminderHost() {
  const user = await getCurrentUser();
  if (!user?.profile?.id) return null;
  return <ClassReminderPopup key={user.profile.id} profileId={user.profile.id} />;
}
