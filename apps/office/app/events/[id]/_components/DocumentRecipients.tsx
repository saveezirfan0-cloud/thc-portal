'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal } from '@thc/ui';
import { setDocumentRecipients } from '../actions';
import {
  MAX_DOCUMENT_RECIPIENTS,
  parseAddresses,
  recipientsRefusal,
  recipientsToSave,
  splitRecipients,
} from '../document-recipients';

/**
 * "Who receives the timesheet" for one event (ADR-0088). Events on the same
 * day for the same client sometimes need the sheet to go to different
 * people, so the recipients are chosen per event: tick any of the client's
 * contacts, and/or add other addresses. Everyone ticked and nothing added is
 * "the client card", so a contact added to the card later still reaches the
 * event. The choice applies to the Allocation Timesheet and the Completed
 * Allocation Timesheet, sent by hand or automatically.
 *
 * Saving does not send anything: the next send uses the list. To send now,
 * use Send Allocation Timesheet.
 */
export function DocumentRecipients({
  eventId,
  clientContacts,
  recipients,
}: {
  eventId: string;
  /** The contact emails on the client card (§9.7). */
  clientContacts: string[];
  /** The event's own list, or null = the client card. */
  recipients: string[] | null;
}) {
  const router = useRouter();
  const initial = splitRecipients(clientContacts, recipients);
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<string[]>(initial.ticked);
  const [extra, setExtra] = useState(initial.extra.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    const fresh = splitRecipients(clientContacts, recipients);
    setTicked(fresh.ticked);
    setExtra(fresh.extra.join(', '));
    setError(null);
  };

  const extraList = parseAddresses(extra);
  const chosen = recipientsToSave(clientContacts, ticked, extraList);
  const count = chosen === null ? clientContacts.length : chosen.length;

  function save() {
    setError(null);
    const list = chosen ?? [];
    const problem = recipientsRefusal(list);
    if (problem) return setError(problem);
    if (chosen !== null && chosen.length === 0) {
      return setError('Choose at least one recipient, or tick the client contacts.');
    }
    startTransition(async () => {
      const result = await setDocumentRecipients(eventId, chosen);
      if ('error' in result) return setError(result.error);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Timesheet recipients
      </Button>
      <Modal
        open={open}
        title="Who receives the timesheet"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Not now</Button>
            <Button tone="primary" disabled={pending} onClick={save}>
              {pending ? 'Saving…' : 'Save recipients'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {error ? <Alert tone="coral">{error}</Alert> : null}
          <p className="sm">
            For <b>this event only</b>. The Allocation Timesheet and the Completed Allocation
            Timesheet go to the people ticked here, from{' '}
            <b>timesheets@thehospitalitycompany.co.uk</b>, by hand or automatically.
          </p>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="sm">Client contacts</legend>
            {clientContacts.length === 0 ? (
              <span className="sm muted">There are no contact emails on the client card.</span>
            ) : (
              clientContacts.map((email) => (
                <label key={email} className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={ticked.includes(email)}
                    onChange={(e) =>
                      setTicked((now) =>
                        e.target.checked ? [...now, email] : now.filter((x) => x !== email),
                      )
                    }
                  />
                  <span>{email}</span>
                </label>
              ))
            )}
          </fieldset>
          <label className="stack">
            <span className="sm">Also send to (other people, separated by commas)</span>
            <input
              className="input"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="name@company.co.uk, name2@company.co.uk"
              aria-label="Other recipients"
            />
          </label>
          <p className="sm muted">
            {chosen === null
              ? 'Everyone on the client card — a contact added to the card later will reach this event too.'
              : `${count} recipient${count === 1 ? '' : 's'}, up to ${MAX_DOCUMENT_RECIPIENTS}. Saving does not send anything: the next send uses this list. To send now, use Send Allocation Timesheet.`}
          </p>
        </div>
      </Modal>
    </>
  );
}
