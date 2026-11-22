/**
 * Email domain classification.
 *
 * Two questions, deliberately kept apart:
 *
 *   `isAllowedInstitutionalEmail()` — "is this an institutional address?"
 *        Still used by the sign-in screen and any surface that needs to know
 *        whether an address qualifies for student access.
 *
 *   `classifyEmail()` — "what kind of account is this?"
 *        Migration 080 replaced the old reject-anything-else trigger with
 *        classification, so a non-institutional address is a legitimate
 *        external visitor rather than an error.
 *
 * Defence in depth is unchanged, but the database is now the only authority on
 * the answer that matters:
 *   1. this module       — server-side pre-check for the UI and for early
 *                          rejection of malformed input,
 *   2. database          — `public.classify_institutional_email()` decides the
 *                          account type inside `handle_new_user()`, from the
 *                          address Supabase Auth verified,
 *   3. Supabase Auth     — must allow the external providers through (see
 *                          docs/EXTERNAL-ACCOUNTS.md for the dashboard steps).
 *
 * The frontend never decides who may sign in, and never decides the account
 * type: a browser-supplied domain or role is never consulted.
 */

import 'server-only';
import { serverConfig } from '@/lib/config.server';
import { emailDomain, formatDomain, normalizeEmail } from '@/lib/utils';
import { ACCOUNT_TYPES } from '@/lib/constants';
import { vInstitutionalEmail } from '@/lib/validation/schemas';

/** Domain list: database platform setting first, environment variable as fallback. */
export async function getAllowedDomains(supabase = null) {
  if (supabase) {
    try {
      const { data } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'allowed_email_domains')
        .maybeSingle();
      const parsed = Array.isArray(data?.value) ? data.value : null;
      if (parsed?.length) {
        return parsed.map((d) => String(d).toLowerCase().replace(/^@/, '')).filter(Boolean);
      }
    } catch {
      // Database not migrated yet — fall through to the environment default so
      // the app still boots with a clear, non-fabricated configuration.
    }
  }
  return serverConfig.allowedEmailDomains;
}

/** Is this address from an allowed institution? */
export function isAllowedInstitutionalEmail(email, domains) {
  return vInstitutionalEmail(email, { domains }).ok;
}

export function domainOf(email) {
  return emailDomain(normalizeEmail(email));
}

export function describeDomains(domains) {
  return (domains || []).map(formatDomain).join(' or ');
}

/**
 * Normalises any pasted address and returns a rich result the UI can render.
 */
export async function checkInstitutionalEmail(rawEmail, supabase = null) {
  const domains = await getAllowedDomains(supabase);
  const email = normalizeEmail(rawEmail);
  const result = vInstitutionalEmail(email, { domains });
  if (!result.ok) return { ok: false, error: result.error, email, domain: domainOf(email), domains };
  return { ok: true, email: result.value, domain: domainOf(result.value), domains };
}

/**
 * Classify a verified address as institutional or external.
 *
 * This mirrors `public.classify_institutional_email()` so the application can
 * make the same read-only judgement the database will make — but the database
 * remains authoritative: the value that ends up in `profile_private.account_type`
 * is the one the signup trigger wrote, never this function's return value.
 *
 * @returns {Promise<{accountType: 'student'|'visitor', institutional: boolean, email: string, domain: string|null, domains: string[]}>}
 */
export async function classifyEmail(rawEmail, supabase = null) {
  const domains = await getAllowedDomains(supabase);
  const email = normalizeEmail(rawEmail);
  const domain = domainOf(email);
  const institutional = Boolean(domain) && isAllowedInstitutionalEmail(email, domains);
  return {
    accountType: institutional ? ACCOUNT_TYPES.student : ACCOUNT_TYPES.visitor,
    institutional,
    email,
    domain: domain || null,
    domains,
  };
}

/**
 * Read the authoritative account type for an already-provisioned auth user.
 *
 * Prefers the database function; falls back to null (never to a guess) when the
 * call fails, because `isInstitutional()` treats anything but 'student' as not
 * institutional. Used by the OAuth callback to decide whether the visitor
 * notice applies.
 */
export async function resolveAccountType(supabase, authUserId) {
  if (!supabase || !authUserId) return null;
  try {
    const { data: privateRow, error } = await supabase
      .from('profile_private')
      .select('account_type')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (error) return null;
    return privateRow?.account_type || null;
  } catch {
    return null;
  }
}
