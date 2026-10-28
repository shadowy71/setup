import { ActionForm } from '@/components/forms/ActionForm';
import { updateClub } from '@/lib/actions/communities';
import { CLUB_CATEGORIES, CLUB_ORGANIZATION_TYPES, LIMITS, ROUTES } from '@/lib/constants';

/** Shared by the stable /edit URL and the management workspace's Settings view. */
export function ClubSettingsForm({ club, cancelHref = null }) {
  return (
    <ActionForm
      action={updateClub}
      hidden={{ id: club.id }}
      submitLabel="Save club"
      pendingLabel="Saving…"
      successMessage="Club updated."
      cancelHref={cancelHref || ROUTES.clubManage(club.id, 'settings')}
      resetOnSuccess={false}
      redirectTo={ROUTES.clubManage(club.id, 'settings')}
      fields={[
        { name: 'name', label: 'Club name', required: true, maxLength: LIMITS.club.name.max, defaultValue: club.name },
        {
          name: 'description', label: 'Description', type: 'textarea', required: true, rows: 5,
          maxLength: LIMITS.club.description.max, defaultValue: club.description,
        },
        {
          name: 'club_category', label: 'Discovery category', type: 'select', required: true,
          defaultValue: club.club_category || '', placeholder: 'Choose a category',
          options: CLUB_CATEGORIES.map((category) => ({ value: category.value, label: category.label })),
        },
        {
          name: 'organization_type', label: 'Organization type', type: 'select', required: true,
          defaultValue: club.organization_type || '', placeholder: 'Choose a type',
          options: CLUB_ORGANIZATION_TYPES.map((type) => ({ value: type.value, label: type.label })),
        },
        { name: 'subject', label: 'Interest / subject', maxLength: 120, defaultValue: club.subject || '' },
        {
          name: 'recruitment_info', label: 'Recruitment details', type: 'textarea', maxLength: 1000,
          defaultValue: club.recruitment_info || '', hint: 'Leave empty when there is no confirmed recruitment announcement.',
        },
        { name: 'meeting_info', label: 'Meeting info', maxLength: 200, defaultValue: club.meeting_info || '' },
        { name: 'contact_info', label: 'Public contact', maxLength: 200, defaultValue: club.contact_info || '' },
        { name: 'external_url', label: 'Website', placeholder: 'https://…', defaultValue: club.external_url || '' },
        {
          name: 'join_policy', label: 'How people join', type: 'select', defaultValue: club.join_policy || 'request',
          options: [
            { value: 'open', label: 'Anyone can join immediately' },
            { value: 'request', label: 'They request and a club manager approves' },
          ],
        },
        {
          name: 'visibility', label: 'Who can see it', type: 'select', defaultValue: club.visibility || 'campus',
          options: [
            { value: 'public', label: 'Everyone on Campus+' },
            { value: 'campus', label: 'Campus members' },
            { value: 'private', label: 'Members only' },
          ],
        },
      ]}
    />
  );
}
