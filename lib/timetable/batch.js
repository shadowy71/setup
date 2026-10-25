/**
 * Batch identity — the one place a timetable batch gets a name, an id and a URL.
 *
 * A "batch" here is exactly what the source document prints: one first-year
 * division letter plus its branch abbreviation. Everything that has to stay
 * stable across a deploy — the installed app's `id`, its `start_url`, the
 * manifest URL, the offline cache key — is derived from the single division
 * letter, never from the display label and never from a query parameter. The
 * label is free to be reworded (it is copy); the identity is not (it is what a
 * student's home-screen icon and their saved offline copy are keyed by).
 *
 * Client-safe on purpose: this module imports only `lib/constants` and
 * `meta.js`, so the install card can name a batch in the browser without
 * pulling the 47 kB semester dataset into a bundle.
 */

import { DIVISIONS, ROUTES } from '@/lib/constants';
import { DIVISION_PROGRAMMES, TIMETABLE_SOURCE, normalizeDivision } from '@/lib/timetable/meta';

/**
 * Namespace for the installable identity. `campusplus-timetable-o` is the
 * manifest `id` for Division O: Chromium keys an installed web app by this
 * string, so each division installs as its own app and one install never
 * replaces another.
 */
export const TIMETABLE_APP_ID_PREFIX = 'campusplus-timetable';

/** The offline app shell, the worker that serves it, and its scopes. */
export const TIMETABLE_SHELL_PATH = '/timetable/offline';
export const TIMETABLE_SW_PATH = '/timetable/sw.js';

/**
 * The colour a browser should paint its own chrome with for this feature —
 * `toolbar`, status bar, the splash behind a launched icon, the manifest
 * background. It mirrors the `--c-canvas` token, exactly as the root layout's
 * `themeColor` does; it lives here because a PWA needs the same value in four
 * places (metadata, viewport, manifest, manifest) and a design system cannot
 * afford four chances to drift. `tests/spec.test.js` forbids a colour literal
 * in any page, so the constant is also the guard that keeps it out of them.
 */
export const TIMETABLE_CANVAS_COLOR = '#07151d';

/**
 * `/timetable/` is the scope every browser allows without help, and it is
 * enough to make the timetable itself offline-capable. `/` additionally lets
 * the worker keep the shell's hashed chunks, and is only reachable when the
 * response for the script carries `Service-Worker-Allowed: /` (next.config.mjs).
 * The client tries the wide scope and quietly falls back — see
 * `lib/timetable/offline-install.js`.
 */
export const TIMETABLE_SCOPE = '/timetable/';
export const TIMETABLE_WIDE_SCOPE = '/';

/** Division letters, in route order — the same list the pages are generated from. */
export function listDivisionLetters() {
  return [...DIVISIONS];
}

/** Every batch, with its labels and URLs. Used by the tests and the selector. */
export function listBatches() {
  return DIVISIONS.map((division) => describeBatch(division)).filter(Boolean);
}

/**
 * The batch's stable identity: a canonical letter, the lowercase route slug,
 * the label the source prints for it, and the four URLs that hang off them.
 * `null` for anything that is not a division — callers must not guess.
 */
export function describeBatch(value) {
  const division = normalizeDivision(value);
  if (!division) return null;
  const programme = DIVISION_PROGRAMMES[division] || { label: division, friendly: null };
  return {
    division,
    slug: division.toLowerCase(),
    label: programme.label,
    friendly: programme.friendly ?? null,
    year: 'First year',
    semester: TIMETABLE_SOURCE.semester,
    academicYear: TIMETABLE_SOURCE.academicYear,
    href: ROUTES.timetableDivision(division),
    apiUrl: `/api/timetable/${division.toLowerCase()}`,
    manifestUrl: `/timetable/manifest/${division.toLowerCase()}`,
    appId: `${TIMETABLE_APP_ID_PREFIX}-${division.toLowerCase()}`,
  };
}

/**
 * `Division O (IT)` — how a batch is named to a person, everywhere the
 * abbreviation is enough. The branch label is the source's own; it is never
 * expanded into something the source did not say.
 */
export function batchName(division) {
  const batch = describeBatch(division);
  if (!batch) return 'this timetable';
  return `Division ${batch.division} (${batch.label})`;
}

/**
 * `Division O (IT · Information Technology) timetable` — the manifest `name`
 * and the install card heading. The expanded programme name is appended only
 * where the source material supplies one (see DIVISION_PROGRAMMES).
 */
export function batchAppName(division) {
  const batch = describeBatch(division);
  if (!batch) return 'Timetable';
  const branch = batch.friendly ? `${batch.label} · ${batch.friendly}` : batch.label;
  return `Division ${batch.division} (${branch}) timetable`;
}

/**
 * `O · IT` — the manifest `short_name`, i.e. the label iOS and Android put
 * under the icon. Always unique across A–R because the letter leads, and short
 * enough never to be ellipsised by a launcher.
 */
export function batchShortName(division) {
  const batch = describeBatch(division);
  if (!batch) return 'Timetable';
  return `${batch.division} · ${batch.label}`.slice(0, 12);
}

/** The button copy: `Add Division O (IT) timetable to Home Screen`. */
export function installLabel(division) {
  const batch = describeBatch(division);
  if (!batch) return 'Add this timetable to Home Screen';
  return `Add ${batchName(batch.division)} timetable to Home Screen`;
}
