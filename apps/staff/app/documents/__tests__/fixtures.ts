import { parseDocuments } from '../data';
import type { DocumentsData } from '../types';

/**
 * `staff_documents()` payloads, shaped exactly as the RPC returns them and
 * run through the same parser the page uses. Names and dates follow
 * wireframes/CONVENTIONS.md: today is 23.09.2026 (UK).
 */
export const TODAY = '2026-09-23';

type Raw = Record<string, unknown>;

export function doc(over: Raw): Raw {
  return {
    id: `doc-${String(over['docType'])}-${String(over['reviewStatus'] ?? 'verified')}`,
    docType: 'passport',
    label: 'Passport',
    reviewStatus: 'verified',
    uploadedAt: '2026-03-01T10:00:00+00:00',
    reviewedAt: '2026-03-02T10:00:00+00:00',
    expiresOn: '2031-03-14',
    rejectionReason: null,
    evidenceForm: null,
    completionDateClaimed: null,
    completionDate: null,
    shareCodeTail: null,
    hasFile: true,
    isCurrent: true,
    isCountedVerified: true,
    ...over,
  };
}

export function payload(over: Raw = {}): Raw {
  return {
    staffId: 'd0000000-0000-4000-8000-000000000001',
    today: TODAY,
    status: 'compliant',
    blockKind: null,
    rtwBranch: 'work_visa',
    dob: '1996-03-03',
    rightToWorkUntil: '2028-01-31',
    graduatedAt: null,
    courseCompletionDate: null,
    termLetterApplies: true,
    missing: [],
    documents: [doc({})],
    declarations: [
      {
        id: 'decl-1',
        source: 'onboarding',
        answer: false,
        declaredAt: '2026-09-18T09:00:00+00:00',
        reviewStatus: 'verified',
        superseded: false,
      },
    ],
    cap: { hours: 48, band: 'standard_48', label: 'the standard weekly limit', until: null },
    optOut: {
      signed: false,
      signedAt: null,
      noticeDays: null,
      cancelledFrom: null,
      hasSignedCopy: false,
    },
    ...over,
  };
}

export function data(over: Raw = {}): DocumentsData {
  return parseDocuments(payload(over));
}
