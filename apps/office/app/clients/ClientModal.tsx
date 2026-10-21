'use client';

import { useState, useTransition } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Alert, Button, Input, Modal, Pill, Switch, Textarea } from '@thc/ui';
import { lengthHint } from '../_lib/length';
import { createClientRecord, updateClientRecord } from './actions';
import {
  ACCOUNTS_CONTACT_MAX,
  BILLING_ADDRESS_MAX,
  CLIENT_NAME_MAX,
  CONTACT_NAME_MAX,
  CONTACT_POINT_MAX,
  MAX_CONTACT_EMAILS,
  MAX_INVOICE_EMAILS,
  clientFieldErrors,
  isEmail,
  normaliseInvoiceEmails,
} from './validate';
import type { Client } from './types';

export interface ClientModalProps {
  /** Null creates; a client opens its fields for editing (§9.7). */
  client: Client | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * New / Edit client (§9.7).
 *
 * §9.7 is absolute that every field here is mandatory and that there is no
 * Delete — a client record can be edited at any time but never removed —
 * so this modal serves both the "New client" and the client card's "Edit"
 * action, and neither has a delete button.
 *
 * The rate card, the dress codes and the qualified staff are deliberately
 * not here: they are added on the client card after creation.
 *
 * New client also asks where its invoices go (ADR-0176, THC 21.10.2026):
 * at least one invoice email is compulsory, up to ten; the accounts
 * contact and billing address are optional. Edit does not show them —
 * once the client exists they are the card's Invoicing panel's, finance
 * only.
 */
export function ClientModal({ client, onClose, onSaved }: ClientModalProps) {
  const editing = client !== null;

  const [name, setName] = useState(client?.name ?? '');
  const [contactName, setContactName] = useState(client?.contact_name ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [contactPoint, setContactPoint] = useState(client?.staff_contact_point ?? '');
  const [emails, setEmails] = useState<string[]>(client?.contact_emails ?? []);
  const [emailDraft, setEmailDraft] = useState('');
  const [paysBreaks, setPaysBreaks] = useState(client?.pays_breaks ?? false);
  const [paysBuffer, setPaysBuffer] = useState(client?.pays_buffer ?? true);
  const [invoiceEmails, setInvoiceEmails] = useState<string[]>([]);
  const [invoiceDraft, setInvoiceDraft] = useState('');
  const [accountsContact, setAccountsContact] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Release audit D-M2: what is missing is said under the field once Save
  // has been tried; what is malformed (a phone that is not one) as soon as
  // it is typed.
  const [tried, setTried] = useState(false);
  const [saving, startSaving] = useTransition();

  const addEmail = () => {
    const value = emailDraft.trim();
    if (!value) return;
    if (!isEmail(value)) {
      setError(`“${value}” is not an email address.`);
      return;
    }
    if (emails.includes(value)) {
      setEmailDraft('');
      return;
    }
    if (emails.length >= MAX_CONTACT_EMAILS) {
      setError(`Up to ${MAX_CONTACT_EMAILS} contact emails.`);
      return;
    }
    setError(null);
    setEmails([...emails, value]);
    setEmailDraft('');
  };

  const onEmailKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter adds the address rather than submitting the modal: the field
      // takes several, and losing a half-typed one to a stray Enter is the
      // most annoying thing a chip input can do.
      event.preventDefault();
      addEmail();
    } else if (event.key === 'Backspace' && emailDraft === '' && emails.length > 0) {
      setEmails(emails.slice(0, -1));
    }
  };

  const addInvoiceEmail = () => {
    const value = invoiceDraft.trim().toLowerCase();
    if (!value) return;
    if (!isEmail(value)) {
      setError(`“${value}” is not an email address.`);
      return;
    }
    if (invoiceEmails.includes(value)) {
      setInvoiceDraft('');
      return;
    }
    if (invoiceEmails.length >= MAX_INVOICE_EMAILS) {
      setError(`Up to ${MAX_INVOICE_EMAILS} invoice emails.`);
      return;
    }
    setError(null);
    setInvoiceEmails([...invoiceEmails, value]);
    setInvoiceDraft('');
  };

  const onInvoiceEmailKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addInvoiceEmail();
    } else if (event.key === 'Backspace' && invoiceDraft === '' && invoiceEmails.length > 0) {
      setInvoiceEmails(invoiceEmails.slice(0, -1));
    }
  };

  // The draft the server sees, with the half-typed address folded in — a
  // manager who types an address and presses Create should not lose it.
  const pendingEmails =
    emailDraft.trim() && isEmail(emailDraft.trim()) ? [...emails, emailDraft.trim()] : emails;
  const pendingInvoiceEmails = normaliseInvoiceEmails(
    invoiceDraft.trim() && isEmail(invoiceDraft.trim())
      ? [...invoiceEmails, invoiceDraft]
      : invoiceEmails,
  );
  // Where the main contact's own addresses are where the invoice goes too.
  const useContactEmails = () => {
    setError(null);
    setInvoiceEmails(
      normaliseInvoiceEmails([...invoiceEmails, ...pendingEmails]).slice(0, MAX_INVOICE_EMAILS),
    );
  };
  const invoicing = editing
    ? undefined
    : {
        invoice_emails: pendingInvoiceEmails,
        accounts_contact_name: accountsContact,
        billing_address: billingAddress,
      };

  // Release audit E-M4 / m2: Escape or the backdrop on a filled-in form
  // asks first; Enter submits.
  const dirty =
    name !== (client?.name ?? '') ||
    contactName !== (client?.contact_name ?? '') ||
    phone !== (client?.phone ?? '') ||
    contactPoint !== (client?.staff_contact_point ?? '') ||
    emailDraft.trim() !== '' ||
    emails.join('\n') !== (client?.contact_emails ?? []).join('\n') ||
    paysBreaks !== (client?.pays_breaks ?? false) ||
    paysBuffer !== (client?.pays_buffer ?? true) ||
    invoiceEmails.length > 0 ||
    invoiceDraft.trim() !== '' ||
    accountsContact.trim() !== '' ||
    billingAddress.trim() !== '';

  const fieldErrors = clientFieldErrors(
    {
      name,
      contact_name: contactName,
      phone,
      staff_contact_point: contactPoint,
      contact_emails: pendingEmails,
      pays_breaks: paysBreaks,
      pays_buffer: paysBuffer,
      invoicing,
    },
    !editing,
  );
  /** The error to draw under a field: always once tried, else only for a value that is there but wrong. */
  const shown = (field: keyof typeof fieldErrors, value: string) =>
    tried || value.trim() !== '' ? fieldErrors[field] : undefined;

  const save = () => {
    setError(null);
    setTried(true);
    if (Object.keys(fieldErrors).length > 0) {
      // The keyboard goes to the first field that needs attention.
      window.setTimeout(() => {
        document.querySelector<HTMLElement>('.modal [aria-invalid="true"]')?.focus();
      }, 0);
      return;
    }
    startSaving(async () => {
      const draft = {
        name,
        contact_name: contactName,
        phone,
        staff_contact_point: contactPoint,
        contact_emails: pendingEmails,
        pays_breaks: paysBreaks,
        pays_buffer: paysBuffer,
        invoicing,
      };
      const result = client
        ? await updateClientRecord(client.id, draft)
        : await createClientRecord(draft);
      if (result.ok) onSaved();
      else setError(result.message);
    });
  };

  return (
    <Modal
      open
      wide
      title={editing ? 'Edit client' : 'New client'}
      onClose={onClose}
      dirty={dirty && !saving}
      onSubmit={() => {
        if (!saving) save();
      }}
      footer={
        <>
          <Button tone="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button tone="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create client'}
          </Button>
        </>
      }
    >
      <div className="row">
        {/* The invoicing name and address are optional (ADR-0176); every
            §9.7 field still is mandatory. */}
        <Pill tone="amber">{editing ? 'all fields mandatory' : 'every * field is mandatory'}</Pill>
        {editing ? <Pill>{client.name}</Pill> : null}
      </div>

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <Input
        label={
          <>
            Client name <span className="coral">*</span>
          </>
        }
        value={name}
        maxLength={CLIENT_NAME_MAX}
        error={shown('name', name)}
        hint={lengthHint(name.length, CLIENT_NAME_MAX)}
        onChange={(event) => setName(event.target.value)}
        aria-required="true"
      />

      <div className="grid c2">
        <Input
          label={
            <>
              Contact full name <span className="coral">*</span>
            </>
          }
          value={contactName}
          maxLength={CONTACT_NAME_MAX}
          error={shown('contact_name', contactName)}
          onChange={(event) => setContactName(event.target.value)}
          aria-required="true"
        />
        <Input
          label={
            <>
              Contact phone <span className="coral">*</span>
            </>
          }
          value={phone}
          type="tel"
          inputMode="tel"
          placeholder="020 7946 0000"
          error={shown('phone', phone)}
          onChange={(event) => setPhone(event.target.value)}
          aria-required="true"
        />
      </div>

      <Input
        label={
          <>
            Staff contact point <span className="coral">*</span>
          </>
        }
        value={contactPoint}
        maxLength={CONTACT_POINT_MAX}
        error={shown('staff_contact_point', contactPoint)}
        onChange={(event) => setContactPoint(event.target.value)}
        hint="The on-site contact the staff see at the venue — pre-fills the event form’s on-site contact."
        aria-required="true"
      />

      <div className="field">
        <label className="label" htmlFor="client-email">
          {/* §9.7: "Contact emails" on New client; "Allocation email(s)" once
              the client exists, as the card's Edit names them
              (wireframes/backoffice/client-card.html) — the allocation sheet
              and timesheet go to these addresses (§11.4). */}
          {editing ? 'Allocation email(s)' : 'Contact emails'} <span className="coral">*</span>
          {/* §9.7 says "several (2–3 people)" without a ceiling; the owner
              asked for ten (ADR-0087), and the label says the real rule. */}
          {editing ? null : (
            <>
              {' '}
              <span className="muted">· up to {MAX_CONTACT_EMAILS}</span>
            </>
          )}
        </label>
        <div className="emails">
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
          <input
            id="client-email"
            value={emailDraft}
            onChange={(event) => setEmailDraft(event.target.value)}
            onKeyDown={onEmailKey}
            onBlur={addEmail}
            placeholder={emails.length === 0 ? 'add an email ↵' : 'add another email ↵'}
            inputMode="email"
            aria-describedby="client-email-hint"
            aria-invalid={tried && fieldErrors.contact_emails ? true : undefined}
          />
        </div>
        {tried && fieldErrors.contact_emails ? (
          <span className="error" role="alert">
            {fieldErrors.contact_emails}
          </span>
        ) : null}
        <span className="hint" id="client-email-hint">
          The Allocation Timesheet and the Completed Allocation Timesheet go to every address here,
          from timesheets@thehospitalitycompany.co.uk.
        </span>
      </div>

      {editing ? null : (
        <div className="stack" role="group" aria-labelledby="client-invoicing">
          <div className="row">
            <Pill id="client-invoicing">Invoicing</Pill>
            <span className="muted xs">where the invoice is emailed, from timesheets@</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="client-invoice-email">
              Invoice emails <span className="coral">*</span>{' '}
              <span className="muted">· up to {MAX_INVOICE_EMAILS}</span>
            </label>
            <div className="emails">
              {invoiceEmails.map((email) => (
                <span className="chip" key={email}>
                  {email}
                  <button
                    type="button"
                    className="x"
                    aria-label={`Remove ${email}`}
                    onClick={() =>
                      setInvoiceEmails(invoiceEmails.filter((other) => other !== email))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
              {invoiceEmails.length < MAX_INVOICE_EMAILS ? (
                <input
                  id="client-invoice-email"
                  value={invoiceDraft}
                  onChange={(event) => setInvoiceDraft(event.target.value)}
                  onKeyDown={onInvoiceEmailKey}
                  onBlur={addInvoiceEmail}
                  placeholder={
                    invoiceEmails.length === 0 ? 'add an email ↵' : 'add another email ↵'
                  }
                  inputMode="email"
                  aria-describedby="client-invoice-email-hint"
                  aria-invalid={tried && fieldErrors.invoice_emails ? true : undefined}
                />
              ) : null}
            </div>
            {tried && fieldErrors.invoice_emails ? (
              <span className="error" role="alert">
                {fieldErrors.invoice_emails}
              </span>
            ) : null}
            <span className="hint" id="client-invoice-email-hint">
              The invoice and the sign-in and sign-out log go to every address here, at 10:00 the
              morning after the event.
            </span>
            {pendingEmails.length > 0 ? (
              <div className="row">
                <Button size="sm" onClick={useContactEmails}>
                  Use the contact emails
                </Button>
              </div>
            ) : null}
          </div>
          <div className="grid c2">
            <Input
              label={
                <>
                  Accounts contact <span className="muted">· optional</span>
                </>
              }
              value={accountsContact}
              maxLength={ACCOUNTS_CONTACT_MAX}
              onChange={(event) => setAccountsContact(event.target.value)}
              placeholder="e.g. Accounts Payable"
              hint="The name the invoice is addressed to; empty uses the contact above."
            />
            <Textarea
              label={
                <>
                  Billing address <span className="muted">· optional</span>
                </>
              }
              value={billingAddress}
              rows={3}
              maxLength={BILLING_ADDRESS_MAX}
              onChange={(event) => setBillingAddress(event.target.value)}
              hint="Printed under “Invoice to”, line by line."
            />
          </div>
        </div>
      )}

      <div className="grid c2">
        <div className="field">
          <span className="label">
            Break policy <span className="coral">*</span>
          </span>
          <Switch
            checked={paysBreaks}
            onChange={setPaysBreaks}
            label={
              <>
                Client pays for breaks — <b>{paysBreaks ? 'ON' : 'OFF'}</b>
              </>
            }
          />
          <span className="hint">
            Off = staff get Start / Finish break buttons; break time is deducted from pay and
            charge.
          </span>
        </div>
        <div className="field">
          <span className="label">
            Buffer policy <span className="coral">*</span>
          </span>
          <Switch
            checked={paysBuffer}
            onChange={setPaysBuffer}
            label={
              <>
                Client pays for the buffer — <b>{paysBuffer ? 'ON' : 'OFF'}</b>
              </>
            }
          />
          <span className="hint">
            Off = strict: surplus workers are turned away at check-in and paid a fixed 4 h if on
            time.
          </span>
        </div>
      </div>

      <div className="note">
        Rate card (roles, charge rates, dress codes) and qualified staff are added on the client
        card after creation. Neither switch has a &ldquo;not set&rdquo; state — both are mandatory.
      </div>
    </Modal>
  );
}
