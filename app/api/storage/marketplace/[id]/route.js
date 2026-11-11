import { NextResponse } from 'next/server';
import { visibleMarketplaceListing } from '@/lib/storage/marketplace-access';
import { marketplaceFiles, cleanupMarketplaceFile } from '@/lib/storage/marketplace-attachments';
import { sameOrigin } from '@/lib/storage/post-access';
import { UUID_REGEX } from '@/lib/constants';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
const json=(data,status=200)=>NextResponse.json(data,{status,headers});
export async function GET(_request,{params}) {
  const {id}=await params; const access=await visibleMarketplaceListing(id); if (access.status) return json({error:'Unavailable.'},access.status);
  try { const flag=await access.db.rpc('feature_enabled',{p_key:'marketplace_images'}); return json({attachments:await marketplaceFiles(id),canEdit:access.canEdit && !flag.error && flag.data===true && process.env.CAMPUS_MARKET_ATTACHMENTS_ENABLED==='1' && process.env.CAMPUS_STORAGE_V3_ENABLED==='1'}); }
  catch { return json({error:'Unavailable.'},503); }
}
export async function PATCH(request,{params}) {
  if (!sameOrigin(request)) return json({error:'Invalid request.'},403);
  const {id}=await params; const access=await visibleMarketplaceListing(id); if (access.status) return json({error:'Unavailable.'},access.status);
  if (!access.canEdit) return json({error:'Not permitted.'},403);
  if (process.env.CAMPUS_MARKET_ATTACHMENTS_ENABLED!=='1' || process.env.CAMPUS_STORAGE_V3_ENABLED!=='1') return json({error:'Attachments are disabled.'},503);
  try {
    if (Number(request.headers.get('content-length'))>2048 || !request.body) return json({error:'Invalid request.'},400);
    const reader=request.body.getReader(); let size=0; const chunks=[];
    while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>2048){await reader.cancel();return json({error:'Invalid request.'},400);} chunks.push(Buffer.from(value)); }
    const body=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
    if (body.replace !== undefined) {
      if (!UUID_REGEX.test(body.draft || '') || !UUID_REGEX.test(body.replace || '') || !Array.isArray(body.files) || body.files.length !== 1 || !UUID_REGEX.test(body.files[0] || '') || body.replace === body.files[0]) return json({error:'Invalid replacement.'},400);
      const result=await access.db.rpc('marketplace_claim_replacement',{p_listing:id,p_draft:body.draft,p_old:body.replace,p_new:body.files[0]});
      if (result.error) throw Error();
      const complete=await cleanupMarketplaceFile(body.replace); return json({ok:true,cleanupPending:!complete});
    }
    if (!Array.isArray(body.files) || body.files.length>8 || body.files.some((file)=>typeof file!=='string'||!UUID_REGEX.test(file))) return json({error:'Invalid images.'},400);
    const claim=body.draft !== undefined;
    if (claim && (!UUID_REGEX.test(body.draft || '') || !body.files.length)) return json({error:'Invalid draft.'},400);
    const result=claim ? await access.db.rpc('marketplace_claim_draft',{p_draft:body.draft,p_listing:id,p_files:body.files}) : await access.db.rpc('marketplace_reorder_images',{p_listing:id,p_files:body.files});
    if (result.error) throw Error(); return json({ok:true});
  } catch { return json({error:'Images could not be saved. Refresh and retry.'},409); }
}
