import type { CompletionEvidenceForm, DocType, RtwCheckStatus, StaffStatus } from '@thc/domain';

/**
 * What `staff_documents()` (20260923150000) hands the Documents tab.
 *
 * Note what is NOT here: the declaration's `details` and `conviction_date`,
 * and the full share code. The RPC does not select them, so there is no
 * field for this screen to render them into (§10.7 step 5).
 */
export type ReviewStatus = 'pending' | 'verified' | 'rejected' | 'superseded';

export interface DocumentRecord {
  id: string;
  docType: DocType;
  label: string;
  reviewStatus: ReviewStatus;
  /** ISO timestamp. */
  uploadedAt: string;
  reviewedAt: string | null;
  /** `doc_expires_on()` — the date §4.3 blocks on, not the printed one. */
  expiresOn: string | null;
  /** Only ever set on a rejected row: the manager's words, sent as N8. */
  rejectionReason: string | null;
  evidenceForm: CompletionEvidenceForm | null;
  completionDateClaimed: string | null;
  completionDate: string | null;
  shareCodeTail: string | null;
  hasFile: boolean;
  /** The latest non-superseded row of its type (`current_compliance_docs()`). */
  isCurrent: boolean;
  /** The verified row expiry is measured off (`current_verified_docs()`). */
  isCountedVerified: boolean;
}

export interface DeclarationRecord {
  id: string;
  source: 'onboarding' | 'in_employment';
  answer: boolean;
  declaredAt: string;
  reviewStatus: ReviewStatus;
  superseded: boolean;
}

export interface CapNow {
  /** Null = no ceiling (a signed opt-out, outside a Student visa term). */
  hours: number | null;
  band: string;
  /** `cap_band_label()` — the words N14 uses. */
  label: string;
  /** The Sunday a term/holiday band holds until, or null. */
  until: string | null;
}

export interface OptOutRecord {
  signed: boolean;
  signedAt: string | null;
  noticeDays: number | null;
  /** The END of the notice period — the day the 48 h ceiling returns. */
  cancelledFrom: string | null;
  hasSignedCopy: boolean;
}

export interface DocumentsData {
  staffId: string;
  /** UK calendar day the database evaluated this on. */
  today: string;
  status: StaffStatus;
  blockKind: 'auto_document' | 'manual' | 'conviction_review' | null;
  rtwBranch: string | null;
  dob: string | null;
  rightToWorkUntil: string | null;
  graduatedAt: string | null;
  courseCompletionDate: string | null;
  /** False once a verified completion letter has stopped the term-letter ladder (§4.5). */
  termLetterApplies: boolean;
  /** `onboarding_documents_missing()` tokens: passport, visa_document, share_code, … */
  missing: string[];
  documents: DocumentRecord[];
  declarations: DeclarationRecord[];
  cap: CapNow | null;
  optOut: OptOutRecord;
  /**
   * The latest automated gov.uk check per share-code document, by document
   * id (`my_rtw_checks()`, ADR-0025). Absent when the check is off or the
   * read failed — the row then reads as it always did.
   */
  rtwChecks?: Record<string, { status: RtwCheckStatus; workerReason: string | null }>;
}

export type ActionResult = { ok: true; note?: string } | { ok: false; message: string };
