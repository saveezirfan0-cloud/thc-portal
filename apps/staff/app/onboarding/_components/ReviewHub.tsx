'use client';

import { useState } from 'react';
import { Alert, Button, Pill, Progress } from '@thc/ui';
import { TOTAL_STEPS, formatShareCode } from '@thc/domain';
import type { DocRequirement } from '@thc/domain';
import { rtwLineForDoc } from '../../_lib/rtwCheck';
import type { RtwCheckLine } from '../../_lib/rtwCheck';
import { docIcon } from '../state';
import type { DocStatus, RequirementRow, UploadedDoc } from '../state';
import { UploadSheet } from './UploadSheet';

/**
 * After "Submit documents" — wireframes/staff/onboarding-3.html, "Documents
 * hub · after 4/11 submit" and "mixed statuses incl. rejected".
 *
 * Steps 5–11 unlock once every document is verified (§2.9), so the wizard
 * pauses here: each item In review / Verified / Rejected with its reason
 * and a Re-upload (§2.3, N8). The office's Verify is what moves the
 * candidate on — by itself, the moment the last item is verified.
 *
 * The share code row carries the automated gov.uk check's status while it
 * is pending (ADR-0025) — the domain's line only, never what gov.uk
 * returned; without a check it reads as it always did.
 *
 * This is the wizard's own paused screen. The Documents TAB — the same
 * list for a working member of staff, the completion letter and the §10.7
 * declaration — is S4's `/documents`.
 */
const STATUS_PILL: Record<
  DocStatus,
  { tone: 'amber' | 'green' | 'coral' | 'neutral'; label: string }
> = {
  pending: { tone: 'amber', label: 'In review' },
  verified: { tone: 'green', label: 'Verified' },
  rejected: { tone: 'coral', label: 'Rejected' },
  superseded: { tone: 'neutral', label: 'Replaced' },
};

function fmtDay(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London',
  }).format(new Date(iso));
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function meta(doc: UploadedDoc): string {
  if (doc.status === 'rejected') return `Rejected · “${doc.rejectionReason ?? 'see the office'}”`;
  if (doc.status === 'verified') {
    return doc.expiryDate ? `Verified · expires ${fmtDate(doc.expiryDate)}` : 'Verified';
  }
  return `Uploaded ${fmtDay(doc.uploadedAt)}`;
}

export function ReviewHub({
  rows,
  shareDoc,
  dob,
  declaration,
  rtwCheck = null,
}: {
  rows: RequirementRow[];
  shareDoc: UploadedDoc | null;
  dob: string | null;
  declaration: { answer: boolean; status: DocStatus; declaredAt: string } | null;
  /** `my_rtw_check()`'s line; null when there is no check or it could not be read. */
  rtwCheck?: RtwCheckLine | null;
}) {
  const [sheet, setSheet] = useState<DocRequirement | null>(null);
  const checkLine = shareDoc
    ? rtwLineForDoc(rtwCheck, {
        pending: shareDoc.status === 'pending',
        uploadedAt: shareDoc.uploadedAt,
      })
    : null;
  const rejected =
    rows.some((r) => r.doc?.status === 'rejected') || declaration?.status === 'rejected';

  return (
    <>
      {rejected ? (
        <Alert tone="amber">
          <b>One document needs your attention.</b> Onboarding continues once everything below is
          verified.
        </Alert>
      ) : (
        <Alert tone="cyan">
          <b>Thanks — your documents are with the office.</b> We check them within 1–2 working days
          and we’ll notify you. Steps 5–11 unlock once every document is verified.
        </Alert>
      )}

      <div className="mlist wiz-list">
        {rows.map(({ requirement, doc }) => {
          const status = doc?.status ?? 'pending';
          return (
            <div
              className={`docrow ${status === 'pending' ? 'pending' : status}`}
              key={requirement.key}
            >
              <span className="ico">{docIcon(doc)}</span>
              <div>
                <div className="t">{requirement.label}</div>
                <div className={`m ${status === 'rejected' ? 'coral' : ''}`}>
                  {doc ? meta(doc) : 'Missing'}
                </div>
              </div>
              <div className="right">
                {status === 'rejected' || !doc ? (
                  <Button tone="primary" size="sm" onClick={() => setSheet(requirement)}>
                    Re-upload
                  </Button>
                ) : (
                  <Pill tone={STATUS_PILL[status].tone}>{STATUS_PILL[status].label}</Pill>
                )}
              </div>
            </div>
          );
        })}
        {shareDoc ? (
          <div className={`docrow ${shareDoc.status === 'verified' ? 'verified' : 'pending'}`}>
            <span className="ico">gov</span>
            <div>
              <div className="t">
                Right to work · share code{' '}
                {shareDoc.shareCode ? formatShareCode(shareDoc.shareCode) : ''}
              </div>
              <div className="m">
                {shareDoc.status === 'verified'
                  ? `Verified${shareDoc.rightToWorkUntil ? ` · right to work until ${fmtDate(shareDoc.rightToWorkUntil)}` : ''}`
                  : (checkLine ?? `gov.uk check running${dob ? ` · DOB ${fmtDate(dob)}` : ''}`)}
              </div>
            </div>
            <div className="right">
              <Pill tone={STATUS_PILL[shareDoc.status].tone}>
                {STATUS_PILL[shareDoc.status].label}
              </Pill>
            </div>
          </div>
        ) : null}
        {declaration ? (
          <div
            className={`docrow ${declaration.status === 'verified' ? 'verified' : declaration.status}`}
          >
            <span className="ico">{declaration.status === 'verified' ? '✓' : '…'}</span>
            <div>
              <div className="t">Criminal conviction declaration</div>
              <div className="m">
                {declaration.answer
                  ? declaration.status === 'verified'
                    ? 'Reviewed and verified by the office'
                    : 'Answered “Yes” · with the office for review'
                  : `Answered “No” · verified automatically ${fmtDay(declaration.declaredAt)}`}
              </div>
            </div>
            <div className="right">
              <Pill tone={STATUS_PILL[declaration.status].tone}>
                {STATUS_PILL[declaration.status].label}
              </Pill>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mcard muted">
        <div className="h">
          <Pill>Onboarding paused</Pill>
          <span className="ml-auto mono sm">4 of {TOTAL_STEPS} done</span>
        </div>
        <Progress value={4} max={TOTAL_STEPS} thin />
        <Button block disabled>
          Continue onboarding — locked
        </Button>
      </div>

      <UploadSheet
        key={sheet?.key ?? 'closed'}
        requirement={sheet}
        onClose={() => setSheet(null)}
      />
    </>
  );
}
