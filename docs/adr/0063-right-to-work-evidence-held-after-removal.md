# ADR-0063 · A GDPR removal holds right-to-work evidence for employment + 2 years

**Status:** Accepted, 28.09.2026 (product owner; THC's right-to-work adviser has signed off the gov.uk check) · **Amends:** [ADR-0019](0019-completion-letter-retention-and-rota-guard.md) §1 (only the completion letter was held) and scope §1.7's removal rule ("contacts / documents / photo wiped") · **Settles:** ADR-0019 §1's "Confirm with THC" and ADR-0041's "To confirm with THC" · **Code:** migration `20261001205000_rtw_evidence_held_after_removal.sql` (`remove_worker()`, `rtw_daily()`); pgTAP `678` (and `230`, `250`, `676` updated); the Remove dialog in `apps/office/app/staff/[id]/ProfileScreen.tsx`; `apps/staff/app/privacy/page.tsx`

## Context

§1.7 wipes a removed worker's documents. ADR-0019 made one exception: an employed worker's
university completion letter is held for the length of employment plus two years, because
the completion-letter requirement asks for it "in line with right-to-work evidence
retention". It left the wider question open: should the same hold apply to the
right-to-work evidence itself?

The Home Office employer guidance answers it. An employer must keep copies of its
right-to-work checks for the length of employment and two years after it ends. The
statutory excuse against a civil penalty for illegal working depends on producing them,
so deleting them early loses it. UK GDPR Art. 17(3)(b) lets a legal obligation override an
erasure request, which is the reasoning ADR-0019 already used.

Until now `remove_worker()` deleted passports, visas, status documents and share-code
reports, and every `rtw_checks` row with its gov.uk report and photo, on the day of the
removal.

## Decision

**The hold.** When someone who was employed is removed (a contract signature or an
Employee ID), the right-to-work evidence **that was relied on** is held exactly like the
completion letter:

- `retain_until` is set to the day employment ended (`left_at`, or the removal itself if
  they never left, as a UK date) plus two years;
- `rtw_daily()` purges it on that date.

Someone never employed has nothing to retain against, and their evidence is wiped as before.

**What counts as right-to-work evidence (§2.5):**

| `doc_type` | Held because |
|---|---|
| `passport` | branches 1–5; for UK/Irish citizens, the whole check |
| `national_id` | branch 2 (EU/EEA: passport **or** ID card) |
| `birth_certificate` | branch 1's other route: List A, a UK birth certificate with an official NI document |
| `ni_evidence` | **only** as the second half of that pair, when a relied-on birth certificate is held with it. On its own it is payroll evidence (§2.5 pt 7) and is deleted |
| `visa_document`, `status_document` | branches 3 and 5 |
| `share_code_report` | branches 2–5: the gov.uk online check. Its `gov_report_path` and its finished `rtw_checks` (report and photo) are held with it |
| `university_term_dates_letter` | branch 4. The guidance also requires an employer of a student with term-time work limits to obtain, copy and **keep** their term and vacation dates. They are the evidence that a 48-hour week fell in a vacation (RULE-20), the same reasoning ADR-0019 used for the completion letter |

**Not held:** criminal declarations (scrubbed as before, §10.7), the 48-hour opt-out copy
(Working Time Regulations, not immigration), references, bank details, the HMRC checklist,
the selfie.

**Only what was relied on.** A row is held if it was ever verified:

- `review_status = 'verified'`, including one whose expiry has passed (expiry is derived,
  not a status);
- or `superseded` with `reviewed_at` set and no `rejection_reason`: a verified row that
  Reset to candidate later superseded.

Pending and rejected uploads, and rows superseded before any decision, were never the basis
of anything. They are deleted as before, and their files queued.

**The completion letter is unchanged.** Every completion letter row of an employed worker
is held, whatever its status, and its columns are not touched.

**What a held row keeps.** It keeps the file, the gov.uk report, the dates the office
confirmed, who verified it and when: what the Home Office asks to see. It loses
`ai_extracted` (the extraction provider's raw read, a second copy of the scan) and
`share_code` (a 90-day key for running a new check, not a record of the one that was run).

**The checks.** A finished `rtw_checks` row on a held document stays. It keeps:

- status, outcome, source and recommendation;
- the result, including the name gov.uk returned, the conditions and the date. These are
  the evidence of the check;
- the report, the photo the admin compared (ADR-0041), and when and by whom it was
  decided.

Its free text is cleared: `review_reason`, `worker_reason`, `suggested_reason` and `error`
can quote the worker's name and are not evidence.

A check still queued or running on a held document is deleted: it never produced a result.
Checks on deleted documents go with them, as before. Their delete trigger queues each
report and photo.

**Storage.** `retained_storage_paths()` (20260930150000) already names every held file:
document, gov.uk report, and the checks' reports and photos. So `gdpr-purge`'s sweep of the
worker's folder leaves them. ADR-0041 wrote that part for this case.

**The purge.** When `retain_until` passes, `rtw_daily()` deletes the row and queues its
file **and** its gov.uk report (it used to queue only the file, which was enough for a
completion letter). The delete cascades to the checks, whose trigger queues their reports
and photos. A right-to-work document's purge is written to the audit trail as
`rtw.purged`, which `compliance_evidence_audit_v` exports. The completion letter's own
trigger still writes `completion_letter.purged`.

## Consequences

- **A removal of an employed worker no longer wipes every document.** Worker-facing and
  office-facing copy say so:
  - `/privacy` names what is held and for how long;
  - the Remove dialog on the staff profile lists it under what is retained.

  This deviates from `wireframes/backoffice/staff-profile.html`'s Remove modal ("documents
  (RTW / HMRC / bank details) … wiped"). The screen follows this ADR.
- The removal's return value keeps its shape. `documentsHeld` now counts the held
  right-to-work rows as well.
- A removed worker's held documents and checks are still visible to admins (the tables are
  admin-read) until the purge. They show under "Deleted account #id". Nothing else reads
  them: `compliance_daily()` and `rtw_daily()`'s alerts skip removed workers, and the login
  is gone.
- **The judgement calls to revisit** if THC's adviser reads the guidance differently: the
  term dates letter is held, and NI evidence is held only with a birth certificate. Each is
  one line in `remove_worker()`'s hold statement.
- `report_sends`' stored CSVs remain the open retention question they were in ADR-0039. This
  ADR does not touch them.
