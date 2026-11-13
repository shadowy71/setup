import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { PageHeader, LinkButton, Notice, Card } from '@/components/ui';
import { NoticeDelete } from '@/components/campus/NoticeDelete';
export const metadata = { title: 'Manage notices' };
export default async function ManageNotices() {
  const user = await requireUser();
  if (!can(toActor(user), 'manage_notices')) return <Notice tone="warning">You cannot manage notices.</Notice>;
  const db = await getServerClient();
  const { data: notices, error } = await db.from('notices').select('id,title,status,pinned,expires_at').order('created_at', { ascending: false }).limit(100);
  return <div className="flex flex-col gap-4"><PageHeader title="Manage notices" back={{ href: '/campus/noticeboard', label: 'Noticeboard' }} action={<LinkButton href="/campus/noticeboard/new" size="sm">New notice</LinkButton>} />
    {error ? <Notice tone="warning">Notices could not be loaded.</Notice> : !notices?.length ? <p className="text-sm text-muted">No notices yet.</p> : notices.map((notice) => <Card key={notice.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-semibold">{notice.title}</p><p className="text-xs text-muted">{notice.status}{notice.pinned ? ' · pinned' : ''}{notice.expires_at ? ` · expires ${notice.expires_at.slice(0, 10)}` : ''}</p></div><div className="flex flex-wrap gap-2"><LinkButton href={`/campus/noticeboard/${notice.id}/edit`} size="sm" variant="secondary">Edit</LinkButton><NoticeDelete id={notice.id} /></div></Card>)}
  </div>;
}
