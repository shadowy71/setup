import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { listMyClubCreationRequests } from '@/lib/data/clubs';
import {
  CLUB_CATEGORIES,
  CLUB_ORGANIZATION_TYPES,
  LIMITS,
  ROUTES,
} from '@/lib/constants';
import { Badge, Card, Notice, PageHeader, SectionHeader } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { submitClubRequest } from '@/lib/actions/club-requests';
import { ClubRequestStatus, WithdrawClubRequest } from '@/components/clubs/ClubRequestPanels';
import { formatDateTime } from '@/lib/utils';

export const metadata = { title: 'Request a club' };

export default async function ClubRequestPage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const requests = await listMyClubCreationRequests(supabase, user.profile.id);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Request a club"
        eyebrow="Club governance"
        description="Propose an official club page. A Campus+ club administrator reviews the request and chooses a real active account as its initial administrator."
        back={{ href: ROUTES.clubs, label: 'Clubs' }}
      />

      <Notice tone="neutral" icon="info">
        Submitting this form does not create a club or make you its owner. For an informal student space, you can still{' '}
        <Link href="/communities/new" className="font-medium text-ink underline">create an ordinary community or study group</Link>.
      </Notice>

      <ActionForm
        action={submitClubRequest}
        submitLabel="Submit club request"
        pendingLabel="Submitting…"
        successMessage="Request submitted. Its status is now pending below; no club has been created yet."
        cancelHref={ROUTES.clubs}
        fields={[
          { name: 'name', label: 'Organization name', required: true, maxLength: LIMITS.club.name.max },
          {
            name: 'slug',
            label: 'Preferred link',
            maxLength: 60,
            hint: 'Lowercase letters, numbers and dashes. Generated from the name if empty; an existing club or pending request cannot use the same link.',
          },
          {
            name: 'description',
            label: 'Purpose and activities',
            type: 'textarea',
            required: true,
            rows: 5,
            maxLength: LIMITS.club.description.max,
            placeholder: 'Describe only what you know. Do not claim institutional endorsement or list members without evidence.',
          },
          {
            name: 'club_category',
            label: 'Discovery category',
            type: 'select',
            required: true,
            placeholder: 'Choose a category',
            options: CLUB_CATEGORIES.map((category) => ({ value: category.value, label: category.label })),
          },
          {
            name: 'organization_type',
            label: 'Organization type',
            type: 'select',
            required: true,
            placeholder: 'Choose a type',
            options: CLUB_ORGANIZATION_TYPES.map((type) => ({ value: type.value, label: type.label })),
          },
          { name: 'subject', label: 'Interests / search terms', maxLength: 120 },
          {
            name: 'proposed_admin_username',
            label: 'Suggested initial administrator (optional)',
            maxLength: 24,
            hint: 'An exact Campus+ username, if you have one. The reviewer independently chooses and validates the account.',
          },
          { name: 'recruitment_info', label: 'Recruitment details (optional)', type: 'textarea', maxLength: 1000 },
          { name: 'meeting_info', label: 'Meeting details (optional)', maxLength: 200 },
          { name: 'contact_info', label: 'Public contact details (optional)', maxLength: 200 },
          { name: 'external_url', label: 'Club website (optional)', placeholder: 'https://…' },
          { name: 'source_label', label: 'Public source name (optional)', maxLength: 160, hint: 'For example, an official college directory page.' },
          { name: 'source_url', label: 'Public source link (optional)', placeholder: 'https://…' },
        ]}
      />

      <section className="flex flex-col gap-3" aria-labelledby="my-club-requests">
        <SectionHeader
          title="My requests"
          description="Statuses and review notes come from your actual request records."
        />
        {requests.unavailable ? (
          <Notice tone="warning">Your request history could not be loaded. Refresh to try again.</Notice>
        ) : null}
        {!requests.unavailable && !requests.items.length ? (
          <Card className="p-4 text-[0.8125rem] text-muted">You have not requested a club yet.</Card>
        ) : null}
        {requests.items.map((request) => (
          <Card key={request.id} className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[0.9375rem] font-semibold">{request.name}</h3>
                <p className="mt-0.5 text-2xs text-muted">Submitted {formatDateTime(request.created_at)}</p>
              </div>
              <Badge tone={request.status === 'approved' ? 'success' : request.status === 'rejected' ? 'danger' : request.status === 'pending' ? 'warning' : 'neutral'}>
                {request.status}
              </Badge>
            </div>
            <ClubRequestStatus request={request} />
            {request.status === 'pending' ? <WithdrawClubRequest requestId={request.id} /> : null}
          </Card>
        ))}
      </section>
    </div>
  );
}
