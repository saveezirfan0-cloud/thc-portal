import type { DocType } from '@thc/domain';

/**
 * The document extractor — §2.6, the one provider interface.
 *
 *   "The AI provider for all document extraction in v1 is Gemini (decided
 *    17.07.2026). The integration is written behind a single provider
 *    interface so the model can be swapped without touching the
 *    onboarding or compliance flows."
 *   "The AI does not verify a document. It only pre-fills the data and
 *    shows its confidence level … Where the AI is unsure, the document is
 *    flagged as 'needs manual review'."
 *
 * STUBBED. What is built is the seam: the interface, the result shape, and
 * the write path (`record_document_extraction()`, service role only, which
 * pre-fills and sets `needs_manual_review` from the confidence against
 * `settings.ai_confidence_threshold` — never `review_status`). What is NOT
 * built is the Gemini call itself: it needs a key (GEMINI_API_KEY, an Edge
 * Function / Vercel secret, never in code — docs/12) and THC's sample term
 * and completion letters to build the prompt against (Appendix B). Until
 * then `documentExtractor()` returns null, uploads arrive flagged for manual
 * review, and a manager reads the dates off the document — which is the
 * behaviour §2.6 asks for when the AI is unsure.
 */

export interface ExtractionInput {
  docType: DocType;
  /** Path in the private `documents` bucket. */
  path: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export interface ExtractionResult {
  /** The document's own expiry, where it has one (passport, visa, status document). */
  expiryDate: string | null;
  /** Term-dates letter: the HOLIDAY ranges, inclusive ISO dates (§2.3, RULE-20). */
  holidays: { from: string; to: string }[] | null;
  /** Completion letter: the course completion / award date (§4.5). */
  completionDate: string | null;
  awardingInstitution: string | null;
  /** 0–1. Below the threshold in settings, the office sees "needs manual review". */
  confidence: number;
  /** The provider's raw answer, kept on the row for the reviewer (ai_extracted). */
  raw: Record<string, unknown>;
}

export interface DocumentExtractor {
  readonly provider: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

/**
 * The configured extractor, or null. Returns null today in every
 * environment — see the header. When the Gemini provider is written it is
 * selected here by `DOCUMENT_EXTRACTOR=gemini` with `GEMINI_API_KEY` set,
 * and nothing else in the wizard changes.
 */
export function documentExtractor(): DocumentExtractor | null {
  return null;
}

/** `[from, to]` inclusive → the half-open range literal Postgres stores. */
export function toDaterangeLiteral(range: { from: string; to: string }): string {
  const end = new Date(`${range.to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return `[${range.from},${end.toISOString().slice(0, 10)})`;
}
