'use client';

/**
 * Membership controls for a community, study group or club (spec §26–§28).
 *
 * Join, leave, request a place, open the community chat and — for owners and
 * moderators — decide pending join requests. Every mutation is a server action;
 * RLS decides whether it is allowed.
 */

import { useState } from 'react';
import { Button, KeycapButton, Notice } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import {
  joinCommunity,
  leaveCommunity,
  decideJoinRequest,
  openCommunityChat,
} from '@/lib/actions/communities';
import { ROUTES } from '@/lib/constants';

export function CommunityActions({
  communityId,
  slug,
  membership = null,
  joinRequest = null,
  joinPolicy = 'open',
  canJoin = true,
  joinDisabledReason = null,
  canChat = false,
  chatConversationId = null,
  pendingRequests = [],
  canManage = false,
}) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  const join = useFormAction(joinCommunity);
  const leave = useFormAction(leaveCommunity, { onSuccess: () => setConfirmLeave(false) });
  const chat = useFormAction(openCommunityChat, { redirectTo: (result) => result.href || ROUTES.chat });
  const decide = useFormAction(decideJoinRequest, { resetOnSuccess: false });

  const isMember = membership?.status === 'active';
  const isPending = membership?.status === 'pending' || joinRequest?.status === 'pending';
  const canInvite = joinPolicy !== 'invite';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!membership && !isPending && canJoin && canInvite ? (
          <form
            action={(formData) => {
              formData.set('community_id', communityId);
              join.run(formData);
            }}
          >
            <Button type="submit" tone="accent" icon="plus" loading={join.pending}>
              {join.pending ? 'Joining…' : joinPolicy === 'open' ? 'Join' : 'Request to join'}
            </Button>
          </form>
        ) : null}

        {isPending ? <span className="text-2xs text-muted">Your join request is waiting for review.</span> : null}
        {!isMember && !isPending && joinDisabledReason ? <span className="text-2xs text-muted">{joinDisabledReason}</span> : null}

        {isMember ? (
          <>
            <span className="text-2xs text-muted">You are a member.</span>
            {canChat ? (
              <form
                action={(formData) => {
                  formData.set('community_id', communityId);
                  chat.run(formData);
                }}
              >
                <Button type="submit" variant="secondary" size="sm" icon="chat" disabled={chat.pending}>
                  {chat.pending ? 'Opening…' : chatConversationId ? 'Open community chat' : 'Start community chat'}
                </Button>
              </form>
            ) : null}
            {confirmLeave ? (
              <form
                action={(formData) => {
                  formData.set('community_id', communityId);
                  formData.set('slug', slug);
                  leave.run(formData);
                }}
                className="flex items-center gap-2"
              >
                <span className="text-2xs font-medium text-muted">Leave this community?</span>
                <Button type="submit" size="sm" variant="danger" loading={leave.pending}>
                  {leave.pending ? 'Leaving…' : 'Yes, leave'}
                </Button>
                <KeycapButton type="button" onClick={() => setConfirmLeave(false)} aria-label="Cancel leaving">
                  Esc
                </KeycapButton>
              </form>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmLeave(true)}>
                Leave
              </Button>
            )}
          </>
        ) : null}
      </div>

      {join.error ? <Notice tone="danger">{join.error}</Notice> : null}
      {leave.error ? <Notice tone="danger">{leave.error}</Notice> : null}
      {chat.error ? <Notice tone="danger">{chat.error}</Notice> : null}

      {canManage && pendingRequests.length ? (
        <section aria-label="Join requests" className="card p-3">
          <h3 className="text-[0.8125rem] font-semibold">Join requests</h3>
          <ul className="mt-2 divide-y divide-line">
            {pendingRequests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block text-[0.8125rem]">
                    {request.display_name || 'Student'} {request.username ? `· @${request.username}` : ''}
                  </span>
                  {request.message ? <span className="block text-2xs text-muted">{request.message}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  {['approved', 'rejected'].map((decision) => (
                    <form
                      key={decision}
                      action={(formData) => {
                        formData.set('request_id', request.id);
                        formData.set('decision', decision);
                        formData.set('slug', slug);
                        decide.run(formData);
                      }}
                    >
                      <Button
                        type="submit"
                        size="sm"
                        variant={decision === 'approved' ? 'primary' : 'ghost'}
                        tone="accent"
                        disabled={decide.pending}
                      >
                        {decision === 'approved' ? 'Approve' : 'Reject'}
                      </Button>
                    </form>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          {decide.error ? <Notice tone="danger">{decide.error}</Notice> : null}
        </section>
      ) : null}
    </div>
  );
}
