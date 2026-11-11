'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { createPost } from '@/lib/actions/social';
import { LIMITS } from '@/lib/constants';
import { Button, Field, IdentityMark, Input, Notice, Textarea } from '@/components/ui';
import { GifPicker } from '@/components/media/GifPicker';
import { DraftAttachments } from '@/components/posts/DraftAttachments';
import { uploadPostFiles } from '@/lib/media/post-upload';
import { getPostDraft, putPostDraft, deletePostDraft } from '@/lib/media/post-draft-store';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

/** Long enough to be read once, short enough not to sit on the composer. */
const HELD_NOTICE_MS = 9_000;

const KINDS = [
  { value: 'post', label: 'Post', icon: 'sparkle', hint: 'A thought, a notice, a link' },
  { value: 'discussion', label: 'Discussion', icon: 'comment', hint: 'A question with a title' },
  { value: 'poll', label: 'Poll', icon: 'trend', hint: 'Let campus decide' },
];

/**
 * The one text composer.
 *
 * Text, an optional GIF, @mentions and — for discussions and polls — a title.
 * Files stay local until submit, then upload to a private expiring draft before publication.
 *
 * The surface opens with the question the product exists to ask: "What's
 * happening on campus?".
 */
export function PostComposer({
  communityId = null,
  defaultKind = 'post',
  compact = false,
  authorName = null,
  authorUsername = null,
  onCreated = null,
}) {
  const [kind, setKind] = useState(defaultKind);
  const [gif, setGif] = useState(null);
  const [options, setOptions] = useState(['', '']);
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [draftId, setDraftId] = useState(null);
  const draftRef = useRef(null); const draftCreatedRef = useRef(false); const uploadedRef = useRef(new Map());
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [checkingRecovery, setCheckingRecovery] = useState(true);
  const storageKey = authorUsername ? `${authorUsername.toLowerCase()}:${communityId || 'campus'}` : null;
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => storageKey ? getPostDraft(storageKey) : null).then((saved) => { if (!cancelled && saved) setRecovery(saved); })
      .catch(() => { if (!cancelled) setUploadError('Browser storage unavailable; attachment recovery is disabled.'); })
      .finally(() => { if (!cancelled) setCheckingRecovery(false); });
    return () => { cancelled = true; };
  }, [storageKey]);
  function resumeDraft() {
    const saved = recovery;
    draftRef.current = saved.draft; draftCreatedRef.current = saved.created;
    uploadedRef.current = new Map(saved.uploaded || []);
    setDraftId(saved.draft); setKind(saved.kind); setTitle(saved.title || ''); setBody(saved.body || '');
    setOptions(saved.options || ['', '']); setGif(saved.gif || null);
    setAttachments(saved.items.map((item) => ({ ...item, progress: uploadedRef.current.has(item.id) ? 100 : 0,
      preview: item.file.type.startsWith('image/') ? URL.createObjectURL(item.file) : null })));
    setRecovery(null);
    setUploadError('Recovered the last submitted version. Submit to resume; server drafts expire after 24 hours.');
  }
  async function discardRecovery() {
    setUploading(true);
    try {
      const response = await fetch(`/api/storage/post-drafts/${recovery.draft}`, { method: 'DELETE' });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw Error(payload.error || 'Could not discard the draft.'); }
      await deletePostDraft(storageKey); setRecovery(null); setUploadError('');
    } catch (error) { setUploadError(error.message || 'Could not discard the draft.'); }
    finally { setUploading(false); }
  }
  async function publishWithAttachments(data) {
    if (!attachments.length) { run(data); return; }
    setUploading(true); setUploadError('');
    let draft = draftRef.current;
    if (!draft) {
      draft = crypto.randomUUID(); draftRef.current = draft; setDraftId(draft);
    }
    // Keep a recoverable copy before contacting the server. Files and text remain
    // on this browser until publication or explicit discard, not in localStorage.
    const snapshot = { draft, created: draftCreatedRef.current, kind, title, body, options, gif,
      items: attachments.map(({ id, file }) => ({ id, file })), uploaded: [...uploadedRef.current] };
    try {
      if (!storageKey) throw Error('Account identity unavailable.');
      await putPostDraft(storageKey, snapshot);
      if (!draftCreatedRef.current) {
        const response = await fetch(`/api/storage/post-drafts/${draft}`, { method: 'PUT' });
        if (!response.ok) throw Error('Could not start upload. Please retry.');
        draftCreatedRef.current = true; snapshot.created = true;
        await putPostDraft(storageKey, snapshot);
      }
      const remaining = attachments.filter((item) => !uploadedRef.current.has(item.id));
      const result = await uploadPostFiles(draft, remaining, {
        endpoint: `/api/storage/post-drafts/${draft}`, requireId: true,
        onProgress: (id, progress) => setAttachments((old) => old.map((entry) => entry.id === id ? { ...entry, progress } : entry)),
        onUploaded: async (id, fileId) => {
          uploadedRef.current.set(id, fileId); snapshot.uploaded = [...uploadedRef.current];
          await putPostDraft(storageKey, snapshot);
          setAttachments((old) => old.map((entry) => entry.id === id ? { ...entry, progress: 100 } : entry));
        },
      });
      if (!result.ok) { setUploadError(result.error); setUploading(false); return; }
    } catch (error) { setUploadError(error.message || 'Could not save the recovery copy. Please retry.'); setUploading(false); return; }
    data.set('attachment_draft_id', draft);
    for (const item of attachments) data.append('attachment_file_id', uploadedRef.current.get(item.id));
    setUploading(false); run(data);
  }
  async function discardDraft() {
    setUploading(true);
    try {
      const response = await fetch(`/api/storage/post-drafts/${draftRef.current}`, { method: 'DELETE' });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw Error(body.error || 'Could not discard the draft.'); }
      await deletePostDraft(storageKey);
      draftRef.current = null; draftCreatedRef.current = false; uploadedRef.current.clear(); setDraftId(null); setAttachments([]); setUploadError('');
    } catch (error) { setUploadError(error.message || 'Could not discard the draft. Retry; abandoned files are also reconciled later.'); }
    finally { setUploading(false); }
  }
  useEffect(() => {
    if (!draftId) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draftId]);
  // Set only when the server confirmed the write but the row is not published —
  // i.e. moderation holds it. Nothing about it is guessed on the client.
  const [held, setHeld] = useState(null);
  const formRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const showHeldNotice = (message) => {
    setHeld(message);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setHeld(null);
    }, HELD_NOTICE_MS);
  };

  const { run, pending, error, fieldErrors } = useFormAction(createPost, {
    onSuccess: (result) => {
      // The draft is cleared only here — after the action has confirmed a real row
      // — and a failed write returns before this callback ever runs, so the text,
      // the GIF and the poll options survive for another attempt.
      if (draftRef.current && storageKey) deletePostDraft(storageKey).catch(() => setUploadError('The local recovery copy could not be deleted. Clear it from browser storage.'));
      setBody('');
      setTitle('');
      setGif(null);
      setOptions(['', '']);
      setKind(defaultKind);
      formRef.current?.reset();
      if (result?.pending) {
        // Not published, so no feed is told anything: the surfaces that list posts
        // filter on `status = 'published'`, exactly like `campus_feed()` does. The
        // author is the only person who can see the row, and only here.
        showHeldNotice(
          result.status === 'hidden' || result.status === 'removed'
            ? 'Saved, but this post is not showing on the feed right now. A moderator can see why.'
            : 'Saved and sent for review. It appears on the feed once a moderator approves it.',
        );
      }
      draftRef.current = null; draftCreatedRef.current = false; uploadedRef.current.clear(); setDraftId(null); setAttachments([]);
      onCreated?.(result);
    },
  });

  const isPoll = kind === 'poll';
  const needsTitle = kind !== 'post';
  const canSubmit = !pending && !uploading && !checkingRecovery && !recovery && (!isPoll || options.filter(Boolean).length >= 2);

  return (
    <form
      ref={formRef}
      action={run}
      className={cn(
        // Level-3 premium glass: the one surface on the feed allowed to glow,
        // and the only one whose highlight answers the pointer.
        'glass-premium rounded-[var(--radius-lg)] overflow-hidden transition-shadow',
        focused ? 'shadow-[var(--shadow-raised)]' : null,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set('kind', kind);
        if (gif) data.set('gif', JSON.stringify(gif));
        if (communityId) {
          data.set('community_id', communityId);
          data.set('visibility', 'community');
        } else {
          data.set('visibility', 'campus');
        }
        publishWithAttachments(data);
      }}
    >
      {!compact ? (
        <div className="flex items-center gap-2 border-b border-glass-border px-4 py-2.5">
          <span className="hidden items-center gap-1.5 text-2xs font-semibold text-muted sm:flex">
            <Icon name="plus" size={12} />
            New
          </span>
          <div className="flex flex-1 flex-wrap items-center gap-1" role="tablist" aria-label="Post type">
            {KINDS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={kind === item.value}
                title={item.hint}
                onClick={() => setKind(item.value)}
                className="chip chip-plain"
              >
                <Icon name={item.icon} size={12} />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="p-4">
        <div className="flex gap-3">
          <IdentityMark name={authorName || 'You'} username={authorUsername} size={36} tone="accent" square={false} className="mt-0.5 hidden sm:flex" />
          <div className="min-w-0 flex-1">
            {!compact && kind === 'post' ? (
              <p className="mb-1 text-[0.9375rem] font-semibold tracking-[-0.015em] text-ink">What&apos;s happening on campus?</p>
            ) : null}

            {needsTitle ? (
              <Field
                label={isPoll ? 'Poll question' : 'Discussion title'}
                htmlFor="post-title"
                required
                error={fieldErrors?.title}
                className="mb-3"
              >
                <Input
                  id="post-title"
                  name="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={140}
                  required
                  placeholder={isPoll ? 'What should we decide?' : 'What should the discussion cover?'}
                />
              </Field>
            ) : null}

            <Field
              label={!compact ? (isPoll ? 'Context (optional)' : null) : kind === 'discussion' ? 'Your opening post' : 'Say something'}
              htmlFor="post-body"
              error={fieldErrors?.body}
              hint={isPoll ? undefined : `${body.length}/${LIMITS.post.max}`}
            >
              <Textarea
                id="post-body"
                name="body"
                rows={compact ? 3 : 3}
                maxLength={LIMITS.post.max}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                required={!isPoll}
                className={cn(!needsTitle && !compact ? 'cp-composer-input' : null)}
                placeholder={
                  compact
                    ? 'Write a reply…'
                    : 'Share something with campus. Use @username to mention someone.'
                }
              />
            </Field>

            {isPoll ? (
              <fieldset className="mt-3">
                <legend className="field-label">Options</legend>
                <div className="mt-2 flex flex-col gap-2">
                  {options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="w-4 shrink-0 text-center text-2xs font-semibold text-muted-soft">{index + 1}</span>
                      <Input
                        name="poll_options"
                        value={option}
                        maxLength={80}
                        aria-label={`Option ${index + 1}`}
                        placeholder={`Option ${index + 1}`}
                        onChange={(event) => {
                          const next = [...options];
                          next[index] = event.target.value;
                          setOptions(next);
                        }}
                      />
                      {options.length > 2 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="close"
                          aria-label={`Remove option ${index + 1}`}
                          onClick={() => setOptions(options.filter((_, i) => i !== index))}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
                {options.length < 6 ? (
                  <Button variant="ghost" size="sm" icon="plus" className="mt-2" onClick={() => setOptions([...options, ''])}>
                    Add option
                  </Button>
                ) : null}
              </fieldset>
            ) : null}

            {recovery ? <Notice tone="warning" className="mt-3">A previous attachment submission is saved on this browser. <button type="button" disabled={uploading} onClick={resumeDraft} className="underline">Resume</button>{' · '}<button type="button" disabled={uploading} onClick={discardRecovery} className="underline">Discard</button></Notice> : null}
            {attachments.length && !draftId ? <p className="mt-2 text-xs text-muted">On submit, a recovery copy of these files and the submitted text is stored in this browser until published or discarded. Avoid shared devices.</p> : null}
            {uploadError && !draftId ? <p role="alert" className="mt-2 text-xs text-danger">{uploadError}</p> : null}
            {draftId ? <p role="status" className="mt-2 text-xs text-muted">{uploading ? 'Uploading before publication…' : 'Private upload draft saved; submit to retry.'} {uploadError ? <span className="text-danger">{uploadError}</span> : null} {!uploading && !pending ? <button type="button" className="underline" onClick={discardDraft}>Discard uploaded files</button> : null}</p> : null}
            <DraftAttachments items={attachments} setItems={setAttachments} disabled={pending || Boolean(draftId) || Boolean(recovery) || checkingRecovery} busy={uploading} postId={draftId} submit={
              <Button type="submit" variant="warm" size="lg" icon="send" loading={pending} disabled={!canSubmit}>
                {pending ? 'Posting…' : isPoll ? 'Publish poll' : kind === 'discussion' ? 'Start discussion' : 'Post'}
              </Button>
            }>
              <GifPicker value={gif} onPick={setGif} onRemove={() => setGif(null)} />
            </DraftAttachments>
          </div>
        </div>

        {error ? (
          <Notice tone="danger" className="mt-3" icon="flag">
            {error}
          </Notice>
        ) : null}

        {held ? (
          <Notice tone="warning" className="mt-3" icon="clock">
            {held}
          </Notice>
        ) : null}
      </div>
    </form>
  );
}
