# ADR-0037 · RULE-20 by the whole week, the conditions a reviewer confirms, and what the office adds to a profile

Status: accepted · 25.09.2026 · WP-F fix round (audit 25.09 D31, D32, D35, D36, D42, D43,
D44, D47, AC3, AC7, item 8) · 20260929150000 – 20260929150500 · pgTAP 635–637

Pending THC's sign-off on §1 (the 10-hour band) and §4 (the NI check), both marked below.

## 1 · The 10-hour band below degree level (D32) — the PDF wins

Two THC documents disagree:

- `docs/scope/scope-of-work-v1.6.txt`, the **v1.5 changelog** (17.09.2026): "The in-term cap
  is 20 h for every student-visa worker; the below-degree-level 10 h variant is not applied."
- `docs/scope/university-completion-letter-requirement.pdf` §1 and §3: "Workers on a UK
  Student visa are limited to 20 hours per week during term time (10 hours if studying below
  degree level)", and the state table: "Student, term time · 20 (or 10 below degree level)".

**Decision: the PDF wins.** It is the later document (it post-dates v1.5 and is the source
CLAUDE.md already names for RULE-20), it states the Home Office condition as it is, and the
failure it avoids is a civil penalty for illegal working: a below-degree student rostered
for 20 hours has worked 10 hours more than their visa allows. The v1.5 line reads as "we are
not building it yet", not "the condition does not exist".

What that means in the system:

- `staff.below_degree_level` (20260922093100) is no longer dormant. The office sets it when
  it verifies a student's right to work or term letter — a checkbox in the Verify window on
  Compliance → Needs review and on `/staff/:id` Documents, and a checkbox on the candidate
  profile (`compliance_set_below_degree_level()`, admin only, International student only,
  audited as `rtw.conditions`).
- The automated gov.uk check (ADR-0025) already reads a term-time limit; a 10-hour limit
  pre-ticks the box. It is never set by itself: the reviewer confirms it.
- The cap stays calculated (RULE-20): the office confirms a fact about the course, it never
  types a number of hours.

If THC decides the 10-hour band is not wanted after all, nobody ticks the box and every
student stays at 20 h; nothing else changes.

## 2 · One cap per Mon–Sun week (D35)

`weekly_cap_for()` compared `graduated_at` with the shift's own day, so a letter verified on
a Wednesday made the Monday of that week a 20-hour day and the Friday a 48-hour one. Every
other straddle in RULE-20 — term and holiday, the completion date, the end of an opt-out's
notice — takes the **lower** cap for the whole week, and the rota guard sums hours per week.

**Decision:** the verification day is a dated fact of `weekly_cap()` (`p_verified_on`,
`verifiedOn` in `cap.ts`) and is compared with the week's Monday, exactly as the completion
date is. A completion letter therefore releases 48 h from the first Monday on or after the
**later** of the verification and the course completion date (that day itself when it is a
Monday). A completion date long past lifts nothing before the Monday after the letter is
verified. `completion_effective_from()` / `completionEffectiveFrom()` tell the worker (CL2)
and the Student visa view that same Monday. The shared vectors carry the new cases, including
a completion date already in the past (the AC3 gap).

## 3 · A work or dependant visa's own hours limit (D36)

The opt-out lifts the Working Time 48, not an immigration condition. A work visa (a
supplementary-employment ceiling) or a dependant visa can carry a weekly hours limit of its
own, and nothing modelled it: with the opt-out such a worker was uncapped.

**Decision:** `staff.visa_weekly_hour_limit` (1–48, null = none), captured by the office at
the right-to-work Verify ("Weekly hours limit on the visa (if any)", pre-filled from the
automated check's parsed conditions when it read one) or on the candidate profile
(`compliance_set_visa_hour_limit()`, audited). `weekly_cap()` applies it after the Student
condition and **ahead of the opt-out**, as band `visa_limit`; the rota guard treats it as a
visa band (over it blocks, in warn mode too). It is read only on the `work_visa` and
`dependant_other` branches, and `record_right_to_work_change()` ends it when the route
changes. A right-to-work expiry still outranks it.

## 4 · The NI number is checked against its evidence (D43)

§2.5 pt 7 says the NI evidence must match the NI number. The office saw the number masked,
and a candidate usually types it at the contract step — after their documents were verified.

**Decision:** the Verify of NI evidence shows the **full** number beside it (admin only).
Verified while no number is on file, the document is flagged (`compliance_docs.ni_recheck`,
set by a row trigger so every Verify path is covered); once the number is entered it returns
to Needs review as "NI number entered after the NI evidence was verified — compare them",
with **Matches** (stamped, audited) or **Does not match** (reason required: the evidence is
rejected and N8 asks the worker to re-upload). A mismatch does not block a compliant worker
by itself; the office blocks from the profile if it has to. The number is never written into
the audit log.

## 5 · E2 only after the interview (D44), amending ADR-0017

E2 says "Thank you for taking the time to complete your interview". ADR-0017 sent it for
every rejection at the interview **stage**, including a candidate at Interview requested who
never did the interview. **Decision:** E2 needs the interview done — Interview completed, or
a Willo response on file (`willo_completed_at`); everyone else gets E2b, which ADR-0017 wrote
for exactly this ("E2 without the interview"). Neither carries the office's reason.

## 6 · N8 lands where the Re-upload is (D42)

A candidate's app is locked to the onboarding wizard, so N8's `/documents` link landed them
on a locked page. The row now names its landing (`n8_link()`: `/onboarding` for a candidate,
`/documents` for a worker) and the register accepts only those two (`deepLinkOptions`). N8
carries a **Re-upload** button where the platform draws notification buttons (the service
worker's action is display-only: tapping it opens the same link) and is tagged per document,
so a second rejection of the same document replaces the first on the device. §8's copy is
unchanged.

## 7 · What the office adds to a profile (D47, D31) and reviews there (item 8)

- **Completion letter (D47):** `office_submit_completion_letter()`, the admin variant of the
  worker's upload, from `/staff/:id` Documents and the candidate profile. It lands **pending**
  and changes no cap until Approve confirms the completion date and visa expiry (AC2). No
  CL1/CL3 (the worker did not upload; the office would be emailing itself).
- **gov.uk report (D31):** ADR-0025's automated check stores its report; the manual path
  (ADR-0018) could not. `compliance_attach_rtw_report()` attaches the PDF/JPG/PNG the office
  downloaded to a share code document without one — never replacing one already on file.
- Uploads use a one-object signed upload issued with the service key only after the caller is
  checked as the office, under a name the server chose; the RPC then judges what Storage
  recorded. A refused upload is removed only if nothing references it.
- **Verify / Reject on `/staff/:id` Documents (item 8):** the same windows and RPCs as
  Compliance → Needs review (`compliance/ReviewModals.tsx`).

## 8 · The audit export carries right-to-work changes (AC7)

`compliance_evidence_audit_v` now also exports `rtw.changed`, `rtw.verified` (the office's and
the automated check's), `rtw.conditions`, `rtw.report_attached` and the automated check's
`rtw_check.*` rows, with the route and right-to-work dates either side. Columns are appended;
the existing ones keep their names and order.

## Consequences

- Types: `staff.visa_weekly_hour_limit`, `compliance_docs.ni_recheck / ni_matched_at /
  ni_matched_by` and the new RPCs are read through narrow hand-written shapes until
  `gen:types` runs against the live project.
- `reset_to_candidate()` and `remove_worker()` do not clear `visa_weekly_hour_limit`. It is
  read only on the two visa branches and a reset's new right-to-work check sets or clears it;
  a removal wipes the branch. Worth adding to both bodies in their owners' next pass.
