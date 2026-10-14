'use client';

import { useState, useTransition } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Alert, Button, Input, Modal, Pill, Switch } from '@thc/ui';
import { lengthHint } from '../_lib/length';
import { createClientRecord, updateClientRecord } from './actions';
import {
  CLIENT_NAME_MAX,
  CONTACT_NAME_MAX,
  CONTACT_POINT_MAX,
  MAX_CONTACT_EMAILS,
  clientFieldErrors,
  isEmail,
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

  // The draft the server sees, with the half-typed address folded in — a
  // manager who types an address and presses Create should not lose it.
  const pendingEmails =
    emailDraft.trim() && isEmail(emailDraft.trim()) ? [...emails, emailDraft.trim()] : emails;

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
    paysBuffer !== (client?.pays_buffer ?? true);

  const fieldErrors = clientFieldErrors({
    name,
    contact_name: contactName,
    phone,
    staff_contact_point: contactPoint,
    contact_emails: pendingEmails,
    pays_breaks: paysBreaks,
    pays_buffer: paysBuffer,
  });
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
        <Pill tone="amber">all fields mandatory</Pill>
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
          mono
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
