'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, DocRow, Panel, Pill } from '@thc/ui';
import { SETTLED_NO_TIME_LIMIT, formatUkDate } from '../staff';
import {
  complianceSummary,
  declarationActionable,
  declarationMeta,
  documentOrder,
  formatUkStamp,
} from './profile';
import { documentLink } from '../../onboarding/actions';
import { useReviewDialogs } from '../../compliance/ReviewDialogs';
import { CompletionLetterUpload, RtwReportUpload } from '../../compliance/EvidenceUploads';
import { canAttachReport, canUploadCompletionLetter } from '../../compliance/conditions';
import { actionsFor, queueByRecord, verifyAllowed, verifyHint } from '../../compliance/queue';
import type { ActionResult, QueueRow } from '../../compliance/types';
import { RtwCheckPanel } from '../../_components/RtwCheckPanel';
import { checksByDocument } from '../../_lib/rtwCheck';
import type { RtwCheckRow } from '../../_lib/rtwCheck';
import type { DeclarationRow, DocumentRow, ProfileRow, ReviewStatus } from './types';

/**
 * The Documents tab (§9.6): "a list with statuses, with the ability to
 * download the file", closing with the one-line compliance summary.
 *
 * Download goes through `documentLink` — the same server action /onboarding
 * uses: the path is read through the manager's own session, so what gets
 * signed is a document this manager can see, never a path the browser sent,
 * and the link lives for 60 seconds.
 *
 * Verify / Reject (§4.1, §9.6). A document or a Yes declaration waiting on
 * the office carries them — the wireframe's "Under review · Verify · Reject
 * · Download" — and they are /compliance's, not a copy: the row they act on
 * is this worker's row of the Needs review queue (`reviewQueue`), and the
 * buttons, the dialogs and the server actions are `useReviewDialogs`, the
 * same hook the queue uses. So the rules are the queue's by construction: a
 * visa, status document or share code asks for its right-to-work date, the
 * completion letter for its completion date and visa expiry, a Reject for
 * the reason N8 sends the worker; a Rejected or Removed worker has nothing
 * to review (§4.1); and the §4.3 re-check, the unblock, N8/N15 and the
 * manual block on a rejected in-employment declaration all happen in the
 * database, whichever screen pressed it. The RPCs run on the manager's
 * session and refuse anyone who is not an admin (assert_reviewer).
 *
 * The Criminal Record declaration is a row of this list, as the wireframe
 * draws it (DECL).
 *
 * Superseded documents are a separate, dimmed group rather than a hidden
 * one. §2.12 keeps them "read-only, on the profile as the record of what
 * was held during the previous period" and is equally explicit that they
 * are "never used to satisfy the new compliance check" — which
 * current_verified_docs() enforces in the database, not here.
 *
 * The verification stamps are UK time whoever is reading (§1.8): they are
 * audit records, not scheduled times.
 *
 * A share code carries its automated gov.uk check (ADR-0025) under the row:
 * status, source, date, right-to-work-until, conditions, "Download gov.uk
 * report" and "Run check again" — the same panel as /onboarding/:id and
 * /compliance. While the check is on, Verify with a hand-typed date is
 * offered only once the check needs review (rtw_check_manual_allowed(), via
 * the queue row's `rtw_manual_allowed`); before that the check verifies it.
 * A share code verified before the date was required carries "Confirm
 * date" (the queue's `rtw_date` row, 20260927160000).
 *
 * What the office adds itself (20260930130400): "Attach gov.uk report" on a
 * share code with none on file, on the manual path only (the automated
 * check stores its own, D31), and "Upload completion letter" on a live
 * Student-visa profile with none waiting (D47) — it lands in Needs review
 * like the worker's own upload. NI evidence is verified with the NI number
 * beside it and comes back to compare once the number arrives (D43); a
 * right-to-work Verify carries the course level or the visa's hours limit
 * (D32, D36). All of that is the shared dialogs'.
 */
function meta(row: DocumentRow): string {
  const parts: string[] = [];
  if (row.expires_on) parts.push(`Expires ${formatUkDate(row.expires_on)}`);
  else if (row.rtw_no_time_limit) parts.push(SETTLED_NO_TIME_LIMIT);
  if (row.ai_confidence !== null) parts.push(`AI ${Math.round(row.ai_confidence * 100)}%`);
  if (row.reviewed_at) {
    parts.push(
      `${row.reviewed_by_name ? `Verified by ${row.reviewed_by_name}` : 'Reviewed'} · ${formatUkStamp(row.reviewed_at)}`,
    );
  } else {
    parts.push(`Uploaded ${formatUkStamp(row.uploaded_at)}`);
  }
  if (row.rejection_reason) parts.push(`Rejected: ${row.rejection_reason}`);
  if (row.share_code) parts.push(`share code ${row.share_code}`);
  if (row.awarding_institution) parts.push(row.awarding_institution);
  return parts.join(' · ');
}

const STATE = {
  verified: 'verified',
  pending: 'review',
  rejected: 'rejected',
  superseded: 'pending',
} as const;

const STATUS_PILL = {
  verified: { tone: 'green', label: 'Verified' },
  pending: { tone: 'amber', label: 'Under review' },
  rejected: { tone: 'coral', label: 'Rejected' },
  superseded: { tone: 'neutral', label: 'Superseded' },
} as const;

function StatusPill({ status }: { status: ReviewStatus }) {
  return <Pill tone={STATUS_PILL[status].tone}>{STATUS_PILL[status].label}</Pill>;
}

export function Documents({
  profile,
  documents,
  declarations = [],
  rtwChecks = [],
  rtwCheckEnabled = false,
  reviewQueue = [],
  reviewQueueProblem = null,
}: {
  profile: ProfileRow;
  documents: DocumentRow[];
  declarations?: DeclarationRow[];
  rtwChecks?: RtwCheckRow[];
  rtwCheckEnabled?: boolean;
  /** This worker's rows of the Needs review queue (§4.1). */
  reviewQueue?: QueueRow[];
  reviewQueueProblem?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const checks = checksByDocument(rtwChecks);
  const queue = queueByRecord(reviewQueue);
  const sorted = [...documents].sort(documentOrder);
  const live = sorted.filter((row) => !row.superseded);
  const superseded = sorted.filter((row) => row.superseded);
  const liveDeclarations = declarations.filter((row) => row.review_status !== 'superseded');
  const supersededDeclarations = declarations.filter((row) => row.review_status === 'superseded');

  const download = (docId: string, which: 'file' | 'report') => {
    setProblem(null);
    start(async () => {
      const result = await documentLink(docId, which);
      if (result.ok && result.url) window.open(result.url, '_blank', 'noopener');
      else if (!result.ok) setProblem(result.message);
    });
  };

  const run = (_id: string, work: () => Promise<ActionResult>, after?: () => void) => {
    setProblem(null);
    setNotice(null);
    start(async () => {
      const result = await work();
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setNotice(result.message ?? null);
      after?.();
      router.refresh();
    });
  };

  // /compliance's Verify / Reject: the same actions, the same dialogs.
  const { verify, reject, dialogs } = useReviewDialogs({ run, busy: () => pending });

  /** Verify / Reject on a record the queue lists, or nothing (§4.1). */
  const reviewButtons = (item: QueueRow | undefined) => {
    if (!item) return null;
    const allowed = actionsFor(item);
    return (
      <>
        {verifyAllowed(item) ? (
          <Button size="sm" tone="green" disabled={pending} onClick={() => verify(item)}>
            {allowed.verify}
          </Button>
        ) : null}
        {allowed.reject ? (
          <Button size="sm" tone="danger" disabled={pending} onClick={() => reject(item)}>
            Reject
          </Button>
        ) : null}
      </>
    );
  };

  // §4.1: once someone is Rejected or Removed, what they left under review
  // no longer needs it — the queue drops it, so there is nothing to press.
  const reviewClosed = profile.status === 'rejected' || profile.status === 'removed';

  /** The row's meta line, with what Verify will do where the queue spells it out. */
  const withHint = (line: string, item: QueueRow | undefined, underReview = false) => {
    const hint = item
      ? verifyHint(item)
      : underReview && reviewClosed
        ? 'No longer needs review — this person is Rejected or Removed'
        : null;
    if (!hint) return line;
    return (
      <>
        {line}
        <span className="review-hint muted xs">{hint}</span>
      </>
    );
  };

  const downloads = (row: DocumentRow) => (
    <>
      {row.file_path ? (
        <Button size="sm" tone="ghost" disabled={pending} onClick={() => download(row.id, 'file')}>
          Download
        </Button>
      ) : null}
      {row.gov_report_path ? (
        <Button
          size="sm"
          tone="ghost"
          disabled={pending}
          onClick={() => download(row.id, 'report')}
        >
          gov.uk report
        </Button>
      ) : null}
      {!row.file_path && !row.gov_report_path ? (
        <span className="muted xs">no file to download</span>
      ) : null}
    </>
  );

  return (
    <Panel
      title="Documents"
      actions={
        <span className="muted sm">
          statuses + download · verification stamps in UK time (audit)
        </span>
      }
    >
      <div className="stack">
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
        {notice ? <Alert tone="green">{notice}</Alert> : null}
        {reviewQueueProblem ? (
          <Alert tone="amber">
            Verify / Reject are unavailable here because the review queue could not be read (
            {reviewQueueProblem}). Review from Compliance → Needs review.
          </Alert>
        ) : null}

        {live.length === 0 && liveDeclarations.length === 0 ? (
          <div className="empty">No documents on file.</div>
        ) : null}

        {live.map((row) => (
          <div key={row.id} className="stack">
            <DocRow
              icon={row.gov_report_path && !row.file_path ? 'GOV' : 'PDF'}
              title={row.doc_label}
              meta={withHint(meta(row), queue.get(row.id), row.review_status === 'pending')}
              state={STATE[row.review_status]}
              actions={
                <>
                  <StatusPill status={row.review_status} />
                  {queue.get(row.id)?.kind === 'rtw_date' ? (
                    <Pill tone="coral">re-verify</Pill>
                  ) : null}
                  {queue.get(row.id)?.kind === 'ni_check' ? (
                    <Pill tone="amber">compare NI number</Pill>
                  ) : null}
                  {reviewButtons(queue.get(row.id))}
                  {downloads(row)}
                  {!reviewClosed &&
                  canAttachReport(row, checks.get(row.id) ?? null, rtwCheckEnabled) ? (
                    <RtwReportUpload docId={row.id} staffId={profile.id} />
                  ) : null}
                </>
              }
            />
            {row.doc_type === 'share_code_report' ? (
              <RtwCheckPanel
                row={checks.get(row.id) ?? null}
                docId={row.id}
                docStatus={row.review_status}
                enabled={rtwCheckEnabled}
              />
            ) : null}
          </div>
        ))}

        {liveDeclarations.map((row) => (
          <DocRow
            key={row.id}
            icon="DECL"
            title={`Criminal Record declaration · ${row.answer ? 'Yes' : 'No'}`}
            meta={withHint(
              declarationMeta(row),
              declarationActionable(row) ? queue.get(row.id) : undefined,
              declarationActionable(row),
            )}
            state={STATE[row.review_status]}
            actions={
              <>
                <StatusPill status={row.review_status} />
                {declarationActionable(row) ? reviewButtons(queue.get(row.id)) : null}
              </>
            }
          />
        ))}

        {profile.photo_path ? (
          <DocRow
            icon="IMG"
            title="Profile selfie"
            meta="locked — changes go through the office"
            state="verified"
            actions={
              <>
                <Pill tone="green">Set</Pill>
                {profile.photo_url ? (
                  <a
                    className="btn sm ghost"
                    href={profile.photo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                  >
                    Download
                  </a>
                ) : null}
              </>
            }
          />
        ) : null}

        {canUploadCompletionLetter(profile, documents) ? (
          <CompletionLetterUpload staffId={profile.id} />
        ) : null}

        {superseded.length > 0 || supersededDeclarations.length > 0 ? (
          <div className="superseded-group stack">
            <div className="label">Superseded · read-only</div>
            <div className="muted sm">
              the record of what was held during a previous period — never used to satisfy the
              current check
            </div>
            {superseded.map((row) => (
              <DocRow
                key={row.id}
                icon={row.gov_report_path && !row.file_path ? 'GOV' : 'PDF'}
                title={row.doc_label}
                meta={meta(row)}
                state="pending"
                actions={
                  <>
                    <Pill>Superseded</Pill>
                    {downloads(row)}
                  </>
                }
              />
            ))}
            {supersededDeclarations.map((row) => (
              <DocRow
                key={row.id}
                icon="DECL"
                title={`Criminal Record declaration · ${row.answer ? 'Yes' : 'No'}`}
                meta={declarationMeta(row)}
                state="pending"
                actions={<Pill>Superseded</Pill>}
              />
            ))}
          </div>
        ) : null}

        {/*
          §9.6: this line never ends with an empty slot. Until a contract
          is signed it closes "Compliant and bookable." instead of
          trailing off after a colon.
        */}
        <div className="sm">{complianceSummary(profile)}</div>
      </div>

      {/*
        Verify with a date, Approve, and Reject with a reason (§4.1, §10.7):
        the /compliance dialogs, not a copy of them.
      */}
      {dialogs}
    </Panel>
  );
}
