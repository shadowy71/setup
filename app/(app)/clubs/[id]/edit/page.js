import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getCommunityById, getCommunityMembership } from '@/lib/data/campus';
import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ClubSettingsForm } from '@/components/clubs/ClubSettingsForm';

export const metadata = { title: 'Edit club' };

/** Stable edit URL; it renders the same working form as Manage → Settings. */
export default async function EditClubPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const club = await getCommunityById(supabase, id);
  if (!club || club.kind !== 'club') notFound();
  const membership = await getCommunityMembership(supabase, club.id, user.profile.id);
  const isStaff = can(actor, 'manage_clubs') || can(actor, 'moderate_communities') || can(actor, 'moderate_all');
  const canManage = isStaff || (membership?.status === 'active' && ['owner', 'moderator'].includes(membership.role));
  if (!canManage) notFound();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Edit club"
        eyebrow={club.name}
        description="Update what students see. The club link, catalogue provenance and verification state do not change here."
        back={{ href: ROUTES.clubManage(club.id, 'settings'), label: 'Club management' }}
      />
      {club.status !== 'published' ? (
        <Notice tone="warning" icon="flag">This club is {club.status}. It stays hidden from the board until staff publish it.</Notice>
      ) : null}
      <ClubSettingsForm club={club} cancelHref={ROUTES.club(club.id)} />
    </div>
  );
}
