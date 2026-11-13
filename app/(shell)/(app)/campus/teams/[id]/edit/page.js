import { TeamGallery } from '@/components/campus/TeamGallery';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { UUID_REGEX } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { updateOwnCampusBoard } from '@/lib/actions/campus-board';

export const metadata = { title: 'Edit team request' };
export default async function EditTeam({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();
  const user = await requireUser();
  const db = await getServerClient();
  const { data: team, error } = await db.from('team_posts').select('id,creator_id,project_name,description,required_skills,team_size,deadline,status,project_id').eq('id', id).eq('creator_id', user.profile.id).maybeSingle();
  if (error || !team) notFound();
  const { data: projects } = await db.from('projects').select('id,title').eq('creator_id', user.profile.id).eq('status', 'published').order('title').limit(100);
  const options = (projects || []).map((project) => ({ value: project.id, label: project.title }));
  if (team.project_id && !options.some((project) => project.value === team.project_id)) options.push({ value: team.project_id, label: 'Keep current project' });
  return <div className="flex flex-col gap-4">
    <PageHeader title="Edit team request" back={{ href: `/campus/teams/${id}`, label: 'Team request' }} />
    {team.status !== 'published' ? <Notice tone="warning">Editing does not change moderation status.</Notice> : null}
    <TeamGallery postId={id} manage username={user.profile.username} />
    <ActionForm action={updateOwnCampusBoard} hidden={{ id, type: 'teams' }} resetOnSuccess={false} cancelHref={`/campus/teams/${id}`} fields={[
      { name: 'project_id', label: 'Your published project (optional)', type: 'select', defaultValue: team.project_id || '', options },
      { name: 'project_name', label: 'Project or hackathon', required: true, maxLength: 140, defaultValue: team.project_name },
      { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: 1500, defaultValue: team.description },
      { name: 'required_skills', label: 'Required skills', required: true, maxLength: 300, defaultValue: team.required_skills },
      { name: 'team_size', label: 'Team size', type: 'number', min: 1, max: 50, defaultValue: team.team_size ?? '' },
      { name: 'deadline', label: 'Deadline', type: 'date', defaultValue: team.deadline || '' },
    ]} />
  </div>;
}
