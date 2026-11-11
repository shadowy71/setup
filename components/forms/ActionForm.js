'use client';

/**
 * One form renderer for every create/edit surface.
 *
 * Pages describe their fields; this component owns the boring parts that must be
 * identical everywhere: loading state, disabled submit, inline field errors,
 * success notice, cancel link and the GIF field wired to the single GifPicker.
 * Validation itself always runs again on the server — this is presentation.
 */

import { useEffect, useRef, useState } from 'react';
import { DraftAttachments } from '@/components/posts/DraftAttachments';
import { uploadPostFiles } from '@/lib/media/post-upload';
import { getPostDraft, putPostDraft, deletePostDraft } from '@/lib/media/post-draft-store';
import { Button, Checkbox, Field, Input, Notice, Select, Switch, Textarea, LinkButton } from '@/components/ui';
import { GifPicker, GifAttachment } from '@/components/media/GifPicker';
import { useFormAction } from '@/lib/forms';

export function ActionForm({
  action,
  fields = [],
  hidden = {},
  submitLabel = 'Save',
  pendingLabel = 'Saving…',
  successMessage = 'Saved.',
  cancelHref = null,
  cancelLabel = 'Cancel',
  resetOnSuccess = true,
  redirectTo = null,
  encTypeNote = null,
  intro = null,
  marketplaceImages = null,
}) {
  const formRef = useRef(null);
  const [gif, setGif] = useState(null);
  const [images, setImages] = useState([]); const [draftId, setDraftId] = useState(null);
  const draft = useRef(null); const created = useRef(false); const uploaded = useRef(new Map());
  const [uploading, setUploading] = useState(false); const [uploadError, setUploadError] = useState('');
  const [recovery, setRecovery] = useState(null); const [checking, setChecking] = useState(Boolean(marketplaceImages));
  const storageKey = marketplaceImages ? `marketplace:${marketplaceImages.toLowerCase()}` : null;
  useEffect(() => {
    let cancelled = false;
    if (!storageKey) return undefined;
    getPostDraft(storageKey).then((saved) => { if (!cancelled && saved) setRecovery(saved); })
      .catch(() => { if (!cancelled) setUploadError('Browser recovery storage is unavailable.'); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [storageKey]);
  function resume() {
    draft.current = recovery.draft; created.current = recovery.created; uploaded.current = new Map(recovery.uploaded || []); setDraftId(recovery.draft);
    setImages(recovery.items.map((item) => ({ ...item, preview: URL.createObjectURL(item.file), progress: uploaded.current.has(item.id) ? 100 : 0 })));
    const saved = new FormData(); for (const [key,value] of recovery.fields) saved.append(key,value);
    for (const field of fields) { const input = formRef.current?.elements.namedItem(field.name); if (!input || input instanceof RadioNodeList) continue; if (input.type === 'checkbox') input.checked = saved.has(field.name); else input.value = saved.get(field.name) || ''; }
    setRecovery(null); setUploadError('Recovered the last submitted version. Submit to resume.');
  }
  async function discard(id) {
    setUploading(true);
    try {
      const response=await fetch(`/api/storage/post-drafts/${id}?scope=marketplace`,{method:'DELETE'});
      if (!response.ok) throw Error('Could not discard the draft. Retry.');
      await deletePostDraft(storageKey); draft.current=null; created.current=false; uploaded.current.clear(); setImages([]); setDraftId(null); setRecovery(null); setUploadError('');
    } catch (e) { setUploadError(e.message || 'Could not discard the draft.'); }
    finally { setUploading(false); }
  }

  const [gifCleared, setGifCleared] = useState(false);
  const { run, pending, error, fieldErrors, success } = useFormAction(action, {
    resetOnSuccess,
    redirectTo,
    onSuccess: () => { if (draft.current && storageKey) deletePostDraft(storageKey).catch(() => {}); draft.current=null; created.current=false; uploaded.current.clear(); setImages([]); setDraftId(null); },
  });

  const gifField = fields.find((field) => field.type === 'gif');

  const submit = async (formData) => {
    for (const [key, value] of Object.entries(hidden)) formData.set(key, value);
    if (gifField) {
      if (gif) formData.set(gifField.name, JSON.stringify(gif));
      else if (gifCleared) formData.set(gifField.name, '');
      else formData.delete(gifField.name);
    }
    if (!marketplaceImages || !images.length) { run(formData); return; }
    setUploading(true); setUploadError('');
    if (!draft.current) { draft.current=crypto.randomUUID(); setDraftId(draft.current); }
    const id=draft.current; const snapshot={draft:id,created:created.current,items:images.map(({id: itemId,file})=>({id:itemId,file})),uploaded:[...uploaded.current],fields:[...formData.entries()]};
    try {
      await putPostDraft(storageKey,snapshot);
      if (!created.current) { const response=await fetch(`/api/storage/post-drafts/${id}?scope=marketplace`,{method:'PUT'}); if (!response.ok) throw Error('Could not start upload. Retry.'); created.current=true; snapshot.created=true; await putPostDraft(storageKey,snapshot); }
      const result=await uploadPostFiles(id,images.filter((item)=>!uploaded.current.has(item.id)),{endpoint:`/api/storage/post-drafts/${id}?scope=marketplace`,requireId:true,
        onProgress:(itemId,progress)=>setImages((old)=>old.map((item)=>item.id===itemId?{...item,progress}:item)),
        onUploaded:async(itemId,fileId)=>{uploaded.current.set(itemId,fileId); snapshot.uploaded=[...uploaded.current]; await putPostDraft(storageKey,snapshot); setImages((old)=>old.map((item)=>item.id===itemId?{...item,progress:100}:item));},
      });
      if (!result.ok) throw Error(result.error);
      formData.set('attachment_draft_id',id); for (const item of images) formData.append('attachment_file_id',uploaded.current.get(item.id));
      setUploading(false); run(formData);
    } catch (e) { setUploadError(e.message || 'Upload failed. Retry.'); setUploading(false); }
  };

  const renderField = (field) => {
    const id = `field-${field.name}`;
    const fieldError = fieldErrors?.[field.name] || null;

    if (field.type === 'gif') {
      return (
        <Field key={field.name} label={field.label || 'GIF'} hint={field.hint} error={fieldError}>
          <div className="flex flex-wrap items-center gap-2">
            <GifPicker
              value={gif}
              onPick={(picked) => {
                setGif(picked);
                setGifCleared(false);
              }}
              onRemove={() => {
                setGif(null);
                setGifCleared(true);
              }}
              label={field.label || 'Attach a GIF'}
            />
            {gif ? <GifAttachment gif={gif} className="max-w-[10rem]" /> : null}
          </div>
        </Field>
      );
    }

    if (field.type === 'checkbox' || field.type === 'switch') {
      const Control = field.type === 'switch' ? Switch : Checkbox;
      return (
        <Control
          key={field.name}
          id={id}
          name={field.name}
          label={field.label}
          note={field.hint}
          defaultChecked={field.defaultChecked}
        />
      );
    }

    if (field.type === 'select') {
      return (
        <Field key={field.name} label={field.label} htmlFor={id} hint={field.hint} error={fieldError} required={field.required}>
          <Select id={id} name={field.name} required={field.required} defaultValue={field.defaultValue ?? ''} aria-invalid={Boolean(fieldError)}>
            <option value="">{field.placeholder || 'Choose…'}</option>
            {(field.options || []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    }

    if (field.type === 'textarea') {
      return (
        <Field key={field.name} label={field.label} htmlFor={id} hint={field.hint} error={fieldError} required={field.required}>
          <Textarea
            id={id}
            name={field.name}
            rows={field.rows || 5}
            required={field.required}
            maxLength={field.maxLength}
            defaultValue={field.defaultValue}
            placeholder={field.placeholder}
            invalid={Boolean(fieldError)}
          />
        </Field>
      );
    }

    return (
      <Field key={field.name} label={field.label} htmlFor={id} hint={field.hint} error={fieldError} required={field.required}>
        <Input
          id={id}
          name={field.name}
          type={field.type || 'text'}
          required={field.required}
          maxLength={field.maxLength}
          min={field.min}
          max={field.max}
          step={field.step}
          defaultValue={field.defaultValue}
          placeholder={field.placeholder}
          inputMode={field.inputMode}
          invalid={Boolean(fieldError)}
        />
      </Field>
    );
  };

  return (
    <form ref={formRef} action={submit} className="card flex flex-col gap-4 p-4 sm:p-5">
      {encTypeNote ? <p className="text-2xs text-muted">{encTypeNote}</p> : null}
      {intro ? <div className="text-[0.8125rem] leading-relaxed text-muted">{intro}</div> : null}
      {fields.map(renderField)}

      {error ? (
        <Notice tone="danger" icon="flag">
          {error}
        </Notice>
      ) : null}
      {success ? (
        <Notice tone="success" icon="checkCircle">
          {successMessage}
        </Notice>
      ) : null}

      {marketplaceImages ? <>
        {recovery ? <Notice tone="warning">An earlier submission is saved on this browser. <button type="button" className="underline" onClick={resume} disabled={uploading}>Resume</button> · <button type="button" className="underline" onClick={() => discard(recovery.draft)} disabled={uploading}>Discard</button></Notice> : null}
        {uploadError ? <Notice tone="warning">{uploadError}</Notice> : null}
        {images.length && !draftId ? <p className="text-xs text-muted">The first image is the cover. On submit, files and listing details are stored in this browser for retry until published or discarded. Avoid shared devices.</p> : null}
        {draftId ? <p className="text-xs text-muted">{uploading ? 'Uploading images…' : 'Submit to retry the private draft.'} {!uploading && !pending ? <button type="button" className="underline" onClick={() => discard(draftId)}>Discard images</button> : null}</p> : null}
        <DraftAttachments scope="marketplace" imagesOnly items={images} setItems={setImages} disabled={pending || Boolean(draftId) || Boolean(recovery) || checking} busy={uploading} postId={draftId} submit={<Button type="submit" tone="accent" loading={pending || uploading} disabled={Boolean(recovery) || checking}>{uploading ? 'Uploading…' : pending ? pendingLabel : submitLabel}</Button>}>
          {cancelHref ? <LinkButton href={cancelHref} variant="ghost" size="md">{cancelLabel}</LinkButton> : null}
        </DraftAttachments>
      </> : <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button type="submit" tone="accent" loading={pending}>{pending ? pendingLabel : submitLabel}</Button>
        {cancelHref ? <LinkButton href={cancelHref} variant="ghost" size="md">{cancelLabel}</LinkButton> : null}
      </div>}
    </form>
  );
}
