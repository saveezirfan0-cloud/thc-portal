# ADR-0199 · Retry AI scan, and a passport / ID expiry the office can type

**Status:** Accepted (instruction of the product owner, 23.10.2026) · builds on ADR-0033 (document extraction with Claude) · scope §2.6, §4.2, §4.3

## Context

The AI sometimes reads no expiry from a passport (confidence 0: a page that is not the photo page, a blurred or HEIC photo, a timeout). The office could neither enter the date when verifying a passport nor ask for a second read, and a passport with no expiry on file gets no §4.2 reminders and no §4.3 block.

## Decision

1. **Passport and national ID Verify offer an optional expiry**, pre-filled from the read, in the Compliance queue and on the candidate card. Blank still verifies. No database change: `verify_document` / `compliance_verify_document` already store `p_expiry` for any type, and neither document carries a right-to-work date.
2. **"Retry AI scan"** on a pending passport, ID card, visa or status document. The reader (Claude key and SDK) lives only in the Staff App (ADR-0033), so the Back Office action checks the caller (`current_app_role()` admin and `office_can('write')`) and calls `POST /api/internal/rescan-document` on the Staff App with `Authorization: Bearer <DOCUMENT_RESCAN_SECRET>` (same value on both Vercel projects, constant-time compare, refuses while unset). The route reads the stored file and writes through `record_document_extraction()`, which never touches a decided document and keeps any date it has no value for.
3. **The outcome is said in words** on the button's toast: confidence, whether an expiry was read, and why not (reason codes only: wrong document type, not legible, timeout, file type, over 5 MB). Nothing about the document is logged or returned.

## Consequences

- The retry is pre-fill only; nothing verifies on the AI's word (§2.6).
- Term and completion letters are not retryable from here yet.
- The reason is shown when a retry is run; it is not yet stored where the queue can show it beside the badge.
- Deploy: set `DOCUMENT_RESCAN_SECRET` on both projects (docs/12).
