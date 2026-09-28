'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Modal, Note, Textarea } from '@thc/ui';
import {
  DOB_CORRECTION_MESSAGES,
  DOB_CORRECTION_REASON_MAX,
  DOB_CORRECTION_REASON_MIN,
  dobValueFrom,
  formatDobTyping,
  ukToday,
  validateDobCorrection,
} from '@thc/domain';
import { correctDob } from '../_lib/dobCorrectionActions';

/**
 * "Correct" on a date of birth — the /staff/:id Overview card "Contacts &
 * identity" and the /onboarding/:id header (ADR-0070). Owners and managers
 * only: the caller passes `allowed` from `officeCan(role, 'identity')`, and
 * `office_correct_dob()` refuses everyone else whatever the screen shows.
 *
 * The date is typed the way /apply types it (ADR-0068's `formatDobTyping`,
 * lifted into packages/domain): digits, the slashes drawn for you, UK
 * order. It is a civil date judged against today in the UK — "18 or over"
 * is asked in Europe/London (§1.8), so the label says so. A reason is
 * required (10–300 characters): it is the activity log's only account of
 * why a date gov.uk matches against was changed.
 *
 * What happened next is said under the date: the pending share code's
 * gov.uk check re-run (or why not), and a warning when the new date puts a
 * signed 48-hour opt-out before the worker's eighteenth birthday.
 */
export function DobCorrection({
  staffId,
  name,
  dob,
  allowed,
  display,
}: {
  staffId: string;
  /** For the dialog's title. */
  name: string;
  /** `yyyy-mm-dd` on file. */
  dob: string | null;
  /** `officeCan(role, 'identity')`, false on a removed profile. */
  allowed: boolean;
  /** How the date on file is written on this screen ("05.06.1998"). */
  display: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ dob?: string; reason?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<{ note: string; warning: string | null } | null>(null);
  const [pending, start] = useTransition();

  if (!allowed) return null;

  const openDialog = () => {
    setShown('');
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
    const value = dobValueFrom(shown);
    const checked = validateDobCorrection({ dob: value, reason }, dob, ukToday());
    if (!checked.ok) {
      setErrors({ [checked.field]: DOB_CORRECTION_MESSAGES[checked.reason] });
      return;
    }
    setErrors({});
    setFailure(null);
    start(async () => {
      const result = await correctDob(staffId, checked.dob, checked.reason, dob);
      if (!result.ok) {
        setFailure(result.message);
        return;
      }
      setDone({ note: result.note, warning: result.warning });
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button size="sm" tone="ghost" disabled={pending} onClick={openDialog}>
        Correct
      </Button>
      {done ? (
        <span className="stack mt-8">
          <span className="green sm">{done.note}</span>
          {done.warning ? <Alert tone="amber">{done.warning}</Alert> : null}
        </span>
      ) : null}

      <Modal
        open={open}
        title={`Correct date of birth — ${name}`}
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
              <b>{display}</b>
            </span>
          </div>
          <Input
            label="New date of birth (UK date)"
            inputMode="numeric"
            autoComplete="off"
            placeholder="DD/MM/YYYY"
            maxLength={10}
            value={shown}
            error={errors.dob}
            hint="Day, month, year — as on their passport or birth certificate. 18 or over, judged on today’s date in the UK."
            onChange={(event) => {
              const raw = event.target.value;
              const caret = event.target.selectionStart ?? raw.length;
              setShown(caret < raw.length ? raw.replace(/[^\d/]/g, '') : formatDobTyping(raw));
            }}
            onBlur={() => setShown(formatDobTyping(shown))}
          />
          <Textarea
            label="Reason · for the activity log"
            value={reason}
            maxLength={DOB_CORRECTION_REASON_MAX}
            error={errors.reason}
            hint={`Required, ${DOB_CORRECTION_REASON_MIN}–${DOB_CORRECTION_REASON_MAX} characters — say how you checked it, e.g. “Passport checked in the office”. Don’t type the date here: the log already records it.`}
            onChange={(event) => setReason(event.target.value)}
          />
          <Note>
            gov.uk matches the share code against this date. If a share code is waiting for review,
            it is checked again with the new date. The change and your reason are written to the
            activity log with your name; the worker sees the new date in the app.
          </Note>
        </div>
      </Modal>
    </>
  );
}
