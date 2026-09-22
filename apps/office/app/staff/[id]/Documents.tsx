'use client';

import { DocRow, Panel, Pill } from '@thc/ui';
import { formatUkDate } from '../staff';
import { complianceSummary, documentOrder, formatUkStamp } from './profile';
import type { DocumentRow, ProfileRow } from './types';

/**
 * The Documents tab (§9.6): "a list with statuses, with the ability to
 * download the file", closing with the one-line compliance summary.
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

export function Documents({
  profile,
  documents,
}: {
  profile: ProfileRow;
  documents: DocumentRow[];
}) {
  const sorted = [...documents].sort(documentOrder);
  const live = sorted.filter((row) => !row.superseded);
  const superseded = sorted.filter((row) => row.superseded);

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
        {live.length === 0 ? (
          <div className="empty">No documents on file.</div>
        ) : (
          live.map((row) => (
            <DocRow
              key={row.id}
              title={row.doc_label}
              meta={meta(row)}
              state={STATE[row.review_status]}
              actions={
                <>
                  <Pill tone={STATUS_PILL[row.review_status].tone}>
                    {STATUS_PILL[row.review_status].label}
                  </Pill>
                  {row.file_path ? null : <span className="muted xs">no file to download</span>}
                </>
              }
            />
          ))
        )}

        {superseded.length > 0 ? (
          <div className="superseded-group stack">
            <div className="label">Superseded · read-only</div>
            <div className="muted sm">
              the record of what was held during a previous period — never used to satisfy the
              current check (§2.12)
            </div>
            {superseded.map((row) => (
              <DocRow
                key={row.id}
                title={row.doc_label}
                meta={meta(row)}
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
    </Panel>
  );
}
