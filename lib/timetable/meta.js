/**
 * Timetable metadata that is safe to ship to the browser.
 *
 * The full semester dataset lives in `master-timetable-2026-27-sem1.js`
 * (≈47 kB of source text) and is only imported by server code
 * (`lib/timetable/index.js`, the public pages). Everything the client nav
 * needs — "which href does the Timetable item point at for this student?" —
 * is answered here without pulling the dataset into a client bundle.
 */

import { DIVISIONS, ROUTES } from '@/lib/constants';

/** Source identity, printed on both timetable pages. */
export const TIMETABLE_SOURCE = {
  title: 'MASTER TIME TABLE',
  department: 'Department AS & H',
  academicYear: '2026–2027',
  semester: 'SEM-I',
  fileTitle: 'Updated Final MTT SEM I 26-27 (1).pdf',
};

/**
 * Division → programme. `label` is the source abbreviation, preserved
 * exactly (the dataset's `branch` field carries the same strings and a test
 * pins the two together). `friendly` is a supplementary expansion, only
 * where the source material itself supplies one — never a replacement, and
 * deliberately absent where expanding it would mean guessing
 * (Civil RL, Comp-R, AI-ML, VLSI, E & TC).
 */
export const DIVISION_PROGRAMMES = {
  A: { label: 'Mech', friendly: 'Mechanical Engineering' },
  B: { label: 'Mech', friendly: 'Mechanical Engineering' },
  C: { label: 'Mech', friendly: 'Mechanical Engineering' },
  D: { label: 'E & TC', friendly: null },
  E: { label: 'E & TC', friendly: null },
  F: { label: 'E & TC', friendly: null },
  G: { label: 'VLSI', friendly: null },
  H: { label: 'Civil', friendly: null },
  I: { label: 'Civil RL', friendly: null },
  J: { label: 'Comp', friendly: 'Computer Engineering' },
  K: { label: 'Comp', friendly: 'Computer Engineering' },
  L: { label: 'Comp', friendly: 'Computer Engineering' },
  M: { label: 'Comp', friendly: 'Computer Engineering' },
  N: { label: 'Comp-R', friendly: null },
  O: { label: 'IT', friendly: 'Information Technology' },
  P: { label: 'IT', friendly: 'Information Technology' },
  Q: { label: 'AI-ML', friendly: null },
  R: { label: 'AI-ML', friendly: null },
};

/**
 * Subject accents.
 * ------------------------------------------------------------------------
 * One stable, muted accent per subject family, reused across every division
 * and weekday. These are deliberately few — seven hues for the subjects that
 * dominate the printed timetable, and a neutral for the long tail. A new
 * subject never invents a colour: it inherits the neutral edge until someone
 * deliberately assigns it one. The hues themselves live in timetable.css
 * (`--tt-hue-*`), derived from the brand teal / sand / orange triad plus
 * three neighbouring tones of the same lightness, and are only ever used for
 * a slim edge, a dot or a wash — never for text.
 *
 * The map is keyed by the printed subject root (`LAUC-1` → `LAUC`), which is
 * the subject code exactly as the source prints it: no expansion, no
 * reinterpretation.
 */
export const SUBJECT_ACCENTS = {
  LAUC: 'teal',
  EPH: 'sky',
  ECH: 'violet',
  DECO: 'rose',
  ENG: 'orange',
  LS: 'sand',
  WDL: 'mint',
};

export const NEUTRAL_ACCENT = 'neutral';

/**
 * The subject root of an event's first line, e.g.:
 *   'WDL-1/ENG-2/WDL-3' → 'WDL'   (a batch practical takes its first code)
 *   'LS 2'              → 'LS'
 *   '[COI'              → 'COI'   (stray bracket kept in the source data)
 *   'DELD #'            → 'DELD'
 * Returns null for a line with no letters at all.
 */
export function subjectRoot(line) {
  const first = String(line ?? '').split('/')[0];
  const code = first
    .replace(/#/g, '')
    .trim()
    .split(/\s+/)[0]
    .replace(/[-_]\d+$/, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();
  return code || null;
}

/** The stable accent key for an event's first line. */
export function subjectAccent(line) {
  return SUBJECT_ACCENTS[subjectRoot(line)] || NEUTRAL_ACCENT;
}

/**
 * Normalise anything division-shaped to a canonical letter, or null.
 * Accepts route params and profile values alike ('o', ' O ', 'O') and
 * rejects everything else — including multi-letter strings — so callers
 * never guess a division from partial input.
 */
export function normalizeDivision(value) {
  if (typeof value !== 'string') return null;
  const letter = value.trim().toUpperCase();
  return DIVISIONS.includes(letter) ? letter : null;
}

/** Canonical public href for a division letter, e.g. '/timetable/o'. */
export function divisionTimetableHref(letter) {
  return ROUTES.timetableDivision(letter);
}

/**
 * The nav shortcut: a saved, valid profile division goes straight to that
 * division's timetable; anything missing/invalid lands on the selector.
 * The preference personalises only this shortcut — every division page is
 * public to everyone.
 */
export function getTimetableHref(savedDivision) {
  const letter = normalizeDivision(savedDivision);
  return letter ? divisionTimetableHref(letter) : ROUTES.timetable;
}
