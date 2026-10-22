'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Modal, Note, Alert, Textarea } from '@thc/ui';
import {
  NAME_CORRECTION_MESSAGES,
  NAME_CORRECTION_REASON_MAX,
  NAME_CORRECTION_REASON_MIN,
  validateNameCorrection,
} from '@thc/domain';
import { correctName } from '../_lib/nameCorrectionActions';

/**
 * "Correct" on a name (ADR-0193) — the /staff/:id Overview "Contacts &
 * identity" card, the /onboarding/:id Application card and each row of
 * /staff/names. Owners and managers only: the caller passes `allowed` from
 * `officeCan(role, 'identity')`, and `office_correct_name()` refuses
 * everyone else whatever the screen shows.
 *
 * The name is typed as the passport prints it: first and middle names, then
 * the surname, in full. A reason is required (10–300 characters): it is the
 * activity log's only account of why a name payroll and the right-to-work
 * check know a worker by was changed. `recordName` is the name the Home
 * Office record carried, shown as a guide where the list has one.
 */
export function NameCorrection({
  staffId,
  first,
  last,
  allowed,
  recordName = null,
  label = 'Correct',
}: {
  staffId: string;
  /** The first and middle names on file. */
  first: string;
  /** The surname on file. */
  last: string;
  /** `officeCan(role, 'identity')`, false on a removed profile. */
  allowed: boolean;
  /** The name on the Home Office record from a share-code check, if any. */
  recordName?: string | null;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newFirst, setNewFirst] = useState(first);
  const [newLast, setNewLast] = useState(last);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ first?: string; last?: string; reason?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!allowed) return null;

  const openDialog = () => {
    setNewFirst(first);
    setNewLast(last);
    setReason('');
    setErrors({});
    setFailure(null);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setFailure(null);
  };

  const save = () => {
    const checked = validateNameCorrection(
      { first: newFirst, last: newLast, reason },
      { first, last },
    );
    if (!checked.ok) {
      setErrors({ [checked.field]: NAME_CORRECTION_MESSAGES[checked.reason] });
      return;
    }
    setErrors({});
    setFailure(null);
    start(async () => {
      const result = await correctName(staffId, checked.first, checked.last, checked.reason, {
        first,
        last,
      });
      if (!result.ok) {
        setFailure(result.message);
        return;
      }
      setDone(result.note);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button size="sm" tone="ghost" disabled={pending} onClick={openDialog}>
        {label}
      </Button>
      {done ? (
        <span className="stack mt-8">
          <span className="green sm">{done}</span>
        </span>
      ) : null}

      <Modal
        open={open}
        title={`Correct name — ${first} ${last}`}
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button tone="primary" disabled={pending} onClick={save}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="stack">
          {failure ? <Alert tone="coral">{failure}</Alert> : null}
          <div className="kv tight">
            <span className="k">On file</span>
            <span>
              <b>
                {first} {last}
              </b>
            </span>
            {recordName ? (
              <>
                <span className="k">Home Office record</span>
                <span>
                  <b>{recordName}</b>
                </span>
              </>
            ) : null}
          </div>
          <Input
            label="First and middle names"
            autoComplete="off"
            value={newFirst}
            error={errors.first}
            hint="As printed on the passport, in full — no initials."
            onChange={(event) => setNewFirst(event.target.value)}
          />
          <Input
            label="Surname"
            autoComplete="off"
            value={newLast}
            error={errors.last}
            hint="As printed on the passport, in full — no initials."
            onChange={(event) => setNewLast(event.target.value)}
          />
          <Textarea
            label="Reason · for the activity log"
            value={reason}
            maxLength={NAME_CORRECTION_REASON_MAX}
            error={errors.reason}
            hint={`Required, ${NAME_CORRECTION_REASON_MIN}–${NAME_CORRECTION_REASON_MAX} characters — say how you checked it, e.g. “Passport checked in the office”. Don’t type the name here: the log already records it.`}
            onChange={(event) => setReason(event.target.value)}
          />
          <Note>
            Capitalise it the way the rest of the system does: first letter of each name in
            capitals. Payroll is emailed the change. The right-to-work check is not started again by
            this — run it from the Documents tab if the old name was why it did not match.
          </Note>
        </div>
      </Modal>
    </>
  );
}
