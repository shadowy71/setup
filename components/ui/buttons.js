/**
 * Campus+ buttons.
 *
 * One visual language, four materials:
 *   - primary  → the Campus+ action button: animated gradient frame around a
 *                deep navy face that reveals the gradient on hover and presses
 *                with a tactile scale. The default for ordinary actions.
 *   - warm     → the sunset-orange call to action. At most one per screen: the
 *                action that should lead it. Opaque light with deep ink.
 *   - sheen    → layered reflective light (hero-level actions: Home's Explore
 *                and featured cards) — deliberately dark text on bright light.
 *   - calm     → secondary / quiet / subtle (everything else)
 *   - tactile  → delete and keycap, used only for destructive or confirmatory
 *                actions
 *   - glass    → the sign-in call to action only: translucent night-blue glass
 *                with a cyan rim and a blue glow (see `.btn-glass`)
 *
 * Every one of them is a real `<button>` (or a real `<a>` when it navigates),
 * so keyboard, screen readers and disabled semantics behave normally.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';

const SIZE = { sm: 'btn-sm', md: 'btn-md', lg: 'btn-lg' };

/* The supplied secondary button stacks seven radial layers, each on its own
   delay and duration, which is what makes the reflection drift instead of
   spinning in lockstep. The timings are the source's. */
const SHEEN_LAYERS = [
  { delay: '0s', duration: '25s' },
  { delay: '0.15s', duration: '15.9s' },
  { delay: '0.53s', duration: '26.4s' },
  { delay: '0.45s', duration: '17.8s' },
  { delay: '1.6s', duration: '19.2s' },
  { delay: '1.6s', duration: '29.2s' },
  { delay: '1.6s', duration: '20.2s' },
];

const VARIANT = {
  warm: 'btn-warm',
  secondary: 'btn-secondary',
  ghost: 'btn-quiet',
  quiet: 'btn-quiet',
  subtle: 'btn-subtle',
  danger: 'btn-danger',
  glass: 'btn-glass',
};

function iconSize(size) {
  if (size === 'sm') return 15;
  if (size === 'lg') return 18;
  return 16;
}

export function Button({
  variant = 'primary',
  size = 'md',
  tone = 'ink',
  icon = null,
  iconRight = null,
  loading = false,
  block = false,
  className = '',
  type = 'button',
  as: Tag = 'button',
  children,
  disabled,
  ...props
}) {
  const classes = cn(
    'btn',
    SIZE[size] || SIZE.md,
    variant === 'primary' ? 'cp-btn' : null,
    variant === 'sheen' ? 'btn-sheen' : null,
    VARIANT[variant] || null,
    block ? 'btn-block' : null,
    !children && (icon || iconRight) ? 'btn-icon' : null,
    className,
  );

  const isDisabled = disabled || loading;
  const glyph = iconSize(size);

  const label = (
    <>
      {loading ? <span className="dot-spin" aria-hidden="true" /> : icon ? <Icon name={icon} size={glyph} /> : null}
      {children ? <span>{children}</span> : null}
      {!loading && iconRight ? <Icon name={iconRight} size={glyph} /> : null}
    </>
  );

  const content =
    variant === 'primary' ? (
      // The supplied structure: a gradient frame with the dark face inside.
      <span className="cp-btn-face">
        <span className="btn-label">{label}</span>
      </span>
    ) : variant === 'sheen' ? (
      <>
        <span className="btn-light" aria-hidden="true" />
        {SHEEN_LAYERS.map((layer) => (
          <span
            key={layer.duration + layer.delay}
            className="btn-sheen-layer"
            style={{ animationDelay: layer.delay, animationDuration: layer.duration }}
            aria-hidden="true"
          />
        ))}
        <span className="btn-label">{label}</span>
      </>
    ) : (
      <span className="btn-label">{label}</span>
    );

  const common = {
    className: classes,
    'data-tone': variant === 'primary' ? tone : undefined,
    'aria-busy': loading || undefined,
    ...props,
  };

  if (Tag === 'button') {
    return (
      <button type={type} disabled={isDisabled} {...common}>
        {content}
      </button>
    );
  }

  return (
    <Tag {...common} aria-disabled={isDisabled || undefined}>
      {content}
    </Tag>
  );
}

export function LinkButton({ href, children, variant = 'secondary', size = 'md', className = '', icon = null, ...props }) {
  return (
    <Button as={Link} href={href} variant={variant} size={size} className={className} icon={icon} {...props}>
      {children}
    </Button>
  );
}

/** The reflective secondary material, used deliberately and rarely. */
export function SheenButton({ size = 'md', className = '', icon = null, children, ...props }) {
  return (
    <Button variant="sheen" size={size} className={className} icon={icon} {...props}>
      {children}
    </Button>
  );
}

export function IconButton({ label, icon, size = 'md', variant = 'quiet', className = '', ...props }) {
  return (
    <Button
      size={size}
      variant={variant}
      icon={icon}
      aria-label={label}
      title={label}
      className={cn(variant === 'quiet' ? 'icon-btn' : null, className)}
      {...props}
    />
  );
}

/**
 * Destructive action: physical depth, inset shading, a pressed state that
 * travels into the surface. Only ever used for delete / remove / block.
 */
export function DeleteButton({ children = 'Delete', icon = 'trash', size = 'md', className = '', ...props }) {
  return (
    <button type="button" className={cn('btn-delete', className)} {...props}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 15} /> : null}
      <span>{children}</span>
    </button>
  );
}

/**
 * Keycap: a small, deliberate confirmation control for modals and inline
 * confirmations. Compact by design — Campus+ is not a keyboard simulator.
 */
export function KeycapButton({ children = 'OK', tone = 'plain', icon = null, className = '', ...props }) {
  return (
    <button type="button" className={cn('keycap', tone === 'accent' ? 'keycap-accent' : null, className)} {...props}>
      {icon ? <Icon name={icon} size={14} /> : null}
      <span>{children}</span>
    </button>
  );
}
