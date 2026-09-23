import { cookies } from 'next/headers';
import { isDocType } from '@thc/domain';
import type { CompletionEvidenceForm } from '@thc/domain';
import { staffDb, supabaseConfigured } from '../db';
import type {
  CapNow,
  DeclarationRecord,
  DocumentRecord,
  DocumentsData,
  OptOutRecord,
  ReviewStatus,
} from './types';

/**
 * The Documents tab's one read — `staff_documents()` (20260923150000).
 *
 * `security definer`, resolving the caller itself (`staff_caller()`), so
 * nothing here names a worker: the same shape as `profile/data.ts` and
 * `app/data.ts`, for the same reason.
 */

export { supabaseConfigured };

export async function loadDocuments(): Promise<DocumentsData | null> {
  if (!supabaseConfigured()) return null;
  const supabase = staffDb(await cookies());
  const { data, error } = await supabase.rpc('staff_documents');
  if (error || !data) return null;
  return parseDocuments(data as Record<string, unknown>);
}

const str = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const day = (value: unknown): string | null => (value ? String(value).slice(0, 10) : null);

const REVIEW: ReadonlySet<string> = new Set(['pending', 'verified', 'rejected', 'superseded']);
const review = (value: unknown): ReviewStatus =>
  REVIEW.has(String(value)) ? (String(value) as ReviewStatus) : 'pending';

/**
 * The RPC's JSON, typed. Pure, so the view-model tests start from exactly
 * what the database returns. A document type this build does not know is
 * dropped rather than rendered as a blank row.
 */
export function parseDocuments(row: Record<string, unknown>): DocumentsData {
  const documents: DocumentRecord[] = ((row['documents'] as Record<string, unknown>[]) ?? [])
    .filter((d) => isDocType(String(d['docType'])))
    .map((d) => ({
      id: String(d['id']),
      docType: String(d['docType']) as DocumentRecord['docType'],
      label: String(d['label'] ?? ''),
      reviewStatus: review(d['reviewStatus']),
      uploadedAt: String(d['uploadedAt']),
      reviewedAt: str(d['reviewedAt']),
      expiresOn: day(d['expiresOn']),
      rejectionReason: str(d['rejectionReason']),
      evidenceForm: (str(d['evidenceForm']) as CompletionEvidenceForm | null) ?? null,
      completionDateClaimed: day(d['completionDateClaimed']),
      completionDate: day(d['completionDate']),
      shareCodeTail: str(d['shareCodeTail']),
      hasFile: Boolean(d['hasFile']),
      isCurrent: Boolean(d['isCurrent']),
      isCountedVerified: Boolean(d['isCountedVerified']),
    }));

  const declarations: DeclarationRecord[] = (
    (row['declarations'] as Record<string, unknown>[]) ?? []
  ).map((c) => ({
    id: String(c['id']),
    source: c['source'] === 'in_employment' ? 'in_employment' : 'onboarding',
    answer: Boolean(c['answer']),
    declaredAt: String(c['declaredAt']),
    reviewStatus: review(c['reviewStatus']),
    superseded: Boolean(c['superseded']),
  }));

  const capRaw = row['cap'] as Record<string, unknown> | null | undefined;
  const cap: CapNow | null =
    capRaw && capRaw['band']
      ? {
          hours:
            capRaw['hours'] === null || capRaw['hours'] === undefined
              ? null
              : Number(capRaw['hours']),
          band: String(capRaw['band']),
          label: String(capRaw['label'] ?? ''),
          until: day(capRaw['until']),
        }
      : null;

  const optRaw = (row['optOut'] as Record<string, unknown> | null) ?? {};
  const optOut: OptOutRecord = {
    signed: Boolean(optRaw['signed']),
    signedAt: str(optRaw['signedAt']),
    noticeDays:
      optRaw['noticeDays'] === null || optRaw['noticeDays'] === undefined
        ? null
        : Number(optRaw['noticeDays']),
    cancelledFrom: day(optRaw['cancelledFrom']),
    hasSignedCopy: Boolean(optRaw['hasSignedCopy']),
  };

  return {
    staffId: String(row['staffId']),
    today: day(row['today']) ?? new Date().toISOString().slice(0, 10),
    status: row['status'] as DocumentsData['status'],
    blockKind: (str(row['blockKind']) as DocumentsData['blockKind']) ?? null,
    rtwBranch: str(row['rtwBranch']),
    dob: day(row['dob']),
    rightToWorkUntil: day(row['rightToWorkUntil']),
    graduatedAt: day(row['graduatedAt']),
    courseCompletionDate: day(row['courseCompletionDate']),
    termLetterApplies: row['termLetterApplies'] !== false,
    missing: ((row['missing'] as string[]) ?? []).map(String),
    documents,
    declarations,
    cap,
    optOut,
  };
}
