'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal, Note, Textarea, toast } from '@thc/ui';
import { resolveTermState } from '@thc/domain';
import { EditTermPeriods, periodsFrom } from '../_components/TermPeriods';
import { withdrawCompletionApproval } from './letterActions';
import { ukDate, ukDay } from './queue';
import type { ActionResult } from './types';

/**
 * "Withdraw approval" on a verified Official University Completion Letter
 * (ADR-0183), beside the letter wherever the office lists it — the staff
 * profile's Documents tab and the candidate screen — for when the course
 * turns out not to be over. The worker stops being treated as a graduate,
 * and their term letter decides the weekly limit again.
 *
 * Correcting the term letter's periods is ADR-0178's "Edit holiday periods"
 * (`EditTermPeriods`); this dialog opens it ("Correct term dates first")
 * when withdrawing would put the worker on the term-time limit today, so
 * the worker is told their new limit once, not twice.
 *
 * Any office login that may write (`canWithdraw`); the database refuses
 * anyone else whatever this shows (assert_reviewer, office_read_only).
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
export function currentTermLetterOf<T extends DecidedLetter>(documents: readonly T[]): T | null {
  const verified = documents
    .filter((d) => d.doc_type === 'university_term_dates_letter' && d.review_status === 'verified')
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at) || a.id.localeCompare(b.id));
  return verified[0] ?? null;
}

/**
 * Whether withdrawing an approval NOW would put the worker on the term-time
 * limit from their current term letter — no holiday periods on it, or this
 * week is not wholly a holiday on it. Then the office corrects the dates
 * first: withdrawing and then correcting changes the limit twice, and each
 * change tells the worker (N14).
 */
export function correctTermDatesFirst(termLetter: DecidedLetter | null, today: string): boolean {
  if (!termLetter) return false;
  const ranges = periodsFrom(termLetter.term_dates);
  if (ranges.length === 0) return true;
  return resolveTermState(ranges, today) !== 'holiday';
}

/** Whether this letter offers "Withdraw approval". */
export function canWithdrawLetter(doc: DecidedLetter): boolean {
  return doc.doc_type === 'university_completion_letter' && doc.review_status === 'verified';
}

export function VerifiedLetterActions({
  doc,
  currentTermLetter,
  canWithdraw,
  name,
}: {
  doc: DecidedLetter;
  /** The worker's current verified term letter (`currentTermLetterOf`). */
  currentTermLetter: DecidedLetter | null;
  canWithdraw: boolean;
  /** The worker's name, for "Edit holiday periods". */
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<'withdraw' | 'term_dates' | null>(null);
  const [today] = useState(() => ukDay(new Date()));
  const [busy, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  if (!canWithdraw || !canWithdrawLetter(doc)) return null;

  const run = (work: () => Promise<ActionResult>) => {
    setProblem(null);
    start(async () => {
      const result = await work();
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setOpen(null);
      toast(result.message ?? 'Saved.', { tone: 'green' });
      router.refresh();
    });
  };
  const close = () => {
    setProblem(null);
    setOpen(null);
  };

  return (
    <>
      <Button size="sm" tone="ghost" disabled={busy} onClick={() => setOpen('withdraw')}>
        Withdraw approval
      </Button>
      {open === 'withdraw' ? (
        <WithdrawApprovalModal
          doc={doc}
          busy={busy}
          problem={problem}
          correctFirst={correctTermDatesFirst(currentTermLetter, today)}
          noTermLetter={!currentTermLetter}
          onCorrectFirst={() => {
            setProblem(null);
            setOpen('term_dates');
          }}
          onClose={close}
          onWithdraw={(reason) => run(() => withdrawCompletionApproval(doc.id, reason))}
        />
      ) : null}
      {open === 'term_dates' && currentTermLetter ? (
        // ADR-0178's dialog, opened straight away; it saves and refreshes itself.
        <EditTermPeriods
          docId={currentTermLetter.id}
          ranges={currentTermLetter.term_dates ?? null}
          allowed
          name={name}
          uploadedAt={currentTermLetter.uploaded_at}
          startOpen
          onClosed={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

function WithdrawApprovalModal({
  doc,
  busy,
  problem,
  correctFirst,
  noTermLetter,
  onCorrectFirst,
  onClose,
  onWithdraw,
}: {
  doc: DecidedLetter;
  busy: boolean;
  problem: string | null;
  /** The term letter's dates would put them on the term-time limit today (`correctTermDatesFirst`). */
  correctFirst: boolean;
  noTermLetter: boolean;
  onCorrectFirst: () => void;
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
      {correctFirst ? (
        <Note tone="neutral">
          Their term letter shows no holiday this week, so withdrawing puts them on the term-time
          limit straight away. If its dates are wrong, correct the term dates first, so the worker
          is only told once about their new limit.{' '}
          <Button size="sm" onClick={onCorrectFirst}>
            Correct term dates first
          </Button>
        </Note>
      ) : null}
      {noTermLetter ? (
        <Note tone="neutral">
          There is no verified term letter on file. After withdrawing, ask the worker to upload
          their current University Term Dates Letter.
        </Note>
      ) : null}
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
