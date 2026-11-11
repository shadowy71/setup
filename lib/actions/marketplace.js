'use server';

/**
 * Marketplace, gigs and free stuff (spec §22–§25).
 *
 * The funnel is server-side by design: browsing never exposes `contact_note`;
 * "I'm interested" goes through `record_listing_interest()`, which records the
 * interaction, notifies the seller once and only then returns the note. Seller
 * contact continues in the normal DM system — there is no marketplace chat.
 */

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { enforceRateLimit } from '@/lib/ratelimit';
import { ROUTES, UUID_REGEX, GIG_STATE_LABELS } from '@/lib/constants';
import { validate, listingSchema, gigSchema, gigApplicationSchema, ratingSchema } from '@/lib/validation/schemas';
import { notify } from '@/lib/notifications';

export async function createListing(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'listing_create', user.profile.id);

    const payload = {
      title: formData.get('title'),
      description: formData.get('description'),
      price: formData.get('price'),
      is_free: formData.get('is_free') !== null,
      is_negotiable: formData.get('is_negotiable') !== null,
      condition: formData.get('condition') || 'not_applicable',
      location: formData.get('location'),
      contact_note: formData.get('contact_note'),
      category_id: formData.get('category_id'),
    };
    const checked = validate(payload, listingSchema);
    if (!checked.ok) throw errors.validation('Please check the listing details.', checked.errors);
    const values = checked.data;

    // Approval mode is a platform setting: pre-moderation parks the listing in
    // `pending`, post-moderation publishes immediately (default).
    const { data: approval } = await supabase.rpc('marketplace_requires_approval');
    const status = approval ? 'pending' : 'active';

    const draft = String(formData.get('attachment_draft_id') || '');
    const files = formData.getAll('attachment_file_id').map(String);
    const valuesToWrite = {
      category_id: values.category_id, title: values.title, description: values.description,
      price: values.is_free ? null : values.price ?? null, is_free: Boolean(values.is_free),
      is_negotiable: Boolean(values.is_negotiable), condition: values.condition || 'not_applicable',
      location: values.location || null, contact_note: values.contact_note || null, status,
    };
    let listingId; let error;
    if (draft || files.length) {
      if (process.env.CAMPUS_MARKET_ATTACHMENTS_ENABLED !== '1' || process.env.CAMPUS_STORAGE_V3_ENABLED !== '1' || !UUID_REGEX.test(draft) || !files.length || files.length > 8 || files.some((id) => !UUID_REGEX.test(id))) throw errors.validation('Invalid image draft.');
      const result = await supabase.rpc('publish_listing_with_draft', { p_draft: draft, p_id: randomUUID(), p_listing: valuesToWrite, p_files: files });
      listingId = result.data; error = result.error;
    } else {
      const result = await supabase.from('marketplace_listings').insert({ ...valuesToWrite, seller_id: user.profile.id }).select('id').single();
      listingId = result.data?.id; error = result.error;
    }
    if (error) throw fromPostgresError(error, { rls: 'You cannot create a listing right now.' });
    if (!listingId) throw errors.validation('Could not confirm the listing. Retry.');

    revalidatePath(ROUTES.market);
    revalidatePath(`${ROUTES.market}/free`);
    return { ok: true, id: listingId, href: ROUTES.listing(listingId), pending: status === 'pending' };
  } catch (error) {
    return toActionError(error, 'That listing could not be created.');
  }
}

export async function updateListing(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const checked = validate(
      {
        title: formData.get('title'),
        description: formData.get('description'),
        price: formData.get('price'),
        is_free: formData.get('is_free') !== null,
        is_negotiable: formData.get('is_negotiable') !== null,
        condition: formData.get('condition') || 'not_applicable',
        location: formData.get('location'),
        contact_note: formData.get('contact_note'),
        category_id: formData.get('category_id'),
      },
      listingSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the listing details.', checked.errors);
    const values = checked.data;

    const supabase = await getServerClient();
    const { error } = await supabase
      .from('marketplace_listings')
      .update({
        title: values.title,
        description: values.description,
        price: values.is_free ? null : values.price ?? null,
        is_free: Boolean(values.is_free),
        is_negotiable: Boolean(values.is_negotiable),
        condition: values.condition || 'not_applicable',
        location: values.location || null,
        contact_note: values.contact_note || null,
        category_id: values.category_id,
      })
      .eq('id', id);
    if (error) throw fromPostgresError(error);
    revalidatePath(ROUTES.listing(id));
    revalidatePath(ROUTES.market);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setListingStatus(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const status = String(formData.get('status') || '');
    if (!['active', 'reserved', 'sold', 'removed'].includes(status)) throw errors.validation('Unknown listing status.');
    const supabase = await getServerClient();
    const { error } = await supabase.from('marketplace_listings').update({ status }).eq('id', id);
    if (error) throw fromPostgresError(error, { rls: 'You cannot change that listing.' });
    revalidatePath(ROUTES.listing(id));
    revalidatePath(ROUTES.market);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Permanently delete a listing — distinct from "Remove listing"
 * (`setListingStatus('removed')`), which only hides it. RLS
 * (`listings_delete_own`, migration 008) already restricts this to the
 * listing's own seller or marketplace staff, so this cannot reach another
 * student's listing. A sold listing is kept out of this path on purpose: it
 * may be the only record of a completed trade a counterparty's rating points
 * back to, so a seller who wants it gone uses "Remove listing" instead, which
 * still hides it from Browse.
 */
export async function deleteListing(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();

    const { data: listing, error: fetchError } = await supabase
      .from('marketplace_listings')
      .select('id, seller_id, status')
      .eq('id', id)
      .maybeSingle();
    if (fetchError) throw fromPostgresError(fetchError);
    if (!listing) throw errors.notFound('That listing could not be found.');
    if (listing.seller_id !== user.profile.id) {
      throw errors.forbidden('Only the seller can delete this listing.');
    }
    if (listing.status === 'sold') {
      throw errors.validation('A completed listing cannot be deleted — remove it instead to hide it from Browse.');
    }

    const { error } = await supabase.from('marketplace_listings').delete().eq('id', id);
    if (error) throw fromPostgresError(error, { rls: 'You cannot delete that listing.' });

    revalidatePath(ROUTES.market);
    revalidatePath(`${ROUTES.market}/free`);
    return { ok: true, href: ROUTES.market };
  } catch (error) {
    return toActionError(error, 'That listing could not be deleted.');
  }
}

/** The single path that reveals a seller's contact note (and gets them notified). */
export async function expressInterest(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const listingId = String(formData.get('listing_id') || '');
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('record_listing_interest', { p_listing: listingId });
    if (error) throw fromPostgresError(error, { rls: 'You cannot contact this seller.' });
    revalidatePath(ROUTES.listing(listingId));
    return { ok: true, result: data };
  } catch (error) {
    return toActionError(error, 'That seller could not be reached.');
  }
}

export async function markListingSold(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const buyer = String(formData.get('buyer_id') || '') || null;
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('mark_listing_completed', { p_listing: id, p_buyer: buyer });
    if (error) throw fromPostgresError(error, { rls: 'Only the seller can complete a listing.' });
    revalidatePath(ROUTES.listing(id));
    revalidatePath(ROUTES.market);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function rateCounterparty(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('listing_id') || '');
    const checked = validate(
      { listing_id: id, score: formData.get('score'), comment: formData.get('comment') },
      { ...ratingSchema, listing_id: ratingSchema.listing_id },
    );
    if (!checked.ok) throw errors.validation('Please choose a rating.', checked.errors);
    const supabase = await getServerClient();
    const { error } = await supabase.from('ratings').insert({
      listing_id: checked.data.listing_id,
      rater_id: user.profile.id,
      ratee_id: checked.data.ratee_id,
      role: checked.data.role,
      score: checked.data.score,
      comment: checked.data.comment || null,
    });
    if (error) throw fromPostgresError(error, { unique: 'You have already rated this exchange.' });
    revalidatePath(ROUTES.listing(id));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * The gig form offers the same categories the board filters by. A category is
 * stored twice on purpose (the FK for filtering, the name for display); this
 * resolves the two so they can never disagree.
 */
async function resolveGigCategory(supabase, formData) {
  const rawId = String(formData.get('category_id') || '').trim();
  const rawName = String(formData.get('category') || '').trim();
  if (!rawId) return { category_id: null, category: rawName };
  if (!UUID_REGEX.test(rawId)) throw errors.validation('Choose a valid category.', { category: 'Choose a valid category.' });
  const { data } = await supabase
    .from('marketplace_categories')
    .select('id, name, scope')
    .eq('id', rawId)
    .maybeSingle();
  if (!data || data.scope !== 'gig') {
    throw errors.validation('Choose a valid category.', { category: 'Choose a valid category.' });
  }
  // The category row is authoritative when an id was chosen; the legacy
  // free-text field is only a fallback for rows written before the FK existed.
  return { category_id: data.id, category: data.name };
}

/** Read the gig fields from a form and run them through the shared schema. */
function readGigForm(formData, category) {
  return validate(
    {
      title: formData.get('title'),
      description: formData.get('description'),
      category: category.category,
      category_id: category.category_id,
      skills: formData.get('skills'),
      payment_type: formData.get('payment_type') || 'unpaid',
      compensation: formData.get('compensation'),
      availability: formData.get('availability'),
      deadline: formData.get('deadline'),
      contact_details: formData.get('contact_details'),
    },
    gigSchema,
  );
}

/** Map a validated gig form onto the gigs table's columns (one shape, two callers). */
function gigRow(values) {
  return {
    title: values.title,
    description: values.description,
    category: values.category,
    category_id: values.category_id || null,
    skills: values.skills || [],
    payment_type: values.payment_type,
    compensation: values.compensation || null,
    availability: values.availability || null,
    deadline: values.deadline || null,
    contact_details: values.contact_details || null,
  };
}

function revalidateGigPaths(id = null) {
  revalidatePath(ROUTES.gigs);
  revalidatePath(ROUTES.market);
  if (id) revalidatePath(ROUTES.gig(id));
}

export async function createGig(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'gig_create', user.profile.id);

    const category = await resolveGigCategory(supabase, formData);
    const checked = readGigForm(formData, category);
    if (!checked.ok) throw errors.validation('Please check the gig details.', checked.errors);

    const { data, error } = await supabase
      .from('gigs')
      .insert({
        creator_id: user.profile.id,
        ...gigRow(checked.data),
        // Moderation state and poster lifecycle are separate: a new gig is
        // published (the platform is post-moderated) and open (accepting
        // applications until its owner closes it).
        status: 'published',
        state: 'open',
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot post a gig right now.' });
    revalidateGigPaths(data.id);
    return { ok: true, id: data.id, href: ROUTES.gig(data.id) };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateGig(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    if (!UUID_REGEX.test(id)) throw errors.notFound('That gig could not be found.');

    const supabase = await getServerClient();
    const category = await resolveGigCategory(supabase, formData);
    const checked = readGigForm(formData, category);
    if (!checked.ok) throw errors.validation('Please check the gig details.', checked.errors);

    // Scoped to the owner as well as RLS: a non-owner gets "not found", never a
    // silent success that changed nothing.
    const { data, error } = await supabase
      .from('gigs')
      .update(gigRow(checked.data))
      .eq('id', id)
      .eq('creator_id', user.profile.id)
      .select('id')
      .maybeSingle();
    if (error) throw fromPostgresError(error, { rls: 'You can only edit your own gigs.' });
    if (!data) throw errors.notFound('You can only edit your own gigs.');
    revalidateGigPaths(id);
    return { ok: true, id, href: ROUTES.gig(id) };
  } catch (error) {
    return toActionError(error);
  }
}

/** Open → closed → completed (and back to open) is the poster's decision. */
export async function setGigState(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const state = String(formData.get('state') || '');
    if (!UUID_REGEX.test(id)) throw errors.notFound('That gig could not be found.');
    if (!GIG_STATE_LABELS[state]) throw errors.validation('Choose a valid gig status.');

    const supabase = await getServerClient();
    const { data, error } = await supabase
      .from('gigs')
      .update({ state })
      .eq('id', id)
      .eq('creator_id', user.profile.id)
      .select('id')
      .maybeSingle();
    if (error) throw fromPostgresError(error, { rls: 'You can only manage your own gigs.' });
    if (!data) throw errors.notFound('You can only manage your own gigs.');
    revalidateGigPaths(id);
    return { ok: true, id, state };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Closing a gig used to soft-delete it (`status = 'deleted'`), which removed it
 * from its own detail page and made "closed" indistinguishable from "removed by
 * a moderator". Closing now sets the lifecycle to `closed`, which is what the
 * board and the detail page render.
 */
export async function closeGig(formData) {
  const data = new FormData();
  data.set('id', String(formData.get('id') || ''));
  data.set('state', 'closed');
  return setGigState(data);
}

/** Remove a gig: a soft delete, so reports and moderation history stay intact. */
export async function deleteGig(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    if (!UUID_REGEX.test(id)) throw errors.notFound('That gig could not be found.');
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('delete_own_content', { p_target_type: 'gig', p_target_id: id });
    if (error) throw fromPostgresError(error, { rls: 'You can only delete your own gigs.' });
    revalidateGigPaths(id);
    return { ok: true, deleted: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function applyToGig(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'gig_apply', user.profile.id);

    const checked = validate(
      { gig_id: formData.get('gig_id'), message: formData.get('message') },
      gigApplicationSchema,
    );
    if (!checked.ok) throw errors.validation('Please write a short application.', checked.errors);

    // Read the gig first: RLS allows selecting it only when it is visible, and
    // the notification needs its title and owner.
    const { data: gig } = await supabase
      .from('gigs')
      .select('id, title, creator_id, state, status')
      .eq('id', checked.data.gig_id)
      .maybeSingle();
    if (!gig) throw errors.notFound('That gig could not be found.');
    if (gig.creator_id === user.profile.id) throw errors.validation('You cannot apply to your own gig.');
    if (gig.status !== 'published' || gig.state !== 'open') {
      throw errors.validation('This gig is no longer accepting applications.');
    }

    const { data, error } = await supabase
      .from('gig_applications')
      .insert({
        gig_id: gig.id,
        applicant_id: user.profile.id,
        message: checked.data.message,
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { unique: 'You have already applied to this gig.', rls: 'You cannot apply to this gig.' });

    await notify(supabase, {
      recipientId: gig.creator_id,
      type: 'marketplace_status',
      title: 'New gig application',
      body: `${user.profile.display_name || user.profile.username || 'A student'} applied to "${gig.title}".`,
      referenceType: 'gig',
      referenceId: gig.id,
      url: ROUTES.gig(gig.id),
    });

    revalidateGigPaths(gig.id);
    return { ok: true, id: data.id };
  } catch (error) {
    return toActionError(error);
  }
}

export async function withdrawGigApplication(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    if (!UUID_REGEX.test(id)) throw errors.notFound('That application could not be found.');
    const supabase = await getServerClient();
    const { data, error } = await supabase
      .from('gig_applications')
      .update({ status: 'withdrawn' })
      .eq('id', id)
      .eq('applicant_id', user.profile.id)
      .select('gig_id')
      .maybeSingle();
    if (error) throw fromPostgresError(error, { rls: 'You can only withdraw your own application.' });
    if (!data) throw errors.notFound('That application could not be found.');
    revalidateGigPaths(data.gig_id);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function decideGigApplication(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const decision = String(formData.get('decision') || '');
    if (!UUID_REGEX.test(id)) throw errors.notFound('That application could not be found.');
    if (!['accepted', 'declined'].includes(decision)) throw errors.validation('Choose accept or decline.');

    const supabase = await getServerClient();
    // The guard trigger stamps decided_by/decided_at and only lets the gig
    // owner decide, so this update is safe even if the id is guessed.
    const { data, error } = await supabase
      .from('gig_applications')
      .update({ status: decision })
      .eq('id', id)
      .select('id, gig_id, applicant_id, gigs(id,title)')
      .maybeSingle();
    if (error) throw fromPostgresError(error, { rls: 'Only the gig owner can decide an application.' });
    if (!data) throw errors.notFound('That application could not be found.');

    const gig = Array.isArray(data.gigs) ? data.gigs[0] : data.gigs;
    if (data.applicant_id) {
      await notify(supabase, {
        recipientId: data.applicant_id,
        type: 'marketplace_status',
        title: decision === 'accepted' ? 'Your gig application was accepted' : 'Your gig application was declined',
        body: gig?.title ? `"${gig.title}" — ${decision}.` : `Your application was ${decision}.`,
        referenceType: 'gig',
        referenceId: data.gig_id,
        url: ROUTES.gig(data.gig_id),
      });
    }

    revalidateGigPaths(data.gig_id);
    return { ok: true, id, status: decision };
  } catch (error) {
    return toActionError(error);
  }
}
