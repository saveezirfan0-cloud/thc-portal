'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal, Note, Textarea } from '@thc/ui';
import { rejectSelfie } from '../staff/[id]/actions';

/**
 * Reject the profile selfie (ADR-0097) — the "Profile selfie" row's one
 * action, on /onboarding/:id and on /staff/:id → Documents.
 *
 * §10.1 locks the avatar once it is set, so without this an inappropriate
 * photo stayed on the Back Office, the client line-up and the timesheet
 * until the worker asked. Rejecting takes the photo down (initials
 * everywhere), lifts the lock and tells the worker why (RC5); they take a
 * new one — on wizard step 3 while onboarding, on Profile details once
 * working. Nothing already issued is rewritten (§1.7).
 *
 * The reason is required and is shown to the worker word for word, so the
 * box says so. The server action asks again: a confirmation that exists only
 * in the browser is not one.
 */
export function RejectSelfie({
  staffId,
  name,
  disabled = false,
}: {
  staffId: string;
  /** Who it is — the dialog names them. */
  name: string;
  /** The row is read-only (a past phase of the profile). */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const close = () => {
    setOpen(false);
    setReason('');
    setProblem(null);
  };

  const confirm = () => {
    setProblem(null);
    start(async () => {
      // A server action that throws must not leave the click looking dead.
      let result: Awaited<ReturnType<typeof rejectSelfie>>;
      try {
        result = await rejectSelfie(staffId, reason);
      } catch {
        result = { ok: false, message: 'Something went wrong on the server. Try again.' };
      }
      if (result.ok) {
        close();
        router.refresh();
      } else {
        setProblem(result.message);
      }
    });
  };

  const first = name.split(' ')[0] || 'They';

  return (
    <>
      <Button tone="danger" size="sm" disabled={disabled || busy} onClick={() => setOpen(true)}>
        Reject
      </Button>
      <Modal
        open={open}
        title="Reject profile selfie"
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              tone="danger"
              solid
              disabled={busy || reason.trim() === '' || reason.length > 300}
              onClick={confirm}
            >
              Reject selfie
            </Button>
          </>
        }
      >
        <div className="stack">
          <Textarea
            label="Reason *"
            value={reason}
            maxLength={300}
            placeholder="e.g. Face not visible · not a photo of you · please retake without a hat or sunglasses"
            onChange={(event) => setReason(event.target.value)}
            hint={`${first} sees this in the app word for word: “Your profile photo was not accepted: [reason]. Please take a new one.” No full stop at the end, and don't describe what the photo showed.`}
          />
          <Note>
            The photo comes down now: {first} shows as initials across the system until they take a
            new one — on step 3 of the onboarding if they are still in it, otherwise under Profile →
            Profile details. Timesheets and sheets already issued keep the photo they printed.
          </Note>
          {problem ? <Alert tone="coral">{problem}</Alert> : null}
        </div>
      </Modal>
    </>
  );
}
