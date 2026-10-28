import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES, LIMITS, CLUB_CATEGORIES, CLUB_ORGANIZATION_TYPES } from '@/lib/constants';
import { PageHeader, Notice, LinkButton } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createClub } from '@/lib/actions/communities';

export const metadata = { title: 'Create a club' };

/** Staff-only direct creation, with the same active-owner guarantee as approval. */
export default async function NewClubPage() {
  const user = await requireUser();
  const actor = toActor(user);

  if (!can(actor, 'manage_clubs')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Create a club" back={{ href: ROUTES.clubs, label: 'Clubs' }} />
        <Notice tone="warning" icon="lock">
          Official clubs are not created directly by student accounts. Submit a request for review, or create an ordinary community or study group instead.
        </Notice>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={ROUTES.clubRequest} tone="accent" icon="plus">Request a club</LinkButton>
          <LinkButton href="/communities/new" variant="secondary">Create a community</LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Create with an initial administrator"
        eyebrow="Campus+ club administration"
        description="Create one official club and assign one active owner atomically. This does not grant that person a platform-wide role."
        back={{ href: `${ROUTES.admin}?tab=clubs`, label: 'Club administration' }}
      />
      <ActionForm
        action={createClub}
        submitLabel="Create club & assign admin"
        pendingLabel="Creating…"
        successMessage="Club created and initial administrator assigned."
        cancelHref={`${ROUTES.admin}?tab=clubs`}
        fields={[
          {
            name: 'admin_username', label: 'Initial club administrator', required: true, maxLength: 24,
            placeholder: 'Exact active Campus+ username',
            hint: 'The account becomes this club’s owner. It receives no platform-wide administration or moderation permission.',
          },
          { name: 'name', label: 'Club name', required: true, maxLength: LIMITS.club.name.max },
          { name: 'slug', label: 'Link (optional)', maxLength: 60, hint: 'Generated from the name if left empty.' },
          { name: 'description', label: 'Description', type: 'textarea', required: true, rows: 5, maxLength: LIMITS.club.description.max },
          {
            name: 'club_category', label: 'Discovery category', type: 'select', required: true, placeholder: 'Choose a category',
            options: CLUB_CATEGORIES.map((category) => ({ value: category.value, label: category.label })),
          },
          {
            name: 'organization_type', label: 'Organization type', type: 'select', required: true, placeholder: 'Choose a type',
            options: CLUB_ORGANIZATION_TYPES.map((type) => ({ value: type.value, label: type.label })),
          },
          { name: 'subject', label: 'Interest / subject', maxLength: 120 },
          { name: 'recruitment_info', label: 'Recruitment details (optional)', type: 'textarea', maxLength: 1000 },
          { name: 'meeting_info', label: 'Meeting info (optional)', maxLength: 200 },
          { name: 'contact_info', label: 'Public contact (optional)', maxLength: 200 },
          { name: 'external_url', label: 'Club website (optional)', placeholder: 'https://…' },
          { name: 'source_label', label: 'Directory source name (optional)', maxLength: 160 },
          { name: 'source_url', label: 'Directory source link (optional)', placeholder: 'https://…' },
          {
            name: 'verification_status', label: 'Source state', type: 'select', defaultValue: 'pending',
            options: [
              { value: 'pending', label: 'Details / source pending' },
              { value: 'source_checked', label: 'I checked the cited source' },
            ],
            hint: 'Source checked is not an institutional endorsement of the page.',
          },
          {
            name: 'join_policy', label: 'How people join', type: 'select', defaultValue: 'request',
            options: [
              { value: 'open', label: 'Anyone can join immediately' },
              { value: 'request', label: 'They request and a club manager approves' },
            ],
          },
          {
            name: 'visibility', label: 'Who can see it', type: 'select', defaultValue: 'campus',
            options: [
              { value: 'public', label: 'Everyone on Campus+' },
              { value: 'campus', label: 'Campus members' },
              { value: 'private', label: 'Members only' },
            ],
          },
        ]}
      />
    </div>
  );
}
