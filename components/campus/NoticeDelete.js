'use client';
import { Button } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import { deleteNotice } from '@/lib/actions/campus';
export function NoticeDelete({ id }) {
  const action = useFormAction(deleteNotice);
  return <div><form action={(data) => { if (!window.confirm('Permanently delete this notice?')) return; data.set('id', id); action.run(data); }}><Button type="submit" variant="danger" size="sm" disabled={action.pending}>Delete</Button></form>{action.error ? <p role="alert" className="text-xs text-danger">{action.error}</p> : null}</div>;
}
