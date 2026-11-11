'use client';
import { Button, LinkButton } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import { deleteProfileAchievement, moderateProfileAchievement } from '@/lib/actions/achievements';
export function AchievementControls({ id, owner, moderator, status }) {
  const remove = useFormAction(deleteProfileAchievement); const moderate = useFormAction(moderateProfileAchievement);
  return <div className="flex flex-wrap gap-2">
    {owner ? <><LinkButton href={`/profile/achievements/${id}/edit`} size="sm" variant="secondary">Edit</LinkButton>
      <form action={(data) => { if (!window.confirm('Remove this achievement?')) return; data.set('id', id); remove.run(data); }}><Button type="submit" size="sm" variant="secondary" disabled={remove.pending}>Remove</Button></form></> : null}
    {moderator ? <form action={(data) => { data.set('id', id); data.set('status', status === 'published' ? 'hidden' : 'published'); moderate.run(data); }}><Button type="submit" size="sm" variant="secondary" disabled={moderate.pending}>{status === 'published' ? 'Hide' : 'Restore'}</Button></form> : null}
    {remove.error || moderate.error ? <p role="alert" className="text-xs text-danger">{remove.error || moderate.error}</p> : null}
  </div>;
}
