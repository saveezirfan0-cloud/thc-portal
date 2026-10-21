import type { TimeFormat } from '@thc/domain';
import { declarationFollowUpParts } from '../../compliance/declarationLines';
import type { DeclarationRow } from './types';

/**
 * The Criminal Record declaration's follow-ups on the Documents tab
 * (ADR-0180): what the office asked the worker, the reason of a rejection,
 * and a reversed rejection. Added to `declarationMeta()`'s line rather than
 * replacing it, so the "declared … · Rejected by …" stamps read as they
 * always have.
 */

/**
 * Live, or history? Superseded is the flag (an update or a Reset to
 * candidate sets it); `review_status = 'superseded'` is kept for rows read
 * before the flag was selected.
 */
export function isLiveDeclaration(row: DeclarationRow): boolean {
  return !row.superseded && row.review_status !== 'superseded';
}

export function declarationFollowUpLine(
  line: string,
  row: DeclarationRow,
  format?: TimeFormat,
): string {
  const parts = [line];
  if (row.review_status === 'rejected' && row.review_note) {
    parts.push(`Reason: “${row.review_note}”`);
  }
  // A reversal's own note is the review note ("Verified by … · note").
  if (row.reversed_at && row.review_note) parts.push(`Note: “${row.review_note}”`);
  parts.push(...declarationFollowUpParts(row, format));
  return parts.join(' · ');
}
