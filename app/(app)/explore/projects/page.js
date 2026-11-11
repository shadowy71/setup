import { ProjectGallery } from '@/components/campus/ProjectGallery';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listProjects } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';

export const metadata = { title: 'Projects' };

/** Project showcase (spec §36). Student work, links out to the repo or a live demo. */
export default async function ProjectsPage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const { items, unavailable } = await listProjects(supabase, { limit: 30 });

  const creators = await (async () => {
    const ids = [...new Set(items.map((project) => project.creator_id))];
    if (!ids.length) return new Map();
    const { data } = await supabase.from('public_profiles').select('id, username, display_name').in('id', ids);
    return new Map((data || []).map((person) => [person.id, person]));
  })();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Projects"
        description="What students are building — with a link to the code or a demo."
        back={{ href: ROUTES.explore, label: 'Explore' }}
        action={can(actor, 'create_projects') ? <LinkButton href="/explore/projects/new" size="sm" icon="plus">Add your project</LinkButton> : null}
      />

      {unavailable ? <Notice tone="warning" icon="flag">Projects could not be loaded right now.</Notice> : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="sparkle"
          title="No projects yet"
          description="Add yours: what it does, what you built it with, and where to find it."
          action={can(actor, 'create_projects') ? <LinkButton href="/explore/projects/new" variant="primary" size="sm">Add your project</LinkButton> : null}
        />
      ) : null}

      <section aria-label="Projects" className="flex flex-col gap-3">
        {items.map((project) => {
          const creator = creators.get(project.creator_id);
          return (
            <ContentCard
              key={project.id}
              media={<ProjectGallery postId={project.id} coverOnly />}
              href={ROUTES.project(project.id)}
              title={project.title}
              description={project.description}
              icon="sparkle"
              badges={[
                ...(project.technologies ? [{ label: project.technologies }] : []),
                ...(project.team_members ? [{ label: project.team_members }] : []),
              ]}
              meta={[creator ? `@${creator.username}` : null]}
            />
          );
        })}
      </section>
    </div>
  );
}
