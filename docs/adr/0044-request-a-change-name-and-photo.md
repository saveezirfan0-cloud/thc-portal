# ADR-0044 · Request a change: the office's queue for what §10.1 locks

Status: proposed — awaiting THC · 25.09.2026

Addition to Scope v1.6: §10.1 ("corrections go through the office" gains an in-app
route), §9.6, §8 (RC1–RC4), §1.5 (*ProfileChangeRequest*). Plan:
`docs/19-staff-features-plan.md` §3. THC: Q13, Q14, Q21 (`docs/15-open-questions.md`).

## Context

§10.1 locks a worker's name and profile photo: the name is tied to the right-to-work
check and payroll, the photo is printed on timesheets. "Corrections go through the
office" — but there is no route for that other than an email, so a worker who marries,
corrects a misspelling or needs a new photo has nothing in the app to press, and the
office has no queue, no evidence and no record of what changed.

## Decision

1. **Requests, not edits.** The locked fields stay locked. The locked name row and the
   locked photo on `/profile/details` gain **Request a change**, which opens
   `/profile/details/request?kind=name|photo`.
   - **Name:** first and last name, an evidence upload (signed upload into the
     `documents` bucket at `<staff_id>/change-requests/<id>.<ext>`; required, Q13), and an
     optional note.
   - **Photo:** a camera capture reusing the selfie capture, uploaded to a fresh name in
     `photos/<own id>/` under the existing INSERT policy — no Storage policy change.
2. **One pending request per kind.** The worker sees a status line ("Name change
   requested · with the office", or "Not changed: {reason}" with **Request again**) and
   can withdraw while pending.
3. **The office decides in one queue**, `/staff/requests`: pending oldest first, current
   and requested side by side (signed photo URLs), evidence link, note. **Approve** — for
   a name, with "I've checked the evidence matches the right-to-work document";
   **Reject** — reason required, labelled "shown to the worker" (the
   `compliance_docs.rejection_reason` precedent). A Decided tab keeps the history.
   `/staff` gets "Change requests (N)"; `/staff/:id` Overview gets a pending-request
   banner.
4. **Approving a name** writes `staff.first_name/last_name` and `audit_log`, and queues
   RC4 to payroll. It does **not** trigger an automatic right-to-work re-check (Q13).
   **Approving a photo** repoints `photo_path` despite `photo_locked`; the old object is
   kept and purged with the prefix on GDPR removal.
5. **Nothing issued is rewritten.** Issued PDFs and payroll exports are never touched
   (§1.7; exports are never corrected retroactively).

### Data model (Phase 0)

`profile_change_requests`: `id`, `staff_id`, `kind 'name'|'photo'`, `status
'pending'|'approved'|'rejected'|'withdrawn'` (default pending),
`proposed_first_name` / `proposed_last_name` (required iff name, 1–100, trimmed),
`proposed_photo_path` (required iff photo; must start with `staff_id || '/'`),
`evidence_path` (required for name), `worker_note` ≤ 500, `previous_value jsonb`
(snapshot at decision), `created_at`, `decided_at`, `decided_by`, `applied_at`,
`decision_reason` ≤ 300 (required on reject). Partial unique `(staff_id, kind) where
status = 'pending'`. State machine: `profile_change_transitions()` +
`profile_change_requests_state_guard` — `pending → approved | rejected | withdrawn`
only; `decided_*` set on leaving pending; proposed values immutable. TS twin in
`packages/domain/src/state.ts` (`CHANGE_REQUEST_TRANSITIONS`,
`assertChangeRequestTransition()`) and `changeRequest.ts`, held to
`changeRequest.vectors.json`. RLS: one `admin_read` select policy; no staff or client
policy. Worker RPCs `request_profile_change`, `withdraw_profile_change`,
`my_profile_change_requests` (never returns `decided_by`); office RPC
`office_decide_profile_change(p_id, p_approve, p_reason)`.

### Notifications (drafts, `ADDITION_CODES`)

| Code | Channel · to | Title / subject | Timing · key |
|---|---|---|---|
| RC1 | email · admin@ | Profile change requested — {name}, Employee ID {employeeId} | on request · `RC1:request:<id>` |
| RC2 | push · worker | Profile updated | on approve · `RC2:request:<id>` |
| RC3 | push · worker | Change not made | on reject · `RC3:request:<id>` |
| RC4 | email · admin@ + thc_payroll@ (E7's recipients) | Name changed — {name}, Employee ID {employeeId} | on approving a name · `RC4:request:<id>` |

Bodies are in `docs/19` §3 and `packages/notifications`. Every send is a
`notification_outbox` row queued in the same transaction as the write.

## Consequences

- **What never changes.** The client sees nothing (no client policy, no `client_*` view
  reads the table; ADR-0004/0026). Issued PDFs and payroll exports are untouched. The
  name and photo stay locked for direct editing.
- GDPR removal anonymises proposed names and withdraws pending requests (pgTAP 702).
- pgTAP 700, 701 (vectors), 702, 715 (second pending refused, withdraw, foreign or
  missing photo path refused, name equal to current refused), 716 (approve name → RC2 +
  RC4; approve photo despite `photo_locked`; reject needs a reason and queues RC3;
  already-decided refused; non-admin refused).
- **THC to confirm** (docs/15): Q13 — must a name change trigger a fresh right-to-work
  check; Q14 — any limit on photo changes; Q21 — the RC1–RC4 wording.

## Implementation notes (Phase 1, `directory` · `20260930203000_office_staff_additions.sql`)

- `office_decide_profile_change(p_id, p_approve, p_reason)` locks the request, then
  the worker; refuses `already_decided` (approved, rejected or withdrawn),
  `request_not_found`, `reason_required` / `reason_too_long` on reject, and any
  non-admin (`not_authorised`, 42501). It is called through the manager's session,
  so `decided_by` and the audit actor are `auth.uid()`.
- `previous_value` is snapshotted on reject as well as approve, so the Decided tab
  always shows what the request was measured against. An approval stores no
  `decision_reason` — that column is what the worker is shown.
- The `audit_log` rows (`profile_change.approve` / `.reject`) carry the request id
  and kind, not the names: the request row holds the values and is anonymised on
  GDPR removal; `audit_log` is not.
- Payloads carry exactly the register's placeholders: RC2 `{change}`, RC3
  `{change, reason}`, RC4 `{name, employeeId, previousName, approvedAt}` with
  `approvedAt` in UK time (`DD Mon YYYY HH24:MI`, E8's shape). `{change}` is
  `name` or `photo`.
- The evidence tick is enforced twice: the dialog's Approve stays disabled without
  it, and the server action re-reads the request's kind and refuses a name
  approval without it (the database cannot see a tick).
- The queue and the banner read `office_profile_change_requests(p_staff, p_decided,
  p_limit)`, which names the decider. Photos are signed with the manager's session
  (`_lib/photos.ts`); the evidence is signed for 60 s after the session has read the
  request (admin_read), as `/onboarding`'s document links are.
- pgTAP 716 (and 711 A for the function shape and grants).

## Review note (25.09.2026)

The office's "I've checked the evidence matches the right-to-work document" tick is
enforced in the Back Office server action (`apps/office/app/staff/requests/actions.ts`),
not by `office_decide_profile_change`, which takes no parameter for it. Only an admin
session can call that function, and the office UI is the only caller, so this is accepted
under Q13's default. If THC answers Q13 with a mandatory right-to-work re-check, the
database function should take the attestation as an argument and refuse without it.
