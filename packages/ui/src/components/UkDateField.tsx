'use client';

import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { UK_DATE_PLACEHOLDER, readUkDate, typeUkDate, ukDateText } from './ukdate';

export interface UkDateFieldProps {
  /** The field's name for people. Visible unless `labelHidden`. */
  label: ReactNode;
  /**
   * Keep the label for a screen reader only — for a filter row whose
   * placeholder and neighbours already say what the box is ("Added from").
   */
  labelHidden?: boolean;
  /** Controlled: `yyyy-mm-dd`, or '' for no date. */
  value?: string;
  /** Uncontrolled: the first value, for a plain `<form>`. */
  defaultValue?: string;
  /** Called with `yyyy-mm-dd`, or '' when the box is emptied or left wrong. */
  onChange?: (iso: string) => void;
  /**
   * Submitted with a `<form>` as `yyyy-mm-dd` (a hidden input) — the typed
   * box itself carries the UK text and is never submitted.
   */
  name?: string;
  /** An error from outside the field (a reversed range); the field's own wins. */
  error?: string | null;
  hint?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  /** Bounds for the calendar picker, `yyyy-mm-dd`. Typing is not clamped. */
  min?: string;
  max?: string;
  className?: string;
}

/**
 * A date typed dd/mm/yyyy, never a bare `<input type="date">`: that one
 * draws its value in the device's locale, so a US-English browser showed
 * mm/dd/yyyy under a "UK date" label (the reason CLAUDE.md bans
 * `<input type="time">` for `TimeField`). The typed box is the field — it
 * has the label, the hint, the error and the keyboard path.
 *
 * A calendar button is welded to its right, as on the Staff App's date of
 * birth (ADR-0068): the browser's own picker laid invisibly over the icon.
 * It only ever writes INTO the text box, which shows the day UK-style, so
 * the device's order never reaches the screen. It is a pointer shortcut to
 * the same value, kept out of the Tab order and the accessibility tree.
 *
 * A complete, real day is applied as it is typed; an empty box removes the
 * value; anything else is left unapplied while typing and, once the reader
 * leaves the box, said in words — and the value is removed, so nothing is
 * filtered or saved by a date the box does not show.
 *
 * Shared by the Client Portal's list filters (ADR-0133) and the Back
 * Office's date fields (ADR-0138).
 */
export function UkDateField({
  label,
  labelHidden,
  value,
  defaultValue = '',
  onChange,
  name,
  error,
  hint,
  disabled,
  required,
  min,
  max,
  className,
}: UkDateFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const controlled = value !== undefined;
  const [own, setOwnValue] = useState(defaultValue);
  const current = controlled ? value : own;
  const [text, setText] = useState(() => ukDateText(current));
  const [problem, setProblem] = useState<string | null>(null);
  // The value this field last applied, so a change from outside (Clear
  // filters, Back, a hand-edited address) is told apart from its own echo.
  const applied = useRef(current);

  useEffect(() => {
    if (current === applied.current) return;
    applied.current = current;
    setText(ukDateText(current));
    setProblem(null);
  }, [current]);

  function apply(iso: string) {
    applied.current = iso;
    if (!controlled) setOwnValue(iso);
    if (iso !== current) onChange?.(iso);
  }

  function show(next: string) {
    setText(next);
    const reading = readUkDate(next);
    if ('value' in reading) {
      setProblem(null);
      apply(reading.value);
    } else if ('error' in reading) {
      setProblem(reading.error);
    } else {
      // Half-typed: no complaint yet, and nothing applied.
      setProblem(null);
    }
  }

  function leave() {
    const reading = readUkDate(text, true);
    if ('error' in reading) {
      setProblem(reading.error);
      apply('');
    } else if ('value' in reading) {
      setText(ukDateText(reading.value));
    }
  }

  const shownError = problem ?? error ?? null;
  const hintId = `${id}-hint`;
  const describedBy = shownError ? noteId : hint ? hintId : undefined;

  return (
    <div className={clsx('field', 'ukd', className)}>
      <label className={labelHidden ? 'label sr-only' : 'label'} htmlFor={id}>
        {label}
      </label>
      <div className="input-row ukd-row">
        <input
          id={id}
          className={shownError ? 'input err' : 'input'}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={UK_DATE_PLACEHOLDER}
          maxLength={10}
          disabled={disabled}
          required={required}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy}
          value={text}
          onChange={(e) => {
            const raw = e.currentTarget.value;
            const caret = e.currentTarget.selectionStart ?? raw.length;
            // Mid-entry edits are left as typed so the caret does not jump;
            // only typing at the end is re-formatted.
            show(caret < raw.length ? raw.replace(/[^\d/]/g, '') : typeUkDate(raw));
          }}
          onBlur={leave}
        />
        <span className={clsx('addon', 'ukd-cal', disabled && 'disabled')}>
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
          <input
            className="ukd-native"
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            title="Pick from a calendar"
            disabled={disabled}
            min={min}
            max={max}
            value={readUkDateValue(text)}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {
                // Not allowed here: the tap opens it where the browser does.
              }
            }}
            onChange={(e) => {
              if (e.currentTarget.value) show(ukDateText(e.currentTarget.value));
            }}
          />
        </span>
      </div>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      {shownError ? (
        <span className="error" role="alert" id={noteId}>
          {shownError}
        </span>
      ) : hint ? (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** The picker's own value: the box's day when it is complete and real. */
function readUkDateValue(text: string): string {
  const reading = readUkDate(text);
  return 'value' in reading ? reading.value : '';
}
