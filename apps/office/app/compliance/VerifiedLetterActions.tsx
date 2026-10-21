'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal, Note, Textarea, toast } from '@thc/ui';
import { correctTermDates, withdrawCompletionApproval } from './letterActions';
import { ukDate, ukDay } from './queue';
import { periodsEdited, periodsFromLetter, termLetterVerifyProblem } from './termDates';
import type { TermPeriod } from './termDates';
import { TermDatesEditor } from './TermDatesEditor';
import type { ActionResult } from './types';

/**
 * What the office can still change on a letter it has already decided
 * (ADR-0178), beside that letter wherever the office lists it:
 *
 *   · "Correct term dates" on the worker's CURRENT verified University Term
 *     Dates Letter — the Verify dialog's editor, pre-filled with the dates
 *     on file, and a note saying why;
 *   · "Withdraw approval" on a verified Official University Completion
 *     Letter — with a reason — when the course turns out not to be over.
 *
 * Owners and managers (`canCorrect`); the database refuses anyone else
 * whatever this shows. Anyone else sees nothing to press.
 */
export interface DecidedLetter {
  id: string;
  doc_type: string;
  review_status: string;
  uploaded_at: string;
  term_dates?: string[] | null;
  completion_date?: string | null;
}

/** The worker's current verified term letter: the latest verified one (current_verified_docs). */
export function currentTermLetterId(documents: readonly DecidedLetter[]): string | null {
  const verified = documents
    .filter((d) => d.doc_type === 'university_term_dates_letter' && d.review_status === 'verified')
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at) || a.id.localeCompare(b.id));
  return verified[0]?.id ?? null;
}

/** Which correction this letter offers, if any. */
export function letterCorrection(
  doc: DecidedLetter,
  currentTermLetter: string | null,
): 'term_dates' | 'withdraw' | null {
  if (doc.review_status !== 'verified') return null;
  if (doc.doc_type === 'university_term_dates_letter' && doc.id === currentTermLetter) {
    return 'term_dates';
  }
  if (doc.doc_type === 'university_completion_letter') return 'withdraw';
  return null;
}

export function VerifiedLetterActions({
  doc,
  currentTermLetter,
  canCorrect,
}: {
  doc: DecidedLetter;
  currentTermLetter: string | null;
  canCorrect: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const kind = letterCorrection(doc, currentTermLetter);
  if (!canCorrect || !kind) return null;

  const run = (work: () => Promise<ActionResult>) => {
    setProblem(null);
    start(async () => {
      const result = await work();
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setOpen(false);
      toast(result.message ?? 'Saved.', { tone: 'green' });
      router.refresh();
    });
  };
  const close = () => {
    setProblem(null);
    setOpen(false);
  };

  return (
    <>
      <Button size="sm" tone="ghost" disabled={busy} onClick={() => setOpen(true)}>
        {kind === 'term_dates' ? 'Correct term dates' : 'Withdraw approval'}
      </Button>
      {open && kind === 'term_dates' ? (
        <CorrectTermDatesModal
          doc={doc}
          busy={busy}
          problem={problem}
          onClose={close}
          onSave={(periods, note, noHolidays) =>
            run(() => correctTermDates(doc.id, periods, note, noHolidays))
          }
        />
      ) : null}
      {open && kind === 'withdraw' ? (
        <WithdrawApprovalModal
          doc={doc}
          busy={busy}
          problem={problem}
          onClose={close}
          onWithdraw={(reason) => run(() => withdrawCompletionApproval(doc.id, reason))}
        />
      ) : null}
    </>
  );
}

function CorrectTermDatesModal({
  doc,
  busy,
  problem,
  onClose,
  onSave,
}: {
  doc: DecidedLetter;
  busy: boolean;
  problem: string | null;
  onClose: () => void;
  onSave: (periods: { from: string; to: string }[], note: string, noHolidays: boolean) => void;
}) {
  const today = useMemo(() => ukDay(new Date()), []);
  const [periods, setPeriods] = useState<TermPeriod[]>(() => periodsFromLetter(doc.term_dates));
  const [noHolidays, setNoHolidays] = useState(false);
  const [note, setNote] = useState('');
  const edited = periodsEdited(periods, doc.term_dates);
  const blocked =
    termLetterVerifyProblem({
      periods,
      noHolidaysConfirmed: noHolidays,
      uploadedAt: doc.uploaded_at,
      today,
    }) ?? (edited ? null : 'Change a date first — these are the dates on file.');
  const noteMissing = note.trim() === '';

  return (
    <Modal
      open
      wide
      dirty={edited || note.trim() !== ''}
      title="Correct term dates"
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="green"
            solid
            disabled={busy || blocked !== null || noteMissing}
            title={blocked ?? (noteMissing ? 'Say why the dates are being corrected.' : undefined)}
            onClick={() =>
              onSave(
                periods.map(({ from, to }) => ({ from, to })),
                note,
                periods.length === 0 && noHolidays,
              )
            }
          >
            Save corrected dates
          </Button>
        </>
      }
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
      <div className="muted sm">
        The holiday periods on this verified letter, as they are on file. Correct them against the
        letter: the weekly limit is calculated from these dates — 48 hours in a holiday week, 20 in
        term time (10 below degree level), the lower in a week that runs across both — and the
        letter expires on the last of them. The change applies from now; shifts already worked are
        not recalculated.
      </div>
      <TermDatesEditor
        periods={periods}
        onChange={setPeriods}
        editable
        badge={{ tone: 'hi', label: 'as verified' }}
        noHolidaysConfirmed={noHolidays}
        onNoHolidaysConfirmed={setNoHolidays}
        uploadedAt={doc.uploaded_at}
        today={today}
      />
      <Textarea
        label={
          <>
            Why are the dates being corrected? <span className="coral">*</span>
          </>
        }
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
        hint="Kept with the change in the audit log, with your name and the time. The worker is not sent it."
      />
    </Modal>
  );
}

function WithdrawApprovalModal({
  doc,
  busy,
  problem,
  onClose,
  onWithdraw,
}: {
  doc: DecidedLetter;
  busy: boolean;
  problem: string | null;
  onClose: () => void;
  onWithdraw: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      dirty={reason.trim() !== ''}
      title="Withdraw completion letter approval"
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="danger"
            solid
            disabled={busy || reason.trim() === ''}
            onClick={() => onWithdraw(reason)}
          >
            Withdraw approval
          </Button>
        </>
      }
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
      <Note tone="amber">
        Use this when the course has not in fact finished
        {doc.completion_date ? ` (the letter gave ${ukDate(doc.completion_date)})` : ''}. The worker
        stops being treated as a graduate: their term letter decides the weekly limit again — 20
        hours a week in term time (10 below degree level), 48 in holidays — and its reminders start
        again. Their right-to-work date does not change.
      </Note>
      <div className="muted sm">
        The letter is kept as history, with your reason. The worker is not sent a rejection; if
        their weekly limit changes this week, they are told their new limit as usual.
      </div>
      <Textarea
        label={
          <>
            Reason <span className="coral">*</span>
          </>
        }
        value={reason}
        maxLength={500}
        placeholder="e.g. Course resumes 18/01/2027 — not completed"
        onChange={(event) => setReason(event.target.value)}
        hint="Kept on the letter and in the audit log, with your name and the time."
      />
    </Modal>
  );
}
