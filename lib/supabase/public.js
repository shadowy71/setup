import 'server-only';

/**
 * A Supabase client with NO session — the anonymous (`anon`) role only.
 *
 * Public discovery pages (and their cached readers) must return exactly the
 * same rows for a guest, a student and an administrator. Using
 * `getServerClient()` here would read `cookies()`, so the result of an
 * `unstable_cache` entry could depend on whoever happened to populate it.
 *
 * This client deliberately:
 *   - uses only the publishable key (never the secret/service-role key),
 *   - never reads, writes or refreshes auth cookies,
 *   - is therefore always subject to the narrow `anon` RLS policies and the
 *     column-level grants in migration 041.
 *
 * Viewer-specific reads (membership, RSVP, moderation queues) use
 * `getServerClient()` separately, in the page, and are never put in a shared
 * cache entry.
 */

import { createClient } from '@supabase/supabase-js';
import { supabasePublicConfig } from '@/lib/config';

let cached = null;

/**
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 *   `null` when Supabase is not configured — callers show an unavailable state.
 */
export function getPublicClient() {
  if (!supabasePublicConfig.isConfigured) return null;
  if (cached) return cached;
  cached = createClient(supabasePublicConfig.url, supabasePublicConfig.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { 'x-campus-plus-client': 'server-public' } },
  });
  return cached;
}
