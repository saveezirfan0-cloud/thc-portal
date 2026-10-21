'use client';

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { isEmail } from './validate';

/**
 * A list of email addresses as chips with an input for the next one
 * (ADR-0176's invoice To and CC lists, on New client and on the card's
 * Invoicing panel). Enter or a comma adds the typed address, Backspace in
 * an empty input removes the last chip, blur adds what was typed. The
 * half-typed address is the caller's (`draft`), so Save can fold it in.
 *
 * Addresses are lower-cased as they are added: the database stores them
 * so (`_invoice_email_list`), and a chip should read as it will be saved.
 */
export function EmailChipsField({
  id,
  label,
  emails,
  onEmailsChange,
  draft,
  onDraftChange,
  max,
  noun,
  hint,
  error,
  onProblem,
  boxClass = 'emails',
}: {
  id: string;
  label: ReactNode;
  emails: readonly string[];
  onEmailsChange: (emails: string[]) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  max: number;
  /** "invoice emails", "CC emails" — for "Up to 10 …". */
  noun: string;
  hint?: ReactNode;
  /** Shown under the field, and marks the input invalid. */
  error?: string;
  /** An address refused as it was added; null clears the last one. */
  onProblem: (message: string | null) => void;
  /** The chip box's class: `emails` (clients.css) or the card's `inv-emails` (card.css). */
  boxClass?: string;
}) {
  const add = () => {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!isEmail(value)) {
      onProblem(`“${value}” is not an email address.`);
      return;
    }
    if (emails.includes(value)) {
      onDraftChange('');
      return;
    }
    if (emails.length >= max) {
      onProblem(`Up to ${max} ${noun}.`);
      return;
    }
    onProblem(null);
    onEmailsChange([...emails, value]);
    onDraftChange('');
  };

  const onKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter adds the address; the field takes several.
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && draft === '' && emails.length > 0) {
      onEmailsChange(emails.slice(0, -1));
    }
  };

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className={boxClass}>
        {emails.map((email) => (
          <span className="chip" key={email}>
            {email}
            <button
              type="button"
              className="x"
              aria-label={`Remove ${email}`}
              onClick={() => onEmailsChange(emails.filter((other) => other !== email))}
            >
              ×
            </button>
          </span>
        ))}
        {emails.length < max ? (
          <input
            id={id}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onKey}
            onBlur={add}
            placeholder={emails.length === 0 ? 'add an email ↵' : 'add another email ↵'}
            inputMode="email"
            aria-describedby={hint ? `${id}-hint` : undefined}
            aria-invalid={error ? true : undefined}
          />
        ) : null}
      </div>
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
