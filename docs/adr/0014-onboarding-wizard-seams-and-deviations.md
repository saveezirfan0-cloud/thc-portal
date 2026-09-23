# ADR-0014 · The onboarding wizard: what is stubbed, and where it departs from the wireframes

**Status:** Accepted (onboarding bot, S2 · §10.3, §2.5–§2.11) · **Builds on:** ADR-0002 (gov.uk check), ADR-0005 (maps without a GL library), ADR-0013 (B5, "Additional info" is a column)

## Context
The Staff App wizard (`apps/staff/app/onboarding/**`, migrations `20260923120000`–`20260923120200`, pgTAP 390–393) needs four inputs this repository does not hold (Appendix B): Gemini access and THC's sample letters for AI extraction, THC's Health & Safety induction deck, the quiz questions and answers taken from it, and the zero-hours agreement. It also meets three places where the wireframes assume something that is not available.

## Decisions

**Seams, built and clearly stubbed**
- **Document extraction (§2.6).** `DocumentExtractor` in `onboarding/extractor.ts` is the one provider interface; `documentExtractor()` returns `null` until the Gemini provider is written (needs `GEMINI_API_KEY` as a secret, and THC's samples for the prompt). The write path exists and is tested: `record_document_extraction()` (service role only) pre-fills dates and a confidence, sets `needs_manual_review` below `settings.ai_confidence_threshold`, and never touches `review_status`. Until then every upload arrives flagged for manual review — the §2.6 behaviour when the AI is unsure.
- **gov.uk check (§2.6).** Submitting step 4 in a share-code branch files a pending `share_code_report` row carrying the code, ADR-0002's assisted flow. Nothing waits on it on the worker's side.
- **Induction deck (§10.3 5/11).** `content/induction.ts` is data. THC's file goes in as exported page images under `apps/staff/public/induction/`; until then the slides are short stand-ins and the screen says so.
- **Quiz (§2.9).** `quiz_questions` rows seeded by `20260923120100` are flagged `is_placeholder`. Replacing them is data (deactivate, insert THC's); the 80 % rule and three attempts do not depend on the count.
- **Contract (§2.11).** `contract_versions` is immutable once published and must contain the duty to disclose convictions (a CHECK). The first row, `placeholder-2026-09`, is the wireframe's draft, flagged; THC's agreement is published as a new version.

**Deviations from the wireframes**
- **The pin stays still and the map moves** (2/11). The wireframe says "drag the pin to your front door"; the build keeps the pin centred and pans the map under it — the common phone gesture, and no 22 px drag target under a thumb. What is stored is the same point.
- **No bank name** (9/11). "HSBC UK · sort code recognised" needs a sort-code directory (a paid bank-data feed). The format check is shown with the wireframe's own "we don't verify the account with the bank" line.
- **The paused screen lives at `/onboarding`**, not the Documents tab. After step 4 the wizard shows its own In review / Verified / Rejected + Re-upload list. The Documents tab (`/documents`, with the completion letter and the §10.7 declaration) is S4's; when it lands, the paused state may simply link there.
- **Ticking "I agree" signs immediately** (10/11) — there is no separate Sign button; the stamp appears under the tick, as the wireframe's signed state shows.
- **Postcode search** (2/11) uses postcodes.io (open data, no key, UK-only) to centre the map; it is a convenience, not a geocoder of record.

**Interpretations of the scope**
- **NI evidence** is required only on branch 1's birth-certificate route. §2.5 pt 7 lists what counts as NI evidence "for branch 1, and any worker supplying an NI number", but pt 8 says no further documents are collected at onboarding and the NI number is only typed at step 7; the set stays exactly pts 1–5.
- **EU/EEA identity** is one requirement satisfied by a passport or a national ID card, chosen in the upload sheet.
- **Steps 7–10 all happen in `contract`.** The §2.12 machine goes quiz → contract; "Additional info" on the office board is derived (ADR-0013).

## Consequences
- The wizard can be walked end to end today (pgTAP 393 does), with every external input visibly marked as a stand-in.
- Go-live needs, in data only: THC's deck images, their quiz rows, their agreement version; and, in code, the Gemini provider behind the existing interface.
