import { clsx } from 'clsx';
import { useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

interface FieldShell {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className="field">
      {label ? (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      {children}
      {hint && !error ? <span className="hint">{hint}</span> : null}
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, FieldShell {
  /** Tabular/monospaced value, for codes and reference numbers. */
  mono?: boolean;
}

export function Input({ label, hint, error, mono, className, id, ...rest }: InputProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Field id={fieldId} label={label} hint={hint} error={error}>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={clsx('input', mono && 'mono', error && 'err', className)}
        {...rest}
      />
    </Field>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldShell {}

export function Textarea({ label, hint, error, className, id, ...rest }: TextareaProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Field id={fieldId} label={label} hint={hint} error={error}>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={clsx('input', error && 'err', className)}
        {...rest}
      />
    </Field>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldShell {}

export function Select({ label, hint, error, className, id, children, ...rest }: SelectProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Field id={fieldId} label={label} hint={hint} error={error}>
      <select
        id={fieldId}
        aria-invalid={error ? true : undefined}
        className={clsx('input', error && 'err', className)}
        {...rest}
      >
        {children}
      </select>
    </Field>
  );
}

/** Search field with the leading glyph, used in every list toolbar. */
export function SearchInput({ label, className, id, ...rest }: InputProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className="search">
      {label ? (
        <label className="label hide" htmlFor={fieldId}>
          {label}
        </label>
      ) : null}
      <input
        id={fieldId}
        type="search"
        aria-label={typeof label === 'string' ? label : 'Search'}
        className={clsx('input', className)}
        {...rest}
      />
    </div>
  );
}

/** An input with a unit or prefix welded to it, e.g. `£ 13.20` or `1500 m`. */
export function InputRow({ children }: { children: ReactNode }) {
  return <div className="input-row">{children}</div>;
}

export function Addon({ leading, children }: { leading?: boolean; children: ReactNode }) {
  return <span className={clsx('addon', leading && 'l')}>{children}</span>;
}

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label?: ReactNode;
  'aria-label'?: string;
}

/**
 * The geofence radius control (§9.11): 100–3000 m, redrawing the circle as it
 * moves. The visible track is decoration over a real range input, so the
 * keyboard and screen-reader paths are the native ones.
 */
export function Slider({ value, min, max, onChange, label, ...rest }: SliderProps) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div className="field">
      {label ? <span className="label">{label}</span> : null}
      <div className="slider">
        <span className="fill" style={{ width: `${pct}%` }} />
        {/* Before `.knob` so the focus ring can be drawn on it, and under the
            decoration so the pointer still lands on the real control. */}
        <input
          type="range"
          className="slider-input"
          value={value}
          min={min}
          max={max}
          onChange={(event) => onChange(Number(event.target.value))}
          {...rest}
        />
        <span className="knob" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}
