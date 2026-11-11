import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), client: vi.fn(), path: vi.fn(), tag: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getActiveUser: mocks.user }));
vi.mock('@/lib/supabase/server', () => ({ getServerClient: mocks.client }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.path, revalidateTag: mocks.tag }));
import { editPostText } from '@/lib/actions/social';
const id = 'd6c50c2c-c061-497e-ae3a-0289944cd024';
function form(body) { const data = new FormData(); data.set('id', id); data.set('body', body); return data; }
beforeEach(() => { vi.resetAllMocks(); });
describe('post text editing', () => {
  it('requires an authenticated active profile and valid text', async () => {
    mocks.user.mockResolvedValueOnce(null).mockResolvedValue({ profile: { id: 'owner' } });
    expect((await editPostText(form('body'))).ok).toBe(false);
    expect((await editPostText(form('   '))).ok).toBe(false);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('updates only the current owner published post text and leaves attachment data untouched', async () => {
    const calls = []; const q = { update(value) { calls.push(['update',value]); return this; }, eq(key,value) { calls.push(['eq',key,value]); return this; }, in(key,value) { calls.push(['in',key,value]); return this; }, select(value) { calls.push(['select',value]); return this; }, async maybeSingle() { return { data: { id }, error: null }; } };
    mocks.user.mockResolvedValue({ profile: { id: 'owner' } }); mocks.client.mockResolvedValue({ from: (table) => { calls.push(['from',table]); return q; } });
    expect((await editPostText(form(' revised '))).ok).toBe(true);
    expect(calls).toContainEqual(['update',{ body: 'revised' }]); expect(calls).toContainEqual(['eq','author_id','owner']); expect(calls).toContainEqual(['eq','status','published']);
    expect(calls.filter((entry) => entry[0] === 'from')).toEqual([['from','posts']]);
  });
});
