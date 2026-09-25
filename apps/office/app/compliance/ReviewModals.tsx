'use client';

import { useState } from 'react';
import { Avatar, Button, Input, Modal, Note, Textarea } from '@thc/ui';
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
import { EVIDENCE_FORM_LABEL, ukDate, ukStamp } from './queue';
import { rtwDateProblem, rtwDateValue } from './rtw';
import type { RtwDateRule } from './rtw';
import type { QueueRow } from './types';

/**
 * The review windows, shared by Compliance → Needs review and the staff
 * profile's Documents tab, so a Verify or a Reject says and does the same
 * thing whichever screen it is pressed on — the same RPCs, the same reason
 * rule, the same confirmations.
 */

/** What a review window reads: a queue row, or a profile document shaped like one. */
export type ReviewItem = Pick<
  QueueRow,
  | 'kind'
  | 'item_id'
  | 'staff_id'
  | 'display_name'
  | 'is_candidate'
  | 'item_type'
  | 'item_label'
  | 'submitted_at'
  | 'rtw_branch'
  | 'expiry_date'
  | 'doc_right_to_work_until'
  | 'share_code'
  | 'staff_right_to_work_until'
  | 'completion_date_claimed'
  | 'evidence_form'
  | 'declaration_source'
  | 'rtw_check_reason'
  | 'rtw_check_conditions'
  | 'rtw_check_term_limit'
  | 'ni_number'
  | 'below_degree_level'
  | 'visa_weekly_hour_limit'
>;

/** What the reviewer confirmed beside the document (conditions.ts). */
export interface ConfirmedConditions {
  belowDegreeLevel?: boolean;
  visaHourLimit?: string;
}

function Who({ item, stamp }: { item: ReviewItem; stamp?: string }) {
  return (
    <div className="row">
      <Avatar name={item.display_name} size="sm" />
      <div className="sm">
        {item.display_name} · {item.is_candidate ? 'Candidate' : 'Staff'} · {item.item_label} ·{' '}
        {stamp ?? `uploaded ${ukStamp(item.submitted_at)}`}
        {item.share_code ? (
          <>
            {' '}
            · share code <span className="mono">{item.share_code}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The course level (a student) or the visa's hours limit (a work or dependant
 * visa), beside the Verify of the document that says so. Renders nothing for
 * any other document.
 */
function useConditions(item: ReviewItem) {
  const field = conditionFieldFor(item.item_type, item.rtw_branch);
  const [below, setBelow] = useState(
    initialBelowDegree(item.below_degree_level, item.rtw_check_term_limit),
  );
  const [limit, setLimit] = useState(
    initialVisaLimit(
      item.visa_weekly_hour_limit,
      item.rtw_check_term_limit,
      item.rtw_check_conditions,
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
          <span className="muted">{belowDegreeHint(item.rtw_check_term_limit)}</span>
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
 * Reject asks for a reason, sent to the worker in push N8 with a Re-upload
 * button. The in-employment declaration is the exception: the worker is NOT
 * told through the app, and the reason becomes the manual block's. On an NI
 * check the evidence is rejected because the number does not match.
 */
export function RejectModal({
  item,
  busy,
  onClose,
  onReject,
}: {
  item: ReviewItem;
  busy: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const inEmployment = item.kind === 'declaration' && item.declaration_source === 'in_employment';
  const niCheck = item.kind === 'ni_check';
  const title =
    item.kind === 'declaration'
      ? 'Reject declaration'
      : niCheck
        ? 'NI number does not match'
        : 'Reject document';
  return (
    <Modal
      open
      title={title}
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
            {item.kind === 'declaration' ? 'Reject declaration' : 'Reject document'}
          </Button>
        </>
      }
    >
      <Who item={item} />
      {niCheck && item.ni_number ? (
        <div className="sm">{niEvidenceLine(item.ni_number)}</div>
      ) : null}
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
              manager can lift it. The worker is not told through the app — the office calls them.
            </>
          ) : (
            <>
              Goes to the worker word for word in push N8 — “Document rejected — [reason]” — with a{' '}
              <b>Re-upload</b> button. The new upload comes back to Needs review.
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
 * Completion letter: "On approval, the reviewer confirms/enters: the course
 * completion date, and the visa expiry date (should already be on file from
 * the right-to-work check)."
 */
export function ApproveModal({
  item,
  busy,
  onClose,
  onApprove,
}: {
  item: ReviewItem;
  busy: boolean;
  onClose: () => void;
  onApprove: (completionDate: string, visaExpiry: string) => void;
}) {
  const [completionDate, setCompletionDate] = useState(item.completion_date_claimed ?? '');
  const [visaExpiry, setVisaExpiry] = useState(item.staff_right_to_work_until ?? '');
  const onFile = item.staff_right_to_work_until;
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
        <Avatar name={item.display_name} size="sm" />
        <div className="sm">
          {item.display_name} ·{' '}
          {item.evidence_form ? EVIDENCE_FORM_LABEL[item.evidence_form] : 'Completion letter'} ·
          uploaded {ukStamp(item.submitted_at)}
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
          item.completion_date_claimed
            ? `Entered with the upload: ${ukDate(item.completion_date_claimed)}. Correct it if the document says otherwise.`
            : 'None entered with the upload — read it off the document.'
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
        The weekly limit becomes 48 hours from the Monday on or after the later of the completion
        date and today — a whole week at a time, never backdated, and never past the visa expiry. A
        completion date in the future lifts nothing until it arrives.
      </Note>
    </Modal>
  );
}

/**
 * A visa document, a status document or a share code report is verified on
 * the right-to-work date it carries. The AI's (or the worker's typed) date is
 * pre-filled; the reviewer confirms it against the document — and, for a
 * student, the course level, or for a work or dependant visa, the weekly
 * hours limit written on it.
 */
export function RightToWorkModal({
  item,
  rule,
  busy,
  onClose,
  onVerify,
}: {
  item: ReviewItem;
  rule: RtwDateRule;
  busy: boolean;
  onClose: () => void;
  onVerify: (field: RtwDateRule['field'], value: string, conditions: ConfirmedConditions) => void;
}) {
  const [date, setDate] = useState(
    (rule.field === 'expiry' ? item.expiry_date : item.doc_right_to_work_until) ?? '',
  );
  const [noTimeLimit, setNoTimeLimit] = useState(false);
  const problem = rtwDateProblem(rule, date, noTimeLimit);
  const conditions = useConditions(item);
  const reverify = item.kind === 'rtw_date';
  return (
    <Modal
      open
      title={reverify ? 'Confirm right-to-work date' : `Verify ${item.item_label}`}
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            tone="green"
            solid
            disabled={busy || problem !== null || conditions.problem !== null}
            onClick={() =>
              onVerify(rule.field, rtwDateValue(date, noTimeLimit), conditions.confirmed)
            }
          >
            {reverify ? 'Confirm date' : 'Verify'}
          </Button>
        </>
      }
    >
      <Who
        item={item}
        stamp={
          reverify
            ? `verified without a date ${ukStamp(item.submitted_at)}`
            : `uploaded ${ukStamp(item.submitted_at)}`
        }
      />
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
          The gov.uk report shows <b>settled status</b> — no time limit. Pre-settled status has an
          end date: enter it instead.
        </label>
      ) : null}
      {reverify ? null : conditions.fields}
      {item.rtw_check_reason ? (
        <Note tone="coral">
          <b>Why the automatic gov.uk check did not verify it:</b> {item.rtw_check_reason} The date
          gov.uk returned, if any, is pre-filled — confirm it against the report.
        </Note>
      ) : null}
      {reverify ? (
        <Note>
          This report was verified before the date was required, so the worker has no right-to-work
          date on file: nothing stops a shift past their visa and the reminder ladder has nothing to
          count down from. Re-run the share code on gov.uk and confirm the date it shows. The report
          stays verified — nothing else on the profile changes. If the check no longer passes, block
          the worker from their profile.
        </Note>
      ) : null}
      {item.staff_right_to_work_until ? (
        <Note>
          On file now: right to work until {ukDate(item.staff_right_to_work_until)}. The earliest
          date across the worker’s current evidence is kept.
        </Note>
      ) : null}
      {problem && (date !== '' || noTimeLimit) ? <div className="coral sm">{problem}</div> : null}
    </Modal>
  );
}

/**
 * A document with no date to confirm but something to check beside it: NI
 * evidence against the NI number (shown in full), or a student's term letter
 * with the course level.
 */
export function ConfirmVerifyModal({
  item,
  busy,
  onClose,
  onVerify,
}: {
  item: ReviewItem;
  busy: boolean;
  onClose: () => void;
  onVerify: (conditions: ConfirmedConditions) => void;
}) {
  const conditions = useConditions(item);
  const ni = item.item_type === 'ni_evidence';
  return (
    <Modal
      open
      title={`Verify ${item.item_label}`}
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
      <Who item={item} />
      {ni ? (
        <Note tone={item.ni_number ? 'neutral' : 'amber'}>
          {item.ni_number ? (
            <>
              NI number on the profile: <b className="mono">{formatNi(item.ni_number)}</b> — check
              it matches the number on the document before you verify.
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

/** Whether Verify on this document opens a window rather than acting on the click. */
export function needsConfirmWindow(item: Pick<ReviewItem, 'item_type' | 'rtw_branch'>): boolean {
  return (
    item.item_type === 'ni_evidence' || conditionFieldFor(item.item_type, item.rtw_branch) !== null
  );
}
