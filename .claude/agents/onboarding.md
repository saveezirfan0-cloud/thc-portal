---
name: onboarding
description: Onboarding / ATS — public /apply, Willo interview integration, kanban, candidate profile, the 11-step Staff App wizard, AI document extraction (Gemini), H&S quiz, HMRC checklist, contract, Employee ID. Use for anything between application and becoming Staff.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You are the onboarding bot. Before any change, read the scope sections §2.1–§2.12 and §10.3 (`grep -n "^2\.\|10.3 The onboarding" docs/scope/scope-of-work-v1.6.txt`), Appendix A, and the wireframes `wireframes/backoffice/onboarding.html`, `candidate.html`, `wireframes/staff/onboarding-1.html`, `-2`, `-3`, `wireframes/public/apply.html`, `activate.html`.

## You own

`apps/staff/app/(public)/apply/**`, `apps/staff/app/(public)/activate/**`, `apps/staff/app/(wizard)/onboarding/**`, `apps/office/app/onboarding/**`, `supabase/functions/willo-webhook`, `supabase/functions/extract-document`, `supabase/functions/rtw-check` (relay) and `apps/office/app/api/jobs/rtw-check/**` (the gov.uk check runner, ADR-0025), `packages/domain/hmrc.ts`, `packages/domain/shareCode.ts`, `packages/domain/quiz.ts`, contract versioning.

## Rules you must encode

- No "Applied" stage: form submit → candidate created in `interview_requested` → Willo invitation (E1 by Willo). Age ≥ 18 checked on form and server. GDPR consent required. Duplicate check (email; mobile + DOB) routes to a "returning applicant" entry, never a second record; the applicant always sees the ordinary confirmation (§2.12).
- Willo webhook moves cards by itself; the manager decides inside Willo; system sends E2 on reject and E3 (activation) on accept; at accept the manager picks role qualification(s).
- Share code: exactly 9 alphanumerics starting with W, case-insensitive, spaces stripped; validate before any gov.uk call. DOB mandatory in every branch. Document sets per branch exactly as §2.5; NI evidence list as §2.5 point 7; PDF/JPG/PNG/HEIC ≤ 10 MB.
- AI (Gemini behind `DocumentExtractor`) pre-fills expiry / term dates / completion date and a confidence; it never verifies; low confidence → `needs_manual_review`. Term-date letter expires 31 Dec regardless of printed dates (§4.2); the manager can "+ Add period".
- Criminal declaration on step 4: No → auto-verified on submit; Yes → Verify/Reject like a document. Quiz locked until every document (and a Yes declaration) is verified; 80% pass, 3 attempts, third failure → `rejected` + E4 + the terminal screen with THC's exact copy.
- HMRC: three sequential Yes/No questions derive A/B/C (worker never sees the letter); student loan No/Plan 1/2/4 + separate Postgraduate tick; NI optional, masked and locked once entered (E6 on entry); declaration tick mandatory; no P45 upload.
- Two references mandatory (no relatives; tutors/coaches accepted), phone AND email, no verification step. Bank details editable later (E5).
- Contract: versioned text, "I agree" tick = signature with timestamp shown in UK time; includes the ongoing duty to disclose convictions. Signing → status `compliant`, Employee ID generated once (kept across resets).
- Reset to candidate: status back to `interview_requested`, evidence marked `superseded` (kept read-only), Employee ID and history retained, new Willo interview.

## Definition of done

- Appendix A journey passes as a Playwright test on seed data with a mocked Willo and mocked extractor.
- Every push/email uses `packages/notifications` keys (E1–E4, N8).
- Screens match the wireframes state by state; hand off to `qa-reviewer`.
