import { getServerClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createTeamPost } from '@/lib/actions/campus';

export const metadata = { title: 'Post a team request' };

/** Team finder post (spec §33). Interested students message the creator. */
export default async function NewTeamPage() {
  const user = await requireUser();
  const actor = toActor(user);

  if (!can(actor, 'create_team_posts')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Post a team request" back={{ href: '/campus/teams', label: 'Team finder' }} />
        <Notice tone="warning" icon="lock">Your account cannot post team requests right now.</Notice>
      </div>
    );
  }

  const db = await getServerClient();
  const { data: projects } = await db.from('projects').select('id,title').eq('creator_id', user.profile.id).eq('status', 'published').order('title').limit(100);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Post a team request"
        description="Say what you are building, what you need and when it is due."
        back={{ href: '/campus/teams', label: 'Team finder' }}
      />
      <ActionForm
        action={createTeamPost}
        submitLabel="Publish request"
        successMessage="Published."
        redirectTo="/campus/teams"
        resetOnSuccess={false}
        cancelHref="/campus/teams"
        fields={[
          { name: 'project_id', label: 'Your published project (optional)', type: 'select', options: (projects || []).map((project) => ({ value: project.id, label: project.title })) },
          { name: 'project_name', label: 'Project or competition', required: true, maxLength: 140 },
          { name: 'description', label: 'What are you building?', type: 'textarea', required: true, maxLength: 2000 },
          { name: 'required_skills', label: 'Who are you looking for?', required: true, maxLength: 300, placeholder: 'One designer, one backend dev' },
          { name: 'team_size', label: 'Team size', type: 'number', min: 2, max: 20, step: '1' },
          { name: 'deadline', label: 'Forming by', type: 'date' },
        ]}
      />
    </div>
  );
}
