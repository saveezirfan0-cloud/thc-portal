'use client';

import { useId, useRef, useState } from 'react';
import { TimeField, readUkDate, typeUkDate, ukDateText } from '@thc/ui';

/**
 * Inline cells for the Review table. Each keeps what is being typed until
 * the person leaves the cell (or presses Enter), then asks the screen to
 * save it and shows whatever the database sends back — a refused edit
 * snaps back to the stored value, with the reason under the row.
 *
 * `onCommit` resolves once the screen has stored the database's row, so
 * the draft is dropped only when the new value is already in `value`.
 */
type Commit<T> = (value: T) => Promise<unknown> | unknown;

interface Common {
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  invalid?: boolean;
  placeholder?: string;
}

export function TextCell({
  value,
  onCommit,
  ariaLabel,
  disabled,
  className,
  invalid,
  placeholder,
  mono,
}: Common & { value: string; onCommit: Commit<string>; mono?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  async function leave() {
    if (draft === null) return;
    const next = draft;
    if (next.trim() !== value.trim()) await onCommit(next);
    setDraft(null);
  }
  return (
    <input
      className={`input pr-cell${mono ? ' mono' : ''}${invalid ? ' err' : ''}${className ? ` ${className}` : ''}`}
      type="text"
      aria-label={ariaLabel}
      aria-invalid={invalid ? true : undefined}
      disabled={disabled}
      placeholder={placeholder}
      value={shown}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={leave}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** A number typed as text (so "4.5", "4,5" and an empty cell all work). */
export function NumberCell({
  value,
  onCommit,
  ariaLabel,
  disabled,
  className,
  invalid,
  placeholder,
  integer,
  decimals = 2,
}: Common & {
  value: number | null;
  onCommit: Commit<number | null>;
  integer?: boolean;
  decimals?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = value === null ? '' : integer ? String(value) : value.toFixed(decimals);
  async function leave() {
    if (draft === null) return;
    const raw = draft.trim().replace(',', '.');
    setDraft(null);
    if (raw === text) return;
    if (raw === '') {
      await onCommit(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      await onCommit(Number.NaN);
      return;
    }
    await onCommit(n);
  }
  return (
    <input
      className={`input pr-cell num${invalid ? ' err' : ''}${className ? ` ${className}` : ''}`}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      aria-label={ariaLabel}
      aria-invalid={invalid ? true : undefined}
      disabled={disabled}
      placeholder={placeholder ?? '—'}
      value={draft ?? text}
      autoComplete="off"
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={leave}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** dd/mm/yyyy typed (UK order, §1.8) — never `<input type="date">`. */
export function DateCell({
  value,
  onCommit,
  ariaLabel,
  disabled,
  className,
  invalid,
  onBad,
}: Common & {
  value: string | null;
  onCommit: Commit<string | null>;
  onBad?: (message: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? ukDateText(value ?? '');
  async function leave() {
    if (draft === null) return;
    const reading = readUkDate(draft, true);
    setDraft(null);
    if ('error' in reading) {
      onBad?.(reading.error);
      return;
    }
    if ('value' in reading && (reading.value || null) !== value)
      await onCommit(reading.value || null);
  }
  return (
    <input
      className={`input pr-cell mono${invalid ? ' err' : ''}${className ? ` ${className}` : ''}`}
      type="text"
      inputMode="numeric"
      maxLength={10}
      aria-label={ariaLabel}
      aria-invalid={invalid ? true : undefined}
      disabled={disabled}
      placeholder="dd/mm/yyyy"
      value={shown}
      autoComplete="off"
      onChange={(e) => setDraft(typeUkDate(e.currentTarget.value))}
      onBlur={leave}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** HH:MM on the person's own clock (ADR-0085) via the shared TimeField. */
export function ClockCell({
  value,
  onCommit,
  ariaLabel,
  disabled,
  className,
  invalid,
}: Common & { value: string | null; onCommit: Commit<string | null> }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const bad = useRef(false);
  const current = value ?? '';
  async function leave() {
    if (draft === null || bad.current) {
      setDraft(null);
      return;
    }
    const next = draft;
    setDraft(null);
    if (next !== current) await onCommit(next === '' ? null : next);
  }
  return (
    <TimeField
      id={id}
      aria-label={ariaLabel}
      className={`pr-cell${invalid ? ' err' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      value={draft ?? current}
      onChange={setDraft}
      onInvalidChange={(v) => {
        bad.current = v;
      }}
      onBlur={leave}
    />
  );
}
