'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Avatar,
  Button,
  EmptyState,
  Input,
  Modal,
  Note,
  Pill,
  Select,
  Textarea,
} from '@thc/ui';
import {
  approveCompletionLetter,
  confirmRtwDate,
  rejectDeclaration,
  rejectDocument,
  verifyDeclaration,
  verifyDocument,
} from './actions';
import {
  DOCUMENT_FILTERS,
  EVIDENCE_FORM_LABEL,
  actionsFor,
  documentLine,
  filterQueue,
  foundLine,
  queueRowCheck,
  ukDate,
  ukStamp,
  verifyAllowed,
  uploadedLine,
  verifyHint,
  whoLine,
} from './queue';
import { RtwCheckPanel } from '../_components/RtwCheckPanel';
import type { WhoFilter } from './queue';
import { rtwDateProblem, rtwDateRule, rtwDateValue } from './rtw';
import type { RtwDateRule } from './rtw';
import type { ActionResult, QueueRow } from './types';

/**
 * Tab 1 · Needs review (§4.1).
 *
 * One row per item waiting on the office, oldest first. Verify and Reject on
 * every row; there is deliberately no "send reminder" anywhere on this screen
 * — the ladder runs itself (§4.2).
 *
 * The completion letter's Verify opens a confirmation rather than acting on
 * the click: the requirement (§2.2) makes the reviewer confirm the course
 * completion date and the visa expiry, and the database refuses the approval
 * without both. So does the Verify of a visa document, a status document or
 * a share code report: the reviewer confirms the right-to-work date it
 * carries, because that date is the per-shift hard stop (20260923200000).
 *
 * The automated gov.uk check (ADR-0025): while it is on, a share code
 * reaches this queue only when its check needs review — with the reason,
 * what gov.uk returned, the report and "Run check again" — and only then is
 * the hand-typed date offered. A check that found no right to work is an
 * item of its own (kind `rtw_check`), cleared with "Mark reviewed".
 *
 * The rtw_date row (20260927160000) is that same confirmation on a share
 * code report verified BEFORE the date was required: the report stays
 * verified, only the date is written — so no Reject, no re-check, no N8.
 */
export function ReviewTab({
  rows,
  rtwCheckEnabled = false,
}: {
  rows: QueueRow[];
  rtwCheckEnabled?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [who, setWho] = useState<WhoFilter>('all');
  const [document, setDocument] = useState('any');
  const [rejecting, setRejecting] = useState<QueueRow | null>(null);
  const [approving, setApproving] = useState<QueueRow | null>(null);
  const [confirming, setConfirming] = useState<QueueRow | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();

  const visible = useMemo(
    () => filterQueue(rows, { query, who, document }),
    [rows, query, who, document],
  );

  const run = (id: string, action: () => Promise<ActionResult>, after?: () => void) => {
    setResult(null);
    setPendingId(id);
    start(async () => {
      const outcome = await action();
      setResult(outcome);
      setPendingId(null);
      if (outcome.ok) {
        after?.();
        router.refresh();
      }
    });
  };

  const verify = (row: QueueRow) => {
    if (row.item_type === 'university_completion_letter') {
      setApproving(row);
      return;
    }
    if (
      (row.kind === 'document' || row.kind === 'rtw_date') &&
      rtwDateRule(row.item_type, row.rtw_branch)
    ) {
      setConfirming(row);
      return;
    }
    run(row.item_id, () =>
      row.kind === 'declaration' ? verifyDeclaration(row.item_id) : verifyDocument(row.item_id),
    );
  };

  return (
    <section className="stack" aria-label="Needs review">
      <div className="toolbar">
        <div className="search">
          <input
            className="input"
            style={{ height: 32, width: 240 }}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name"
            aria-label="Search by name"
          />
        </div>
        <Select
          value={who}
          onChange={(event) => setWho(event.target.value as WhoFilter)}
          aria-label="Candidates or staff"
          style={{ height: 32, width: 170 }}
        >
          <option value="all">Candidates + staff</option>
          <option value="candidates">Candidates only</option>
          <option value="staff">Staff only</option>
        </Select>
        <Select
          value={document}
          onChange={(event) => setDocument(event.target.value)}
          aria-label="Document type"
          style={{ height: 32, width: 220 }}
        >
          {DOCUMENT_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <div className="right">
          <span className="muted sm">Oldest first · the menu counter is this number</span>
        </div>
      </div>

      <Alert tone="cyan">
        <b>Why this tab exists:</b> a current worker who re-uploads after an expiry or a rejection
        never reappears on the onboarding kanban. Every profile with a document — or a Criminal
        Record declaration answered Yes (onboarding or in-employment, §10.7) — in the “under review”
        state lands here, candidates and staff alike (§4.1). So does a share code verified before
        the right-to-work date was required — “Right-to-work date missing — re-verify” — until the
        date off the gov.uk report is confirmed (§2.6, §4.4).
      </Alert>

      {result ? (
        <Alert tone={result.ok ? 'green' : 'coral'}>{result.message ?? 'Done.'}</Alert>
      ) : null}

      <div className="panel">
        <div className="panel-b tight">
          {visible.length === 0 ? (
            <EmptyState>
              <h3>{rows.length === 0 ? 'Nothing waiting on the office' : 'Nothing matches'}</h3>
              <p>
                Uploads and Yes declarations appear here the moment they are submitted. Rejected
                candidates and removed workers drop out by themselves.
              </p>
            </EmptyState>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Document</th>
                  <th>Uploaded</th>
                  <th>AI found</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <QueueLine
                    key={row.item_id}
                    row={row}
                    rtwCheckEnabled={rtwCheckEnabled}
                    busy={pendingId === row.item_id}
                    onVerify={() => verify(row)}
                    onReject={() => setRejecting(row)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Note>
        <b>Dropped out automatically:</b> once someone is Rejected or Removed their outstanding
        documents no longer need review and leave this queue (§4.1). A “No” Criminal Record answer
        is auto-verified on submission and never appears here (§2.10). References are never reviewed
        and never queue (§2.10). The Official University Completion Letter is reviewed here too:
        approving it confirms the completion date and visa expiry, and the cap follows from the
        completion date (completion letter requirement §2.2–2.3).
      </Note>

      {rejecting ? (
        <RejectModal
          row={rejecting}
          busy={pendingId === rejecting.item_id}
          onClose={() => setRejecting(null)}
          onReject={(reason) =>
            run(
              rejecting.item_id,
              () =>
                rejecting.kind === 'declaration'
                  ? rejectDeclaration(rejecting.item_id, reason)
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
          busy={pendingId === confirming.item_id}
          onClose={() => setConfirming(null)}
          onVerify={(field, value) =>
            run(
              confirming.item_id,
              () =>
                confirming.kind === 'rtw_date'
                  ? confirmRtwDate(confirming.item_id, value)
                  : verifyDocument(
                      confirming.item_id,
                      field === 'expiry' ? { expiry: value } : { rightToWorkUntil: value },
                    ),
              () => setConfirming(null),
            )
          }
        />
      ) : null}

      {approving ? (
        <ApproveModal
          row={approving}
          busy={pendingId === approving.item_id}
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
    </section>
  );
}

function QueueLine({
  row,
  rtwCheckEnabled,
  busy,
  onVerify,
  onReject,
}: {
  row: QueueRow;
  rtwCheckEnabled: boolean;
  busy: boolean;
  onVerify: () => void;
  onReject: () => void;
}) {
  const who = whoLine(row);
  const found = foundLine(row);
  const hint = verifyHint(row);
  const actions = actionsFor(row);
  return (
    <tr>
      <td>
        <div className="person">
          <Avatar name={row.display_name} size="sm" />
          <div>
            <div className="n">
              <Link href={`/staff/${row.staff_id}`}>{row.display_name}</Link>
            </div>
            <div className="s">
              {who.text}
              {who.blocked ? (
                <>
                  {' · '}
                  <span className="coral">{who.blocked}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </td>
      <td>
        <b>{row.item_label}</b>{' '}
        {row.kind === 'declaration' && row.declaration_source === 'in_employment' ? (
          <Pill tone="purple">in-employment</Pill>
        ) : null}
        {row.is_reupload ? <Pill tone="amber">re-upload</Pill> : null}
        {row.kind === 'rtw_check' ? <Pill tone="coral">no right to work</Pill> : null}
        {row.kind === 'rtw_date' ? <Pill tone="coral">re-verify</Pill> : null}
        <span className="sub">
          {documentLine(row)}
          {row.kind === 'declaration' && row.declaration_details ? (
            <> · “{row.declaration_details}” · details visible to Admin only</>
          ) : null}
        </span>
        {row.item_type === 'share_code_report' && row.kind !== 'rtw_date' ? (
          <RtwCheckPanel
            compact
            row={queueRowCheck(row)}
            docId={row.kind === 'document' ? row.item_id : ''}
            docStatus={row.kind === 'document' ? 'pending' : 'rejected'}
            enabled={rtwCheckEnabled}
          />
        ) : null}
      </td>
      <td className="mono sm">
        {ukStamp(row.submitted_at)}
        <span className="sub">{uploadedLine(row)}</span>
      </td>
      <td>
        <span
          className={
            found.confidence === null && row.kind === 'declaration' ? 'found muted' : 'found'
          }
        >
          {found.text}
        </span>
        {found.confidence === 'manual' ? (
          <span className="ai manual">needs manual review</span>
        ) : found.confidence ? (
          <span className={`ai ${found.confidence}`}>
            AI {Math.round((row.ai_confidence ?? 0) * 100)}%
          </span>
        ) : null}
      </td>
      <td style={{ textAlign: 'right' }}>
        {verifyAllowed(row) ? (
          <Button size="sm" tone="green" onClick={onVerify} disabled={busy}>
            {actions.verify}
          </Button>
        ) : null}
        {actions.reject ? (
          <>
            {' '}
            <Button size="sm" tone="danger" onClick={onReject} disabled={busy}>
              Reject
            </Button>
          </>
        ) : null}
        {hint ? <span className="sub muted xs">{hint}</span> : null}
      </td>
    </tr>
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
  return (
    <Modal
      open
      title={row.kind === 'declaration' ? 'Reject declaration' : 'Reject document'}
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
  onVerify: (field: RtwDateRule['field'], value: string) => void;
}) {
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
            disabled={busy || problem !== null}
            onClick={() => onVerify(rule.field, rtwDateValue(date, noTimeLimit))}
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
