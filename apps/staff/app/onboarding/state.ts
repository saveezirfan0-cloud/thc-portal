import { requiredDocuments } from '@thc/domain';
import type {
  DocRequirement,
  DocType,
  HmrcAnswers,
  OnboardingStatus,
  RtwBranch,
  StudentLoanPlan,
  UkDocChoice,
  WizardFacts,
} from '@thc/domain';

/**
 * The wizard's view of `onboarding_state()` — typed, and nothing more.
 *
 * Pure (no Next, no Supabase) so the mapping and the per-requirement
 * statuses are unit-tested against the RPC's JSON shape. Every decision is
 * the database's; what this does is name the fields.
 */

export type DocStatus = 'pending' | 'verified' | 'rejected' | 'superseded';

export interface UploadedDoc {
  id: string;
  docType: DocType;
  status: DocStatus;
  fileName: string | null;
  fileSize: number | null;
  uploadedAt: string;
  expiryDate: string | null;
  rightToWorkUntil: string | null;
  rejectionReason: string | null;
  reviewedAt: string | null;
  needsManualReview: boolean;
  termDates: { from: string; to: string }[] | null;
  shareCode: string | null;
}

export interface Referee {
  name: string;
  relationship: string;
  phone: string;
  email: string;
}

export interface OnboardingState {
  staffId: string;
  firstName: string;
  lastName: string;
  status: OnboardingStatus;
  employeeId: number | null;
  dob: string | null;
  rtwBranch: RtwBranch | null;
  shareCode: string | null;
  wtrOptOut: boolean;
  homeAddress: string | null;
  homeLat: number | null;
  homeLng: number | null;
  photoPath: string | null;
  niMasked: string | null;
  quizAttempts: number;
  contractSignedAt: string | null;
  contractVersion: string | null;
  /** "18.09.2026 14:42 UK time" — formatted by the database, UK only (§1.8). */
  contractStamp: string | null;
  progress: {
    ukDocChoice: UkDocChoice | null;
    visaType: string | null;
    visaExpiry: string | null;
    rtwAt: string | null;
    addressAt: string | null;
    selfieAt: string | null;
    documentsAt: string | null;
    inductionAt: string | null;
    hmrcAt: string | null;
    referencesAt: string | null;
    bankAt: string | null;
    contractAt: string | null;
    tutorialAt: string | null;
  };
  documents: UploadedDoc[];
  declaration: { answer: boolean; status: DocStatus; declaredAt: string } | null;
  quiz: { attemptNo: number; percent: number; passed: boolean; correct: number; total: number }[];
  hmrc: (HmrcAnswers & { studentLoan: StudentLoanPlan; postgraduateLoan: boolean }) | null;
  references: Referee[];
  bank: { accountHolder: string; sortCode: string; accountNumber: string } | null;
  contract: { version: string; title: string; body: string; isPlaceholder: boolean } | null;
}

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);
const bool = (v: unknown): boolean => v === true;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});

export function mapOnboardingState(raw: unknown): OnboardingState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Json;
  const p = obj(r['progress']);
  const decl = r['declaration'] ? obj(r['declaration']) : null;
  const hmrc = r['hmrc'] ? obj(r['hmrc']) : null;
  const bank = r['bank'] ? obj(r['bank']) : null;
  const contract = r['contract'] ? obj(r['contract']) : null;

  return {
    staffId: String(r['staffId'] ?? ''),
    firstName: str(r['firstName']) ?? '',
    lastName: str(r['lastName']) ?? '',
    status: (str(r['status']) ?? 'documents') as OnboardingStatus,
    employeeId: num(r['employeeId']),
    dob: str(r['dob']),
    rtwBranch: str(r['rtwBranch']) as RtwBranch | null,
    shareCode: str(r['shareCode']),
    wtrOptOut: bool(r['wtrOptOut']),
    homeAddress: str(r['homeAddress']),
    homeLat: num(r['homeLat']),
    homeLng: num(r['homeLng']),
    photoPath: str(r['photoPath']),
    niMasked: str(r['niMasked']),
    quizAttempts: num(r['quizAttempts']) ?? 0,
    contractSignedAt: str(r['contractSignedAt']),
    contractVersion: str(r['contractVersion']),
    contractStamp: str(r['contractStamp']),
    progress: {
      ukDocChoice: str(p['ukDocChoice']) as UkDocChoice | null,
      visaType: str(p['visaType']),
      visaExpiry: str(p['visaExpiry']),
      rtwAt: str(p['rtwAt']),
      addressAt: str(p['addressAt']),
      selfieAt: str(p['selfieAt']),
      documentsAt: str(p['documentsAt']),
      inductionAt: str(p['inductionAt']),
      hmrcAt: str(p['hmrcAt']),
      referencesAt: str(p['referencesAt']),
      bankAt: str(p['bankAt']),
      contractAt: str(p['contractAt']),
      tutorialAt: str(p['tutorialAt']),
    },
    documents: ((r['documents'] as Json[] | null) ?? []).map((d) => ({
      id: String(d['id']),
      docType: d['docType'] as DocType,
      status: d['status'] as DocStatus,
      fileName: str(d['fileName']),
      fileSize: num(d['fileSize']),
      uploadedAt: String(d['uploadedAt'] ?? ''),
      expiryDate: str(d['expiryDate']),
      rightToWorkUntil: str(d['rightToWorkUntil']),
      rejectionReason: str(d['rejectionReason']),
      reviewedAt: str(d['reviewedAt']),
      needsManualReview: bool(d['needsManualReview']),
      termDates: (d['termDates'] as { from: string; to: string }[] | null) ?? null,
      shareCode: str(d['shareCode']),
    })),
    declaration: decl
      ? {
          answer: bool(decl['answer']),
          status: decl['status'] as DocStatus,
          declaredAt: String(decl['declaredAt'] ?? ''),
        }
      : null,
    quiz: ((r['quiz'] as Json[] | null) ?? []).map((q) => ({
      attemptNo: Number(q['attemptNo']),
      percent: Number(q['percent']),
      passed: bool(q['passed']),
      correct: Number(q['correct'] ?? 0),
      total: Number(q['total'] ?? 0),
    })),
    hmrc: hmrc
      ? {
          q1OtherJob: hmrc['q1OtherJob'] as boolean | null,
          q2Pension: (hmrc['q2Pension'] as boolean | null) ?? null,
          q3Since6April: (hmrc['q3Since6April'] as boolean | null) ?? null,
          studentLoan: (str(hmrc['studentLoan']) ?? 'none') as StudentLoanPlan,
          postgraduateLoan: bool(hmrc['postgraduateLoan']),
        }
      : null,
    references: ((r['references'] as Json[] | null) ?? []).map((x) => ({
      name: String(x['name'] ?? ''),
      relationship: String(x['relationship'] ?? ''),
      phone: String(x['phone'] ?? ''),
      email: String(x['email'] ?? ''),
    })),
    bank: bank
      ? {
          accountHolder: String(bank['accountHolder'] ?? ''),
          sortCode: String(bank['sortCode'] ?? ''),
          accountNumber: String(bank['accountNumber'] ?? ''),
        }
      : null,
    contract: contract
      ? {
          version: String(contract['version']),
          title: String(contract['title'] ?? ''),
          body: String(contract['body'] ?? ''),
          isPlaceholder: bool(contract['isPlaceholder']),
        }
      : null,
  };
}

/** What `packages/domain`'s step gating reads. */
export function wizardFacts(s: OnboardingState): WizardFacts {
  const p = s.progress;
  return {
    status: s.status,
    rtwDone: Boolean(p.rtwAt),
    addressDone: Boolean(p.addressAt),
    selfieDone: Boolean(p.selfieAt),
    documentsSubmitted: Boolean(p.documentsAt),
    inductionDone: Boolean(p.inductionAt),
    quizPassed: s.quiz.some((q) => q.passed),
    hmrcDone: Boolean(p.hmrcAt),
    referencesDone: Boolean(p.referencesAt),
    bankDone: Boolean(p.bankAt),
    contractSigned: Boolean(s.contractSignedAt),
    tutorialDone: Boolean(p.tutorialAt),
  };
}

export interface RequirementRow {
  requirement: DocRequirement;
  /** The current upload that answers it, if any. */
  doc: UploadedDoc | null;
}

/** One row per document the branch asks for, with whatever answers it now. */
export function requirementRows(s: OnboardingState): RequirementRow[] {
  if (!s.rtwBranch) return [];
  return requiredDocuments(s.rtwBranch, s.progress.ukDocChoice).map((requirement) => {
    const candidates = s.documents
      .filter((d) => requirement.accepts.includes(d.docType))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return { requirement, doc: candidates[0] ?? null };
  });
}

/** The gov.uk share-code check row, once step 4 has been submitted. */
export function shareCodeDoc(s: OnboardingState): UploadedDoc | null {
  return s.documents.find((d) => d.docType === 'share_code_report') ?? null;
}

/** Every requirement has a file on it — Submit can be pressed (§10.3). */
export function allUploaded(rows: readonly RequirementRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.doc && r.doc.status !== 'rejected');
}

/** What the worker calls each document — the same words as SQL doc_label(). */
export function docLabel(t: DocType): string {
  switch (t) {
    case 'passport':
      return 'Passport';
    case 'birth_certificate':
      return 'Birth certificate';
    case 'ni_evidence':
      return 'NI evidence';
    case 'national_id':
      return 'National ID card';
    case 'visa_document':
      return 'Visa document';
    case 'status_document':
      return 'Status document';
    case 'university_term_dates_letter':
      return 'University Term Dates Letter';
    case 'university_completion_letter':
      return 'Official University Completion Letter';
    case 'share_code_report':
      return 'Right to work · share code';
  }
}

/** The file-type badge on a document row: "PDF", "JPG", "gov" … */
export function docIcon(doc: UploadedDoc | null): string {
  if (!doc) return '—';
  if (doc.docType === 'share_code_report') return 'gov';
  if (doc.status === 'verified') return '✓';
  if (doc.status === 'rejected') return '✕';
  const ext = doc.fileName?.split('.').pop()?.toUpperCase() ?? '';
  return ext === 'JPEG' ? 'JPG' : ext || 'DOC';
}
