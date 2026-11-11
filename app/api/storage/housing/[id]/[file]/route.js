import { NextResponse } from 'next/server';
import { visibleHousing, housingFile, cleanHousingFile } from '@/lib/storage/housing-attachments';
import { downloadPostAttachment, thumbnailPostAttachment } from '@/lib/storage/post-attachments';
import { sameOrigin } from '@/lib/storage/post-access';
import { UUID_REGEX } from '@/lib/constants';
export const dynamic='force-dynamic'; export const runtime='nodejs';
const noStore={'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'};
export async function GET(request,{params}) {
  const {id,file}=await params; const access=await visibleHousing(id); if(access.status || !UUID_REGEX.test(file || '')) return new NextResponse(null,{status:access.status || 404,headers:noStore});
  try {
    const metadata=await housingFile(id,file); if(!metadata || !/^[a-f0-9]{64}$/.test(metadata.checksum || '')) return new NextResponse(null,{status:404,headers:noStore});
    const thumb=new URL(request.url).searchParams.get('size')==='thumb' && metadata.mime_type.startsWith('image/'); const tag=`"${metadata.checksum}${thumb?'-thumb-v1':''}"`;
    const headers={...noStore,'Cache-Control':'private, no-cache, must-revalidate',ETag:tag,'Content-Type':thumb?'image/webp':metadata.mime_type,'Content-Disposition':metadata.mime_type === 'application/pdf' ? 'attachment' : 'inline','Content-Security-Policy':"default-src 'none'; sandbox"};
    if((request.headers.get('if-none-match') || '').split(',').some(v=>[tag,`W/${tag}`,'*'].includes(v.trim()))) return new NextResponse(null,{status:304,headers});
    return new NextResponse(await (thumb?thumbnailPostAttachment(metadata):downloadPostAttachment(metadata)),{headers});
  } catch {return new NextResponse(null,{status:503,headers:noStore});}
}
export async function DELETE(request,{params}) {
  if(!sameOrigin(request)) return NextResponse.json({error:'Invalid request.'},{status:403,headers:noStore});
  const {id,file}=await params; const access=await visibleHousing(id); if(access.status || !UUID_REGEX.test(file || '')) return NextResponse.json({error:'Unavailable.'},{status:access.status || 404,headers:noStore});
  if(access.post.creator_id!==access.user.profile.id) return NextResponse.json({error:'Not permitted.'},{status:403,headers:noStore});
  if(process.env.CAMPUS_HOUSING_ATTACHMENTS_ENABLED!=='1' || process.env.CAMPUS_STORAGE_V3_ENABLED!=='1') return NextResponse.json({error:'Attachments are disabled.'},{status:503,headers:noStore});
  try {const result=await access.db.rpc('housing_retire_attachment',{p_post:id,p_file:file}); if(result.error) throw Error(); const complete=await cleanHousingFile(file); return NextResponse.json({ok:true,cleanupPending:!complete},{headers:noStore});} catch {return NextResponse.json({error:'Removal failed.'},{status:503,headers:noStore});}
}
