'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { UK_DATE_PLACEHOLDER, readUkDate, typeUkDate, ukDateText } from './ukdate';

/**
 * "From (UK date)" / "To (UK date)" on the event list (ADR-0049, ADR-0133).
 *
 * A text box typed dd/mm/yyyy, never a bare `<input type="date">`: that one
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
 * `value` is `yyyy-mm-dd` or '' (the address bar's form, window.ts). A
 * complete, real day is applied as it is typed; an empty box removes the
 * bound; anything else is left unapplied while typing and, once the
 * customer leaves the box, said in words — and the bound is removed, so the
 * list is never filtered by a date the box does not show.
 */
export function UkDateField({
  label,
  value,
  onChange,
  error,
  className,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  /** An error from outside the field (a reversed range); the field's own wins. */
  error?: string | null;
  className?: string;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const [text, setText] = useState(() => ukDateText(value));
  const [own, setOwn] = useState<string | null>(null);
  // The value this field last applied, so a change from outside (Clear
  // filters, Back, a hand-edited address) is told apart from its own echo.
  const applied = useRef(value);

  useEffect(() => {
    if (value === applied.current) return;
    applied.current = value;
    setText(ukDateText(value));
    setOwn(null);
  }, [value]);

  function apply(iso: string) {
    applied.current = iso;
    if (iso !== value) onChange(iso);
  }

  function show(next: string) {
    setText(next);
    const reading = readUkDate(next);
    if ('value' in reading) {
      setOwn(null);
      apply(reading.value);
    } else if ('error' in reading) {
      setOwn(reading.error);
    } else {
      // Half-typed: no complaint yet, and nothing applied.
      setOwn(null);
    }
  }

  function leave() {
    const reading = readUkDate(text, true);
    if ('error' in reading) {
      setOwn(reading.error);
      apply('');
    } else if ('value' in reading) {
      setText(ukDateText(reading.value));
    }
  }

  const shownError = own ?? error ?? null;

  return (
    <div className={className ? `field ukd ${className}` : 'field ukd'}>
      <label className="label" htmlFor={id}>
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
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? noteId : undefined}
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
        <span className="addon ukd-cal">
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
      {shownError ? (
        <span className="error" role="alert" id={noteId}>
          {shownError}
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
