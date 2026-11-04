'use server';

/**
 * Moderation (spec §24, §51, §52).
 *
 * Every action goes through a SECURITY DEFINER function that re-checks the
 * caller's permission, writes the moderation record and appends an audit entry
 * (`moderate_content`, `resolve_report`, `assign_report`). The UI only decides
 * which controls to render — a forged request still fails server-side.
 */

import { revalidatePath, revalidateTag } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { validate } from '@/lib/validation/schemas';
import { vEnum, vUuid, vOptionalString } from '@/lib/validation/primitives';
import { ROUTES, REPORT_STATUS, MODERATION_TARGET_TYPES, MODERATION_VERBS } from '@/lib/constants';
import { PUBLIC_TAGS } from '@/lib/data/public-tags';

const targetType = (v) => vEnum(v, MODERATION_TARGET_TYPES, { label: 'Content type' });
const verb = (v) => vEnum(v, MODERATION_VERBS, { label: 'Action' });
const reason = (v) => vOptionalString(v, { max: 500, label: 'Reason' });

function assertStaff(user) {
  const actor = toActor(user);
  if (!can(actor, 'review_reports') && !can(actor, 'moderate_all') && !can(actor, 'view_moderation_logs')) {
    throw errors.forbidden('Moderation tools are not available for your account.');
  }
  return user;
}

async function runModeration({ target_type, target_ref, action, note, report_id }) {
  const checked = validate(
    { target_type, target_ref, action, reason: note, report_id: report_id || null },
    {
      target_type: targetType,
      target_ref: (v) => vUuid(v, { label: 'Item' }),
      action: verb,
      reason,
      report_id: (v) => vUuid(v, { label: 'Report', required: false }),
    },
  );
  if (!checked.ok) throw errors.validation('That moderation action is not valid.', checked.errors);

  const supabase = await getServerClient();
  const { data, error } = await supabase.rpc('moderate_content', {
    p_target_type: checked.data.target_type,
    p_target_id: checked.data.target_ref,
    p_action: checked.data.action,
    p_reason: checked.data.reason || null,
    p_report_id: checked.data.report_id || null,
  });
  if (error) throw fromPostgresError(error, { rls: 'That action is not allowed.' });
  return data;
}

/** Hide / remove / restore / approve / reject, or pin / unpin a post. */
export async function moderateContent(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    assertStaff(user);
    const result = await runModeration({
      target_type: formData.get('target_type'),
      target_ref: formData.get('target_ref'),
      action: formData.get('action'),
      note: formData.get('reason'),
      report_id: formData.get('report_id'),
    });
    revalidatePath(ROUTES.moderator);
    revalidatePath(ROUTES.home);
    if (['pin', 'unpin'].includes(formData.get('action'))) {
      revalidatePath(ROUTES.post(formData.get('target_ref')));
      revalidatePath('/communities/[slug]', 'page');
      revalidatePath('/c/[slug]', 'page');
      revalidateTag(PUBLIC_TAGS.clubs);
    }
    return { ok: true, result };
  } catch (error) {
    return toActionError(error);
  }
}

/** Close a report, optionally acting on the reported content at the same time. */
export async function resolveReport(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    assertStaff(user);

    const checked = validate(
      {
        report_id: formData.get('report_id'),
        status: formData.get('status'),
        resolution: formData.get('resolution'),
        target_action: formData.get('target_action') || null,
      },
      {
        report_id: (v) => vUuid(v, { label: 'Report' }),
        status: (v) => vEnum(v, REPORT_STATUS, { label: 'Status' }),
        resolution: (v) => vOptionalString(v, { max: 1000, label: 'Resolution' }),
        target_action: (v) => vEnum(v, [...MODERATION_VERBS, 'none'], { label: 'Action' }),
      },
    );
    if (!checked.ok) throw errors.validation('That resolution is not valid.', checked.errors);

    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('resolve_report', {
      p_report_id: checked.data.report_id,
      p_status: checked.data.status,
      p_resolution: checked.data.resolution || null,
      p_target_action: checked.data.target_action && checked.data.target_action !== 'none'
        ? checked.data.target_action
        : null,
    });
    if (error) throw fromPostgresError(error, { rls: 'That report cannot be resolved by you.' });

    revalidatePath(ROUTES.moderator);
    return { ok: true, result: data };
  } catch (error) {
    return toActionError(error);
  }
}

/** Claim a report (assign to me) or hand it to another moderator. */
export async function assignReport(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    assertStaff(user);
    const checked = validate(
      { report_id: formData.get('report_id'), to: formData.get('to') || null },
      {
        report_id: (v) => vUuid(v, { label: 'Report' }),
        to: (v) => vUuid(v, { label: 'Moderator', required: false }),
      },
    );
    if (!checked.ok) throw errors.validation('That assignment is not valid.', checked.errors);

    const supabase = await getServerClient();
    const { error } = await supabase.rpc('assign_report', {
      p_report: checked.data.report_id,
      p_to: checked.data.to || null,
    });
    if (error) throw fromPostgresError(error, { rls: 'That report cannot be assigned by you.' });
    revalidatePath(ROUTES.moderator);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Marketplace moderation (spec §18/§51): review, approve, hide, restore, remove.
 * Routed through `moderate_content()` so the audit trail is identical.
 */
export async function moderateListing(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const actor = toActor(user);
    if (!can(actor, 'moderate_marketplace') && !can(actor, 'moderate_all')) {
      throw errors.forbidden('Marketplace moderation is not available for your account.');
    }
    const result = await runModeration({
      target_type: 'marketplace_listing',
      target_ref: formData.get('listing_id'),
      action: formData.get('action'),
      note: formData.get('reason') || formData.get('note'),
    });
    revalidatePath(ROUTES.moderator);
    revalidatePath(ROUTES.market);
    return { ok: true, result };
  } catch (error) {
    return toActionError(error);
  }
}

/** Random reports: reviewers with `moderate_random` (or full moderation) only. */
export async function reviewRandomReport(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const actor = toActor(user);
    if (!can(actor, 'moderate_random') && !can(actor, 'moderate_all')) {
      throw errors.forbidden('Random reports are not available for your account.');
    }

    const checked = validate(
      {
        report_id: formData.get('report_id'),
        status: formData.get('status'),
        resolution: formData.get('resolution'),
      },
      {
        report_id: (v) => vUuid(v, { label: 'Report' }),
        status: (v) => vEnum(v, REPORT_STATUS, { label: 'Status' }),
        resolution: (v) => vOptionalString(v, { max: 1000, label: 'Resolution' }),
      },
    );
    if (!checked.ok) throw errors.validation('That Random review is not valid.', checked.errors);

    const supabase = await getServerClient();
    const { error } = await supabase
      .from('random_reports')
      .update({
        status: checked.data.status,
        resolution: checked.data.resolution || null,
        reviewed_by: user.profile.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', checked.data.report_id);
    if (error) throw fromPostgresError(error, { rls: 'You cannot review Random reports.' });

    revalidatePath(ROUTES.moderator);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
