'use client';

/**
 * Member management for a club's owners and moderators.
 *
 * The club page renders this only for people who can manage the club; the
 * server actions and RLS enforce the same rules again (owners change roles,
 * owners and moderators remove members, nobody removes an owner).
 */

import { useState } from 'react';
import { Badge, Button, KeycapButton, Notice, StaffDot } from '@/components/ui';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { useFormAction } from '@/lib/forms';
import { removeCommunityMember, setCommunityMemberRole } from '@/lib/actions/communities';

export function ClubMembersPanel({ clubId, members = [], isOwner = false, canChangeRoles = isOwner, currentUserId = null }) {
  const role = useFormAction(setCommunityMemberRole, { resetOnSuccess: false });
  const remove = useFormAction(removeCommunityMember, { resetOnSuccess: false });
  const [confirmRemove, setConfirmRemove] = useState(null);

  const changeRole = (member, nextRole) => {
    const formData = new FormData();
    formData.set('community_id', clubId);
    formData.set('user_id', member.user_id);
    formData.set('role', nextRole);
    role.run(formData);
  };

  const removeMember = (member) => {
    const formData = new FormData();
    formData.set('community_id', clubId);
    formData.set('user_id', member.user_id);
    remove.run(formData);
    setConfirmRemove(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {members.map((member) => {
          const isSelf = member.user_id === currentUserId;
          const isOwnerRow = member.role === 'owner';
          return (
            <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-2">
              <IdentityLine
                username={member.username}
                displayName={member.display_name}
                isStaff={member.is_staff}
                size="sm"
                badge={
                  <>
                    {member.role !== 'member' ? <Badge tone="accent">{member.role}</Badge> : null}
                    {member.is_staff ? <StaffDot label="Campus+ staff" /> : null}
                  </>
                }
              />

              {!isSelf && !isOwnerRow ? (
                <span className="flex flex-wrap items-center gap-2">
                  {canChangeRoles ? (
                    member.role === 'moderator' ? (
                      <Button type="button" size="sm" variant="ghost" disabled={role.pending} onClick={() => changeRole(member, 'member')}>
                        Make member
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" disabled={role.pending} onClick={() => changeRole(member, 'moderator')}>
                        Make moderator
                      </Button>
                    )
                  ) : null}

                  {confirmRemove === member.user_id ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-2xs text-muted">Remove?</span>
                      <Button type="button" size="sm" variant="danger" loading={remove.pending} onClick={() => removeMember(member)}>
                        Yes
                      </Button>
                      <KeycapButton type="button" onClick={() => setConfirmRemove(null)} aria-label="Cancel removing member">
                        Esc
                      </KeycapButton>
                    </span>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(member.user_id)}>
                      Remove
                    </Button>
                  )}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {role.error ? <Notice tone="danger">{role.error}</Notice> : null}
      {remove.error ? <Notice tone="danger">{remove.error}</Notice> : null}
      <p className="text-2xs text-muted">
        {canChangeRoles
          ? 'Owners and authorized Campus+ club staff can promote members or step moderators down. Managers can remove non-owner members.'
          : 'Moderators can remove non-owner members. Only the owner or authorized Campus+ club staff can change roles.'}
      </p>
    </div>
  );
}
