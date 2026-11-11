import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest';
const m=vi.hoisted(()=>({user:vi.fn(),client:vi.fn(),limit:vi.fn(),path:vi.fn()}));
vi.mock('@/lib/auth/session',()=>({getActiveUser:m.user}));
vi.mock('@/lib/supabase/server',()=>({getServerClient:m.client}));
vi.mock('@/lib/ratelimit',()=>({enforceRateLimit:m.limit}));
vi.mock('next/cache',()=>({revalidatePath:m.path}));
import { createListing } from '@/lib/actions/marketplace';
const file='f4b5c514-200e-4cae-912f-6b8d03f71589',draft='a3c50c2c-c061-497e-ae3a-0289944cd024',cat='d6c50c2c-c061-497e-ae3a-0289944cd024';
function form(withImages=true){const f=new FormData();f.set('title','Calculator');f.set('description','Working calculator');f.set('category_id',cat);f.set('condition','good');if(withImages){f.set('attachment_draft_id',draft);f.append('attachment_file_id',file);}return f;}
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('CAMPUS_MARKET_ATTACHMENTS_ENABLED','1');vi.stubEnv('CAMPUS_STORAGE_V3_ENABLED','1');m.user.mockResolvedValue({profile:{id:'owner'}});m.limit.mockResolvedValue();});
afterEach(()=>vi.unstubAllEnvs());
describe('marketplace draft publication',()=>{
  it('publishes images through a single atomic RPC',async()=>{
    const rpc=vi.fn().mockImplementation(async(name)=>name==='marketplace_requires_approval'?{data:false,error:null}:{data:cat,error:null});
    const from=vi.fn();m.client.mockResolvedValue({rpc,from});const result=await createListing(form());
    expect(result.ok).toBe(true);expect(result.id).toBe(cat);expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('publish_listing_with_draft',expect.objectContaining({p_draft:draft,p_files:[file],p_listing:expect.objectContaining({title:'Calculator',status:'active'})}));
  });
  it('fails closed when the feature is off without inserting a listing',async()=>{
    vi.stubEnv('CAMPUS_MARKET_ATTACHMENTS_ENABLED','0');const rpc=vi.fn().mockResolvedValue({data:false,error:null});const from=vi.fn();m.client.mockResolvedValue({rpc,from});
    expect((await createListing(form())).ok).toBe(false);expect(from).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalledWith('publish_listing_with_draft',expect.anything());
  });
  it('keeps image-free listing creation on the established path',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:false,error:null});const single=vi.fn().mockResolvedValue({data:{id:cat},error:null});const insert=vi.fn().mockReturnValue({select:()=>({single})});m.client.mockResolvedValue({rpc,from:()=>({insert})});
    expect((await createListing(form(false))).ok).toBe(true);expect(insert).toHaveBeenCalledWith(expect.objectContaining({seller_id:'owner',title:'Calculator'}));
  });
});
