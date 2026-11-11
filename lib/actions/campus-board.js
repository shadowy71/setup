'use server';
import { revalidatePath } from 'next/cache';
import { getActiveUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { UUID_REGEX } from '@/lib/constants';
import { errors, fromPostgresError, toActionError } from '@/lib/errors';
import { validate, lostFoundSchema, housingSchema, rideSchema, teamPostSchema, projectSchema } from '@/lib/validation/schemas';

/** Edit and remove a student's own board content without changing moderation state. */
const OWN_BOARD_TYPES = {
  lostfound: { table: 'lost_found', schema: lostFoundSchema, fields: ['kind', 'title', 'description', 'location', 'occurred_on'], optional: ['location', 'occurred_on'], path: '/campus/lost-found' },
  housing: { table: 'housing_posts', schema: housingSchema, fields: ['title', 'description', 'area', 'budget', 'room_type', 'available_from'], optional: ['budget', 'available_from'], path: '/campus/housing' },
  rides: { table: 'ride_posts', schema: rideSchema, fields: ['ride_kind', 'origin', 'destination', 'ride_date', 'ride_time', 'description', 'seats'], optional: ['ride_kind', 'ride_time', 'seats'], path: '/campus/rides' },
  teams: { table: 'team_posts', schema: teamPostSchema, fields: ['project_id', 'project_name', 'description', 'required_skills', 'team_size', 'deadline'], optional: ['project_id', 'team_size', 'deadline'], path: '/campus/teams' },
  projects: { table: 'projects', schema: projectSchema, fields: ['title', 'description', 'technologies', 'repo_url', 'live_url', 'team_members'], optional: ['repo_url', 'live_url', 'team_members'], path: '/explore/projects' },
};

async function mutateOwnBoard(formData, remove) {
  try {
    const user = await getActiveUser();
    if (!user?.profile?.id) throw errors.unauthenticated();
    const type = String(formData.get('type') || '');
    const spec = OWN_BOARD_TYPES[type];
    const id = String(formData.get('id') || '');
    if (!spec || !UUID_REGEX.test(id)) throw errors.notFound('That post could not be found.');
    let row;
    if (!remove) {
      const checked = validate(Object.fromEntries(spec.fields.map((field) => [field, formData.get(field)])), spec.schema);
      if (!checked.ok) throw errors.validation('Please check the details.', checked.errors);
      row = { ...checked.data };
      // Older clients do not send fields introduced in later migrations.
      for (const field of ['ride_kind', 'project_id']) if (!formData.has(field)) delete row[field];
      for (const field of spec.optional) if (field in row && (row[field] === '' || row[field] === undefined)) row[field] = null;
    }
    const db = await getServerClient();
    const mutation = remove ? db.from(spec.table).delete() : db.from(spec.table).update(row);
    const { data, error } = await mutation.eq('id', id).eq('creator_id', user.profile.id).select('id').maybeSingle();
    if (error) throw fromPostgresError(error, { rls: 'You can only change your own posts.' });
    if (!data) throw errors.notFound('You can only change your own posts.');
    revalidatePath(spec.path);
    if (['projects', 'lostfound', 'teams'].includes(type)) revalidatePath(`${spec.path}/${id}`);
    return { ok: true, href: remove || !['projects', 'lostfound', 'teams'].includes(type) ? spec.path : `${spec.path}/${id}` };
  } catch (error) { return toActionError(error); }
}

export async function updateOwnCampusBoard(formData) { return mutateOwnBoard(formData, false); }
export async function deleteOwnCampusBoard(formData) { return mutateOwnBoard(formData, true); }

