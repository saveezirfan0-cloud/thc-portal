'use client';

import { useState, useTransition } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Alert, Button, Chip, Input, Panel, Textarea } from '@thc/ui';
import { isEmail } from '../validate';
import { setInvoiceDetails } from './actions';
import {
  INVOICE_EMAILS_HINT,
  MAX_INVOICE_EMAILS,
  invoiceEmailsProblem,
  normaliseInvoiceEmails,
} from './invoiceDetails';
import type { InvoiceDetails } from './types';

/**
 * Invoicing (ADR-0176, THC 20.10.2026) — the system emails each invoice
 * itself, with the sign-in and sign-out log attached, addressed to the
 * client's accounts contact:
 *
 *   · Accounts contact — the name under "Invoice to";
 *   · Invoice emails — up to five; none sends the invoice to the
 *     allocation emails above;
 *   · Billing address — printed under the name on the invoice.
 *
 * Not in the wireframe; the ADR is the deviation record. Without the
 * 'write' permission (a viewer, ADR-0060) the values are text, with no
 * Edit — the database (`set_client_invoice_details`) refuses the same.
 */
export function Invoicing({
  clientId,
  details,
  canWrite,
}: {
  clientId: string;
  details: InvoiceDetails;
  /** ADR-0060: office_can('write'). */
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <Panel
      title={
        <>
          <span className="blk-n">7</span> Invoicing
        </>
      }
      actions={
        <>
          {canWrite && !editing ? (
            <Button size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
          <span className="muted xs">
            the invoice is emailed with the sign-in and sign-out log, from timesheets@
          </span>
        </>
      }
    >
      {canWrite && editing ? (
        <InvoicingForm clientId={clientId} details={details} onDone={() => setEditing(false)} />
      ) : (
        <InvoicingView details={details} />
      )}
    </Panel>
  );
}

function InvoicingView({ details }: { details: InvoiceDetails }) {
  return (
    <div className="kv">
      <span className="k">Accounts contact</span>
      <span>{details.accountsContactName ?? <span className="muted">Not set</span>}</span>
      <span className="k">Invoice emails</span>
      <span className="stack tight">
        {details.invoiceEmails.length > 0 ? (
          <span className="row wrap">
            {details.invoiceEmails.map((email) => (
              <Chip key={email}>{email}</Chip>
            ))}
          </span>
        ) : (
          <span className="muted">None</span>
        )}
        <span className="muted xs">{INVOICE_EMAILS_HINT}</span>
      </span>
      <span className="k">Billing address</span>
      <span className="stack tight">
        {details.billingAddress ? (
          <span className="inv-address">{details.billingAddress}</span>
        ) : (
          <span className="muted">Not set</span>
        )}
        <span className="muted xs">printed under &ldquo;Invoice to&rdquo; on the invoice</span>
      </span>
    </div>
  );
}

function InvoicingForm({
  clientId,
  details,
  onDone,
}: {
  clientId: string;
  details: InvoiceDetails;
  onDone: () => void;
}) {
  const [name, setName] = useState(details.accountsContactName ?? '');
  const [emails, setEmails] = useState<string[]>(details.invoiceEmails);
  const [draft, setDraft] = useState('');
  const [address, setAddress] = useState(details.billingAddress ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const addEmail = () => {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!isEmail(value)) {
      setError(`“${value}” is not an email address.`);
      return;
    }
    if (emails.includes(value)) {
      setDraft('');
      return;
    }
    if (emails.length >= MAX_INVOICE_EMAILS) {
      setError(`Up to ${MAX_INVOICE_EMAILS} invoice emails.`);
      return;
    }
    setError(null);
    setEmails([...emails, value]);
    setDraft('');
  };

  const onEmailKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter adds the address; the field takes several.
      event.preventDefault();
      addEmail();
    } else if (event.key === 'Backspace' && draft === '' && emails.length > 0) {
      setEmails(emails.slice(0, -1));
    }
  };

  const save = () => {
    // A half-typed address is kept, not lost to Save.
    const pending = normaliseInvoiceEmails(draft.trim() ? [...emails, draft] : emails);
    const problem = invoiceEmailsProblem(pending);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = await setInvoiceDetails(clientId, {
        accountsContactName: name,
        invoiceEmails: pending,
        billingAddress: address,
      });
      if (result.ok) onDone();
      else setError(result.message);
    });
  };

  return (
    <div className="stack">
      <Input
        label="Accounts contact"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Accounts Payable"
        hint="The name the invoice is addressed to."
        maxLength={200}
      />

      <div className="field">
        <label className="label" htmlFor={`invoice-email-${clientId}`}>
          Invoice emails <span className="muted">· up to {MAX_INVOICE_EMAILS}</span>
        </label>
        <div className="inv-emails">
          {emails.map((email) => (
            <span className="chip" key={email}>
              {email}
              <button
                type="button"
                className="x"
                aria-label={`Remove ${email}`}
                onClick={() => setEmails(emails.filter((other) => other !== email))}
              >
                ×
              </button>
            </span>
          ))}
          {emails.length < MAX_INVOICE_EMAILS ? (
            <input
              id={`invoice-email-${clientId}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onEmailKey}
              onBlur={addEmail}
              placeholder={emails.length === 0 ? 'add an email ↵' : 'add another email ↵'}
              inputMode="email"
              aria-describedby={`invoice-email-hint-${clientId}`}
            />
          ) : null}
        </div>
        <span className="hint" id={`invoice-email-hint-${clientId}`}>
          {INVOICE_EMAILS_HINT}
        </span>
      </div>

      <Textarea
        label="Billing address"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        rows={4}
        hint="Printed under “Invoice to” on the invoice, line by line."
        maxLength={1000}
      />

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <div className="row">
        <Button tone="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
