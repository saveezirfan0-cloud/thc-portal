import type { TimeFormat } from '@thc/domain';
import { formatUkStamp } from '../staff/[id]/profile';

/**
 * What a declaration's follow-ups add to its line on the office screens
 * (ADR-0180): the message the office sent when it asked for more details,
 * a reversed rejection (when, and the reason it had — who reversed it and
 * their note are the review stamp the line already carries), and whether this
 * declaration is an update. Pure, so /staff/:id and /onboarding/:id word
 * it the same. The stamps are audit records, UK time (§1.8).
 */
export interface DeclarationFollowUpFacts {
  review_status: string;
  superseded?: boolean;
  worker_message?: string | null;
  replaces_declaration_id?: string | null;
  reversed_at?: string | null;
  /** The reason the reversed rejection had (the review fields are the reversal's). */
  reversed_rejection_reason?: string | null;
}

export function declarationFollowUpParts(
  row: DeclarationFollowUpFacts,
  format?: TimeFormat,
): string[] {
  const parts: string[] = [];
  if (row.review_status === 'details_requested' && row.worker_message) {
    parts.push(`asked: “${row.worker_message}”`);
    if (!row.superseded) parts.push('waiting for their updated declaration');
  }
  if (row.reversed_at) {
    parts.push(
      `Rejection reversed · ${formatUkStamp(row.reversed_at, format)}${row.reversed_rejection_reason ? ` · was rejected for: “${row.reversed_rejection_reason}”` : ''}`,
    );
  }
  if (row.replaces_declaration_id) parts.push('updated declaration');
  return parts;
}

/** The same, as a suffix for a line that is already written: "" or " · …". */
export function declarationFollowUps(row: DeclarationFollowUpFacts, format?: TimeFormat): string {
  return declarationFollowUpParts(row, format)
    .map((part) => ` · ${part}`)
    .join('');
}
