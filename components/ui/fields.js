/**
 * Form primitives.
 *
 * Labels, hints and errors are part of the component so every form in Campus+
 * shows the same anatomy: label → control → hint/error. The animated checkbox
 * and the tactile switch keep a real `<input>` underneath, visually hidden but
 * focusable, so keyboard and screen-reader behaviour is untouched.
 */

import { cn } from '@/lib/utils';

export function Field({ label, htmlFor, hint, error, required = false, children, className = '' }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="field-label">
          {label}
          {required ? (
            <span className="ml-1 text-accent" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {hint && !error ? <p className="field-hint">{hint}</p> : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className = '', invalid = false, ...props }) {
  if (typeof props.type === 'string' && props.type.toLowerCase() === 'file') {
    throw new Error('File inputs must use the dedicated upload component');
  }
  return <input aria-invalid={invalid || props['aria-invalid'] || undefined} className={cn('control control-input', className)} {...props} />;
}

export function Textarea({ className = '', rows = 4, invalid = false, ...props }) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      className={cn('control control-textarea', className)}
      {...props}
    />
  );
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={cn('control control-select', className)} {...props}>
      {children}
    </select>
  );
}

/**
 * The animated checkbox: the tick is drawn with a stroke-dashoffset transition
 * on a real SVG path. It is a label-wrapped input, never a div pretending.
 */
export function Checkbox({ label, note, id, className = '', ...props }) {
  return (
    <label htmlFor={id} className={cn('check', className)}>
      <input id={id} type="checkbox" className="check-input" {...props} />
      <span className="check-box" aria-hidden="true">
        <svg className="check-mark" viewBox="0 0 24 24" focusable="false">
          <path d="M5 12.5 10 17.5 19 7" />
        </svg>
      </span>
      {label || note ? (
        <span className="check-copy">
          {label ? <span className="check-title">{label}</span> : null}
          {note ? <span className="check-note">{note}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

/** Tactile switch for preferences, privacy and admin controls. */
export function Switch({ label, note, id, className = '', ...props }) {
  return (
    <label htmlFor={id} className={cn('switch', className)}>
      <input id={id} type="checkbox" role="switch" className="switch-input" {...props} />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      {label || note ? (
        <span className="switch-copy">
          {label ? <span className="check-title">{label}</span> : null}
          {note ? <span className="check-note">{note}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
