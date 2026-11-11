'use client';
import { Button, LinkButton } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import { deleteOwnCampusBoard } from '@/lib/actions/campus-board';

export function OwnBoardActions({ type, id, editHref }) {
  const action = useFormAction(deleteOwnCampusBoard);
  return <div className="flex flex-wrap items-center gap-2">
    <LinkButton href={editHref} size="sm" variant="secondary">Edit</LinkButton>
    <form action={(data) => { if (!window.confirm('Permanently remove this post?')) return; data.set('id', id); data.set('type', type); action.run(data); }}>
      <Button type="submit" size="sm" variant="secondary" disabled={action.pending}>{action.pending ? 'Removing…' : 'Remove'}</Button>
    </form>
    {action.error ? <span role="alert" className="text-xs text-danger">{action.error}</span> : null}
  </div>;
}
