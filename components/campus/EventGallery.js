/* eslint-disable @next/next/no-img-element */
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@/components/ui';
import { DraftAttachments } from '@/components/posts/DraftAttachments';
import { FullImage, snapshotThumbnail } from '@/components/posts/PostAttachments';
import { uploadPostFiles } from '@/lib/media/post-upload';
import { getPostDraft, putPostDraft, deletePostDraft } from '@/lib/media/post-draft-store';

export function EventGallery({ postId, manage=false, username=null, coverOnly=false }) {
  const [files,setFiles]=useState([]); const [canEdit,setCanEdit]=useState(false); const [visible,setVisible]=useState(manage);
  const [loaded,setLoaded]=useState(false); const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState([]); const [draftId,setDraftId]=useState(null); const draft=useRef(null); const uploaded=useRef(new Map());
  const [recovery,setRecovery]=useState(null); const [checking,setChecking]=useState(Boolean(manage)); const [lightbox,setLightbox]=useState(null); const root=useRef(null);
  const close=useCallback(()=>setLightbox(null),[]); const base=`/api/storage/event/${postId}`;
  const key=manage && username ? `event-edit:${username.toLowerCase()}:${postId}` : null;
  useEffect(()=>{let cancelled=false;if(!key)return undefined;getPostDraft(key).then(saved=>{if(!cancelled&&saved)setRecovery(saved);}).catch(()=>{if(!cancelled)setMessage('Browser recovery storage unavailable.');}).finally(()=>{if(!cancelled)setChecking(false);});return()=>{cancelled=true;};},[key]);
  const load=useCallback(async()=>{try{const r=await fetch(base,{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();setFiles(d.attachments||[]);setCanEdit(d.canEdit===true);setLoaded(true);}catch{setLoaded(true);setMessage('Could not load attachments. Refresh to retry.');}},[base]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{if(visible){load();return;}const target=root.current;if(!target)return;if(!('IntersectionObserver' in window)){setVisible(true);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'300px'});observer.observe(target);return()=>observer.disconnect();},[visible,load]);
  function resume(){draft.current=recovery.draft;uploaded.current=new Map(recovery.uploaded||[]);setDraftId(recovery.draft);setSelected(recovery.items.map(item=>({...item,preview:item.file.type.startsWith('image/')?URL.createObjectURL(item.file):null,progress:uploaded.current.has(item.id)?100:0})));setRecovery(null);setMessage('Recovered the previous upload. Retry or discard it.');}
  async function discard(){setBusy(true);try{const r=await fetch(`/api/storage/post-drafts/${draft.current || recovery.draft}?scope=event`,{method:'DELETE'});if(!r.ok)throw Error();await deletePostDraft(key);draft.current=null;uploaded.current.clear();setRecovery(null);setDraftId(null);setSelected([]);setMessage('');await load();}catch{setMessage('Could not discard the draft. Retry.');}finally{setBusy(false);}}
  async function save(){if(!selected.length)return;setBusy(true);setMessage('');if(!draft.current){draft.current=crypto.randomUUID();setDraftId(draft.current);}const id=draft.current;const snapshot={draft:id,items:selected.map(({id:itemId,file})=>({id:itemId,file})),uploaded:[...uploaded.current]};
    try{if(!key)throw Error('Account identity unavailable.');await putPostDraft(key,snapshot);const created=await fetch(`/api/storage/post-drafts/${id}?scope=event`,{method:'PUT'});if(!created.ok&&!selected.every(item=>uploaded.current.has(item.id)))throw Error('Could not start upload. Retry.');
      const result=await uploadPostFiles(id,selected.filter(item=>!uploaded.current.has(item.id)),{endpoint:`/api/storage/post-drafts/${id}?scope=event`,requireId:true,onProgress:(itemId,progress)=>setSelected(old=>old.map(item=>item.id===itemId?{...item,progress}:item)),onUploaded:async(itemId,fileId)=>{uploaded.current.set(itemId,fileId);snapshot.uploaded=[...uploaded.current];await putPostDraft(key,snapshot);setSelected(old=>old.map(item=>item.id===itemId?{...item,progress:100}:item));}});
      if(!result.ok)throw Error(result.error);const claim=await fetch(base,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:id,files:selected.map(item=>uploaded.current.get(item.id))})});if(!claim.ok)throw Error('Could not save attachments. Retry.');await deletePostDraft(key);draft.current=null;uploaded.current.clear();setDraftId(null);setSelected([]);await load();
    }catch(e){setMessage(e.message||'Attachment upload failed. Retry.');}finally{setBusy(false);}}
  async function remove(file){setBusy(true);setMessage('');try{const r=await fetch(`${base}/${file.id}`,{method:'DELETE'});if(!r.ok)throw Error();await load();}catch{setMessage('Could not remove attachment. Retry.');}finally{setBusy(false);}}
  function openImage(file){const img=root.current?.querySelector(`img[data-file-id="${file.id}"]`);setLightbox({file,preview:snapshotThumbnail(img)});}
  return <div ref={root}>
    {coverOnly && files.some(file=>file.mime_type.startsWith('image/')) ? <img src={`${base}/${files.find(file=>file.mime_type.startsWith('image/')).id}?size=thumb`} alt="" loading="lazy" className="aspect-video w-full rounded object-cover"/> : null}
    {!coverOnly && files.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{files.map(file=><div key={file.id} className="min-w-0 rounded border border-line p-1">{file.mime_type.startsWith('image/') ? <button type="button" onClick={()=>openImage(file)} aria-label={`View ${file.original_name}`}><img data-file-id={file.id} src={`${base}/${file.id}?size=thumb`} alt={file.original_name} loading="lazy" className="max-h-80 rounded object-contain"/></button> : <a href={`${base}/${file.id}`} className="block break-all p-2 text-sm underline">{file.original_name} · {(file.byte_size / 1024).toFixed(0)} KiB</a>}{manage&&canEdit?<button type="button" disabled={busy||!!draftId} onClick={()=>remove(file)} className="block text-xs underline">Remove</button>:null}</div>)}</div>:null}
    {!coverOnly && manage && canEdit ? <>
      {recovery?<p role="status" className="mt-2 text-xs">An upload is saved in this browser. <button type="button" disabled={busy} onClick={resume} className="underline">Resume</button> · <button type="button" disabled={busy} onClick={discard} className="underline">Discard</button></p>:null}
      {selected.length&&!draftId?<p className="mt-2 text-xs text-muted">A recovery copy is stored in this browser during upload. Avoid shared devices.</p>:null}
      <DraftAttachments scope="event" maxItems={8-files.length} items={selected} setItems={setSelected} disabled={busy||checking||!!recovery||!!draftId} busy={busy} postId={draftId} submit={selected.length?<Button type="button" size="sm" disabled={busy} onClick={save}>{busy?'Uploading…':'Upload files'}</Button>:null}/>
      {draftId&&!busy?<button type="button" className="text-xs underline" onClick={discard}>Discard upload draft</button>:null}
    </>:null}
    {message&&!coverOnly?<p role="status" className="mt-2 text-xs text-danger">{message}</p>:null}
    {!loaded&&visible?<p className="text-xs text-muted">Loading images…</p>:null}
    <Modal open={Boolean(lightbox)} onClose={close} title={lightbox?.file.original_name||'Image'} size="lg">{lightbox?<FullImage key={lightbox.file.id} postId={postId} file={lightbox.file} preview={lightbox.preview} basePath="/api/storage/event"/>:null}</Modal>
  </div>;
}
