import { AchievementGallery } from '@/components/campus/AchievementGallery';
import { Card, LinkButton, Notice } from '@/components/ui';
import { AchievementControls } from '@/components/profile/AchievementControls';
import { LinkifiedText } from '@/components/content/LinkifiedText';
import { formatDate } from '@/lib/utils';

/** Session-scoped reads only: never put profile-specific data in a public cache. */
export async function ProfileAchievements({ db, profileId, owner = false, moderator = false }) {
  const flag = await db.rpc('feature_enabled', { p_key: 'achievements' });
  if (flag.error || flag.data !== true) return null;
  const { data, error } = await db.from('profile_achievements').select('id,title,description,category,achieved_on,status').eq('owner_id', profileId).order('achieved_on', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(50);
  return <section aria-label="Achievements" className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Achievements</h2>{owner ? <LinkButton href="/profile/achievements/new" size="sm">Add achievement</LinkButton> : null}</div>
    <p className="text-xs text-muted">Self-reported by the student; not independently verified.</p>
    {error ? <Notice tone="warning">Achievements could not be loaded.</Notice> : !data?.length ? <p className="text-sm text-muted">No achievements shared.</p> : data.map((item) => <Card key={item.id} className="flex flex-col gap-2 p-4">
      <h3 className="font-semibold">{item.title}</h3>
      <p className="text-xs text-muted">{item.category}{item.achieved_on ? ` · ${formatDate(item.achieved_on)}` : ''}{item.status !== 'published' ? ` · ${item.status}` : ''}</p>
      <p className="user-text whitespace-pre-wrap text-sm"><LinkifiedText text={item.description} /></p>
      <AchievementGallery postId={item.id} />
      {owner || moderator ? <AchievementControls id={item.id} owner={owner} moderator={moderator} status={item.status} /> : null}
    </Card>)}
  </section>;
}
