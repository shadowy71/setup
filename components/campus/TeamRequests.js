'use client';
import { Button } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import { requestTeam, withdrawTeamRequest, decideTeamRequest, inviteTeamMember, respondTeamInvitation, removeTeamMember } from '@/lib/actions/campus';

export function TeamJoin({ postId, request }) {
  const apply = useFormAction(requestTeam);
  const withdraw = useFormAction(withdrawTeamRequest);
  return <div className="flex flex-col gap-2">
    {request ? <>
      <p className="text-sm">Your request: {request.status}</p>
      <form action={(data) => { data.set('id', request.id); withdraw.run(data); }}>
        <Button type="submit" size="sm" variant="secondary" disabled={withdraw.pending}>{request.status === 'accepted' ? 'Leave' : 'Withdraw request'}</Button>
      </form>
    </> : <form className="flex flex-col items-start gap-2" action={(data) => { data.set('id', postId); apply.run(data); }}>
      <label className="text-sm" htmlFor="team-message">Message to the organiser (optional)</label>
      <textarea id="team-message" name="message" maxLength={500} rows={3} className="control control-input w-full" />
      <Button type="submit" size="sm" disabled={apply.pending}>{apply.pending ? 'Sending…' : 'Request to join'}</Button>
    </form>}
    {apply.error || withdraw.error ? <p role="alert" className="text-xs text-danger">{apply.error || withdraw.error}</p> : null}
  </div>;
}
export function TeamDecision({ requestId }) {
  const action = useFormAction(decideTeamRequest);
  return <div className="flex flex-wrap gap-2">
    {['accepted', 'declined'].map((decision) => <form key={decision} action={(data) => { data.set('id', requestId); data.set('decision', decision); action.run(data); }}>
      <Button type="submit" size="sm" variant="secondary" disabled={action.pending}>{decision === 'accepted' ? 'Accept' : 'Decline'}</Button>
    </form>)}
    {action.error ? <p role="alert" className="text-xs text-danger">{action.error}</p> : null}
  </div>;
}

export function TeamInvite({ teamId }) {
  const action = useFormAction(inviteTeamMember);
  return <form className="flex flex-wrap items-end gap-2" action={(data) => { data.set('id', teamId); action.run(data); }}>
    <label className="text-xs text-muted">Invite by username<input name="username" maxLength={25} required className="control control-input" placeholder="@username" /></label>
    <Button type="submit" size="sm" disabled={action.pending}>Send invite</Button>
    {action.success ? <p role="status" className="text-xs text-success">Invitation sent.</p> : null}
    {action.error ? <p role="alert" className="text-xs text-danger">{action.error}</p> : null}
  </form>;
}
export function TeamInvitationResponse({ invitationId, teamId }) {
  const action = useFormAction(respondTeamInvitation);
  return <div className="flex flex-wrap gap-2">
    {['accept','decline'].map((response) => <form key={response} action={(data) => { data.set('id', invitationId); data.set('team_id', teamId); data.set('response', response); action.run(data); }}><Button type="submit" size="sm" variant="secondary" disabled={action.pending}>{response === 'accept' ? 'Accept invitation' : 'Decline'}</Button></form>)}
    {action.error ? <p role="alert" className="text-xs text-danger">{action.error}</p> : null}
  </div>;
}
export function TeamRemoveMember({ requestId }) {
  const action = useFormAction(removeTeamMember);
  return <div><form action={(data) => { if (!window.confirm('Remove this team member?')) return; data.set('id', requestId); action.run(data); }}><Button type="submit" size="sm" variant="secondary" disabled={action.pending}>Remove member</Button></form>{action.error ? <p role="alert" className="text-xs text-danger">{action.error}</p> : null}</div>;
}
