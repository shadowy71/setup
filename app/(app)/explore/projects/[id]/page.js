import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getProject } from '@/lib/data/campus';
import { UUID_REGEX } from '@/lib/constants';
import { PageHeader, Badge, Card, Notice } from '@/components/ui';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { MessageButton } from '@/components/social/MessageButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { ExternalLink } from '@/components/content/ExternalLink';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { formatDate } from '@/lib/utils';
import { OwnBoardActions } from '@/components/campus/OwnBoardActions';

export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: 'Project' };
  const supabase = await getServerClient();
  const project = await getProject(supabase, id);
  return { title: project?.title || 'Project' };
}

/** One project (spec §36). Repo and demo links open externally; nothing is embedded. */
export default async function ProjectPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const project = await getProject(supabase, id);
  if (!project) notFound();

  const { data: teams } = await supabase.from('team_posts').select('id,project_name').eq('project_id', id).eq('status', 'published').order('created_at', { ascending: false }).limit(20);
  const isCreator = project.creator_id === user.profile.id;
  const canModerate = can(actor, 'moderate_all');
  if (['hidden', 'removed'].includes(project.status) && !isCreator && !canModerate) notFound();

  const { data: creator } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_staff')
    .eq('id', project.creator_id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={project.title} back={{ href: '/explore/projects', label: 'Projects' }} />

      {isCreator ? <OwnBoardActions type="projects" id={project.id} editHref={`/explore/projects/${project.id}/edit`} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {project.status !== 'published' ? <Badge tone="danger">{project.status}</Badge> : null}
        {project.technologies ? <Badge>{project.technologies}</Badge> : null}
        {project.team_members ? <Badge>{project.team_members}</Badge> : null}
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <p className="user-text whitespace-pre-wrap text-[0.9375rem] leading-relaxed"><LinkifiedText text={project.description} mentions /></p>
        <div className="flex flex-wrap gap-4 text-[0.8125rem]">
          {project.repo_url ? (
            <ExternalLink url={project.repo_url} className="underline">
              Source code
            </ExternalLink>
          ) : null}
          {project.live_url ? (
            <ExternalLink url={project.live_url} className="underline">
              Live demo
            </ExternalLink>
          ) : null}
        </div>
        <p className="text-2xs text-muted">Added {formatDate(project.created_at)}</p>
      </Card>

      {creator ? (
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold">Built by</h2>
          <IdentityLine username={creator.username} displayName={creator.display_name} isStaff={creator.is_staff} />
          {!isCreator && can(actor, 'send_messages') ? (
            <MessageButton profileId={creator.id} label="Message the creator" />
          ) : null}
        </Card>
      ) : null}

      {teams?.length ? <Card className="flex flex-col gap-2 p-4"><h2 className="text-sm font-semibold">Find a team</h2>{teams.map((team) => <Link key={team.id} href={`/campus/teams/${team.id}`} className="text-sm underline">{team.project_name}</Link>)}</Card> : null}

      {project.status !== 'published' ? (
        <Notice tone="warning" icon="flag">
          This project is {project.status}. Only you and moderators can see it.
        </Notice>
      ) : null}

      {!isCreator && can(actor, 'report_content') ? (
        <div className="flex justify-end">
          <ReportDialog targetType="project" targetRef={project.id} label="this project" />
        </div>
      ) : null}
    </div>
  );
}
