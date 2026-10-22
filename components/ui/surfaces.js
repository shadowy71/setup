/**
 * Surfaces and structure primitives.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';

export function Card({ className = '', as: Tag = 'div', interactive = false, children, ...props }) {
  return (
    <Tag className={cn('card', interactive ? 'card-interactive' : null, className)} {...props}>
      {children}
    </Tag>
  );
}

/**
 * Glass is a material accent, in deliberate levels (see surfaces.css):
 *
 *   default    quiet — navigation and secondary controls
 *   soft       quieter — panels that should recede
 *   strong     pronounced — sheets and popovers
 *   floating   level 2 — headers, menus, dialogs
 *   featured   level 3 — featured controls and hero panels
 *   premium    level 3, interactive — the composer and featured cards, whose
 *              specular highlight answers the pointer
 *   cinematic  the dark sky context
 *   read       long-form text, messages and forms — the least decorated tier,
 *              because immersion must stop where reading starts
 */
export function GlassSurface({ className = '', tone = 'default', as: Tag = 'div', rounded = true, children, ...props }) {
  const tones = {
    default: 'glass',
    soft: 'glass-soft',
    strong: 'glass-strong',
    floating: 'glass-floating',
    featured: 'glass-featured',
    premium: 'glass-premium',
    cinematic: 'glass-cinematic',
    read: 'glass-read',
  };
  return (
    <Tag className={cn(tones[tone] || tones.default, rounded ? 'rounded-[var(--radius-lg)]' : null, className)} {...props}>
      {children}
    </Tag>
  );
}

/**
 * The page header. Every screen opens the same way: an optional technical
 * eyebrow in the micro face, the title, the description, and a short luminous
 * rule that separates the page from the environment. The rule is the one
 * consistently emissive element on an ordinary page — it is what makes the
 * whole application read as one art-directed place rather than forty similar
 * ones.
 */
export function PageHeader({ title, eyebrow = null, description = null, action = null, back = null, className = '' }) {
  return (
    <header className={cn('page-head', className)}>
      {back ? (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1 text-2xs font-medium text-muted transition-colors hover:text-ink hover:no-underline"
        >
          <Icon name="chevronLeft" size={13} />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {eyebrow ? <p className="t-eyebrow mb-2">{eyebrow}</p> : null}
          <h1 className="t-page break-anywhere">{title}</h1>
          {description ? <p className="t-secondary mt-1.5 max-w-2xl">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      <span className="lit-rule mt-3.5" aria-hidden="true" />
    </header>
  );
}

export function SectionHeader({ title, description = null, action = null, icon = null, className = '', id = undefined }) {
  return (
    <div className={cn('section-head', className)}>
      <div className="min-w-0">
        <h2 id={id} className="t-section flex items-center gap-2">
          {icon ? <Icon name={icon} size={16} className="text-muted" /> : null}
          {title}
        </h2>
        {description ? <p className="t-caption mt-1 max-w-2xl">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badges, dots and small labels                                               */
/* -------------------------------------------------------------------------- */

const BADGE_TONES = {
  neutral: 'badge',
  accent: 'badge badge-accent',
  danger: 'badge badge-danger',
  success: 'badge badge-success',
  warning: 'badge badge-warning',
  info: 'badge badge-info',
  live: 'badge badge-live',
};

export function Badge({ children, tone = 'neutral', className = '', title = undefined, icon = null }) {
  return (
    <span title={title} className={cn(BADGE_TONES[tone] || BADGE_TONES.neutral, className)}>
      {icon ? <Icon name={icon} size={11} /> : null}
      {children}
    </span>
  );
}

/** The small "Official" label. Never decorative — it is a claim. */
export function OfficialBadge({ className = '' }) {
  return (
    <Badge tone="accent" className={className} icon="checkCircle" title="Published by the campus team">
      Official
    </Badge>
  );
}

/**
 * Role dot for Moderators/Admins. Students get nothing at all.
 * There is no online/presence dot anywhere in Campus+.
 */
export function StaffDot({ tone = 'danger', label, className = '' }) {
  return (
    <span
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: tone === 'danger' ? 'var(--c-danger)' : 'var(--c-warning)' }}
      role="img"
      aria-label={label || 'Staff member'}
      title={label || 'Staff member'}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Notices                                                                     */
/* -------------------------------------------------------------------------- */

const NOTICE_TONES = new Set(['neutral', 'accent', 'danger', 'success', 'warning', 'info']);

export function Notice({ tone = 'neutral', children, className = '', icon = null }) {
  const safeTone = NOTICE_TONES.has(tone) ? tone : 'neutral';
  return (
    <div className={cn('notice', `notice-${safeTone}`, className)}>
      {icon ? <Icon name={icon} size={16} className="notice__icon mt-0.5 shrink-0" /> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The text-first avatar: the first letter, in a quiet material square.
 * `size` is in pixels; `tone="accent"` marks the signed-in student.
 */
export function IdentityMark({ name, size = 32, tone = 'neutral', className = '', square = false }) {
  const initial = (name || '?').trim().slice(0, 1).toUpperCase() || '?';
  return (
    <span
      aria-hidden="true"
      className={cn('identity-mark', tone === 'accent' ? 'identity-mark-accent' : null, className)}
      style={{
        width: size,
        height: size,
        borderRadius: square ? 'var(--radius-sm)' : 999,
        fontSize: size <= 26 ? '0.6875rem' : size <= 34 ? '0.8125rem' : '0.9375rem',
      }}
    >
      {initial}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Contextual rail                                                             */
/* -------------------------------------------------------------------------- */

/** Sticky contextual column (xl and up) — real campus information only. */
export function Rail({ children, className = '', label = 'Campus information' }) {
  return (
    <aside className={cn('rail', className)} aria-label={label}>
      {children}
    </aside>
  );
}

/**
 * One titled section in a rail.
 *
 *   variant="card"    the design-system card (default) — hairline, radius, shadow.
 *   variant="island"  the Home island surface: elevation and tone come from the
 *                     island scale (see app/styles/islands.css), and `note`
 *                     carries the one-line explanation under the title.
 */
export function RailCard({
  title,
  icon = null,
  action = null,
  children,
  className = '',
  variant = 'card',
  elevation = 1,
  tone = null,
  note = null,
}) {
  if (variant === 'island') {
    return (
      <section
        className={cn('island', className)}
        data-elevation={String(elevation)}
        data-tone={tone || undefined}
      >
        <header className="island__head">
          <div className="min-w-0">
            <h2 className="island__eyebrow flex items-center gap-1.5">
              {icon ? <Icon name={icon} size={13} /> : null}
              {title}
            </h2>
            {note ? <p className="island__note mt-1.5">{note}</p> : null}
          </div>
          {action}
        </header>
        <div>{children}</div>
      </section>
    );
  }

  return (
    <section className={cn('card p-3.5', className)}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="t-label flex items-center gap-1.5">
          {icon ? <Icon name={icon} size={13} /> : null}
          {title}
        </h2>
        {action}
      </header>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}
