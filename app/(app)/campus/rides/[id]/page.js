import { RideGallery } from '@/components/campus/RideGallery';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { UUID_REGEX } from '@/lib/constants';
import { PageHeader, Card, Badge } from '@/components/ui';
import { PostActionsRow } from '@/components/campus/PostActionsRow';
import { OwnBoardActions } from '@/components/campus/OwnBoardActions';
import { LinkifiedText } from '@/components/content/LinkifiedText';

export const metadata = { title: 'Ride' };
export default async function DetailPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();
  const user = await requireUser();
  const db = await getServerClient();
  const { data: record, error } = await db.from('ride_posts').select('id, creator_id, status, description, ride_kind, origin, destination, ride_date, ride_time, seats').eq('id', id).maybeSingle();
  if (error || !record) notFound();
  const actor = toActor(user);
  const owner = record.creator_id === user.profile.id;
  return <div className="flex flex-col gap-4">
    <PageHeader title={`${record.origin} → ${record.destination}`} back={{ href: '/campus/rides', label: 'Ride' }} />
    <div className="flex flex-wrap gap-2">{record.status !== 'published' ? <Badge tone="danger">{record.status}</Badge> : null}{[record.ride_kind === 'offer' ? 'Offering a ride' : record.ride_kind === 'request' ? 'Looking for a ride' : null, record.ride_date, record.ride_time, record.seats ? `${record.seats} seats` : null].filter(Boolean).map((item) => <Badge key={item}>{item}</Badge>)}</div>
    <Card className="p-4"><p className="user-text whitespace-pre-wrap"><LinkifiedText text={record.description} /></p></Card>
    <RideGallery postId={id} />
    <PostActionsRow creatorId={record.creator_id} isOwner={owner} canReport={can(actor, 'report_content')} canMessage={can(actor, 'send_messages')} reportType="ride_post" reportRef={id} />
    {owner ? <OwnBoardActions type="rides" id={id} editHref={`/campus/rides/${id}/edit`} /> : null}
  </div>;
}
