import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { OPPORTUNITY_CATEGORIES, ROUTES, UUID_REGEX } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { submitOpportunity } from '@/lib/actions/campus';

export const metadata = { title: 'Submit an opportunity' };

export default async function NewOpportunityPage({ searchParams }) {
  const user = await requireUser();
  const actor = toActor(user);
  const params = await searchParams;
  if (!can(actor, 'submit_opportunities')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Submit an opportunity" back={{ href: '/explore/opportunities', label: 'Opportunities' }} />
        <Notice tone="warning" icon="lock">Your account cannot submit opportunities right now.</Notice>
      </div>
    );
  }

  const supabase = await getServerClient();
  const canLinkAnyClub = can(actor, 'manage_official_content') || can(actor, 'manage_clubs') || can(actor, 'moderate_communities') || can(actor, 'moderate_all');
  const [{ data: clubs }, { data: memberships }] = await Promise.all([
    supabase.from('communities').select('id, name').eq('status', 'published').eq('kind', 'club').order('name', { ascending: true }).limit(100),
    canLinkAnyClub
      ? Promise.resolve({ data: [] })
      : supabase.from('community_members').select('community_id').eq('user_id', user.profile.id).eq('status', 'active').in('role', ['owner', 'moderator']).limit(100),
  ]);
  const managedIds = new Set((memberships || []).map((row) => row.community_id));
  const choices = (clubs || []).filter((club) => canLinkAnyClub || managedIds.has(club.id));
  const requestedClub = UUID_REGEX.test(String(params?.club_id || '')) && choices.some((club) => club.id === params.club_id) ? params.club_id : null;
  const selectedClub = choices.find((club) => club.id === requestedClub);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Submit an opportunity"
        description="Link to the original posting. Student submissions stay labelled community-submitted; only a club you manage can be linked."
        back={requestedClub ? { href: ROUTES.clubManage(requestedClub, 'opportunities'), label: 'Club opportunities' } : { href: '/explore/opportunities', label: 'Opportunities' }}
      />
      {params?.club_id && !requestedClub ? <Notice tone="warning" icon="lock">The requested club is not one your account manages, so it was not preselected.</Notice> : null}
      <ActionForm
        action={submitOpportunity}
        submitLabel="Submit"
        successMessage="Submitted. It remains marked community-submitted until staff review it."
        redirectTo={requestedClub ? ROUTES.clubManage(requestedClub, 'opportunities') : '/explore/opportunities'}
        resetOnSuccess={false}
        cancelHref={requestedClub ? ROUTES.clubManage(requestedClub, 'opportunities') : '/explore/opportunities'}
        fields={[
          { name: 'title', label: 'Title', required: true, maxLength: 140 },
          { name: 'organization', label: 'Organization', required: true, maxLength: 140, defaultValue: selectedClub?.name || '' },
          { name: 'url', label: 'Original opportunity link', required: true, placeholder: 'https://…' },
          { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: 2000 },
          { name: 'category', label: 'Category', type: 'select', options: OPPORTUNITY_CATEGORIES.map((option) => ({ value: option.value, label: option.label })) },
          { name: 'eligibility', label: 'Eligibility', type: 'textarea', maxLength: 1000 },
          { name: 'deadline', label: 'Deadline', type: 'date' },
          { name: 'location', label: 'Location', maxLength: 140 },
          {
            name: 'club_id', label: 'Managed club (optional)', type: 'select', defaultValue: requestedClub || '',
            options: choices.map((club) => ({ value: club.id, label: club.name })),
            hint: choices.length ? 'The link is authorized again on the server and in PostgreSQL.' : 'You do not manage a club, so no club can be linked.',
          },
          {
            name: 'mode', label: 'Mode', type: 'select', defaultValue: 'onsite',
            options: [{ value: 'onsite', label: 'On site' }, { value: 'remote', label: 'Remote' }, { value: 'hybrid', label: 'Hybrid' }],
          },
        ]}
      />
    </div>
  );
}
