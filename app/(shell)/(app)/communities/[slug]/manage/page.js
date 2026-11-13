import { SpaceGallery } from '@/components/campus/SpaceGallery';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { BRANCHES, YEARS, LIMITS } from '@/lib/constants';
import { getCommunityBySlug, getCommunityMembership, listCommunityMembers } from '@/lib/data/campus';
import { PageHeader, Card, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { ClubMembersPanel } from '@/components/clubs/ClubMembersPanel';
import { updateCommunity } from '@/lib/actions/communities';
export const metadata = { title: 'Manage community' };
export default async function ManageCommunity({ params }) {
  const { slug } = await params;
  const user = await requireUser(); const db = await getServerClient();
  const community = await getCommunityBySlug(db, slug);
  if (!community || !['community', 'study_group'].includes(community.kind)) notFound();
  const membership = await getCommunityMembership(db, community.id, user.profile.id);
  const actor = toActor(user);
  const owner = membership?.status === 'active' && membership.role === 'owner';
  const manager = membership?.status === 'active' && ['owner','moderator'].includes(membership.role);
  const staff = can(actor, 'moderate_communities') || can(actor, 'moderate_all');
  if (!manager && !staff) notFound();
  const members = await listCommunityMembers(db, community.id, { limit: 100 });
  const study = community.kind === 'study_group';
  return <div className="flex flex-col gap-4">
    <PageHeader title={`Manage ${community.name}`} back={{ href: `/communities/${community.slug}`, label: 'Community' }} />
    <Notice tone="neutral">Changes do not alter the community’s link or moderation status.</Notice>
    <SpaceGallery postId={community.id} manage username={user.profile.username} imagesOnly />
    <ActionForm action={updateCommunity} hidden={{ id: community.id }} resetOnSuccess={false} cancelHref={`/communities/${community.slug}`} fields={[
      { name: 'name', label: 'Name', required: true, maxLength: study ? LIMITS.studyGroup.name.max : LIMITS.community.name.max, defaultValue: community.name },
      { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: study ? LIMITS.studyGroup.description.max : LIMITS.community.description.max, defaultValue: community.description },
      { name: 'subject', label: study ? 'Subject' : 'Topic', required: study, maxLength: 120, defaultValue: community.subject || '' },
      { name: 'branch', label: 'Branch', type: 'select', options: BRANCHES.map((value) => ({ value, label: value })), defaultValue: community.branch || '' },
      { name: 'year', label: 'Year', type: 'select', options: YEARS.map((value) => ({ value, label: value })), defaultValue: community.year || '' },
      { name: 'meeting_info', label: 'Meeting info', maxLength: 200, defaultValue: community.meeting_info || '' },
      ...(!study ? [
        { name: 'contact_info', label: 'Contact', maxLength: 200, defaultValue: community.contact_info || '' },
        { name: 'external_url', label: 'Website', defaultValue: community.external_url || '' },
        { name: 'visibility', label: 'Visibility', type: 'select', options: ['public','campus','private'].map((value) => ({ value, label: value })), defaultValue: community.visibility },
      ] : []),
      { name: 'join_policy', label: 'How people join', type: 'select', options: (community.join_policy === 'invite' ? ['open','request','invite'] : ['open','request']).map((value) => ({ value, label: value })), defaultValue: community.join_policy },
    ]} />
    <Card className="flex flex-col gap-3 p-4"><h2 className="font-semibold">Members</h2><ClubMembersPanel clubId={community.id} members={members} isOwner={owner} canChangeRoles={owner} currentUserId={user.profile.id} /></Card>
  </div>;
}
