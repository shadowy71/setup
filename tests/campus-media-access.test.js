import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth/session', () => ({ getActiveUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: vi.fn() }));
vi.mock('@/lib/storage', () => ({ deleteFileByUploadKeyV3: vi.fn() }));
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/supabase/admin';
import { visibleSpace } from '@/lib/storage/space-attachments';
import { visibleEvent } from '@/lib/storage/event-attachments';
import { visibleNotice } from '@/lib/storage/notice-attachments';
const id='d6c50c2c-c061-497e-ae3a-0289944cd024';
const user={profile:{id:'owner',account_status:'active'},permissions:[]};
const db=(data,rpc=vi.fn().mockResolvedValue({data:false}))=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data,error:null})})})}),rpc});
beforeEach(()=>{vi.resetAllMocks();getActiveUser.mockResolvedValue(user);});
it.each([visibleSpace,visibleEvent,visibleNotice])('denies unauthenticated and RLS-inaccessible records before privileged access',async visible=>{
  getActiveUser.mockResolvedValueOnce(null); expect((await visible(id)).status).toBe(401);
  getServerClient.mockResolvedValue(db(null)); expect((await visible(id)).status).toBe(404);
  expect(getAdminClient).not.toHaveBeenCalled();
});
it('uses scoped space management rather than creator identity',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:true});getServerClient.mockResolvedValue(db({id,kind:'club',status:'published'},rpc));
  expect((await visibleSpace(id)).canManage).toBe(true);
  expect(rpc).toHaveBeenCalledWith('can_manage_space',{p_space:id});
  rpc.mockResolvedValue({error:{}});expect((await visibleSpace(id)).canManage).toBe(false);
});
it('allows submitter or club manager on drafts but not creator after publication',async()=>{
  const record={id,status:'draft',created_by:'owner',is_official:false,club_id:null};
  getServerClient.mockResolvedValue(db(record));expect((await visibleEvent(id)).canManage).toBe(true);
  record.status='published';expect((await visibleEvent(id)).canManage).toBe(false);
  record.status='draft';record.created_by='other';record.club_id=id;
  getServerClient.mockResolvedValue(db(record,vi.fn().mockResolvedValue({data:true})));expect((await visibleEvent(id)).canManage).toBe(true);
});
it('limits notice edits to manage_notices permission',async()=>{
  getServerClient.mockResolvedValue(db({id,status:'published'}));expect((await visibleNotice(id)).canManage).toBe(false);
  getActiveUser.mockResolvedValue({...user,permissions:['manage_notices']});expect((await visibleNotice(id)).canManage).toBe(true);
});
