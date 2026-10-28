'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { useFormAction } from '@/lib/forms';
import {
  approveClubRequest,
  assignClubAdmin,
  rejectClubRequest,
  withdrawClubRequest,
} from '@/lib/actions/club-requests';
import { ROUTES } from '@/lib/constants';

export function ClubRequestReview({ request }) {
  const [adminUsername, setAdminUsername] = useState(request.proposed_admin_username || '');
  const [reviewNote, setReviewNote] = useState('');
  const approve = useFormAction(approveClubRequest, { resetOnSuccess: false });
  const reject = useFormAction(rejectClubRequest, { resetOnSuccess: false });

  const run = (action) => {
    const data = new FormData();
    data.set('request_id', request.id);
    data.set('admin_username', adminUsername.trim());
    data.set('review_note', reviewNote);
    action.run(data);
  };

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Initial club administrator</span>
        <input
          value={adminUsername}
          onChange={(event) => setAdminUsername(event.target.value)}
          className="control control-input"
          placeholder="Exact active Campus+ username"
          autoComplete="off"
          maxLength={24}
          required
        />
        <span className="field-hint">
          The reviewer chooses this account. Approval creates one club and one active owner atomically; it does not grant a platform role.
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Review note (optional)</span>
        <textarea
          value={reviewNote}
          onChange={(event) => setReviewNote(event.target.value)}
          className="control control-input min-h-20 py-2"
          maxLength={1000}
          placeholder="Context for the requester or audit trail"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          tone="accent"
          loading={approve.pending}
          disabled={reject.pending || !adminUsername.trim()}
          onClick={() => run(approve)}
        >
          {approve.pending ? 'Approving…' : 'Approve & create club'}
        </Button>
        <Button type="button" variant="secondary" loading={reject.pending} disabled={approve.pending} onClick={() => run(reject)}>
          {reject.pending ? 'Rejecting…' : 'Reject request'}
        </Button>
      </div>
      {approve.error ? <Notice tone="danger">{approve.error}</Notice> : null}
      {reject.error ? <Notice tone="danger">{reject.error}</Notice> : null}
      {reject.success ? <Notice tone="success">Request rejected. The requester has been notified.</Notice> : null}
    </div>
  );
}

export function AssignClubAdminForm({ club }) {
  return (
    <ActionForm
      action={assignClubAdmin}
      hidden={{ club_id: club.id }}
      submitLabel="Assign administrator"
      pendingLabel="Assigning…"
      successMessage="Administrator assigned. Membership requests can now be accepted."
      cancelHref={ROUTES.club(club.id)}
      fields={[
        {
          name: 'admin_username',
          label: `Initial administrator for ${club.name}`,
          placeholder: 'Exact active Campus+ username',
          required: true,
          maxLength: 24,
          hint: 'This assigns a club owner membership only. It never grants platform-wide administration.',
        },
      ]}
    />
  );
}

export function WithdrawClubRequest({ requestId }) {
  const action = useFormAction(withdrawClubRequest, { resetOnSuccess: false });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        loading={action.pending}
        onClick={() => {
          const data = new FormData();
          data.set('request_id', requestId);
          action.run(data);
        }}
      >
        {action.pending ? 'Withdrawing…' : 'Withdraw request'}
      </Button>
      {action.success ? <span className="text-2xs text-muted">Request withdrawn.</span> : null}
      {action.error ? <Notice tone="danger">{action.error}</Notice> : null}
    </div>
  );
}

export function ClubRequestStatus({ request }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        {request.status === 'pending'
          ? 'Waiting for a Campus+ club administrator. Approval is not automatic and does not make you the club owner.'
          : request.status === 'approved'
            ? 'Approved. The reviewer assigned an initial administrator and created the club.'
            : request.status === 'rejected'
              ? 'Not approved. You may submit a revised request with a different link.'
              : 'Withdrawn by you. It will not be reviewed or create a club.'}
      </p>
      {request.review_note ? <p className="text-[0.8125rem] leading-relaxed">Review note: {request.review_note}</p> : null}
      {request.community_id ? (
        <Link href={ROUTES.club(request.community_id)} className="text-[0.8125rem] font-medium text-accent underline">
          Open the approved club
        </Link>
      ) : null}
    </div>
  );
}
