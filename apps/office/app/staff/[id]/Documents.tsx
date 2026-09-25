'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, DocRow, Modal, Note, Panel, Pill, Textarea } from '@thc/ui';
import { SETTLED_NO_TIME_LIMIT, formatUkDate } from '../staff';
import {
  complianceSummary,
  declarationActionable,
  declarationMeta,
  documentOrder,
  formatUkStamp,
} from './profile';
import { documentLink } from '../../onboarding/actions';
import {
  approveCompletionLetter,
  rejectDeclaration,
  rejectDocument,
  reviewFacts,
  verifyDeclaration,
  verifyDocument,
} from '../../compliance/actions';
import {
  ApproveModal,
  ConfirmVerifyModal,
  RejectModal,
  RightToWorkModal,
} from '../../compliance/ReviewModals';
import type { ConfirmedConditions, ReviewItem } from '../../compliance/ReviewModals';
import { CompletionLetterUpload, RtwReportUpload } from '../../compliance/EvidenceUploads';
import {
  canAttachReport,
  canUploadCompletionLetter,
  profileReviewItem,
  profileVerifyStep,
  reviewableOnProfile,
} from '../../compliance/profileReview';
import type { ProfileDocument, ProfileVerifyStep } from '../../compliance/profileReview';
import { rtwDateRule } from '../../compliance/rtw';
import { RtwCheckPanel } from '../../_components/RtwCheckPanel';
import { checksByDocument, rtwCheckView } from '../../_lib/rtwCheck';
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
 * A pending document carries Verify / Reject (audit item 8), and so does a
 * Yes declaration under review. Both are /compliance's own windows and RPCs
 * (ReviewModals.tsx, actions.ts): the reject reason goes to the worker in
 * N8, a right-to-work document is verified on its date, a completion letter
 * is approved with its completion date and visa expiry, NI evidence is
 * verified beside the full NI number, and the full compliance re-check, the
 * unblock and the manual block on a rejected in-employment declaration all
 * happen in the database, whichever screen pressed it.
 *
 * The office can add two things itself: the completion letter of a
 * Student-visa worker (D47, lands pending for Approve), and the gov.uk report
 * of a share code verified by hand (D31).
 *
 * Superseded documents are a separate, dimmed group rather than a hidden
 * one: they stay read-only on the profile as the record of what was held
 * during the previous period, and current_verified_docs() never lets them
 * satisfy the current check.
 *
 * The verification stamps are UK time whoever is reading (§1.8): they are
 * audit records, not scheduled times.
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
  const extra = row as DocumentRow & Partial<ProfileDocument>;
  if (extra.ni_recheck) parts.push('to compare with the NI number once it is entered');
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

type Window =
  | { step: Exclude<ProfileVerifyStep, 'direct' | 'automated'>; item: ReviewItem }
  | { step: 'reject'; item: ReviewItem }
  | null;

type Result = { ok: true; message?: string } | { ok: false; message: string };

export function Documents({
  profile,
  documents,
  declarations = [],
  rtwChecks = [],
  rtwCheckEnabled = false,
}: {
  profile: ProfileRow;
  documents: DocumentRow[];
  declarations?: DeclarationRow[];
  rtwChecks?: RtwCheckRow[];
  rtwCheckEnabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<DeclarationRow | null>(null);
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState<Window>(null);

  const checks = checksByDocument(rtwChecks);
  const sorted = [...documents].sort(documentOrder);
  const live = sorted.filter((row) => !row.superseded);
  const superseded = sorted.filter((row) => row.superseded);
  const liveDeclarations = declarations.filter((row) => row.review_status !== 'superseded');
  const supersededDeclarations = declarations.filter((row) => row.review_status === 'superseded');
  const subject = {
    id: profile.id,
    display_name: profile.display_name,
    status: profile.status,
    rtw_branch: profile.rtw_branch,
    right_to_work_until: profile.right_to_work_until,
  };

  const download = (docId: string, which: 'file' | 'report') => {
    setProblem(null);
    start(async () => {
      const result = await documentLink(docId, which);
      if (result.ok && result.url) window.open(result.url, '_blank', 'noopener');
      else if (!result.ok) setProblem(result.message);
    });
  };

  const review = (work: () => Promise<Result>, after?: () => void) => {
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

  const stepFor = (row: DocumentRow): ProfileVerifyStep => {
    const check = checks.get(row.id) ?? null;
    const manual = rtwCheckView(check, {
      docStatus: row.review_status,
      enabled: rtwCheckEnabled,
    }).manualAllowed;
    return profileVerifyStep(row, profile.rtw_branch, manual);
  };

  // A Verify that needs the reviewer to confirm something opens its window
  // with the facts the document row does not carry (the NI number, the
  // course level, the visa limit), read through the manager's session.
  const verify = (row: DocumentRow) => {
    const step = stepFor(row);
    if (step === 'automated') return;
    if (step === 'direct') {
      review(() => verifyDocument(row.id));
      return;
    }
    setProblem(null);
    start(async () => {
      const facts = step === 'approve' ? null : await reviewFacts(profile.id);
      if (facts && !facts.ok) {
        setProblem(facts.message);
        return;
      }
      const item = profileReviewItem(
        row as DocumentRow & ProfileDocument,
        subject,
        facts?.facts ?? null,
        checks.get(row.id) ?? null,
      );
      setOpen({ step, item });
    });
  };

  const withStaff = (conditions: ConfirmedConditions) =>
    Object.keys(conditions).length ? { staffId: profile.id, ...conditions } : undefined;

  const closeReject = () => {
    setRejecting(null);
    setReason('');
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

  const reviewButtons = (row: DocumentRow) => {
    if (!reviewableOnProfile(row, subject)) return null;
    const step = stepFor(row);
    return (
      <>
        {step === 'automated' ? null : (
          <Button size="sm" tone="green" disabled={pending} onClick={() => verify(row)}>
            {step === 'approve' ? 'Approve' : 'Verify'}
          </Button>
        )}
        <Button
          size="sm"
          tone="danger"
          disabled={pending}
          onClick={() =>
            setOpen({
              step: 'reject',
              item: profileReviewItem(row as DocumentRow & ProfileDocument, subject),
            })
          }
        >
          Reject
        </Button>
      </>
    );
  };

  const offerLetter = canUploadCompletionLetter(profile, documents);

  return (
    <Panel
      title="Documents"
      actions={
        <span className="muted sm">statuses + download · verification stamps in UK time</span>
      }
    >
      <div className="stack">
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
        {notice ? <Alert tone="green">{notice}</Alert> : null}

        {live.length === 0 && liveDeclarations.length === 0 ? (
          <div className="empty">No documents on file.</div>
        ) : null}

        {live.map((row) => (
          <div key={row.id} className="stack">
            <DocRow
              icon={row.gov_report_path && !row.file_path ? 'GOV' : 'PDF'}
              title={row.doc_label}
              meta={meta(row)}
              state={STATE[row.review_status]}
              actions={
                <>
                  <StatusPill status={row.review_status} />
                  {reviewButtons(row)}
                  {downloads(row)}
                  {canAttachReport(row, checks.get(row.id) ?? null) &&
                  profile.status !== 'removed' ? (
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
            meta={declarationMeta(row)}
            state={STATE[row.review_status]}
            actions={
              <>
                <StatusPill status={row.review_status} />
                {declarationActionable(row) ? (
                  <>
                    <Button
                      size="sm"
                      tone="green"
                      disabled={pending}
                      onClick={() => review(() => verifyDeclaration(row.id))}
                    >
                      Verify
                    </Button>
                    <Button
                      size="sm"
                      tone="danger"
                      disabled={pending}
                      onClick={() => setRejecting(row)}
                    >
                      Reject
                    </Button>
                  </>
                ) : null}
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

        {offerLetter ? <CompletionLetterUpload staffId={profile.id} /> : null}

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

      {open?.step === 'reject' ? (
        <RejectModal
          item={open.item}
          busy={pending}
          onClose={() => setOpen(null)}
          onReject={(text) =>
            review(
              () => rejectDocument(open.item.item_id, text),
              () => setOpen(null),
            )
          }
        />
      ) : null}
      {open?.step === 'approve' ? (
        <ApproveModal
          item={open.item}
          busy={pending}
          onClose={() => setOpen(null)}
          onApprove={(completionDate, visaExpiry) =>
            review(
              () => approveCompletionLetter(open.item.item_id, completionDate, visaExpiry),
              () => setOpen(null),
            )
          }
        />
      ) : null}
      {open?.step === 'rtw_date' ? (
        <RightToWorkModal
          item={open.item}
          rule={rtwDateRule(open.item.item_type, open.item.rtw_branch)!}
          busy={pending}
          onClose={() => setOpen(null)}
          onVerify={(field, value, conditions) =>
            review(
              () =>
                verifyDocument(
                  open.item.item_id,
                  field === 'expiry' ? { expiry: value } : { rightToWorkUntil: value },
                  withStaff(conditions),
                ),
              () => setOpen(null),
            )
          }
        />
      ) : null}
      {open?.step === 'confirm' ? (
        <ConfirmVerifyModal
          item={open.item}
          busy={pending}
          onClose={() => setOpen(null)}
          onVerify={(conditions) =>
            review(
              () => verifyDocument(open.item.item_id, {}, withStaff(conditions)),
              () => setOpen(null),
            )
          }
        />
      ) : null}

      {/*
        Reject a declaration. The same RPC as the /compliance queue. An
        in-employment declaration's reason becomes the manual block's and
        the worker is not pushed; an onboarding one is a candidate's.
      */}
      <Modal
        open={rejecting !== null}
        title="Reject declaration"
        onClose={closeReject}
        footer={
          <>
            <Button tone="ghost" onClick={closeReject}>
              Cancel
            </Button>
            <Button
              tone="danger"
              solid
              disabled={pending || reason.trim() === ''}
              onClick={() =>
                rejecting && review(() => rejectDeclaration(rejecting.id, reason), closeReject)
              }
            >
              Reject declaration
            </Button>
          </>
        }
      >
        <Textarea
          label={
            <>
              Reason <span className="coral">*</span>
            </>
          }
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint={
            rejecting?.source === 'in_employment' ? (
              <>
                Kept on the profile: the block converts to a manual block with this reason, and only
                a manager can lift it. The worker is not told through the app — the office calls
                them.
              </>
            ) : (
              <>Kept on the declaration as the reason it was rejected.</>
            )
          }
        />
        <Note>
          {rejecting?.source === 'in_employment'
            ? 'The block stands. Bookings released when they declared are not restored.'
            : 'Nothing else on the profile changes — including the weekly hours cap.'}
        </Note>
      </Modal>
    </Panel>
  );
}
