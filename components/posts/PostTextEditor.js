'use client';
import { useCallback, useState } from 'react';
import { editPostText } from '@/lib/actions/social';
import { useFormAction } from '@/lib/forms';
import { useLiveFeed } from '@/components/layout/LiveFeedProvider';
import { Button, Input, Modal, Notice, Textarea } from '@/components/ui';

export function PostTextEditor({ postId, body, title, kind }) {
  const [open, setOpen] = useState(false); const [text, setText] = useState(body || ''); const [heading, setHeading] = useState(title || '');
  const close = useCallback(() => setOpen(false), []); const feed = useLiveFeed();
  const { run, pending, error } = useFormAction(editPostText, { onSuccess: () => { close(); feed.invalidate('local', [postId]); } });
  return <>
    <Button type="button" variant="ghost" size="sm" onClick={() => { setText(body || ''); setHeading(title || ''); setOpen(true); }}>Edit text</Button>
    <Modal open={open} onClose={close} title="Edit post">
      <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(); data.set('id', postId); data.set('body', text); if (kind === 'discussion') data.set('title', heading); run(data); }} className="mt-3 flex flex-col gap-3">
        {kind === 'discussion' ? <Input aria-label="Discussion title" value={heading} onChange={(event) => setHeading(event.target.value)} minLength={5} maxLength={140} required /> : null}
        <Textarea aria-label="Post text" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} required rows={5} />
        <p className="text-xs text-muted">Existing attachments remain unchanged.</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  </>;
}
