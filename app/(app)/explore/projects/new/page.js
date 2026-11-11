import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createProject } from '@/lib/actions/campus';

export const metadata = { title: 'Add your project' };

/** Add a project (spec §36). Links must be safe external URLs. */
export default async function NewProjectPage() {
  const user = await requireUser();
  const actor = toActor(user);

  if (!can(actor, 'create_projects')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Add your project" back={{ href: '/explore/projects', label: 'Projects' }} />
        <Notice tone="warning" icon="lock">Your account cannot add projects right now.</Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Add your project"
        description="Tell people what it does and how to see it. Repo and demo links open externally."
        back={{ href: '/explore/projects', label: 'Projects' }}
      />
      <ActionForm
        action={createProject}
        projectAttachments={user.profile.username}
        submitLabel="Publish project"
        successMessage="Published."
        redirectTo="/explore/projects"
        resetOnSuccess={false}
        cancelHref="/explore/projects"
        fields={[
          { name: 'title', label: 'Title', required: true, maxLength: 140 },
          { name: 'description', label: 'What does it do?', type: 'textarea', required: true, maxLength: 2000 },
          { name: 'technologies', label: 'Built with', maxLength: 300, placeholder: 'Next.js, Supabase, Tailwind' },
          { name: 'repo_url', label: 'Repository', placeholder: 'https://github.com/…' },
          { name: 'live_url', label: 'Live demo', placeholder: 'https://…' },
          { name: 'team_members', label: 'Team', maxLength: 300, hint: 'Names or usernames of everyone involved.' },
        ]}
      />
    </div>
  );
}
