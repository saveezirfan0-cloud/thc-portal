'use client';

import { useId, useState } from 'react';
import { dobShownFrom, dobValueFrom, formatDobTyping } from './dob';
import { parseDob } from './form';
import './dob-input.css';

export interface DobInputProps {
  label: string;
  /** `yyyy-mm-dd` once complete; a half-typed entry otherwise (dob.ts). */
  value: string;
  onChange: (value: string) => void;
  /** Submitted in a hidden input under this name, always as `value`. */
  name?: string;
  hint?: string;
  error?: string;
}

/**
 * Date of birth, typed or picked (§2.1, ADR-0064).
 *
 * A text box that takes digits (`inputMode="numeric"`, so phones open the
 * number pad) and draws the `DD/MM/YYYY` slashes itself, with a calendar
 * button welded to its right. The button is the browser's own date picker —
 * a transparent `<input type="date">` laid over the icon — so the phone
 * opens its OS wheel and the desktop its calendar, and a pick fills the box.
 *
 * The typed box is the field: it has the label, the error and the keyboard
 * path. The calendar is a pointer shortcut to the same value, so it is kept
 * out of the Tab order and the accessibility tree rather than giving a
 * screen reader two controls for one answer. It sits outside the text box,
 * where the browser's own autofill icon cannot cover it.
 *
 * No `max`, as before: capping the calendar at eighteen years ago would hide
 * the under-18 case instead of refusing it out loud (§1.7).
 */
export function DobInput({ label, value, onChange, name, hint, error }: DobInputProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const [shown, setShown] = useState(() => dobShownFrom(value));
  const complete = parseDob(value) ? value : '';

  function show(next: string) {
    setShown(next);
    onChange(dobValueFrom(next));
  }

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div className="input-row dob-row">
        <input
          id={id}
          className={`input${error ? ' err' : ''}`}
          type="text"
          inputMode="numeric"
          autoComplete="bday"
          placeholder="DD/MM/YYYY"
          maxLength={10}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? noteId : undefined}
          value={shown}
          onChange={(event) => {
            const raw = event.target.value;
            const caret = event.target.selectionStart ?? raw.length;
            // Mid-entry edits are left alone, so the caret does not jump;
            // only typing at the end is re-formatted.
            show(caret < raw.length ? raw.replace(/[^\d/]/g, '') : formatDobTyping(raw));
          }}
          onBlur={() => show(formatDobTyping(shown))}
        />
        <span className="addon dob-cal">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
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
            className="dob-native"
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            title="Pick from a calendar"
            value={complete}
            onClick={(event) => {
              try {
                event.currentTarget.showPicker?.();
              } catch {
                // Not allowed here (or not supported): the tap itself
                // opens the picker on the browsers that do that natively.
              }
            }}
            onChange={(event) => {
              if (event.target.value) show(formatDobTyping(event.target.value));
            }}
          />
        </span>
      </div>
      {hint && !error ? (
        <span className="hint" id={noteId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="error" role="alert" id={noteId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
