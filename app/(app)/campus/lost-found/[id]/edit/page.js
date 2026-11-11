import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { UUID_REGEX } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { updateOwnCampusBoard } from '@/lib/actions/campus-board';

export const metadata = { title: 'Edit item report' };
export default async function EditReport({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();
  const user = await requireUser();
  const db = await getServerClient();
  const { data: item, error } = await db.from('lost_found').select('id,creator_id,kind,title,description,location,occurred_on,status').eq('id', id).eq('creator_id', user.profile.id).maybeSingle();
  if (error || !item) notFound();
  return <div className="flex flex-col gap-4">
    <PageHeader title="Edit item report" back={{ href: `/campus/lost-found/${id}`, label: 'Report' }} />
    {item.status !== 'published' ? <Notice tone="warning">Editing does not change moderation status.</Notice> : null}
    <ActionForm action={updateOwnCampusBoard} hidden={{ id, type: 'lostfound', kind: item.kind }} resetOnSuccess={false} cancelHref={`/campus/lost-found/${id}`} fields={[
      { name: 'title', label: 'Item', required: true, maxLength: 140, defaultValue: item.title },
      { name: 'description', label: 'Details', type: 'textarea', required: true, maxLength: 1000, defaultValue: item.description },
      { name: 'location', label: 'Where', maxLength: 120, defaultValue: item.location || '' },
      { name: 'occurred_on', label: 'Date', type: 'date', defaultValue: item.occurred_on || '' },
    ]} />
  </div>;
}
