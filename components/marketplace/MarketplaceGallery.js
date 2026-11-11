/* eslint-disable @next/next/no-img-element */
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@/components/ui';
import { DraftAttachments } from '@/components/posts/DraftAttachments';
import { FullImage, snapshotThumbnail } from '@/components/posts/PostAttachments';
import { uploadPostFiles } from '@/lib/media/post-upload';
import { getPostDraft, putPostDraft, deletePostDraft } from '@/lib/media/post-draft-store';

/** Gallery metadata and image bytes both come from listing-authorized endpoints. */
export function MarketplaceGallery({ listingId, manage=false, coverOnly=false, username=null }) {
  const [files,setFiles]=useState([]); const [canEdit,setCanEdit]=useState(false); const [visible,setVisible]=useState(manage);
  const [loaded,setLoaded]=useState(false); const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState([]); const [draftId,setDraftId]=useState(null); const draft=useRef(null); const uploaded=useRef(new Map());
  const [replaceId,setReplaceId]=useState(null); const [lightbox,setLightbox]=useState(null); const close=useCallback(()=>setLightbox(null),[]);
  const root=useRef(null); const input=useRef(null); const replacement=useRef(null);
  const [recovery,setRecovery]=useState(null); const [checking,setChecking]=useState(Boolean(manage));
  const key=manage && username ? `marketplace-edit:${username.toLowerCase()}:${listingId}` : null;
  useEffect(()=>{let cancelled=false;if(!key)return undefined;getPostDraft(key).then((saved)=>{if(!cancelled&&saved)setRecovery(saved);}).catch(()=>{if(!cancelled)setMessage('Browser recovery storage unavailable.');}).finally(()=>{if(!cancelled)setChecking(false);});return()=>{cancelled=true;};},[key]);
  function resume() {
    draft.current=recovery.draft;uploaded.current=new Map(recovery.uploaded||[]);setDraftId(recovery.draft);setReplaceId(recovery.replaceId||null);
    setSelected(recovery.items.map((item)=>({...item,preview:URL.createObjectURL(item.file),progress:uploaded.current.has(item.id)?100:0})));setRecovery(null);setMessage('Recovered the previous upload. Retry or discard it.');
  }
  const base=`/api/storage/marketplace/${listingId}`;
  const load=useCallback(async()=>{ try { const response=await fetch(base,{cache:'no-store'}); if(!response.ok) throw Error(); const data=await response.json(); setFiles(data.attachments||[]);setCanEdit(data.canEdit===true);setLoaded(true);return data.attachments||[]; } catch {setLoaded(true);setMessage('Could not load images. Refresh to retry.');return null;} },[base]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{if(visible){load();return;} const target=root.current;if(!target)return; if(!('IntersectionObserver' in window)){setVisible(true);return;} const observer=new IntersectionObserver((entries)=>{if(entries.some((e)=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'300px'});observer.observe(target);return()=>observer.disconnect();},[visible,load]);
  function openImage(file) { const img=root.current?.querySelector(`img[data-file-id="${file.id}"]`); setLightbox({file,preview:snapshotThumbnail(img)}); }
  async function reorder(next) {
    setBusy(true);setMessage(''); try {const response=await fetch(base,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:next.map((f)=>f.id)})});if(!response.ok)throw Error();setFiles(next);} catch {setMessage('Could not change image order. Refresh and retry.');await load();} finally {setBusy(false);}
  }
  async function remove(file) {
    setBusy(true);setMessage('');try {const response=await fetch(`${base}/${file.id}`,{method:'DELETE'});if(!response.ok)throw Error();await load();}catch{setMessage('Could not remove image. Retry.');}finally{setBusy(false);}
  }
  async function discard() {
    setBusy(true);try{const response=await fetch(`/api/storage/post-drafts/${draft.current || recovery.draft}?scope=marketplace`,{method:'DELETE'});if(!response.ok)throw Error();await deletePostDraft(key);setRecovery(null);draft.current=null;uploaded.current.clear();setDraftId(null);setSelected([]);setReplaceId(null);setMessage('');await load();}catch{setMessage('Could not discard the draft. Retry.');}finally{setBusy(false);}
  }
  async function saveImages() {
    if(!selected.length)return; setBusy(true);setMessage('');
    if(!draft.current){draft.current=crypto.randomUUID();setDraftId(draft.current);}
    const id=draft.current;
    const snapshot={draft:id,items:selected.map(({id:itemId,file})=>({id:itemId,file})),uploaded:[...uploaded.current],replaceId};
    try {
      if(!key) throw Error('Account identity unavailable.');
      await putPostDraft(key,snapshot);
      const create=await fetch(`/api/storage/post-drafts/${id}?scope=marketplace`,{method:'PUT'}); if(!create.ok && !selected.every((item)=>uploaded.current.has(item.id)))throw Error('Could not start upload. Retry.');
      const result=await uploadPostFiles(id,selected.filter((item)=>!uploaded.current.has(item.id)),{endpoint:`/api/storage/post-drafts/${id}?scope=marketplace`,requireId:true,onProgress:(itemId,progress)=>setSelected((old)=>old.map((item)=>item.id===itemId?{...item,progress}:item)),onUploaded:async(itemId,fileId)=>{uploaded.current.set(itemId,fileId);snapshot.uploaded=[...uploaded.current];await putPostDraft(key,snapshot);setSelected((old)=>old.map((item)=>item.id===itemId?{...item,progress:100}:item));}});
      if(!result.ok)throw Error(result.error);
      const claim=await fetch(base,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:id,files:selected.map((item)=>uploaded.current.get(item.id)),...(replaceId?{replace:replaceId}:{})})});if(!claim.ok)throw Error('Could not save images. Retry.');
      await deletePostDraft(key);draft.current=null;uploaded.current.clear();setDraftId(null);setSelected([]);setReplaceId(null);await load();
    } catch(e){setMessage(e.message||'Image upload failed. Retry.');}finally{setBusy(false);}
  }
  function chooseReplacement(event) {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>3*1024*1024){setMessage('Choose a JPEG, PNG or WebP image up to 3 MiB.');return;}
    setReplaceId(replacement.current);setSelected([{id:crypto.randomUUID(),file,preview:URL.createObjectURL(file),progress:0}]);setMessage('');
  }
  return <div ref={root} className={coverOnly?'mb-3':''}>
    {!loaded && (visible || coverOnly) ? <div aria-label="Loading images" className="aspect-video w-full animate-pulse rounded bg-surface-2"/> : null}
    {loaded && !files.length && coverOnly ? <div className="grid aspect-video place-items-center rounded bg-surface-2 text-xs text-muted">No photo</div> : null}
    {files.length && coverOnly ? <img src={`${base}/${files[0].id}?size=thumb`} alt="" loading="lazy" decoding="async" className="aspect-video w-full rounded object-cover"/> : null}
    {!coverOnly && files.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{files.map((file,index)=><div key={file.id} className="min-w-0 rounded border border-line p-1">
      <button type="button" className="block w-full" aria-label={`View ${file.original_name}`} onClick={()=>openImage(file)}><img data-file-id={file.id} src={`${base}/${file.id}?size=thumb`} alt={file.original_name} loading="lazy" decoding="async" className="mx-auto max-h-80 w-auto max-w-full rounded object-contain"/></button>
      {index===0?<span className="text-xs text-muted">Cover</span>:null}
      {manage && canEdit ? <div className="flex flex-wrap gap-2 text-xs"><button type="button" disabled={busy||!!draftId||index===0} onClick={()=>reorder([file,...files.filter((f)=>f.id!==file.id)])} className="underline">Make cover</button><button type="button" disabled={busy||!!draftId||index===0} onClick={()=>{const next=[...files];[next[index-1],next[index]]=[next[index],next[index-1]];reorder(next);}} className="underline">Earlier</button><button type="button" disabled={busy||!!draftId||index===files.length-1} onClick={()=>{const next=[...files];[next[index+1],next[index]]=[next[index],next[index+1]];reorder(next);}} className="underline">Later</button><button type="button" disabled={busy||checking||!!recovery||!!draftId||!!selected.length} onClick={()=>{replacement.current=file.id;input.current?.click();}} className="underline">Replace</button><button type="button" disabled={busy||!!draftId} onClick={()=>remove(file)} className="underline">Remove</button></div>:null}
    </div>)}</div>:null}
    {!coverOnly && manage && canEdit ? <>
      {recovery ? <p role="status" className="mt-2 text-xs text-muted">An image upload is saved on this browser. <button type="button" className="underline" disabled={busy} onClick={resume}>Resume</button> · <button type="button" className="underline" disabled={busy} onClick={discard}>Discard</button></p> : null}
      {selected.length && !draftId ? <p className="mt-2 text-xs text-muted">A recovery copy of selected images is stored in this browser when uploading, until saved or discarded. Avoid shared devices.</p> : null}
      <input ref={input} aria-label="Choose replacement image" type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseReplacement} disabled={busy} className="sr-only"/>
      <DraftAttachments scope="marketplace" imagesOnly maxItems={8-files.length} items={selected} setItems={setSelected} disabled={busy||checking||!!recovery||!!draftId||!!replaceId} busy={busy} postId={draftId} submit={selected.length?<Button type="button" size="sm" onClick={saveImages} disabled={busy}>{busy?'Uploading…':'Upload images'}</Button>:null}/>
      {draftId && !busy?<button type="button" className="text-xs underline" onClick={discard}>Discard upload draft</button>:null}
      {replaceId && !draftId && selected.length?<button type="button" className="text-xs underline" onClick={()=>{setReplaceId(null);setSelected([]);}}>Cancel replacement</button>:null}
    </>:null}
    {message&&!coverOnly?<p role="status" className="mt-2 text-xs text-danger">{message}</p>:null}
    <Modal open={Boolean(lightbox)} onClose={close} title={lightbox?.file.original_name||'Image'} size="lg">
      {lightbox?<FullImage key={lightbox.file.id} postId={listingId} file={lightbox.file} preview={lightbox.preview} basePath="/api/storage/marketplace"/>:null}
      {lightbox && files.length>1?<div className="mt-2 flex justify-between text-sm"><button type="button" onClick={()=>{const n=files.findIndex((f)=>f.id===lightbox.file.id);openImage(files[(n-1+files.length)%files.length]);}}>Previous</button><span>{files.findIndex((f)=>f.id===lightbox.file.id)+1} / {files.length}</span><button type="button" onClick={()=>{const n=files.findIndex((f)=>f.id===lightbox.file.id);openImage(files[(n+1)%files.length]);}}>Next</button></div>:null}
    </Modal>
  </div>;
}
