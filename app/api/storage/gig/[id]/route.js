import { NextResponse } from 'next/server';
import { visibleGig, gigFiles } from '@/lib/storage/gig-attachments';
import { sameOrigin } from '@/lib/storage/post-access';
import { UUID_REGEX } from '@/lib/constants';
export const dynamic='force-dynamic'; export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
const json=(data,status=200)=>NextResponse.json(data,{status,headers});
export async function GET(_request,{params}) {
  const {id}=await params; const access=await visibleGig(id); if(access.status) return json({error:'Unavailable.'},access.status);
  try { const flag=await access.db.rpc('feature_enabled',{p_key:'gig_attachments'}); return json({attachments:await gigFiles(id),canEdit:access.post.creator_id===access.user.profile.id && access.post.status==='published' && !flag.error && flag.data===true && process.env.CAMPUS_GIG_ATTACHMENTS_ENABLED==='1' && process.env.CAMPUS_STORAGE_V3_ENABLED==='1'}); } catch {return json({error:'Unavailable.'},503);}
}
export async function PATCH(request,{params}) {
  if(!sameOrigin(request)) return json({error:'Invalid request.'},403);
  const {id}=await params; const access=await visibleGig(id); if(access.status) return json({error:'Unavailable.'},access.status);
  if(access.post.creator_id!==access.user.profile.id) return json({error:'Not permitted.'},403);
  if(process.env.CAMPUS_GIG_ATTACHMENTS_ENABLED!=='1' || process.env.CAMPUS_STORAGE_V3_ENABLED!=='1') return json({error:'Attachments are disabled.'},503);
  try {
    if(Number(request.headers.get('content-length'))>2048 || !request.body) return json({error:'Invalid request.'},400);
    const reader=request.body.getReader(); const chunks=[]; let size=0;
    while(true) {const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>2048){await reader.cancel();return json({error:'Invalid request.'},400);} chunks.push(Buffer.from(value));}
    const body=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    if(!UUID_REGEX.test(body.draft || '') || !Array.isArray(body.files) || !body.files.length || body.files.length>8 || body.files.some(f=>typeof f!=='string' || !UUID_REGEX.test(f))) return json({error:'Invalid draft.'},400);
    const result=await access.db.rpc('gig_claim_draft',{p_draft:body.draft,p_post:id,p_files:body.files}); if(result.error) throw Error(); return json({ok:true});
  } catch {return json({error:'Attachments could not be saved. Refresh and retry.'},409);}
}
