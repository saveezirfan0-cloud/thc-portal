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
import { rejectDeclaration, verifyDeclaration } from '../../compliance/actions';
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
 * The Criminal Record declaration is a row of this list, as the wireframe
 * draws it (DECL). A Yes still under review carries Verify / Reject, and
 * those are /compliance's own actions and RPCs (§4.1, §10.7) — the §4.3
 * re-check, the unblock and the manual block on a rejected in-employment
 * declaration all happen in the database, whichever screen pressed it.
 *
 * Superseded documents are a separate, dimmed group rather than a hidden
 * one. §2.12 keeps them "read-only, on the profile as the record of what
 * was held during the previous period" and is equally explicit that they
 * are "never used to satisfy the new compliance check" — which
 * current_verified_docs() enforces in the database, not here.
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
}: {
  profile: ProfileRow;
  documents: DocumentRow[];
  declarations?: DeclarationRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<DeclarationRow | null>(null);
  const [reason, setReason] = useState('');

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

  const review = (
    work: () => Promise<{ ok: true; message?: string } | { ok: false; message: string }>,
    after?: () => void,
  ) => {
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

  return (
    <Panel
      title="Documents"
      actions={
        <span className="muted sm">
          statuses + download · verification stamps in UK time (audit, §1.8)
        </span>
      }
    >
      <div className="stack">
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
        {notice ? <Alert tone="green">{notice}</Alert> : null}

        {live.length === 0 && liveDeclarations.length === 0 ? (
          <div className="empty">No documents on file.</div>
        ) : null}

        {live.map((row) => (
          <DocRow
            key={row.id}
            icon={row.gov_report_path && !row.file_path ? 'GOV' : 'PDF'}
            title={row.doc_label}
            meta={meta(row)}
            state={STATE[row.review_status]}
            actions={
              <>
                <StatusPill status={row.review_status} />
                {downloads(row)}
              </>
            }
          />
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

        {superseded.length > 0 || supersededDeclarations.length > 0 ? (
          <div className="superseded-group stack">
            <div className="label">Superseded · read-only</div>
            <div className="muted sm">
              the record of what was held during a previous period — never used to satisfy the
              current check (§2.12)
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
        Reject (§10.7, §4.1). The same RPC as the /compliance queue. An
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
                them (§10.7).
              </>
            ) : (
              <>Kept on the declaration as the reason it was rejected (§2.10).</>
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
