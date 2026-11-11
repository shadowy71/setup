import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { PageHeader, Notice } from '@/components/ui';
import { NoticeForm } from '@/components/campus/NoticeForm';
export const metadata = { title: 'New notice' };
export default async function NewNotice() {
  const user = await requireUser();
  if (!can(toActor(user), 'manage_notices')) return <Notice tone="warning">You cannot manage notices.</Notice>;
  return <div className="flex flex-col gap-4"><PageHeader title="New notice" back={{ href: '/campus/noticeboard/manage', label: 'Manage notices' }} /><NoticeForm /></div>;
}
