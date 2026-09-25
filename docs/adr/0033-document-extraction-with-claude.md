# ADR-0033 · Document extraction with Anthropic's Claude instead of Gemini

**Status:** Accepted by the product owner; awaiting THC confirmation (listed as a decision in THC's review pack) · 25.09.2026 · built and tested, **switched off until `ANTHROPIC_API_KEY` is set**
**Supersedes:** the scope's choice of Gemini in §2.6 ("The AI provider for all document extraction in v1 is Gemini (decided 17.07.2026)") · **Amends:** ADR-0014 (its "Document extraction" seam: the provider is now written) · **Builds on:** ADR-0002 / ADR-0018 (the share code report's date is pre-filled by the extractor)
**Scope:** §2.5, §2.6, §4.2, §4.5, RULE-20 and `docs/scope/university-completion-letter-requirement.pdf` · **Code:** `apps/staff/app/onboarding/extractors/anthropic.ts`, `apps/staff/app/onboarding/extractor.ts` (`documentExtractor()`), tests `apps/staff/app/onboarding/__tests__/anthropic-extractor.test.ts` and `apps/staff/lib/__tests__/extract.test.ts`

## Context

§2.6 names Gemini as the provider for all document extraction, "written behind a single provider interface so the model can be swapped without touching the onboarding or compliance flows". The interface (`DocumentExtractor`), the result shape (`ExtractionResult`) and the write path (`record_document_extraction()`, service role only) were built in ADR-0014. The provider itself was not: `documentExtractor()` returned null everywhere, and every upload waited for a person.

THC's product owner has asked for Anthropic's Claude instead of Gemini. That departs from the scope, so it needs THC's confirmation. It is in their review pack as a decision. This ADR records the change so it can be confirmed or reversed without code archaeology.

## Decision

1. **Claude is the provider, behind the existing interface.** `extractors/anthropic.ts` implements `DocumentExtractor` with the official `@anthropic-ai/sdk`. The SDK is a dependency of `apps/staff` only, and the file imports `server-only`. The wizard, the Documents tab, the office screens and `record_document_extraction()` are unchanged. Swapping back to Gemini would be one more file behind the same interface.

2. **Off until a key exists.** `documentExtractor()` returns the provider only when `ANTHROPIC_API_KEY` is set and `DOCUMENT_EXTRACTOR` is unset or `anthropic`. Any other `DOCUMENT_EXTRACTOR` value is a kill switch. With no key it returns null, exactly as before. The key lives on the `thc-portal-staff` Vercel project, server-side (docs/12). `GEMINI_API_KEY` is retired.

3. **Model: `claude-sonnet-5` by default**, overridable with `ANTHROPIC_MODEL`. The task is reading printed dates and a name off one document. Sonnet is the tier that balances accuracy, speed and cost, and it has high-resolution vision for phone photos. The worker's upload waits on the call, so Opus's extra reasoning is not worth its latency or price here. `ANTHROPIC_EFFORT` defaults to `medium`. `off` omits it for a model that takes no effort setting.

4. **One call per upload, structured output.** The file goes in as a `document` block (PDF) or an `image` block (JPG, PNG; GIF and WebP are also accepted). The type is sniffed from the file's own bytes, because the Documents tab passes no MIME type. With the file goes a system prompt and a `DocType`-specific instruction:
   - passport, national ID, visa, status document: the expiry;
   - share code report: the right-to-work-until date, which `record_document_extraction()` writes to `right_to_work_until`;
   - term-dates letter: the **holiday** ranges as inclusive ISO dates. A gap between two printed terms counts, but a range is never extended past the printed dates. Outside every range the week is term (RULE-20, the conservative reading);
   - completion letter: the course completion date, or the award date if that is all it states, plus the awarding institution (§4.5 and the requirement);
   - birth certificate, NI evidence: nothing to pre-fill. The model reports only whether the file is that document and legible.

   The answer is constrained by a JSON schema through structured outputs (`output_config.format`), not a forced tool. Newer models reject `tool_choice: tool`, and the schema maps 1:1 onto `ExtractionResult` plus `matchesDocType`, `legible`, `completionDateKind` and a short `notes` field.

5. **The answer is checked before it is written.**
   - Dates must be real `yyyy-mm-dd` calendar dates between 1990 and 2100.
   - Holiday ranges must run forwards. They are sorted.
   - Fields another document type would carry are ignored.
   - The confidence must be a number in 0–1, or it is taken as 0.

   Whenever something is dropped, or a field the document type needs is missing, the confidence is capped at 0.3. The same happens when the document is not legible. A file that is not the document asked for scores 0. `record_document_extraction()` then flags the row against `settings.ai_confidence_threshold` (0.8), as before. The model's answer and the list of issues are kept in `ai_extracted` for the reviewer.

6. **Failure means manual review, never a crash, never a log of personal data.** The call has a 45-second timeout and one retry. The following never throw:
   - a timeout, API error, refusal, truncated or unparseable answer;
   - a HEIC photo, which §2.5 accepts but the API does not;
   - a photo over the API's 5 MB image limit.

   Each returns a zero-confidence, all-null result carrying only an error code, so the row is written with `needs_manual_review = true` on every upload path. That matters because the Documents tab inserts rows with `needs_manual_review = false`, so a thrown error would leave them unflagged. The only log line is that code. The document, the answer and the SDK's error message are never logged.

7. **Pre-fill only.** Nothing here reads or writes `review_status`. §2.6 is unchanged: "The AI does not verify a document … the manager checks and confirms manually."

## Consequences

- **THC must confirm.** If THC insists on Gemini, the Gemini provider is written behind the same interface and `DOCUMENT_EXTRACTOR` selects it. Nothing else changes.
- **Personal data goes to Anthropic, not Google.** THC's privacy notice and sub-processor list (docs/17: "Google Gemini for reading documents"; the key/account table there) must name Anthropic before the key is set for real workers. THC should also confirm Anthropic's commercial data-processing terms.
- **HEIC photos and photos over 5 MB are always read by a person.** Converting or downscaling them server-side needs an image library, which was not added here.
- **The prompt has not yet seen real letters.** THC's sample term and completion letters (Appendix B) are still wanted to tune the instructions. Until then the confidence cap and the reviewer are the safeguards.
- **Known gap, needs a migration (not in this change):** `record_document_extraction()` sets `awarding_institution = nullif(btrim(p_institution), '')` without a `coalesce`. So an extraction that finds no institution, or a failed read, clears the institution the worker typed on the Documents tab (`submit_completion_letter()`). It was latent while the extractor returned null, and becomes live when the key is set. The fix is `coalesce(nullif(btrim(p_institution), ''), awarding_institution)` in a forward migration, with a pgTAP case.
