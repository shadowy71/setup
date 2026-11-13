'use server';

import { revalidatePath } from 'next/cache';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { errors, fromPostgresError, toActionError } from '@/lib/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RLS is the authority on ownership, active accounts and blocking. */
export async function setFollowing(profileId, following) {
  try {
    const user = await getActiveUser();
    if (!user?.profile || user.needsProfileSetup) throw errors.unauthenticated();
    if (typeof profileId !== 'string' || !UUID.test(profileId) || profileId === user.profile.id || typeof following !== 'boolean') {
      throw errors.validation('That follow action is not valid.');
    }
    const db = await getServerClient();
    if (!db) throw errors.configuration();
    if (following) {
      const { error } = await db.from('user_follows').insert({ follower_id: user.profile.id, followed_id: profileId });
      if (error && error.code !== '23505') throw fromPostgresError(error);
    } else {
      const { error } = await db.from('user_follows').delete().eq('follower_id', user.profile.id).eq('followed_id', profileId);
      if (error) throw fromPostgresError(error);
    }
    revalidatePath('/home');
    revalidatePath('/user/[username]', 'page');
    return { ok: true, following };
  } catch (error) {
    return toActionError(error, 'Could not update this follow. Please try again.');
  }
}
