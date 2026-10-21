'use client';

import { useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal, Note, Textarea } from '@thc/ui';
import {
  CRIMINAL_RECORDS_READ_ONLY,
  DECLARATION_MESSAGE_MAX,
  REVERSAL_NOTE_MAX,
  canUpdateDeclaration,
  declarationReviewActions,
} from '@thc/domain';
import type { DeclarationReviewStatus, StaffStatus } from '@thc/domain';
import { requestDeclarationDetails, reverseDeclarationRejection } from './declarationActions';
import { useCriminalRecordsReviewer } from './useCriminalRecordsReviewer';
import type { ActionResult } from './types';

/**
 * Ask for more details and Reverse rejection on a criminal declaration
 * (ADR-0180) — the two follow-ups beside Verify and Reject, the same on
 * every screen that reviews a declaration: Compliance → Needs review, the
 * Documents tab of /staff/:id and the candidate screen /onboarding/:id.
 * Which of them a declaration carries is `declarationReviewActions()`
 * (packages/domain), and the database refuses whatever that does not
 * offer.
 *
 * Only the office users an owner named on /users decide a declaration
 * (owners, while nobody is named — can_review_criminal_records()). For
 * anyone else these buttons are not drawn, and `DeclarationDecisions`
 * puts the read-only line where Verify / Reject would be.
 *
 * Self-contained: each button opens its own dialog and runs its own
 * action, so a screen adds one line beside its Verify / Reject. A screen
 * with a result banner of its own passes `onResult`; otherwise the result
 * is shown under the buttons.
 */
export interface DeclarationTarget {
  id: string;
  answer: boolean;
  status: DeclarationReviewStatus | 'superseded';
  superseded: boolean;
  source: 'onboarding' | 'in_employment';
  /** The person's status now (a Rejected or Removed person has nothing to review). */
  staffStatus: string;
  /**
   * Their block now, when the screen has it: someone who cannot answer from
   * the app (a manual hold) is not offered Ask for more details — the
   * database refuses it too (cannot_answer_from_app).
   */
  blockKind?: 'auto_document' | 'manual' | 'conviction_review' | null;
  displayName: string;
  /** The rejection being reversed, shown in the dialog. Office-only. */
  rejectionReason?: string | null;
}

const CANDIDATE_STATUSES: ReadonlySet<string> = new Set([
  'interview_requested',
  'interview_completed',
  'documents',
  'quiz',
  'additional_info',
  'contract',
]);

export function DeclarationFollowUp({
  target,
  disabled = false,
  readOnly = false,
  onResult,
}: {
  target: DeclarationTarget;
  disabled?: boolean;
  /** A viewer, or a screen showing a past phase: no buttons at all. */
  readOnly?: boolean;
  onResult?: (result: ActionResult) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<'ask' | 'reverse' | null>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();

  const reviewer = useCriminalRecordsReviewer();
  const base = declarationReviewActions(target, target.staffStatus as StaffStatus);
  const actions = {
    ...base,
    askForDetails:
      base.askForDetails &&
      (target.blockKind === undefined ||
        canUpdateDeclaration({
          status: target.staffStatus as StaffStatus,
          blockKind: target.blockKind,
          latest: {
            answer: true,
            source: target.source,
            status: 'details_requested',
            superseded: false,
          },
        })),
  };
  if (reviewer !== true || readOnly || (!actions.askForDetails && !actions.reverse)) return null;

  const close = () => {
    setOpen(null);
    setText('');
  };

  const submit = () => {
    const which = open;
    if (!which) return;
    setResult(null);
    start(async () => {
      const outcome =
        which === 'ask'
          ? await requestDeclarationDetails(target.id, text)
          : await reverseDeclarationRejection(target.id, text);
      if (onResult) onResult(outcome);
      else setResult(outcome);
      if (outcome.ok) {
        close();
        router.refresh();
      }
    });
  };

  // The copy follows where the person is NOW, not where the declaration
  // came from: staff may carry a declaration made at onboarding.
  const candidate = CANDIDATE_STATUSES.has(target.staffStatus);
  const paused = target.staffStatus === 'blocked';
  const max = open === 'ask' ? DECLARATION_MESSAGE_MAX : REVERSAL_NOTE_MAX;

  return (
    <>
      {actions.askForDetails ? (
        <Button
          size="sm"
          tone="amber"
          disabled={disabled || busy}
          onClick={() => {
            setResult(null);
            setOpen('ask');
          }}
        >
          Ask for more details
        </Button>
      ) : null}
      {actions.reverse ? (
        <Button
          size="sm"
          tone="outline"
          disabled={disabled || busy}
          onClick={() => {
            setResult(null);
            setOpen('reverse');
          }}
        >
          Reverse rejection
        </Button>
      ) : null}
      {result && !onResult ? (
        <Alert tone={result.ok ? 'green' : 'coral'}>{result.message ?? 'Done.'}</Alert>
      ) : null}

      <Modal
        open={open !== null}
        title={open === 'ask' ? 'Ask for more details' : 'Reverse rejection'}
        onClose={close}
        dirty={text.trim() !== ''}
        footer={
          <>
            <Button tone="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              tone={open === 'ask' ? 'amber' : 'primary'}
              disabled={busy || text.trim() === '' || text.trim().length > max}
              onClick={submit}
            >
              {busy ? 'Saving…' : open === 'ask' ? 'Send request' : 'Reverse rejection'}
            </Button>
          </>
        }
      >
        <div className="sm">
          {target.displayName} · Criminal Record declaration ·{' '}
          {target.source === 'in_employment' ? 'declared from the app' : 'declared at onboarding'}
        </div>
        {open === 'ask' ? (
          <>
            <Textarea
              label={
                <>
                  Message to the worker <span className="coral">*</span>
                </>
              }
              value={text}
              maxLength={DECLARATION_MESSAGE_MAX}
              onChange={(event) => setText(event.target.value)}
              placeholder="Please tell us the date of the conviction and the sentence."
              style={{ minHeight: 96 }}
              hint="Sent to them word for word as a notification, and shown where they update their declaration. It can appear on their lock screen, so don’t repeat what they declared."
            />
            <Note>
              {candidate
                ? 'Onboarding stays paused until their updated declaration is verified. It comes back to Needs review; this one is kept on record, read-only.'
                : paused
                  ? 'Their shifts stay paused while they answer. Their updated declaration comes back to Needs review; this one is kept on record, read-only.'
                  : 'When they answer, their upcoming shifts are paused until the office verifies it, as for any declaration from the app. It comes back to Needs review; this one is kept on record, read-only.'}
            </Note>
          </>
        ) : (
          <>
            {target.rejectionReason ? (
              <div className="sm muted">Rejected: “{target.rejectionReason}”</div>
            ) : null}
            <Textarea
              label={
                <>
                  Note <span className="coral">*</span>
                </>
              }
              value={text}
              maxLength={REVERSAL_NOTE_MAX}
              onChange={(event) => setText(event.target.value)}
              placeholder="Reviewed by Sam and Richard, cleared to work."
              style={{ minHeight: 80 }}
              hint="Kept on the record with your name and the time, beside the rejection. The worker is not shown it."
            />
            <Note>
              {candidate
                ? 'The declaration becomes verified. If nothing else is outstanding they move on to the quiz by themselves.'
                : paused
                  ? 'The declaration becomes verified. If they are on the hold this rejection put on them, it is lifted and the full compliance check runs: if everything else is in order they are unblocked and told their shifts are open again. A block a manager added for anything else stays.'
                  : 'The declaration becomes verified. Nothing else on their profile changes.'}
            </Note>
          </>
        )}
      </Modal>
    </>
  );
}

/**
 * The decision buttons on a criminal declaration — Verify, Reject and the
 * follow-ups — drawn only for an office user who may decide it (ADR-0180).
 * Anyone else reads the declaration with the line saying why there is
 * nothing to press. Nothing is drawn until the answer arrives.
 */
export function DeclarationDecisions({ children }: { children: ReactNode }) {
  const reviewer = useCriminalRecordsReviewer();
  if (reviewer === null) return null;
  if (!reviewer) return <span className="sub muted xs">{CRIMINAL_RECORDS_READ_ONLY}</span>;
  return <>{children}</>;
}
