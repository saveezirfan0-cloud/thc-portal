import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocType } from '@thc/domain';
import { documentExtractor, toDaterangeLiteral } from '../app/onboarding/extractor';
import type { DocumentExtractor, ExtractionResult } from '../app/onboarding/extractor';
import { bakeOrientation, turnClockwise, turnable, uprightPath } from './upright';
import type { QuarterTurn } from './upright';

/**
 * §2.6 — the AI reads EVERY uploaded document: the wizard's step 4, a
 * renewal from the Documents tab, and the completion letter (§4.5), whose
 * completion date and awarding institution `record_document_extraction()`
 * pre-fills, and a passport, whose issuing country `record_passport_country()`
 * puts on the worker when none is on file (ADR-0159). So the call lives
 * here, once, and both upload paths make it after their RPC has recorded
 * the document.
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

/**
 * What a read came to, for the office's "Retry AI scan" to say in words:
 * the confidence, whether an expiry was read, and the reason codes (an error
 * code or the list of issues) — never the document or the answer.
 */
export interface ExtractionSummary {
  confidence: number;
  expiryFound: boolean;
  reasons: string[];
}

export async function extractDocument(
  admin: SupabaseClient,
  docId: string,
  docType: DocType,
  path: string,
  mimeType?: string,
): Promise<ExtractionSummary | undefined> {
  const extractor = documentExtractor();
  if (!extractor) return undefined;
  try {
    const { data: file, error: downloadError } = await admin.storage
      .from('documents')
      .download(path);
    if (!file) {
      logFailure('download', docId, downloadError);
      return undefined;
    }
    const mime = mimeType || file.type || 'application/octet-stream';
    let bytes = await file.arrayBuffer();
    // ADR-0212: a photo is read the way a browser shows it.
    const photo = turnable(docType, mime);
    if (photo) bytes = await bakeOrientation(bytes).catch(() => bytes);
    let result = await extractor.extract({
      docType,
      path,
      mimeType: photo ? detectedPhotoMime(bytes, mime) : mime,
      bytes,
    });
    if (photo && result.uprightTurn) {
      result = await turnUpright(admin, extractor, docId, docType, path, bytes, result);
    }
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
    // ADR-0159: the passport's issuing country for the New Starter
    // report. The RPC fills a blank only — never what the office set.
    if (docType === 'passport' && result.passportCountry) {
      const { error: countryError } = await admin.rpc('record_passport_country', {
        p_doc: docId,
        p_country: result.passportCountry,
      });
      if (countryError) logFailure('passport_country', docId, countryError);
    }
    if (error) return undefined;
    return {
      confidence: result.confidence,
      expiryFound: result.expiryDate !== null,
      reasons: reasonCodes(result.raw),
    };
  } catch (error) {
    logFailure('extract', docId, error);
    return undefined;
  }
}

/**
 * ADR-0212 (TK-18): the reader says the photo is sideways or upside down.
 * Turn a copy, read the copy, and only when that read says it now reads the
 * right way up store it in place of the original (`turn_document_upright`,
 * which refuses once the office has decided, or if the file has changed).
 * The read of the upright copy is the one recorded. Anything short of that
 * keeps the original and the first read; the office can still Rotate.
 */
async function turnUpright(
  admin: SupabaseClient,
  extractor: DocumentExtractor,
  docId: string,
  docType: DocType,
  path: string,
  bytes: ArrayBuffer,
  first: ExtractionResult,
): Promise<ExtractionResult> {
  const degrees = first.uprightTurn as QuarterTurn;
  try {
    const turned = await turnClockwise(bytes, degrees);
    const check = await extractor.extract({ docType, path, mimeType: 'image/jpeg', bytes: turned });
    if (check.uprightTurn !== 0) {
      logFailure('upright_unconfirmed', docId, { code: `turn_${degrees}` });
      return first;
    }
    const to = uprightPath(path);
    const { error: uploadError } = await admin.storage
      .from('documents')
      .upload(to, new Blob([turned], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
    if (uploadError) {
      logFailure('upright_upload', docId, uploadError);
      return first;
    }
    const { error } = await admin.rpc('turn_document_upright', {
      p_doc: docId,
      p_from: path,
      p_to: to,
      p_size: turned.byteLength,
      p_turned: degrees,
    });
    if (error) {
      logFailure('upright_record', docId, error);
      await admin.storage.from('documents').remove([to]);
      return first;
    }
    return { ...check, raw: { ...check.raw, turnedUpright: degrees } };
  } catch (error) {
    logFailure('upright', docId, error);
    return first;
  }
}

/** A baked photo is a JPEG whatever it was uploaded as; an untouched one keeps its type. */
function detectedPhotoMime(bytes: ArrayBuffer, mime: string): string {
  const head = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff ? 'image/jpeg' : mime;
}

/** The extractor's own codes from `raw` (`error`, or the `issues` list). */
function reasonCodes(raw: Record<string, unknown>): string[] {
  if (typeof raw['error'] === 'string') return [raw['error']];
  const issues = raw['issues'];
  return Array.isArray(issues) ? issues.filter((i): i is string => typeof i === 'string') : [];
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
