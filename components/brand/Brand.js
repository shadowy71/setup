import Link from 'next/link';
import campusLogo from '@/logo.jpeg';
import pccoeCrest from '@/public/brand/pccoe-crest.webp';
import { Icon } from '@/components/ui/icons';
import { ROUTES } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The single brand surface.
 *
 * Every placement — the sidebar, the mobile header, the public/login frame —
 * renders through this module, so the Campus+ identity is defined once and the
 * mark never drifts between screens.
 *
 * ── Identity vs context ───────────────────────────────────────────────────
 * The product mark is the supplied Campus+ artwork in `logo.jpeg`. The college
 * crest is a separate slot with its own rules (see `CollegeCrest`): it says
 * who the product is *for*, never what it is.
 *
 * Swapping the mark: statically import the asset and point `LOGO_SRC` at its
 * `src`. Every placement follows, at three responsive sizes, with the original
 * proportions preserved (`object-fit: contain`). Static imports are served
 * from /_next/static/media so the logo also works before sign-in.
 * `LOGO_PLATE` optionally renders the artwork on a soft white plate.
 */

export const LOGO_SRC = campusLogo.src;
export const LOGO_PLATE = false;

/**
 * The college crest — context, not identity.
 *
 * Campus+ keeps its own mark as the product identity (and as the app icon).
 * The crest belongs exactly where the product states who it is *for*: the
 * sign-in brand area, the sidebar's affiliation line and the public footer.
 * It always renders next to the words that keep the positioning honest —
 * "unofficial student project" / "not affiliated with PCCOE" — so it reads as
 * context rather than endorsement.
 *
 * The supplied crest is `public/brand/pccoe-crest.webp` (300x300, opaque
 * white background), which is why it renders on a plate with the corners
 * clipped to the disc. Clearing `CREST_SRC` hides the crest everywhere —
 * no empty plate, no placeholder.
 *
 * `MIN_SIZE` is a legibility floor, not a style preference: the artwork
 * carries a torch, an open book, a motto ribbon, five lines of type and a
 * "Since 1999" line, and rendered at 28px it is an unreadable smudge. Below
 * roughly 44px the crest stops being an identity cue and becomes noise, so it
 * is only placed where it can be shown at or above that size.
 */
// Static imports are served from /_next/static/media, including on the public
// sign-in page. Do not relax the auth proxy just to expose a brand asset.
export const CREST_SRC = pccoeCrest.src;
export const MIN_SIZE = 44;

export function CollegeCrest({ size = MIN_SIZE, className = '', label = 'PCCOE crest' }) {
  if (!CREST_SRC) return null;

  return (
    <span className={cn('brand-crest', className)} style={{ '--crest-size': `${size}px` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a static brand asset, not content */}
      <img src={CREST_SRC} alt={label} width={size} height={size} decoding="async" loading="lazy" />
    </span>
  );
}

const MARK_SIZE = { sm: 28, md: 34, lg: 44 };
const GLYPH_SIZE = { sm: 14, md: 18, lg: 22 };

/** The mark on its own. Decorative by default — the wordmark names the product. */
export function BrandMark({ size = 'md', className = '' }) {
  const px = MARK_SIZE[size] || MARK_SIZE.md;

  if (LOGO_SRC) {
    return (
      <span
        className={cn('brand-mark brand-mark-img', className)}
        data-size={size}
        data-plate={LOGO_PLATE ? 'true' : undefined}
        aria-hidden="true"
      >
        {/* Decorative mark, never the LCP element. `loading="lazy"` stops
            React from emitting a document-wide `<link rel=preload as=image>`
            for it on every route: the asset is a large JPEG, and preloading it
            at high priority competed with the stylesheet and the text on slow
            connections. Explicit width/height keep the box reserved. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a static brand asset, not content */}
        <img
          src={LOGO_SRC}
          alt=""
          width={px}
          height={px}
          loading="lazy"
          fetchPriority="low"
          decoding="async"
        />
      </span>
    );
  }

  return (
    <span className={cn('brand-mark', className)} data-size={size} aria-hidden="true">
      <Icon name="plus" size={GLYPH_SIZE[size] || GLYPH_SIZE.md} />
    </span>
  );
}

/** Mark + wordmark in one labelled link — the standard identity lockup. */
export function BrandLockup({ size = 'md', subtitle = 'PCCOE', wordClass = '', className = '', href = ROUTES.home }) {
  return (
    <Link href={href} className={cn('brand min-w-0', className)} aria-label="Campus+ home">
      <BrandMark size={size} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={cn('brand-word truncate', wordClass)}>Campus+</span>
        {subtitle ? <span className="brand-sub">{subtitle}</span> : null}
      </span>
    </Link>
  );
}
