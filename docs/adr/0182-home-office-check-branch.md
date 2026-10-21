# ADR-0182 · A sixth right-to-work branch: the Home Office check (Employer Checking Service)

**Status:** Accepted · 22.10.2026 · **A deliberate addition to scope v1.6 §2.5** ("Right to
Work — 5 branches"; "Document sets per branch are exactly as listed in points 1–5"), asked for
by THC on 21.10.2026 · **Amended:** 22.10.2026 (THC: the result runs six months from the date
it was approved; and after QA review — the reference from the Change dialog, N4's variant,
pasted no-break spaces, a result attached before submit, a rejected renewal; below) ·
**Renumbered:** from ADR-0177 / migrations `20261022140000`–`140100`, which main took first (#296) · **Builds on:** ADR-0018 (the right-to-work date is confirmed on
Verify), ADR-0041 (the admin decides every right-to-work result), ADR-0065 (right-to-work
evidence held after removal), ADR-0078 (the share code is the visa evidence), ADR-0163 (identity
columns leave the API roles; definers pinned by name)

`supabase/migrations/20261022190000_home_office_check_values.sql`,
`20261022190100_home_office_check_branch.sql` · pgTAP `919`, `920` (and `892`, `445`, `886`
follow) · `packages/notifications/src/templates.ts` (N4's `home_office` variant) · `packages/domain/src/homeOfficeRef.ts`, `onboarding.ts`, `documents.ts` · Staff App
step 1, step 4, the review hub and the Documents tab · Back Office candidate page, Compliance →
Needs review, the staff Documents tab and the right-to-work **Change** dialog

## Context

THC (Richard), 21.10.2026:

> On occasions we need to run an Employer Checking Service check via
> Employercheckingservice@homeoffice.gov.uk, mainly for staff members who are claiming asylum.
> We complete the online form and the results are emailed back as a PDF. We would attach this
> to their profile; they normally run for 6 months. Currently we are unable to attach files of
> this nature, which stops the person progressing as we do not have a right-to-work date or
> format.

Every branch but UK / Irish required a W-format share code at step 1, and step 4 filed a
`share_code_report` for the gov.uk check (ADR-0078). A worker whose right to work is confirmed
by the Home Office's Employer Checking Service — an asylum seeker with permission to work, a
pending application or appeal, section 3C leave — has no share code. They could never reach the
quiz, the office had nowhere to put the result, and nothing could give them a right-to-work
date.

THC, 22.10.2026: "the result is valid for 6 months from the date it was approved, and the
approval date is printed on the PDF."

## Decision

A sixth branch, `rtw_branch = 'home_office_check'`, and a sixth right-to-work document type,
`doc_type = 'home_office_check_result'`.

**The worker (Staff App).**

- Step 1 picker: **Home Office check — asylum or pending application**, "The office checks your
  right to work with the Home Office. You don't need a share code."
- No share code. A required **Home Office reference** (the Application Registration Card number
  or the Home Office application reference) is asked instead: trimmed, single spaces, upper case;
  6–30 letters, digits, spaces, `/` or `-`, with at least one digit. It is a shape check only —
  the office checks the reference itself. Every Unicode space (a no-break space pasted from a
  PDF, the narrow, thin and ideographic spaces, the BOM) reads as a space on both sides, and the
  Staff App sends the normalised value. Same rule in SQL (`is_valid_home_office_ref()`) and
  TypeScript (`isValidHomeOfficeRef()`), held to one literal by `onboarding.sql.test.ts`.
- Stored on `staff.home_office_ref`, which no API role can read (no column grant, as for
  `share_code`, ADR-0163). The office reads it through `staff_identity_v`; the worker through
  `onboarding_state()`. A trigger clears it when the branch changes, on a reset to candidate
  and on a GDPR removal.
- Step 4 asks for **no upload**. Identity is the step 3 selfie; the right-to-work evidence is
  the Home Office's result. An optional passport was considered and left out: a rejected
  optional upload would hold the quiz gate shut (`compliance_blockers()` counts every current
  document), as the graduate's term letter once did (ADR-0112).
- Submitting step 4 files a pending `home_office_check_result` row carrying the reference, with
  no file — as a share-code branch files its pending `share_code_report`. It is the office's
  place in the Needs review queue. No gov.uk check is queued. If the office has already attached
  a result (it may, before the candidate submits), submit keeps it and files nothing; saving
  step 1 again on the same branch does not supersede it.

**The office (Back Office).**

- **Attach Home Office check result** (PDF/JPG/PNG ≤ 10 MB, `<staff>/home-office-check-result/`)
  on the candidate page, the staff Documents tab and the queue row itself;
  `office_attach_home_office_check()`, `assert_reviewer()`, audited as
  `rtw.home_office_check_attached`. The first result goes onto the row step 4 filed. A later one
  — a renewal, labelled **Attach new Home Office check result** — is a fresh pending row; a
  replacement for one not yet reviewed supersedes it (kept). The office upload folder whitelist
  (`startOfficeUpload`) gains `home-office-check-result`.
- **Verify** (`compliance_verify_home_office_check()`) asks for **Date approved (on the Home Office
  result)** — required, not in the future and not before 2000 (each refused in its own words),
  stored on the row as `compliance_docs.home_office_approved_on` — and **Right to work until**,
  filled in as the date approved + six months (same day of the month, clamped to a shorter
  month's end: 31.08 → 28/29.02; `home_office_check_until()` / `homeOfficeCheckUntil()`),
  editable, with the hint "Six months from the date approved. Change it only if the result says
  otherwise." It must fall after the date approved and no more than 12 months after it
  (`until_too_far`): the office may extend, but 2099 is a typo. Then the one Verify path (`compliance_verify_document_as`): the date
  guard of ADR-0018, `rtw.verified` in the audit log, the §4.3 re-check, the §2.3 advance to the
  quiz. No "no time limit". A trigger refuses to verify a result with no file or no date
  approved, whatever path flips it — so the generic Verify cannot skip either.
- **No AI.** The extractor (ADR-0033) is built into the Staff App and runs only on the worker's
  own uploads; office uploads never pass through it. Pre-filling the date approved from the PDF
  would need the extractor moved to a shared package (or an endpoint the Back Office calls) and
  a new seam for office-side extraction — more plumbing than this feature, so it is left out
  and the date is typed.
- Once verified, the result is the worker's evidence: `staff.right_to_work_until` follows it
  (`rtw_evidence_until()` includes the type), and a renewal verified later replaces the old one,
  which stays on file.
- The **Change** dialog may move a worker onto or off the branch. Onto it, the share code
  report and any visa / status document are superseded (they are no longer the evidence, and an
  expired one would otherwise keep blocking); off it, the Home Office results are. Kept,
  read-only (§2.12). On the branch the dialog has a required **Home Office reference** (the
  worker's step 1 rule; `record_right_to_work_change(…, p_home_office_ref)`, which keeps the one
  on file when none is typed and refuses with `home_office_ref_required` when there is none).
  The same field edits it; a new reference is copied onto a result still pending and audited as
  changed (whether, never what). The profile's Right to Work row shows it, read through
  `staff_identity_v`.

**Expiry.** The usual ladder and the automatic block, except:

- the worker is **not** sent N1–N3 ("Update your …") for this document — they cannot obtain it.
  The office is told by **CL4** (60, 30 and 14 days before; route "Home Office check (Employer
  Checking Service)"). No new template was needed;
- N4 and the block on the day still happen (the worker must be told). For this document N4 is
  sent in its `home_office` variant, "Your Home Office check has expired. The office is renewing
  it; shifts are paused until then." — never "please update". Every other N4 still reads §8's
  body: a code with a body AND variants now sends the body when the row names no variant
  (`body()`, `messageFor()`), so the change is N4's alone;
- the locked tabs and the Documents alert say "Your shifts are paused." and "Your Home Office
  check has run out — the office is renewing it. There's nothing for you to upload; shifts open
  again as soon as they've recorded the new result." (no promise of a notification: none is
  sent on unblock);
- a rejected result sends no N8 ("Re-upload"); the Documents tab and the review hub say "Not
  accepted · reason · the office will be in touch";
- the worker's Documents tab never offers an upload for this type, and does not count it in
  "N documents need your attention". The hub's upload route 404s for it, and
  `submit_document_upload()` refuses it with `office_only`.

**Rules that follow from the branch.**

- Weekly cap: a non-student's (48 h; the 48-hour opt-out lifts it). `weekly_cap_for()` is
  unchanged; no visa hours limit applies.
- `can_roster_staff()` refuses a worker on this branch with **no** right-to-work date at all, as
  well as past it (it has no "no time limit").
- Quiz gate: unchanged rules — the pending result is a current, unverified document, so the quiz
  opens once the office has verified it and everything else is in. No share-code token is owed;
  `onboarding_documents_missing()` names `home_office_check_result` until the row exists.
- A renewal waiting for review, or rejected, is no `compliance_blockers()` reason while the
  result before it is verified and in date: that result is still the worker's right to work,
  they stay compliant and rosterable, and the Documents tab says "your current Home Office check
  stays valid until …".
- RLS: the office sees every result and the reference; a worker sees their own result rows
  (`staff_self_docs`), never the reference (the `share_code` column of `compliance_docs` and
  `staff.home_office_ref` are both outside their grants); a client sees neither (pgTAP `920`).

## Ordering against the other branches

The migration is numbered `20261022190100` so it applies after the other branches built
alongside it (`20261022150000`–`180000`: term dates on verify, the office copy of timesheets,
"ask for more details" on a declaration, the buffer suggestion). Its function changes are
literal patches of the LIVE definitions (`pg_get_functiondef`), each insisting on how many times
its pattern matches — so whichever of those lands first and restates a body this file patches
(for example `compliance_daily()` or `compliance_blockers()`), the patch runs on that body, and
a pattern that no longer matches stops the migration with its label instead of silently
dropping either change.

## Consequences

- THC can onboard, roster and renew workers whose right to work is confirmed by the Employer
  Checking Service, with a right-to-work date the reminders, CL4 and the per-shift hard stop all
  read.
- The six months are a default, not a rule the database imposes: the office can type another
  end date when a result says so. The Home Office's own wording is the authority.
- The reference shares the `compliance_docs.share_code` column on the result row (the typed
  right-to-work reference of that check, admin-only, nulled on removal), so the queue, the
  candidate page and the profile show it without a new column on the review views.
- `doc_expires_on()` now dates the new type from its right-to-work-until; pgTAP `886`'s
  equivalence check of the plpgsql conversion excludes it.

## Deviation from the wireframes

`wireframes/staff/onboarding-1.html`, `backoffice/candidate.html`, `backoffice/compliance.html`,
`backoffice/staff-profile.html` and `staff/documents.html` predate this branch. The screens follow
this ADR; `docs/08-screen-inventory.md` lists the new states.
