'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Avatar, Button, Input, Modal, Note, Textarea } from '@thc/ui';
import {
  approveCompletionLetter,
  confirmRtwDate,
  rejectDeclaration,
  rejectDocument,
  resolveNiCheck,
  verifyDeclaration,
  verifyDocument,
} from './actions';
import type { VerifyConditions, VerifyDates } from './actions';
import {
  VISA_LIMIT_HINT,
  belowDegreeHint,
  conditionFieldFor,
  formatNi,
  initialBelowDegree,
  initialVisaLimit,
  niEvidenceLine,
  visaLimitProblem,
} from './conditions';
import { EVIDENCE_FORM_LABEL, ukDate, ukStamp, verifyStep } from './queue';
import { rtwDateProblem, rtwDateRule, rtwDateValue } from './rtw';
import type { RtwDateRule } from './rtw';
import type { ActionResult, QueueRow } from './types';

/**
 * Verify and Reject on a queue row (§4.1, §10.7) — the ONE path, shared by
 * /compliance's Needs review tab and the /staff/:id Documents tab, so the
 * two screens cannot drift: which server action a row's Verify calls, which
 * rows ask the reviewer for a date first, and what the Reject dialog tells
 * them all live here.
 *
 * Every action is /compliance's own (./actions.ts), through the manager's
 * session: the RPCs refuse a caller who is not an admin (assert_reviewer),
 * and the §4.3 re-check, N8 and N15 happen in the database whichever screen
 * pressed the button.
 *
 * The screen owns what "running" looks like (a spinner per row, a banner),
 * so it hands in `run`; this owns which action runs and the dialogs.
 */
export type RunReview = (
  id: string,
  action: () => Promise<ActionResult>,
  after?: () => void,
) => void;

export function useReviewDialogs({
  run,
  busy,
}: {
  run: RunReview;
  /** Whether an action on this item is in flight. */
  busy: (id: string) => boolean;
}): { verify: (row: QueueRow) => void; reject: (row: QueueRow) => void; dialogs: ReactNode } {
  const [rejecting, setRejecting] = useState<QueueRow | null>(null);
  const [approving, setApproving] = useState<QueueRow | null>(null);
  const [confirming, setConfirming] = useState<QueueRow | null>(null);
  const [checking, setChecking] = useState<QueueRow | null>(null);

  const verify = (row: QueueRow) => {
    const step = verifyStep(row);
    if (step === 'ni_match') {
      run(row.item_id, () => resolveNiCheck(row.item_id, true));
      return;
    }
    if (step === 'confirm') {
      setChecking(row);
      return;
    }
    if (step === 'approve') {
      setApproving(row);
      return;
    }
    if (step === 'confirm_date') {
      setConfirming(row);
      return;
    }
    run(row.item_id, () =>
      row.kind === 'declaration' ? verifyDeclaration(row.item_id) : verifyDocument(row.item_id),
    );
  };

  const dialogs = (
    <>
      {rejecting ? (
        <RejectModal
          row={rejecting}
          busy={busy(rejecting.item_id)}
          onClose={() => setRejecting(null)}
          onReject={(reason) =>
            run(
              rejecting.item_id,
              () =>
                rejecting.kind === 'declaration'
                  ? rejectDeclaration(rejecting.item_id, reason)
                  : rejecting.kind === 'ni_check'
                    ? resolveNiCheck(rejecting.item_id, false, reason)
                    : rejectDocument(rejecting.item_id, reason),
              () => setRejecting(null),
            )
          }
        />
      ) : null}

      {confirming ? (
        <RightToWorkModal
          row={confirming}
          rule={rtwDateRule(confirming.item_type, confirming.rtw_branch)!}
          busy={busy(confirming.item_id)}
          onClose={() => setConfirming(null)}
          onVerify={(field, value, conditions) =>
            run(
              confirming.item_id,
              () =>
                confirming.kind === 'rtw_date'
                  ? confirmRtwDate(confirming.item_id, value)
                  : verifyWith(
                      confirming,
                      field === 'expiry' ? { expiry: value } : { rightToWorkUntil: value },
                      conditions,
                    ),
              () => setConfirming(null),
            )
          }
        />
      ) : null}

      {checking ? (
        <ConfirmVerifyModal
          row={checking}
          busy={busy(checking.item_id)}
          onClose={() => setChecking(null)}
          onVerify={(conditions) =>
            run(
              checking.item_id,
              () => verifyWith(checking, {}, conditions),
              () => setChecking(null),
            )
          }
        />
      ) : null}

      {approving ? (
        <ApproveModal
          row={approving}
          busy={busy(approving.item_id)}
          onClose={() => setApproving(null)}
          onApprove={(completionDate, visaExpiry) =>
            run(
              approving.item_id,
              () => approveCompletionLetter(approving.item_id, completionDate, visaExpiry),
              () => setApproving(null),
            )
          }
        />
      ) : null}
    </>
  );

  return { verify, reject: setRejecting, dialogs };
}

/** What the reviewer confirmed beside the document (conditions.ts). */
type ConfirmedConditions = Omit<VerifyConditions, 'staffId'>;

/**
 * Verify, and then the conditions confirmed beside it — or the plain Verify
 * when the route has none to confirm.
 */
function verifyWith(
  row: QueueRow,
  dates: VerifyDates,
  conditions: ConfirmedConditions,
): Promise<ActionResult> {
  if (conditions.belowDegreeLevel === undefined && conditions.visaHourLimit === undefined) {
    return verifyDocument(row.item_id, dates);
  }
  return verifyDocument(row.item_id, dates, { staffId: row.staff_id, ...conditions });
}

/**
 * The course level (a student, D32) or the visa's own weekly hours limit (a
 * work or dependant visa, D36), beside the Verify of the document that says
 * so. Opens on what is on file, else on what the automated gov.uk check
 * read. Renders nothing for any other document.
 */
function useConditions(row: QueueRow) {
  const field = conditionFieldFor(row.item_type, row.rtw_branch);
  const [below, setBelow] = useState(
    initialBelowDegree(row.below_degree_level, row.rtw_check_term_limit),
  );
  const [limit, setLimit] = useState(
    initialVisaLimit(
      row.visa_weekly_hour_limit,
      row.rtw_check_term_limit,
      row.rtw_check_conditions,
    ),
  );
  const problem = field === 'visa_limit' ? visaLimitProblem(limit) : null;
  const confirmed: ConfirmedConditions =
    field === 'below_degree'
      ? { belowDegreeLevel: below }
      : field === 'visa_limit'
        ? { visaHourLimit: limit }
        : {};
  const fields =
    field === 'below_degree' ? (
      <label className="row sm">
        <input
          type="checkbox"
          checked={below}
          onChange={(event) => setBelow(event.target.checked)}
        />
        <span>
          <b>Course is below degree level</b> — 10 hours a week in term time instead of 20.{' '}
          <span className="muted">{belowDegreeHint(row.rtw_check_term_limit)}</span>
        </span>
      </label>
    ) : field === 'visa_limit' ? (
      <Input
        type="text"
        inputMode="numeric"
        label="Weekly hours limit on the visa (if any)"
        value={limit}
        onChange={(event) => setLimit(event.target.value)}
        hint={VISA_LIMIT_HINT}
        error={problem ?? undefined}
      />
    ) : null;
  return { fields, confirmed, problem };
}

/**
 * A document with no date to confirm but something to check beside it: NI
 * evidence against the NI number, shown in full (D43), or a student's term
 * letter with the course level (D32).
 */
function ConfirmVerifyModal({
  row,
  busy,
  onClose,
  onVerify,
}: {
  row: QueueRow;
  busy: boolean;
  onClose: () => void;
  onVerify: (conditions: ConfirmedConditions) => void;
}) {
  const conditions = useConditions(row);
  const ni = row.item_type === 'ni_evidence';
  return (
    <Modal
      open
      title={`Verify ${row.item_label}`}
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="green"
            solid
            disabled={busy || conditions.problem !== null}
            onClick={() => onVerify(conditions.confirmed)}
          >
            Verify
          </Button>
        </>
      }
    >
      <div className="row">
        <Avatar name={row.display_name} size="sm" />
        <div className="sm">
          {row.display_name} · {row.is_candidate ? 'Candidate' : 'Staff'} · {row.item_label} ·
          uploaded {ukStamp(row.submitted_at)}
        </div>
      </div>
      {ni ? (
        <Note tone={row.ni_number ? 'neutral' : 'amber'}>
          {row.ni_number ? (
            <>
              NI number on the profile: <b className="mono">{formatNi(row.ni_number)}</b> — check it
              matches the number on the document before you verify.
            </>
          ) : (
            niEvidenceLine(null)
          )}
        </Note>
      ) : null}
      {conditions.fields}
    </Modal>
  );
}

/**
 * "Reject asks for a reason → push N8 with a Re-upload button" (§4.1). The
 * in-employment declaration is the exception: the worker is NOT told through
 * the app (§10.7), and the reason becomes the manual block's.
 */
function RejectModal({
  row,
  busy,
  onClose,
  onReject,
}: {
  row: QueueRow;
  busy: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const inEmployment = row.kind === 'declaration' && row.declaration_source === 'in_employment';
  const niCheck = row.kind === 'ni_check';
  return (
    <Modal
      open
      title={
        row.kind === 'declaration'
          ? 'Reject declaration'
          : niCheck
            ? 'NI number does not match'
            : 'Reject document'
      }
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
            onClick={() => onReject(reason)}
          >
            {row.kind === 'declaration' ? 'Reject declaration' : 'Reject document'}
          </Button>
        </>
      }
    >
      <div className="row">
        <Avatar name={row.display_name} size="sm" />
        <div className="sm">
          {row.display_name} · {row.is_candidate ? 'Candidate' : 'Staff'} · {row.item_label} ·
          uploaded {ukStamp(row.submitted_at)}
        </div>
      </div>
      {niCheck && row.ni_number ? <div className="sm">{niEvidenceLine(row.ni_number)}</div> : null}
      <Textarea
        label={
          <>
            Reason <span className="coral">*</span>
          </>
        }
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        hint={
          inEmployment ? (
            <>
              Kept on the profile: the block converts to a manual block with this reason, and only a
              manager can lift it. The worker is not told through the app — the office calls them
              (§10.7).
            </>
          ) : (
            <>
              Goes to the worker word for word in push N8 — “Document rejected — [reason]” — with a{' '}
              <b>Re-upload</b> button. The new upload comes back to this queue (§4.1, §2.3).
            </>
          )
        }
      />
      <Note>
        {inEmployment
          ? 'The block stands. Bookings released when they declared are not restored.'
          : 'Nothing else on the profile changes — including the weekly hours cap.'}
      </Note>
    </Modal>
  );
}

/**
 * Completion letter requirement §2.2: "On approval, the reviewer
 * confirms/enters: the course completion date, and the visa expiry date
 * (should already be on file from the right-to-work check)."
 */
function ApproveModal({
  row,
  busy,
  onClose,
  onApprove,
}: {
  row: QueueRow;
  busy: boolean;
  onClose: () => void;
  onApprove: (completionDate: string, visaExpiry: string) => void;
}) {
  const [completionDate, setCompletionDate] = useState(row.completion_date_claimed ?? '');
  const [visaExpiry, setVisaExpiry] = useState(row.staff_right_to_work_until ?? '');
  const onFile = row.staff_right_to_work_until;
  return (
    <Modal
      open
      title="Approve completion letter"
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="green"
            solid
            disabled={busy || !completionDate || !visaExpiry}
            onClick={() => onApprove(completionDate, visaExpiry)}
          >
            Approve
          </Button>
        </>
      }
    >
      <div className="row">
        <Avatar name={row.display_name} size="sm" />
        <div className="sm">
          {row.display_name} ·{' '}
          {row.evidence_form ? EVIDENCE_FORM_LABEL[row.evidence_form] : 'Completion letter'} ·
          uploaded {ukStamp(row.submitted_at)}
        </div>
      </div>
      <Input
        type="date"
        label={
          <>
            Course completion date on the document <span className="coral">*</span>
          </>
        }
        value={completionDate}
        onChange={(event) => setCompletionDate(event.target.value)}
        hint={
          row.completion_date_claimed
            ? `The worker entered ${ukDate(row.completion_date_claimed)}. Correct it if the document says otherwise.`
            : 'The worker did not enter one — read it off the document.'
        }
      />
      <Input
        type="date"
        label={
          <>
            Visa expiry <span className="coral">*</span>
          </>
        }
        value={visaExpiry}
        onChange={(event) => setVisaExpiry(event.target.value)}
        hint={
          onFile
            ? `On file from the right-to-work check: ${ukDate(onFile)}. If you enter a different date, the earlier of the two is kept.`
            : 'No right-to-work expiry is on file yet.'
        }
      />
      <Note>
        The weekly limit becomes 48 hours from the first whole week on or after the completion date
        — never before it, never backdated, and never past the visa expiry. A completion date in the
        future lifts nothing until it arrives.
      </Note>
    </Modal>
  );
}

/**
 * §2.5 / §2.6: a visa document, a status document or a share code report is
 * verified on the right-to-work date it carries. The AI's (or the worker's
 * typed) date is pre-filled; the reviewer confirms it against the document.
 * The worker's right-to-work date becomes the earliest across their current
 * evidence, and no shift after it can be rostered.
 */
function RightToWorkModal({
  row,
  rule,
  busy,
  onClose,
  onVerify,
}: {
  row: QueueRow;
  rule: RtwDateRule;
  busy: boolean;
  onClose: () => void;
  onVerify: (field: RtwDateRule['field'], value: string, conditions: ConfirmedConditions) => void;
}) {
  const conditions = useConditions(row);
  const [date, setDate] = useState(
    (rule.field === 'expiry' ? row.expiry_date : row.doc_right_to_work_until) ?? '',
  );
  const [noTimeLimit, setNoTimeLimit] = useState(false);
  const problem = rtwDateProblem(rule, date, noTimeLimit);
  const reverify = row.kind === 'rtw_date';
  return (
    <Modal
      open
      title={reverify ? 'Confirm right-to-work date' : `Verify ${row.item_label}`}
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="green"
            solid
            disabled={busy || problem !== null || (!reverify && conditions.problem !== null)}
            onClick={() =>
              onVerify(
                rule.field,
                rtwDateValue(date, noTimeLimit),
                reverify ? {} : conditions.confirmed,
              )
            }
          >
            {reverify ? 'Confirm date' : 'Verify'}
          </Button>
        </>
      }
    >
      <div className="row">
        <Avatar name={row.display_name} size="sm" />
        <div className="sm">
          {row.display_name} · {row.is_candidate ? 'Candidate' : 'Staff'} · {row.item_label} ·{' '}
          {reverify ? 'verified without a date' : 'uploaded'} {ukStamp(row.submitted_at)}
          {row.share_code ? (
            <>
              {' '}
              · share code <span className="mono">{row.share_code}</span>
            </>
          ) : null}
        </div>
      </div>
      <Input
        type="date"
        label={
          <>
            {rule.label} <span className="coral">*</span>
          </>
        }
        value={noTimeLimit ? '' : date}
        disabled={noTimeLimit}
        onChange={(event) => setDate(event.target.value)}
        hint={rule.hint}
      />
      {rule.allowNoTimeLimit ? (
        <label className="row sm">
          <input
            type="checkbox"
            checked={noTimeLimit}
            onChange={(event) => setNoTimeLimit(event.target.checked)}
          />
          The gov.uk report shows <b>settled status</b> — no time limit (§2.5 pt 2). Pre-settled
          status has an end date: enter it instead.
        </label>
      ) : null}
      {reverify ? null : conditions.fields}
      {row.rtw_check_reason ? (
        <Note tone="coral">
          <b>Why the automatic gov.uk check did not verify it:</b> {row.rtw_check_reason} The date
          gov.uk returned, if any, is pre-filled — confirm it against the report.
        </Note>
      ) : null}
      {reverify ? (
        <Note>
          This report was verified before the date was required (23.09), so the worker has no
          right-to-work date on file: nothing stops a shift past their visa and the reminder ladder
          has nothing to count down from. Re-run the share code on gov.uk and confirm the date it
          shows. The report stays verified — nothing else on the profile changes. If the check no
          longer passes, block the worker from their profile (§9.6).
        </Note>
      ) : null}
      {row.staff_right_to_work_until ? (
        <Note>
          On file now: right to work until {ukDate(row.staff_right_to_work_until)}. The earliest
          date across the worker’s current evidence is kept.
        </Note>
      ) : null}
      {problem && (date !== '' || noTimeLimit) ? <div className="coral sm">{problem}</div> : null}
    </Modal>
  );
}
