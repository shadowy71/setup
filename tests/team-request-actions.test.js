import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), client: vi.fn(), revalidate: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate, revalidateTag: vi.fn(), unstable_cache: (fn) => fn }));
vi.mock('@/lib/auth/session', () => ({ getActiveUser: m.user }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: m.client }));
import { requestTeam, withdrawTeamRequest, decideTeamRequest } from '@/lib/actions/campus';
const uuid = 'bbf83b36-6bf8-4e47-84c4-47eadab72971';
let calls, result;
function db() { return { from(table) { calls.push(['table', table]); return {
  insert(v) { calls.push(['insert', v]); return this; }, update(v) { calls.push(['update', v]); return this; }, delete() { calls.push(['delete']); return this; },
  eq(k,v) { calls.push(['eq',k,v]); return this; }, select() { return this; },
  async single() { return result; }, async maybeSingle() { return result; },
}; } }; }
function form(values) { const f = new FormData(); for (const [k,v] of Object.entries(values)) f.set(k,v); return f; }
beforeEach(() => { vi.clearAllMocks(); calls = []; result = { data: { id: uuid, team_post_id: uuid }, error: null }; m.user.mockResolvedValue({profile:{id:'student'}}); m.client.mockResolvedValue(db()); });
describe('team request actions', () => {
  it('creates a pending request for the current user only', async () => {
    expect((await requestTeam(form({id:uuid,message:'Hi!'}))).ok).toBe(true);
    expect(calls).toContainEqual(['insert',{team_post_id:uuid,user_id:'student',message:'Hi!',status:'pending'}]);
  });
  it('validates input and does not write for bad IDs, oversized messages or bad decisions', async () => {
    expect((await requestTeam(form({id:'bad'}))).ok).toBe(false);
    expect((await requestTeam(form({id:uuid,message:'x'.repeat(501)}))).ok).toBe(false);
    expect((await decideTeamRequest(form({id:uuid,decision:'pending'}))).ok).toBe(false);
    expect(m.client).not.toHaveBeenCalled();
  });
  it('checks pending state for owner decisions and does not fake success on denied RLS', async () => {
    result = {data:null,error:null}; expect((await decideTeamRequest(form({id:uuid,decision:'accepted'}))).ok).toBe(false);
    expect(calls).toContainEqual(['eq','status','pending']);
  });
  it('scopes withdrawal to the current user', async () => {
    expect((await withdrawTeamRequest(form({id:uuid}))).ok).toBe(true); expect(calls).toContainEqual(['eq','user_id','student']);
  });
});
