import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES, BRANCHES, YEARS, LIMITS } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createCommunity } from '@/lib/actions/communities';

export const metadata = { title: 'New community' };

/**
 * Create a community or study group (spec §26, §33). Student-created spaces are
 * never marked official. Clubs are campus-run, live at `/clubs/new`, and old
 * `?kind=club` links redirect there.
 */
export default async function NewCommunityPage({ searchParams }) {
  const user = await requireUser();
  const actor = toActor(user);
  const params = await searchParams;
  // Clubs have their own creation flow (staff-managed, with a category).
  if (params?.kind === 'club') redirect(ROUTES.clubNew);
  const requestedKind = ['community', 'study_group'].includes(String(params?.kind)) ? String(params.kind) : 'community';
  // Clubs are gated by `manage_clubs` and live at /clubs/new; this form only
  // creates the spaces students run.
  if (!can(actor, 'create_communities')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Create" back={{ href: ROUTES.communities, label: 'Communities' }} />
        <Notice tone="warning" icon="lock">
          Your account cannot create communities right now.
        </Notice>
      </div>
    );
  }

  const kind = requestedKind;
  const kindLabel = kind === 'study_group' ? 'study group' : 'community';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Create a ${kindLabel}`}
        description={
          kind === 'study_group'
            ? 'Find people studying the same subject. The group gets a chat and a shared feed.'
            : 'A shared space with its own feed, members and chat.'
        }
        back={{ href: ROUTES.communities, label: 'Communities' }}
      />

      <div className="flex flex-wrap gap-1.5">
        {[
          { key: 'community', label: 'Community' },
          { key: 'study_group', label: 'Study group' },
        ].map((option) => (
          <a
            key={option.key}
            href={`/communities/new?kind=${option.key}`}
            className="chip"
            data-active={kind === option.key}
          >
            {option.label}
          </a>
        ))}
      </div>

      <ActionForm
        action={createCommunity}
        spaceAttachments={user.profile.username}
        spaceImagesOnly
        hidden={{ kind }}
        submitLabel={`Create ${kindLabel}`}
        pendingLabel="Creating…"
        successMessage="Created. You are the owner."
        cancelHref={ROUTES.communities}
        // No redirectTo here on purpose: createCommunity() returns { href },
        // and useFormAction() follows an action's own href automatically.
        // (Passing a closure here from this Server Component to the
        // Client Component ActionForm previously crashed the page.)
        fields={[
          { name: 'name', label: 'Name', required: true, maxLength: LIMITS.community.name.max },
          { name: 'slug', label: 'Link (optional)', maxLength: 60, hint: 'Lowercase letters, numbers and dashes. Generated from the name if left empty.' },
          { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: LIMITS.community.description.max },
          ...(kind === 'study_group'
            ? [
                { name: 'subject', label: 'Subject', required: true, maxLength: 120, placeholder: 'Data Structures' },
                { name: 'meeting_info', label: 'Meeting info', maxLength: 200, placeholder: 'Saturdays, library discussion room' },
              ]
            : []),
          { name: 'branch', label: 'Branch', type: 'select', options: BRANCHES.map((branch) => ({ value: branch, label: branch })) },
          { name: 'year', label: 'Year', type: 'select', options: YEARS.map((year) => ({ value: year, label: year })) },
          ...(kind === 'community'
            ? [
                { name: 'subject', label: 'Topic', maxLength: 120, placeholder: 'Robotics, placements, campus life…' },
                { name: 'meeting_info', label: 'Meeting info', maxLength: 200 },
                { name: 'contact_info', label: 'Contact', maxLength: 200, hint: 'Text only — no links to personal chats.' },
                { name: 'external_url', label: 'Website', placeholder: 'https://…' },
              ]
            : []),
          {
            name: 'join_policy',
            label: 'How people join',
            type: 'select',
            defaultValue: 'open',
            options: [
              { value: 'open', label: 'Anyone can join' },
              { value: 'request', label: 'They request, you approve' },
            ],
          },
          {
            name: 'visibility',
            label: 'Visibility',
            type: 'select',
            defaultValue: 'campus',
            options: [
              { value: 'campus', label: 'PCCOE students' },
              { value: 'public', label: 'Anyone signed in' },
            ],
          },
        ]}
      />

      <Notice tone="neutral" icon="shield">
        Everything here is text. Do not paste personal contact numbers or other people&apos;s details into a
        community description.
      </Notice>
    </div>
  );
}
