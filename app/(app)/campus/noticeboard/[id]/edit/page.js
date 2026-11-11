import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { UUID_REGEX } from '@/lib/constants';
import { PageHeader } from '@/components/ui';
import { NoticeForm } from '@/components/campus/NoticeForm';
export const metadata = { title: 'Edit notice' };
export default async function EditNotice({ params }) {
  const { id } = await params; if (!UUID_REGEX.test(id)) notFound();
  const user = await requireUser(); if (!can(toActor(user), 'manage_notices')) notFound();
  const db = await getServerClient(); const { data: notice, error } = await db.from('notices').select('id,title,body,category,importance,pinned,expires_at,status').eq('id', id).maybeSingle();
  if (error || !notice) notFound();
  return <div className="flex flex-col gap-4"><PageHeader title="Edit notice" back={{ href: '/campus/noticeboard/manage', label: 'Manage notices' }} /><NoticeForm notice={notice} /></div>;
}
