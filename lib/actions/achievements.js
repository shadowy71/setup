'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { UUID_REGEX } from '@/lib/constants';
import { can, toActor } from '@/lib/permissions/authorization';
import { errors, fromPostgresError, toActionError } from '@/lib/errors';
import { validate, vString, vEnum, vDate } from '@/lib/validation/primitives';
const schema = {
  title: (v) => vString(v, { min: 3, max: 140, label: 'Title', allowNewlines: false }),
  description: (v) => vString(v, { min: 5, max: 1000, label: 'Description' }),
  category: (v) => vEnum(v, ['academic','competition','community','creative','sport','other'], { label: 'Category' }),
  achieved_on: (v) => vDate(v, { label: 'Date' }),
};
export async function saveProfileAchievement(formData) {
  try {
    const user = await getActiveUser();
    if (!user?.profile?.id) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    if (id && !UUID_REGEX.test(id)) throw errors.notFound('Achievement not found.');
    const checked = validate(Object.fromEntries(Object.keys(schema).map((key) => [key, formData.get(key)])), schema);
    if (!checked.ok) throw errors.validation('Please check the achievement.', checked.errors);
    const db = await getServerClient();
    const row = { ...checked.data, achieved_on: checked.data.achieved_on || null };
    const draft = String(formData.get('attachment_draft_id') || '');
    const files = formData.getAll('attachment_file_id').map(String);
    let data; let error;
    if (draft || files.length) {
      if (id || process.env.CAMPUS_ACHIEVEMENT_ATTACHMENTS_ENABLED !== '1' || process.env.CAMPUS_STORAGE_V3_ENABLED !== '1' || !UUID_REGEX.test(draft) || !files.length || files.length > 8 || files.some((file) => !UUID_REGEX.test(file))) throw errors.validation('Invalid attachment draft.');
      const result = await db.rpc('publish_achievement_with_draft', { p_draft: draft, p_id: randomUUID(), p_post: row, p_files: files }); data = result.data ? { id: result.data } : null; error = result.error;
    } else {
      const query = id ? db.from('profile_achievements').update(row).eq('id', id).eq('owner_id', user.profile.id) : db.from('profile_achievements').insert({ ...row, owner_id: user.profile.id });
      ({ data, error } = await query.select('id').maybeSingle());
    }
    if (error) throw fromPostgresError(error, { rls: 'You cannot save that achievement.' });
    if (!data) throw errors.notFound('Achievement not found.');
    revalidatePath('/profile'); revalidatePath(`/user/${user.profile.username}`);
    return { ok: true, href: '/profile' };
  } catch (error) { return toActionError(error); }
}
export async function deleteProfileAchievement(formData) {
  try {
    const user = await getActiveUser();
    if (!user?.profile?.id) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    if (!UUID_REGEX.test(id)) throw errors.notFound('Achievement not found.');
    const db = await getServerClient();
    const { data, error } = await db.from('profile_achievements').delete().eq('id', id).eq('owner_id', user.profile.id).select('id').maybeSingle();
    if (error) throw fromPostgresError(error); if (!data) throw errors.notFound('Achievement not found.');
    revalidatePath('/profile'); revalidatePath(`/user/${user.profile.username}`); return { ok: true };
  } catch (error) { return toActionError(error); }
}
export async function moderateProfileAchievement(formData) {
  try {
    const user = await getActiveUser();
    if (!user?.profile?.id) throw errors.unauthenticated();
    if (!can(toActor(user), 'moderate_all')) throw errors.forbidden();
    const id = String(formData.get('id') || ''); const status = String(formData.get('status') || '');
    if (!UUID_REGEX.test(id)) throw errors.notFound('Achievement not found.');
    if (!['published','hidden','removed'].includes(status)) throw errors.validation('Invalid status.');
    const db = await getServerClient();
    const { data, error } = await db.from('profile_achievements').update({ status }).eq('id', id).select('id').maybeSingle();
    if (error) throw fromPostgresError(error); if (!data) throw errors.notFound('Achievement not found.');
    revalidatePath('/profile'); revalidatePath('/user/[username]', 'page'); return { ok: true };
  } catch (error) { return toActionError(error); }
}
