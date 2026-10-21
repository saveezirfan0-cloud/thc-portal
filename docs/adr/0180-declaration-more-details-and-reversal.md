# ADR-0180 · A criminal declaration: Ask for more details, Update your declaration, Reverse rejection — decided only by named office users

**Status:** Accepted · 22.10.2026 · **Asked by:** THC (Sam and Richard), 21.10.2026 and 22.10.2026 · **Builds on:** ADR-0031 (the worker reads declarations through definer RPCs only), ADR-0039 (a declaration is never edited), ADR-0014, ADR-0056 / ADR-0060 (office roles; the viewer writes nothing), ADR-0163 (definers pinned by name) · **Departs from:** §4.1 / §10.7 ("[Verify] / [Reject]" are the only review actions) and §10.1 case 2 is unchanged

`supabase/migrations/20261022170000_declaration_details_requested_status.sql`,
`20261022170100_declaration_more_details.sql`, `20261022170200_criminal_records_reviewers.sql` ·
pgTAP `915_declaration_more_details` (and `892`, `856`, `390` follow) ·
`packages/domain/src/state.ts` (`DECLARATION_REVIEW_TRANSITIONS`), `packages/domain/src/declaration.ts` ·
`packages/notifications` (DR1) · `apps/office/app/compliance/DeclarationFollowUp.tsx`,
`declarationActions.ts`, `declarationData.ts`, `declarationLines.ts`, `useCriminalRecordsReviewer.ts` ·
`apps/office/app/users/CriminalRecordsToggle.tsx`, `criminalRecordsActions.ts` ·
`apps/staff/app/documents/_components/UpdateDeclarationForm.tsx`, `declaration*.ts`, `declare/page.tsx`,
`apps/staff/app/onboarding/_components/ReviewHub.tsx`

## Context

The office asked: when a Yes declaration's details are not enough, is it best to reject it and
ask for full details? And if Sam and Richard decide the person can still work, can the
rejection be overturned? Then (22.10): only named people — today Sam and Richard — may decide a
criminal declaration; and a real case, a worker who is already staff whose latest declaration
(from onboarding) is rejected.

What existed: Verify and Reject on a pending Yes, both refusing anything not pending
(`not_pending`). Reject was the only way to say "not enough", and a rejected declaration could
not be answered — the candidate's wizard was already submitted (`already_submitted`) and the
paused screen showed only "Rejected", so they sat behind `conviction_rejected`; in employment a
rejection is a manual hold and `declare_my_conviction` refuses one.

## Decision

### 1 · Ask for more details (office, on a pending Yes)

A third outcome of a pending review, beside Verify and Reject, wherever those appear (Needs
review, `/staff/:id` Documents, `/onboarding/:id`). A required message to the worker (≤ 1,000
characters). `compliance_request_declaration_details()` closes the declaration as
**`details_requested`** — a new value of the shared `review_status` enum (its own migration,
because `add value` cannot be used in the transaction that adds it; `compliance_docs` is
constrained never to take it) — stamps the reviewer, keeps the message in
`criminal_declarations.worker_message`, queues **DR1** (`DR1:declaration:<id>`, once per
declaration), and audits `declaration.details_requested` (without the message).

Why a status rather than a flag: every reader that already asks "is it pending?" — the queue,
Verify and Reject's refusals — keeps meaning what it says. What had to change is the one reader
that must keep blocking: `compliance_blockers()` (restated from its plan-once plpgsql body,
ADR-0166) treats `details_requested` as it treats `pending` (`conviction_unreviewed`), so the
quiz gate holds and `compliance_daily` cannot lift a conviction-review block while the office
waits. In employment the conviction-review block stays exactly as it was.

DR1: "More detail needed" · "We need a bit more detail about your declaration — {message}" ·
button **Update declaration** · `/onboarding` for a candidate, `/documents/declare` for a worker.
The second push in the register with a button (N8 is the other); the template test says so.

### 2 · Update your declaration (worker)

`my_declaration_update()` (definer, the caller only) returns the latest declaration's status,
the office's message when it asked, `canUpdate` and `pausesShifts` — never the details, the
date or `review_note`. `update_my_declaration(details, date)` inserts a NEW pending declaration
(`replaces_declaration_id` → the old one) and sets the old one `superseded`; the old row's
content and review are never touched (§1.5). Same validation as the original declaration.

Who may answer is decided by where the person is **now**, whichever source the declaration had
(`declaration_update_allowed()`, mirrored by `canUpdateDeclaration()`): latest Yes is
`details_requested` or `rejected`, and the person is a candidate at the documents stage, a
compliant worker, or a worker locked to Documents (blocked for a document or for the review).
Never a manual hold — §10.1 case 2 has nothing behind it for the worker, and in employment that
is what a Reject makes; the office asks for more details instead when it wants an answer from
the app, or reverses the rejection.

The new row's source is `onboarding` for a candidate (the onboarding screen reads those) and
`in_employment` for a worker. A **compliant** worker's update pauses them exactly as §10.7
pauses any declaration from the app — blocked "Criminal conviction declared — under review",
future bookings released, invitations and applications withdrawn, E9 to the office without the
text — because a pending declaration on a compliant worker would otherwise lock their app and
refuse their check-in (`conviction_unreviewed`) while leaving them bookable. The form says so
and asks first, with the real shift count. A worker already blocked keeps their block; a
candidate's gate now waits on the new pending row instead of `conviction_rejected`.

Where it shows: the Documents tab's declaration row ("The office needs more detail: “…”" /
"Not accepted as it was — please update it with the full details", **Update your
declaration** → `/documents/declare`, which then shows the update form instead of the declare
form); and first on the paused onboarding screen, which is where both N8 (a rejected onboarding
Yes, unchanged) and DR1 land.

### 3 · Reverse rejection (office, on the latest rejected Yes)

`compliance_reverse_declaration_rejection(id, note)`: note required; only from `rejected`, only
the latest (a superseded one has been answered). The review fields become the reversal's — who
reversed it, when, and the note — so every existing "Verified by …" line stays true; the
rejection's reason is kept in `reversed_rejection_reason`, `reversed_at` marks it, and the audit
row `declaration.rejection_reversed` carries who rejected it, when and why. The general
`not_pending` refusal is not loosened.

- Onboarding: the flip to verified clears `conviction_rejected` and `onboarding_evidence_changed()`
  runs `onboarding_advance_if_ready()`, so a candidate with nothing else outstanding moves on to
  the quiz (E12).
- A worker (either source): if the block on them is the manual one the rejection made (manual,
  with exactly the rejection's reason) it goes back to being the review's block and the flip
  runs the ordinary re-check — unblocked and N15 if nothing else is wrong, otherwise left
  blocked on what is (N15 when that lifts). A manual block a manager added for anything else
  stays. A compliant worker with a rejected onboarding declaration (the real case) is simply
  verified.

### 4 · Only named office users decide (22.10.2026)

`profiles.reviews_criminal_records` — a per-login permission beside `office_role`, set by an
owner on `/users` (**Allow / Stop criminal record reviews**, `admin_set_criminal_records_reviewer`,
audited `account.criminal_records_granted` / `_revoked`; never on a viewer, who changes
nothing). `can_review_criminal_records()`: a named login that may write — or, while **no
working, writing** office login is named, an owner, so nothing locks up at release (and nothing
locks up when the only named login is switched off). `assert_criminal_records_reviewer()` is
called by Verify, Reject (`compliance_verify_declaration` / `compliance_reject_declaration`,
restated from their latest bodies with one line added; the onboarding wrappers call them), Ask
for more details and Reverse rejection. Everyone else sees the declaration read-only with "Only
office users allowed to review criminal records can decide this." (the screens ask
`can_review_criminal_records()`; the database refuses regardless).

Who may **read** the details is unchanged (every office login, ADR-0031). Limiting that to the
named reviewers is possible — an owner-rights view or a column revoke on `details` /
`conviction_date`, as ADR-0031's option 1 describes — but it reaches the queue view and three
office data files, and THC did not ask for it here.

### 5 · Every state change in one place

`DECLARATION_REVIEW_TRANSITIONS` in `packages/domain/src/state.ts` and
`declaration_review_transitions()` in SQL list the same edges (a test reads the migration):
`pending → verified | rejected | details_requested`, `rejected → verified`. The never-edited
trigger (restated from 20260930120000, every earlier refusal kept) now also refuses any other
status change (`illegal_declaration_transition`), a `details_requested` without its message, a
`rejected → verified` without the reversal stamp and a note (`reversal_note_required`), any later
write to `worker_message`, `reversed_at`, `reversed_rejection_reason` or `replaces_declaration_id`
— for every role, the table owner included. A GDPR removal clears the two new texts with the
details (a trigger on the removal itself, rather than a fifth restatement of `remove_worker()`);
an unsent DR1 goes with the person through `remove_worker()`'s outbox scrub.

## Consequences

- **`390_onboarding_documents` updated deliberately.** It flipped a rejected declaration to
  verified with a bare `update`; the guard now refuses that even from the table owner, so the
  line carries `reversed_at` and a note — what a reversal is. What it asserts (a verified
  declaration moves the candidate on) is unchanged. `441` passes unchanged.
- `892` pins seven new definers callable by `authenticated` (209), `856` and
  `notification_priorities()` carry DR1, docs/14 §4 counts them.
- Not in the wireframes: the follow-up buttons, the update form and the /users toggle. This ADR
  is the deviation record; docs/08 lists the states.
- `packages/db` types are not regenerated here; the screens call the new RPCs untyped, as the
  office and Staff App already do for the review RPCs.

## Open questions for THC

1. DR1's wording, and whether the office's message should appear on the lock screen at all (the
   dialog warns the office not to repeat what was declared).
2. A rejection in employment stays a manual hold with nothing in the app (§10.1 case 2). If THC
   wants those workers to answer from the app, the hold screen would need a link — the database
   already refuses it, deliberately.
3. Whether reading the declaration details should also be limited to the named reviewers (§4).

## Update — QA review of ab61e6d7 (`20261022170300_declaration_review_hardening.sql`)

1. **No direct write (B1).** 0001's `admin_all` on `criminal_declarations` is FOR ALL, and
   Supabase grants `authenticated` table DML, so any office session — named or not — could
   PATCH `review_status` and have the triggers unblock a worker and push N15, past every check
   in §4. Nothing in `apps/`, `packages/` or `supabase/functions/` writes the table, so the
   office now reads it (`admin_read`, select only) and INSERT / UPDATE / DELETE / TRUNCATE are
   revoked from `anon` and `authenticated`. Every write is a definer function (they run as the
   owner); the service role and migrations keep theirs. `010_rls_admin` ("admin writes
   criminal declarations") and the first block of `671` (which ran the trigger's checks as an
   office session) are updated deliberately: the office's write is now refused outright, and
   the trigger's rules are held as the table owner — the role those functions run as.
   `001_rls_guard` is unchanged (the policy is still an `admin_` one).
2. **No free text in the log (B2).** `declaration.rejection_reversed` carried the note and the
   rejection's reason — review-note text that `/activity` prints and exports and
   `remove_worker()` does not scrub. It now carries `rejectedBy`, `rejectedAt`, `reversedBy`,
   `reversedAt`, `liftedHold`; the texts stay on the row, which a removal clears. The other rows
   this ADR writes never carried free text. The removal trigger also strips `note`,
   `rejectionReason`, `reason`, `message`, `details` from a declaration's audit rows.
3. **A reversal lifts only the hold it can prove (B3).** `criminal_declaration_reviewed()` now
   stamps `rejection_hold_at` on the declaration when its rejection actually turns the review
   block into a manual one. A reversal lifts a manual block only for an **in-employment**
   rejection, only with that stamp, only if the block is still manual with that reason, and only
   if nobody has blocked, unblocked or reset the worker since (`block_manual` / `unblock` /
   `reset_to_candidate` in the audit log). It never makes the block `conviction_review`: what
   can still hold them is a document, so it becomes an automatic document block and the flip's
   ordinary re-check (`unblock_if_compliant`, N15) lifts it when nothing does. A manager's own
   block — same words or not — stays.
4. **Ask only someone who can answer (N1).** `compliance_request_declaration_details()` refuses
   `cannot_answer_from_app` (a manual hold, a candidate past documents, a leaver); the dialog
   reads "This person can’t answer from the app right now — call them.", and the button is not
   drawn for a manual hold.
5. **Copy by where the person is now (N2)**, not by the declaration's source.
6. **`/users` keeps the fallback honest (N3).** Only a working, writing holder counts (as
   `can_review_criminal_records()`); a switched-off login cannot be named (`login_disabled`)
   and reads "switched off, not counted"; a login demoted to viewer loses the permission,
   audited `account.criminal_records_revoked` with `because: became_viewer` — owners then
   decide again.
7. **The office hears of an answer (N5).** Every in-employment update sends E9 — the existing
   office email, without the text, listing what was released ("(none)" for a worker already
   paused). A candidate's update goes to Needs review only, as their first declaration did;
   whether THC wants an email for that too is an open question.
