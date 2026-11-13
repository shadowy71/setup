import { TeamGallery } from '@/components/campus/TeamGallery';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { UUID_REGEX } from '@/lib/constants';
import { can, toActor } from '@/lib/permissions/authorization';
import { PageHeader, Card, Badge } from '@/components/ui';
import { PostActionsRow } from '@/components/campus/PostActionsRow';
import { OwnBoardActions } from '@/components/campus/OwnBoardActions';
import { TeamJoin, TeamDecision, TeamInvite, TeamInvitationResponse, TeamRemoveMember } from '@/components/campus/TeamRequests';
import { LinkifiedText } from '@/components/content/LinkifiedText';

export const metadata = { title: 'Team request' };
export default async function TeamPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();
  const user = await requireUser();
  const db = await getServerClient();
  const { data: team, error } = await db.from('team_posts').select('id,project_name,description,required_skills,team_size,deadline,status,creator_id,project_id').eq('id', id).maybeSingle();
  if (error || !team) notFound();
  const owner = team.creator_id === user.profile.id;
  const { data: requests, error: requestsError } = await db.from('team_post_requests').select('id,user_id,message,status,created_at').eq('team_post_id', id).order('created_at');
  const rows = requests || [];
  const { data: invites, error: inviteError } = await db.from('team_invitations').select('id,invitee_id,status').eq('team_post_id', id).order('created_at', { ascending: false });
  const ids = owner ? [...new Set([...rows.map((row) => row.user_id), ...(invites || []).map((inv) => inv.invitee_id)])] : [];
  const profiles = ids.length ? await db.from('public_profiles').select('id,username,display_name').in('id', ids) : { data: [] };
  const people = new Map((profiles.data || []).map((profile) => [profile.id, profile]));
  const actor = toActor(user);
  return <div className="flex flex-col gap-4">
    <PageHeader title={team.project_name} back={{ href: '/campus/teams', label: 'Team finder' }} />
    <div className="flex flex-wrap gap-2"><Badge>{team.required_skills}</Badge>{team.team_size ? <Badge>{team.team_size} people</Badge> : null}{team.deadline ? <Badge>By {team.deadline}</Badge> : null}</div>
    {team.project_id ? <Link href={`/explore/projects/${team.project_id}`} className="text-sm underline">View linked project</Link> : null}
    <Card className="p-4"><p className="user-text whitespace-pre-wrap"><LinkifiedText text={team.description} /></p></Card>
    <TeamGallery postId={id} />
    <PostActionsRow creatorId={team.creator_id} isOwner={owner} canMessage={can(actor, 'send_messages')} canReport={can(actor, 'report_content')} />
    {owner ? <OwnBoardActions type="teams" id={id} editHref={`/campus/teams/${id}/edit`} /> : null}
    {requestsError ? <p role="alert" className="text-sm text-danger">Requests could not be loaded. Refresh to retry.</p> : owner ? <Card className="flex flex-col gap-3 p-4">
      <h2 className="font-semibold">Join requests and members</h2>
      <TeamInvite teamId={id} />
      {inviteError ? <p role="alert" className="text-xs text-danger">Invitations could not be loaded.</p> : (invites || []).length ? <ul className="text-xs text-muted">{invites.map((inv) => <li key={inv.id}>Invitation to {people.get(inv.invitee_id)?.display_name || people.get(inv.invitee_id)?.username || 'student'} · {inv.status}</li>)}</ul> : null}
      {!rows.length ? <p className="text-sm text-muted">No requests yet.</p> : rows.map((request) => <div key={request.id} className="flex flex-col gap-2 border-t border-line pt-3">
        <p className="text-sm font-semibold">{people.get(request.user_id)?.display_name || people.get(request.user_id)?.username || 'Student'} · {request.status}</p>
        {request.message ? <p className="user-text whitespace-pre-wrap text-sm">{request.message}</p> : null}
        {request.status === 'pending' ? <TeamDecision requestId={request.id} /> : null}
        {request.status === 'accepted' ? <TeamRemoveMember requestId={request.id} /> : null}
      </div>)}
    </Card> : team.status === 'published' ? <Card className="flex flex-col gap-3 p-4">
      {inviteError ? <p role="alert" className="text-xs text-danger">Invitations could not be loaded.</p> : (invites || []).filter((inv) => inv.invitee_id === user.profile.id && inv.status === 'pending').map((inv) => <TeamInvitationResponse key={inv.id} invitationId={inv.id} teamId={id} />)}
      <TeamJoin postId={id} request={rows.find((row) => row.user_id === user.profile.id)} />
    </Card> : null}
  </div>;
}
