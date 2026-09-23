'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Checkbox, Modal, Select } from '@thc/ui';
import { optOutCancelledFrom } from '@thc/domain';
import { cancelOptOut, signOptOut } from '../actions';
import { EVIDENCE_ACCEPT, uploadEvidence } from './upload';

/**
 * The 48-hour opt-out — completion letter requirement §2.4.
 *
 * Voluntary and in writing: the worker reads it, ticks that they agree,
 * and signs in the app — or uploads a copy they signed on paper. It is
 * cancellable with notice (7 days, or up to 3 months if the agreement says
 * so), and the 48-hour ceiling returns at the END of that notice, which is
 * shown before they confirm (acceptance criterion 5).
 *
 * It is Working Time, not immigration: for a Student visa in term time it
 * lifts nothing, and the screen says so rather than letting a student think
 * they have bought more hours. Under-18s never reach this component — the
 * page does not offer the flow (§2.4).
 */

export const NOTICE_OPTIONS: { days: number; label: string }[] = [
  { days: 7, label: '7 days (standard)' },
  { days: 30, label: '1 month' },
  { days: 92, label: '3 months' },
];

function formatDay(iso: string): string {
  return iso.split('-').reverse().join('.');
}

export function OptOutForm({
  state,
  today,
  noticeDays,
  cancelledFrom,
  student,
}: {
  state: 'not_signed' | 'signed' | 'cancelling' | 'cancelled';
  today: string;
  noticeDays: number;
  cancelledFrom: string | null;
  student: boolean;
}) {
  const router = useRouter();
  const [agree, setAgree] = useState(false);
  const [notice, setNotice] = useState(7);
  const [file, setFile] = useState<File | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function sign() {
    setError(null);
    start(async () => {
      let path: string | null = null;
      if (file) {
        const up = await uploadEvidence({ kind: 'wtr-optout' }, file);
        if (!up.ok) {
          setError(up.message);
          return;
        }
        path = up.path;
      }
      const result = await signOptOut(notice, path);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.replace('/documents?sent=optout');
      router.refresh();
    });
  }

  function cancel() {
    setError(null);
    start(async () => {
      const result = await cancelOptOut();
      setAsking(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.replace('/documents?sent=optout-cancel');
      router.refresh();
    });
  }

  const studentNote = student ? (
    <div>
      <b>Student visa:</b> this does not change your 20-hour term-time limit — that is a condition
      of your visa, and no agreement can lift it.
    </div>
  ) : null;

  if (state === 'signed') {
    const returns = optOutCancelledFrom(today, noticeDays);
    return (
      <div className="docs-form">
        <div className="notice">
          <div className="strong">You have opted out of the 48-hour limit</div>
          <div>
            You can cancel at any time by giving {noticeDays} days’ notice. The 48-hour limit then
            applies again from the end of the notice period.
          </div>
          {studentNote}
        </div>
        {error ? <Alert tone="coral">{error}</Alert> : null}
        <Button block onClick={() => setAsking(true)} disabled={pending}>
          Cancel my opt-out
        </Button>
        <Modal
          open={asking}
          onClose={() => setAsking(false)}
          title="Cancel your opt-out?"
          footer={
            <>
              <Button tone="primary" onClick={() => setAsking(false)} disabled={pending}>
                Go back
              </Button>
              <Button tone="danger" onClick={cancel} disabled={pending}>
                {pending ? 'Sending…' : 'Yes, give notice'}
              </Button>
            </>
          }
        >
          <p className="muted">
            Your {noticeDays}-day notice starts today. The 48-hour limit applies again from{' '}
            <b>{formatDay(returns)}</b>. Shifts you already hold above 48 hours in a week after that
            date are flagged to the office.
          </p>
        </Modal>
      </div>
    );
  }

  return (
    <div className="docs-form">
      {state === 'cancelling' && cancelledFrom ? (
        <Alert tone="amber">
          You gave notice to cancel. The 48-hour limit returns on {formatDay(cancelledFrom)}.
          Signing again withdraws that notice.
        </Alert>
      ) : null}

      <div className="notice optout-text">
        <div className="strong">Opting out of the 48-hour average working week</div>
        <div>
          The Working Time Regulations 1998 limit your working week to an average of 48 hours. You
          can choose to work more by agreeing, in writing, to opt out of that limit.
        </div>
        <div>
          It is entirely voluntary. Nobody can make you sign it, and you won’t be treated any
          differently if you don’t.
        </div>
        <div>You can cancel it at any time by giving the notice below.</div>
        {studentNote}
      </div>

      <Select
        label="Notice to cancel"
        value={String(notice)}
        onChange={(event) => setNotice(Number(event.target.value))}
        hint="7 days unless your written agreement says otherwise (up to 3 months)."
      >
        {NOTICE_OPTIONS.map((option) => (
          <option key={option.days} value={option.days}>
            {option.label}
          </option>
        ))}
      </Select>

      <label className="file-pick field">
        <span className="label">Signed on paper? Upload the signed copy · optional</span>
        <input
          type="file"
          accept={EVIDENCE_ACCEPT}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>

      <Checkbox checked={agree} onChange={setAgree}>
        I agree, voluntarily, that the 48-hour average weekly limit does not apply to me. I can
        cancel this with {notice} days’ notice.
      </Checkbox>

      {error ? <Alert tone="coral">{error}</Alert> : null}

      <Button tone="primary" size="lg" block disabled={!agree || pending} onClick={sign}>
        {pending ? 'Signing…' : 'Sign the opt-out'}
      </Button>
    </div>
  );
}
