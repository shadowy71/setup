'use client';

import { Button, EmptyState, Notice } from '@/components/ui';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { useFormAction } from '@/lib/forms';
import { decideJoinRequest } from '@/lib/actions/communities';
import { formatDateTime } from '@/lib/utils';

export function ClubJoinRequestsPanel({ clubId, requests = [] }) {
  const decide = useFormAction(decideJoinRequest, { resetOnSuccess: false });

  const run = (request, decision) => {
    const data = new FormData();
    data.set('request_id', request.id);
    data.set('community_id', clubId);
    data.set('decision', decision);
    decide.run(data);
  };

  return (
    <div className="flex flex-col gap-2">
      {requests.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <IdentityLine username={request.username} displayName={request.display_name} size="sm" />
                <time className="text-2xs text-muted" dateTime={request.created_at}>{formatDateTime(request.created_at)}</time>
              </div>
              {request.message ? <p className="user-text text-[0.8125rem] leading-relaxed text-muted">{request.message}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" tone="accent" disabled={decide.pending} onClick={() => run(request, 'approved')}>Approve</Button>
                <Button type="button" size="sm" variant="secondary" disabled={decide.pending} onClick={() => run(request, 'rejected')}>Reject</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="users" title="No pending join requests" description="New membership requests will appear here. Approval and membership creation happen in one transaction." />
      )}
      {decide.pending ? <p className="text-2xs text-muted" role="status">Saving the decision…</p> : null}
      {decide.success ? <Notice tone="success">Decision saved. The requester has been notified.</Notice> : null}
      {decide.error ? <Notice tone="danger">{decide.error}</Notice> : null}
    </div>
  );
}
