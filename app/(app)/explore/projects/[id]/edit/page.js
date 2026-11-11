import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { UUID_REGEX } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { updateOwnCampusBoard } from '@/lib/actions/campus-board';

export const metadata = { title: 'Edit project' };
export default async function EditPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();
  const user = await requireUser();
  const db = await getServerClient();
  const { data: record, error } = await db.from('projects').select('*').eq('id', id).eq('creator_id', user.profile.id).maybeSingle();
  if (error || !record) notFound();
  return <div className="flex flex-col gap-4">
    <PageHeader title="Edit project" back={{ href: '/explore/projects', label: 'Project' }} />
    {record.status !== 'published' ? <Notice tone="warning" icon="flag">Editing does not change this post’s moderation status.</Notice> : null}
    <ActionForm action={updateOwnCampusBoard} hidden={{ id, type: 'projects' }} submitLabel="Save changes" cancelHref="/explore/projects" resetOnSuccess={false} fields={[
          { name: 'title', label: 'Title', type: 'text', defaultValue: record.title ?? '', maxLength: 140, required: true },
          { name: 'description', label: 'What does it do?', type: 'textarea', defaultValue: record.description ?? '', maxLength: 2000, required: true },
          { name: 'technologies', label: 'Built with', type: 'text', defaultValue: record.technologies ?? '', maxLength: 300, required: true },
          { name: 'repo_url', label: 'Repository', type: 'text', defaultValue: record.repo_url ?? '' },
          { name: 'live_url', label: 'Live demo', type: 'text', defaultValue: record.live_url ?? '' },
          { name: 'team_members', label: 'Team', type: 'text', defaultValue: record.team_members ?? '', maxLength: 300 },
    ]} />
  </div>;
}
