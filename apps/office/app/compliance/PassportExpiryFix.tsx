'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal, Note, Pill, UkDateField, toast } from '@thc/ui';
import { setPassportExpiry } from './actions';
import { identityExpiryProblem } from './rtw';

/**
 * A verified passport with no expiry on file (ADR-0201): one verified before
 * the expiry became required, or whose AI read found none. Nothing reminds or
 * blocks it until it has one, so the office is shown that and can add it.
 */
export function passportNeedsExpiry(doc: {
  doc_type: string;
  review_status: string;
  expiry_date: string | null;
}): boolean {
  return doc.doc_type === 'passport' && doc.review_status === 'verified' && !doc.expiry_date;
}

export function PassportExpiryFix({
  docId,
  disabled = false,
}: {
  docId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [pending, start] = useTransition();
  const problem = identityExpiryProblem(date, true);

  const save = () =>
    start(async () => {
      const result = await setPassportExpiry(docId, date);
      toast(result.message ?? (result.ok ? 'Saved.' : 'Could not save.'), {
        tone: result.ok ? 'green' : 'coral',
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <>
      <Pill tone="coral">no expiry — not monitored</Pill>
      <Button size="sm" tone="green" disabled={disabled || pending} onClick={() => setOpen(true)}>
        Add expiry
      </Button>
      {open ? (
        <Modal
          open
          title="Add the passport expiry"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button tone="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button tone="green" solid disabled={pending || problem !== null} onClick={save}>
                Save expiry
              </Button>
            </>
          }
        >
          <UkDateField
            label={
              <>
                Passport expiry <span className="coral">*</span>
              </>
            }
            value={date}
            onChange={setDate}
            hint="Enter it off the passport. Reminders start a month before and the worker is blocked automatically on the day it expires."
          />
          <Note>
            This passport was verified without an expiry, so nothing is watching it. An
            already-expired passport cannot be dated: reject it and ask for a current one.
          </Note>
          {problem && date !== '' ? <div className="coral sm">{problem}</div> : null}
        </Modal>
      ) : null}
    </>
  );
}
