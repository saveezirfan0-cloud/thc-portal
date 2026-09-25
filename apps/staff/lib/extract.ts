import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocType } from '@thc/domain';
import { documentExtractor, toDaterangeLiteral } from '../app/onboarding/extractor';

/**
 * §2.6 — the AI reads EVERY uploaded document: the wizard's step 4, a
 * renewal from the Documents tab, and the completion letter (§4.5), whose
 * completion date and awarding institution `record_document_extraction()`
 * pre-fills. So the call lives here, once, and both upload paths make it
 * after their RPC has recorded the document.
 *
 * Pre-fill, never verify: a failed or absent extractor leaves the document
 * flagged for manual review, which is where it started, and it never fails
 * the upload. Server only — it holds the service client.
 */
export async function extractDocument(
  admin: SupabaseClient,
  docId: string,
  docType: DocType,
  path: string,
  mimeType?: string,
): Promise<void> {
  const extractor = documentExtractor();
  if (!extractor) return;
  try {
    const { data: file } = await admin.storage.from('documents').download(path);
    if (!file) return;
    const result = await extractor.extract({
      docType,
      path,
      mimeType: mimeType || file.type || 'application/octet-stream',
      bytes: await file.arrayBuffer(),
    });
    await admin.rpc('record_document_extraction', {
      p_doc: docId,
      p_expiry: result.expiryDate,
      p_term_dates: result.holidays?.map(toDaterangeLiteral) ?? null,
      p_completion: result.completionDate,
      p_institution: result.awardingInstitution,
      p_confidence: result.confidence,
      p_raw: { provider: extractor.provider, ...result.raw },
    });
  } catch (error) {
    console.error('document extraction failed', docId, error);
  }
}
