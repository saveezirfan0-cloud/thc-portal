import type { DocType } from '@thc/domain';
import { createAnthropicExtractor, parseEffort } from './extractors/anthropic';

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
 * The provider is Anthropic's Claude, not Gemini — ADR-0033, a deviation
 * from §2.6 accepted by the product owner and AWAITING THC's CONFIRMATION.
 * The swap is exactly the one the scope's interface was written for:
 * `extractors/anthropic.ts` implements `DocumentExtractor`, and nothing in
 * the wizard, the Documents tab or the office changes.
 *
 * SWITCHED OFF until a key exists. `documentExtractor()` returns the Claude
 * provider only when `ANTHROPIC_API_KEY` is set (server-only, the
 * thc-portal-staff Vercel project — docs/12) and `DOCUMENT_EXTRACTOR` is
 * unset or `anthropic`; any other `DOCUMENT_EXTRACTOR` value switches it
 * off. Otherwise it returns null, uploads arrive as the upload RPC left
 * them, and a manager reads the dates off the document.
 *
 * The write path is `record_document_extraction()` (lib/extract.ts, service
 * role only), which pre-fills and sets `needs_manual_review` from the
 * confidence against `settings.ai_confidence_threshold` — never
 * `review_status`. THC's sample term and completion letters (Appendix B)
 * are still wanted to tune the prompt against.
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
 * The configured extractor, or null (ADR-0033).
 *
 *   ANTHROPIC_API_KEY    required; without it this returns null.
 *   DOCUMENT_EXTRACTOR   optional; unset or `anthropic` selects Claude,
 *                        anything else (e.g. `off`) switches extraction off.
 *   ANTHROPIC_MODEL      optional; default `DEFAULT_ANTHROPIC_MODEL`.
 *   ANTHROPIC_EFFORT     optional; `low` … `max`, default `medium`, `off`
 *                        for a model that takes no effort setting.
 */
export function documentExtractor(
  env: Record<string, string | undefined> = process.env,
): DocumentExtractor | null {
  const choice = (env['DOCUMENT_EXTRACTOR'] ?? '').trim().toLowerCase();
  if (choice && choice !== 'anthropic') return null;
  const apiKey = (env['ANTHROPIC_API_KEY'] ?? '').trim();
  if (!apiKey) return null;
  return createAnthropicExtractor({
    apiKey,
    model: env['ANTHROPIC_MODEL'],
    effort: parseEffort(env['ANTHROPIC_EFFORT']),
  });
}

/** `[from, to]` inclusive → the half-open range literal Postgres stores. */
export function toDaterangeLiteral(range: { from: string; to: string }): string {
  const end = new Date(`${range.to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return `[${range.from},${end.toISOString().slice(0, 10)})`;
}
