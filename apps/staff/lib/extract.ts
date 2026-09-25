import { after } from 'next/server';
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
 * The read runs AFTER THE RESPONSE (`after()` from `next/server`,
 * ADR-0033). A Claude read is up to 45 s an attempt with one retry, plus
 * the Storage download; awaited in the upload action it held the worker's
 * upload open for up to ~90 s, and a platform timeout mid-read errored an
 * upload whose row was already recorded. Now the action returns as soon as
 * the RPC has filed the document.
 *
 * Pre-fill, never verify. Every path a read can take ends flagged for a
 * human unless the model was sure:
 *   · extractor configured — `extractAfterResponse()` first flags the row
 *     for manual review (a null-confidence `record_document_extraction()`,
 *     which keeps every date the worker entered — 20260928120100), then
 *     schedules the read; if the platform kills the deferred work, the row
 *     stays flagged (§2.6: "Where the AI is unsure, the document is
 *     flagged as 'needs manual review'").
 *   · a failed read (timeout, API error, unreadable file) comes back from
 *     the provider as confidence 0 and is recorded → flagged.
 *   · a failure here (download, RPC, a throw) is caught and logged with an
 *     error code only — never document content — and the row keeps the
 *     flag it was given.
 *   · extractor off (no ANTHROPIC_API_KEY) — nothing is flagged or read;
 *     the row stays as its upload RPC left it (extractor.ts).
 * Server only — it holds the service client.
 */

/**
 * Record the upload as awaiting its read, then read it after the response.
 * Awaits only the flag (one RPC); never throws, never fails the upload.
 */
export async function extractAfterResponse(
  admin: SupabaseClient,
  docId: string,
  docType: DocType,
  path: string,
  mimeType?: string,
): Promise<void> {
  if (!documentExtractor()) return;
  await flagUntilRead(admin, docId);
  try {
    after(() => extractDocument(admin, docId, docType, path, mimeType));
  } catch (error) {
    // Outside a request scope `after()` throws. The row is already flagged.
    logFailure('schedule', docId, error);
  }
}

/**
 * The wizard's rows are inserted flagged; a Documents-tab row is not
 * (`submit_document_upload()` / `submit_completion_letter()` leave the
 * column default, false). A read with no confidence flags it —
 * `record_document_extraction()` treats a null confidence as "a human
 * reads it" and, since 20260928120100, keeps every field it has no value
 * for. No new RPC: the same seam the read itself writes through.
 */
async function flagUntilRead(admin: SupabaseClient, docId: string): Promise<void> {
  try {
    const { error } = await admin.rpc('record_document_extraction', {
      p_doc: docId,
      p_expiry: null,
      p_term_dates: null,
      p_completion: null,
      p_institution: null,
      p_confidence: null,
      p_raw: null,
    });
    if (error) logFailure('flag', docId, error);
  } catch (error) {
    logFailure('flag', docId, error);
  }
}

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
    const { data: file, error: downloadError } = await admin.storage
      .from('documents')
      .download(path);
    if (!file) {
      logFailure('download', docId, downloadError);
      return;
    }
    const result = await extractor.extract({
      docType,
      path,
      mimeType: mimeType || file.type || 'application/octet-stream',
      bytes: await file.arrayBuffer(),
    });
    const { error } = await admin.rpc('record_document_extraction', {
      p_doc: docId,
      p_expiry: result.expiryDate,
      p_term_dates: result.holidays?.map(toDaterangeLiteral) ?? null,
      p_completion: result.completionDate,
      p_institution: result.awardingInstitution,
      p_confidence: result.confidence,
      p_raw: { provider: extractor.provider, ...result.raw },
    });
    if (error) logFailure('record', docId, error);
  } catch (error) {
    logFailure('extract', docId, error);
  }
}

/**
 * The error's code only — a Postgres / PostgREST code, an HTTP status or
 * the error class name. Never the message: a provider or RPC message can
 * quote the document or the worker's details.
 */
export function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; status?: unknown; name?: unknown };
    if (typeof e.code === 'string' && e.code) return e.code;
    if (typeof e.status === 'number') return `http_${e.status}`;
    if (typeof e.name === 'string' && e.name) return e.name;
  }
  return 'unknown';
}

function logFailure(stage: string, docId: string, error: unknown): void {
  console.error('document extraction failed', { stage, docId, code: errorCode(error) });
}
