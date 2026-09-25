import { DOC_LABELS, EXPIRING_WITHIN_DAYS, daysBetween, documentState } from '@thc/domain';
import type { DocType } from '@thc/domain';
import type { DocumentsData } from '../documents/types';

/**
 * "Passport expires in 12 days" — the sub-line on the Profile tab's
 * Documents row (ADR-0035), so a document running out is visible from the
 * tab the worker opens, not only inside Documents.
 *
 * The window is the first rung of the §4.2 reminder ladder — "1 month
 * before expiry", then 2 weeks, 1 week, and the block on the day (§4.3).
 * It is not restated here: `EXPIRING_WITHIN_DAYS` in @thc/domain is that
 * rung, and `documentState()` is what the Documents screen itself calls
 * "expiring" with it, so the two screens cannot disagree about a document.
 *
 * Only the VERIFIED row that expiry is measured off counts
 * (`isCountedVerified`, `current_verified_docs()`), and a type whose
 * replacement is already with the office is left out: the worker has done
 * the thing this line would ask for, and the row's badge says "In review".
 * An expired document is not "expiring" — that is lock case 1 and the
 * row's "Action needed" badge.
 */
export interface ExpiringDocument {
  docType: DocType;
  label: string;
  /** Whole UK days until `expiresOn`, 1 … EXPIRING_WITHIN_DAYS. */
  days: number;
  expiresOn: string;
}

export function expiringDocument(
  data: Pick<DocumentsData, 'today' | 'documents' | 'termLetterApplies'>,
): ExpiringDocument | null {
  let soonest: ExpiringDocument | null = null;
  for (const doc of data.documents) {
    if (!doc.isCountedVerified || !doc.expiresOn) continue;
    if (documentState(doc, data.today, data.termLetterApplies) !== 'expiring') continue;
    const replacing = data.documents.some(
      (other) =>
        other.docType === doc.docType && other.isCurrent && other.reviewStatus === 'pending',
    );
    if (replacing) continue;
    const days = daysBetween(data.today, doc.expiresOn);
    if (days < 1 || days > EXPIRING_WITHIN_DAYS) continue;
    if (!soonest || days < soonest.days) {
      soonest = { docType: doc.docType, label: labelFor(doc), days, expiresOn: doc.expiresOn };
    }
  }
  return soonest;
}

/** The share code's expiry is the right-to-work date (§4.4), so it is named that. */
function labelFor(doc: { docType: DocType; label: string }): string {
  if (doc.docType === 'share_code_report') return 'Right to work';
  return doc.label || DOC_LABELS[doc.docType];
}

/** "Passport expires in 12 days" / "… expires tomorrow". */
export function expiryLine(doc: Pick<ExpiringDocument, 'label' | 'days'>): string {
  return doc.days === 1
    ? `${doc.label} expires tomorrow`
    : `${doc.label} expires in ${doc.days} days`;
}
