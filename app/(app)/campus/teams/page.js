import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listTeamPosts } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { PostActionsRow } from '@/components/campus/PostActionsRow';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Team finder' };

/** Team finder (spec §33). Post what you are building and who you need. */
export default async function TeamsPage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const { items, unavailable } = await listTeamPosts(supabase, { limit: 30 });
  const canCreate = can(actor, 'create_team_posts');

  const creators = await (async () => {
    const ids = [...new Set(items.map((item) => item.creator_id))];
    if (!ids.length) return new Map();
    const { data } = await supabase.from('public_profiles').select('id, username, display_name').in('id', ids);
    return new Map((data || []).map((person) => [person.id, person]));
  })();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Team finder"
        description="Find teammates for a project, a hackathon or a competition."
        back={{ href: ROUTES.campus, label: 'Campus' }}
        action={canCreate ? <LinkButton href="/campus/teams/new" size="sm" icon="plus">Post a team request</LinkButton> : null}
      />

      {unavailable ? <Notice tone="warning" icon="flag">Team posts could not be loaded right now.</Notice> : null}

      <Notice tone="info" icon="book">
        Studying for a subject or exam instead of building a project?{' '}
        <LinkButton href={ROUTES.study} size="sm" variant="ghost">Try the study partner finder</LinkButton>
      </Notice>

      {!unavailable && !items.length ? (
        <EmptyState
          icon="users"
          title="No team requests"
          description="Post what you are building and who you are looking for."
          action={canCreate ? <LinkButton href="/campus/teams/new" variant="primary" size="sm">Post a request</LinkButton> : null}
        />
      ) : null}

      <section aria-label="Team requests" className="flex flex-col gap-3">
        {items.map((post) => {
          const creator = creators.get(post.creator_id);
          return (
            <ContentCard
              key={post.id}
              href={`/campus/teams/${post.id}`}
              title={post.project_name}
              description={post.description}
              icon="users"
              timestamp={post.created_at}
              badges={[
                ...(post.team_size ? [{ label: `${post.team_size} people` }] : []),
                ...(post.deadline ? [{ label: `By ${formatDate(post.deadline)}`, tone: 'warning' }] : []),
              ]}
              meta={[post.required_skills, creator ? `@${creator.username}` : null]}
              footer={
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <PostActionsRow
                    creatorId={post.creator_id}
                    creatorUsername={creator?.username}
                    isOwner={post.creator_id === user.profile.id}
                    canReport={can(actor, 'report_content')}
                    canMessage={can(actor, 'send_messages')}
                  />
                </span>
              }
            />
          );
        })}
      </section>
    </div>
  );
}
