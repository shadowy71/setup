/**
 * Configuration — server-only half.
 *
 * Secrets are read lazily, never bundled, and a missing value produces a clear
 * configuration state instead of a crash (spec §92). We never fabricate
 * credentials. Importing this module from client code is a build error by
 * design (`server-only`).
 */

import 'server-only';

function read(name) {
  const value = process.env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Treat the placeholders shipped in .env.example as "not configured".
  if (/^YOUR_|^your_/.test(trimmed)) return null;
  return trimmed;
}

/** Server-only secrets. Never import this object into a client component. */
export const serverConfig = {
  get supabaseSecretKey() {
    return read('SUPABASE_SECRET_KEY');
  },
  get giphyApiKey() {
    return read('GIPHY_API_KEY');
  },
  get giphyClientId() {
    return read('GIPHY_CLIENT_ID') || 'campus_plus';
  },
  get giphyRating() {
    const rating = (read('GIPHY_CONTENT_RATING') || 'pg-13').toLowerCase();
    return ['g', 'pg', 'pg-13', 'r'].includes(rating) ? rating : 'pg-13';
  },
  get allowedEmailDomains() {
    return (read('CAMPUS_ALLOWED_EMAIL_DOMAINS') || 'pccoepune.org')
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
  },
};

/**
 * The Google provider is configured in Supabase, not in the app; this only
 * reports presence and points at the two places an operator has to touch.
 */
export const AUTH_SETUP_NOTE =
  'Enable the Google provider in Supabase (Authentication → Sign In / Providers) with your Google OAuth client ID and secret, and add <your-origin>/auth/callback to the redirect URLs.';

/**
 * Human readable configuration status, surfaced on /setup and in the admin
 * dashboard so the operator can see exactly what is missing.
 */
export function configurationStatus() {
  return [
    {
      key: 'NEXT_PUBLIC_SUPABASE_URL',
      label: 'Supabase project URL',
      configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
      scope: 'client',
      where: 'Supabase → Project Settings → Data API',
      required: true,
    },
    {
      key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      label: 'Supabase publishable key',
      configured: Boolean(serverConfig.supabaseSecretKey || read('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')),
      scope: 'client',
      where: 'Supabase → Project Settings → API Keys → Publishable key',
      required: true,
    },
    {
      key: 'SUPABASE_SECRET_KEY',
      label: 'Supabase secret key',
      configured: Boolean(serverConfig.supabaseSecretKey),
      scope: 'server',
      where: 'Supabase → Project Settings → API Keys → Secret key',
      required: false,
      note: 'Needed by the maintenance scripts (seeding, role grants) and audited admin operations. Never set it as NEXT_PUBLIC_*.',
    },
    {
      key: 'NEXT_PUBLIC_KLIPY_APP_KEY',
      label: 'KLIPY public app key',
      configured: Boolean(read('NEXT_PUBLIC_KLIPY_APP_KEY')),
      scope: 'client',
      where: 'partner.klipy.com → API Keys',
      required: false,
      note: 'Without it, the GIF picker shows a configuration message; nothing else breaks.',
    },
    {
      key: 'CAMPUS_ALLOWED_EMAIL_DOMAINS',
      label: 'Institutional email domain(s)',
      configured: Boolean(read('CAMPUS_ALLOWED_EMAIL_DOMAINS')),
      scope: 'server',
      where: 'Deployment default for the database allow-list',
      required: false,
      note: `Currently: ${serverConfig.allowedEmailDomains.map((d) => '@' + d).join(', ')}`,
    },
    {
      key: 'Supabase Google provider',
      label: 'Google sign-in provider',
      configured: false,
      scope: 'external',
      where: 'Supabase → Authentication → Sign In / Providers → Google',
      required: false,
      note: AUTH_SETUP_NOTE,
    },
  ];
}
