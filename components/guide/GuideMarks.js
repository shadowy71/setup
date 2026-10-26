/**
 * Hand-drawn marks for the first-visit guide.
 *
 * The guide's "field notes" feel comes from four small strokes, not from a
 * handwriting typeface: the project's own note on the onboarding sheet is that
 * essential copy stays in the UI font because the local faces are not handwriting
 * faces, and no new font is added here either (the product ships no external
 * dependency for a decoration, and a `cursive` system stack resolves to junk on
 * Linux and Android). Wavy ink, a circled number and a curved arrow read as
 * pencil marks and cost a few hundred bytes of path data.
 *
 * All of these are `aria-hidden` and decorative: every word a screen reader needs
 * is real text in the page, so turning a mark off loses nothing.
 */

/** A wavy ink underline, drawn rather than `text-decoration` so it can sit a few
 *  pixels below the baseline and end in a slight overshoot, like a pen lift. */
export function InkUnderline({ className = '', ...rest }) {
  return (
    <svg
      className={`guide-mark guide-mark--underline ${className}`.trim()}
      viewBox="0 0 220 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path
        d="M2 8.4c14-5 27 3.6 41-0.7S66 2.1 80 6.4s25 4.6 39 0.5 26-5.4 40-1.2 25 3.9 38 0.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A hand-drawn circle around a short word or a number. */
export function InkCircle({ className = '', ...rest }) {
  return (
    <svg
      className={`guide-mark guide-mark--circle ${className}`.trim()}
      viewBox="0 0 120 64"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path
        d="M62 6C34 3 8 12 6 29c-2 16 20 27 50 28 27 1 52-8 56-23 4-14-14-24-40-26-9-1-19-1-27 1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A curved arrow, used to point a reader at the next thing on the page. */
export function InkArrow({ className = '', ...rest }) {
  return (
    <svg
      className={`guide-mark guide-mark--arrow ${className}`.trim()}
      viewBox="0 0 64 44"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path
        d="M3 5c6 18 20 30 40 32 6 0 12-1 17-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M52 23c3 5 5 8 8 11-5 1-9 2-13 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A small asterisk/checked mark used as the bullet on the field-note lists. */
export function InkTick({ className = '', ...rest }) {
  return (
    <svg
      className={`guide-mark guide-mark--tick ${className}`.trim()}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path
        d="M3 11.2c2.4.6 4 2 5.4 4.3C11 10.4 14 6.2 17.6 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The corner of a page that has been folded over: the hero's only ornament. */
export function InkFold({ className = '', ...rest }) {
  return (
    <svg
      className={`guide-mark guide-mark--fold ${className}`.trim()}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M2 2h24l12 12v24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M26 2v12h12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
