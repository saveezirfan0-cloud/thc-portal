# ADR-0070 · Date of birth corrections — from the Back Office and from the Staff App

**Status:** Accepted, 28.09.2026 (product owner) · **Amends:** [ADR-0045](0045-request-a-change-name-and-photo.md) (Request a change gains `dob`), scope §10.1's locked-field list, [ADR-0056](0056-office-roles.md) (a fifth permission, `identity`), [ADR-0068](0068-searchable-dial-code-and-typed-dob.md) (its date-typing helpers move to `packages/domain`) · **Code:** migration `20261001210000_date_of_birth_corrections.sql`; pgTAP `717` (with `change_request_vectors.psql`); `packages/domain/src/dob.ts`; `apps/office/app/_components/DobCorrection.tsx`, `_lib/dobCorrection*.ts`; `apps/staff/app/documents/_components/UploadForm.tsx`; `apps/staff/app/profile/details/request/DobRequestForm.tsx`

## Context

After onboarding, nobody could change a worker's date of birth. The office showed it
read-only (`/staff/:id` Overview "Contacts & identity", `/onboarding/:id`). Profile
details in the Staff App did not show it. Request a change (ADR-0045) had no date of
birth. The Documents hub's **New share code** form used the date on file and said "If
your date of birth on file is wrong, tell the office", which led nowhere. Only a candidate
re-entering a rejected share code could change it (`onboarding_reenter_share_code`,
ShareCodeSheet).

A live test hit this. A wrong date of birth made gov.uk answer "not found", and there was
no way to fix it.

The date matters:

- gov.uk matches a share code **and** a date of birth (the automated check, ADR-0025,
  ADR-0041).
- An under-18 cannot sign the 48-hour opt-out (`canSignOptOut`, RULE-20).
- The HMRC New Starter report carries it (§9.9).
- `/apply` dedupes returning applicants on phone + date of birth (§2.12).

**The product owner decided on 28.09.2026** that the date of birth must be correctable
from the Back Office and from the Staff App. Every change must be deliberate and audited.

## Decision

### One rule, one effect

- **The rule.** `dobChangeProblem()` in `packages/domain/src/dob.ts` and
  `dob_change_problem()` in SQL apply `/apply`'s rule (`submit_application`), in its
  order:
  - `dob_required` — no date;
  - `dob_invalid` — in the future, or more than 100 completed years ago;
  - `under_18` — under 18, judged in UK time;
  - `unchanged` — the date already on file. A no-op is refused, so the audit trail only
    records real changes.

  Both are held to the `dobs` group of `changeRequest.vectors.json` (Vitest `dob.test.ts`,
  pgTAP `717` B).
- **The effect.** `staff_dob_apply()` is internal: no API role may execute it (the
  service role keeps the default grant every function has). It:
  1. writes `staff.dob`;
  2. writes one `audit_log` row with the dates under the `dob` key (`{from, to}`) and the
     actor's name (`actorName`, ADR-0055). The dates go under `dob` only because
     `remove_worker()`'s §1.7 scrub already strips `dob` from every row about the worker
     (`v_pii_keys`), so the log keeps the event but not the dates. The office's free-text
     `reason` is not a key that scrub knows, and a reason can name a date, so
     `staff_removed_purge_additions()` (restated) overwrites `reason` with "Removed under
     GDPR (§1.7)" and drops any `note` on the worker's `staff.dob_corrected` and
     `staff.dob_claimed_with_share_code` rows — as it already does to a change request's
     `decision_reason`. The dialog's hint says not to type the date there;
  3. closes any **other** pending date-of-birth change request: withdrawn when it asked for
     exactly this date (no RC3 — the date is theirs), otherwise rejected with the reason
     the worker reads ("The office has since set your date of birth to dd.mm.yyyy.") and
     RC3;
  4. for the office's routes, clears a date a worker entered with a pending share code
     (`claimed_dob`, route 2) — the office's date wins — and re-runs the gov.uk check of a
     **pending** share code while `rtw_check_enabled()`:

     | Check state | What happens | `rtwCheck` |
     |---|---|---|
     | None open | `rtw_check_enqueue(doc, actor)` adds a new row. `rtw_checks_latest_v` takes the newest row per document, so a finished `needs_review` check is superseded (717 E) | `queued` |
     | Still **queued** | Left alone: the runner reads the date when it claims the check (717 E) | `queued` |
     | Already **running** | Asks gov.uk with the old date, so it is reported. The office presses "Run check again" once it lands | `running` |
     | Check switched off | Nothing to queue; checked by hand | `off` |
     | No pending share code | Nothing to re-run | `none` |

### Route 1 · the Back Office corrects it — owners and managers

- **Where.** "Correct" on the Date of birth row of `/staff/:id` Overview ("Contacts &
  identity") and beside DOB (or Age, before Documents) in the `/onboarding/:id` header.
- **The dialog.**
  - The date on file.
  - **New date of birth (UK date)**: a civil date, judged 18+ against today in
    Europe/London (§1.8). It is typed `DD/MM/YYYY` with the slashes drawn, as `/apply`
    types it (ADR-0068's helpers, now in `packages/domain`).
  - A **reason**, 10–300 characters, for the activity log.
  - Save.
- **After saving.** The row says what happened to the gov.uk check. If the new date puts
  a signed opt-out before the worker's 18th birthday, it adds a warning (see
  [Under 18](#under-18)).
- **The RPC.** `office_correct_dob(p_staff uuid, p_dob date, p_reason text) returns jsonb`:
  - SECURITY DEFINER, `search_path = public, extensions`; EXECUTE revoked from
    public/anon and granted to authenticated.
  - Called through the manager's **session**, so `auth.uid()` is the audit actor. There is
    no service-key door.
  - Refuses, in this order:
    1. `not_authorised` — not an office login;
    2. `read_only` — a viewer (`assert_not_read_only`, ADR-0060);
    3. `not_permitted` — without `office_can('identity')`;
    4. `staff_not_found`;
    5. `staff_removed` — a removed / GDPR-anonymised profile (§1.7: nothing personal is
       put back);
    6. the rule;
    7. `reason_required` / `reason_too_short` / `reason_too_long`.
  - Audited as `staff.dob_corrected` with `source: office`, `reason`, `rtwCheck` and
    `actorName`.
- **Role gating.** ADR-0056 says a new permission is a migration plus `permissions.ts`.
  `office_can()` is restated with a fifth permission, `identity`: owner yes, manager yes,
  scheduler no, viewer no. The Back Office hides "Correct" unless
  `officeCan(role, 'identity')`. The database refuses the rest whatever the screen shows.
  - Chosen over reusing `finance` + `write`. That pair happens to select owner + manager,
    but a DOB correction has nothing to do with money, and the next person to change the
    finance matrix would silently change who can correct a date of birth.

### Route 2 · the worker, with a new share code

- **The form.** The Documents hub's **New share code** form now has a **Date of birth**
  field:
  - pre-filled from the profile, as ShareCodeSheet does in onboarding;
  - `DobInput`, ADR-0068;
  - hint: "Must match the date of birth gov.uk holds for you."
- **The RPC.** `submit_share_code_with_dob(p_share_code text, p_dob date, p_file_path text
  default null) returns jsonb`, the caller's own row only (`staff_writer`). In order:
  1. `submit_document_upload()`'s eligibility (`not_eligible`).
  2. For a **changed** date: the rule, then at most `settings.rtw_check.reenter_per_day`
     (5) date changes in 24 h (`too_many_attempts`, the onboarding re-entry's cap), so the
     form is no way to try dates against a code. A refused date files nothing.
  3. `submit_document_upload('share_code_report', …)` files the code exactly as before.
     It is not restated.
  4. Only if the filing succeeded, the date is kept **on that document**, not on the
     profile: `compliance_docs.claimed_dob` (new, nullable, share-code rows only), audited
     as the worker (`staff.dob_claimed_with_share_code`, `source: staff_app`, the
     document id, the dates under `dob`).

  The insert trigger queues the gov.uk check. `rtw_check_claim()` (restated) asks gov.uk
  with `coalesce(claimed_dob, staff.dob)`.
- **When the profile takes the date.** Only when an admin **verifies** that document. A
  trigger on `review_status → verified` (`compliance_docs_claimed_dob_verified`) calls
  `staff_dob_apply()` — audited `staff.dob_corrected`, `source: share_code_verified`, the
  reviewer as actor, `optOutSignedUnder18` flagged — whichever verify path set it, so no
  verify function is restated. The rule is checked again at that moment; an unchanged
  date writes nothing. A not-found, a rejected or a superseded document never changes
  `staff.dob`.
- **Who may write `claimed_dob`.** Definer code only. `compliance_docs_claimed_dob_guard`
  refuses it from any API session (`anon`, `authenticated`), because the office's
  `admin_all` policy would otherwise let any Back Office login — a scheduler included —
  set a date that Verify then copies. §1.7 removal clears it on every row, held
  right-to-work evidence included.
- **What the office sees.** `share_code_dob_claims_v` (security invoker) lists each pending
  share code whose worker entered a different date. `/compliance`, `/staff/:id` Documents
  and `/onboarding/:id` show, beside the gov.uk check, "Date of birth entered with this
  code: 15.06.1995 (profile: 31.12.1994)" and that Verify also changes the profile's date
  — plus "ask them to sign it again" when that date would put a signed 48-hour opt-out
  before their 18th birthday. When it happens, the flag is also on the audit row and in
  the activity log.
- **Why self-serve is safe now.** The worker's date is a claim, not a change: it is only
  what gov.uk is asked with. gov.uk checks the code and date as a pair, and nothing
  reaches the profile until an admin compares the result and presses Verify (ADR-0041)
  with the two dates in front of them. A worker cannot use the form to overwrite an
  office correction; an office correction clears a pending claim.
- **Copy.**
  - "What happens next" now says the office confirms the result. Before, it said "If
    gov.uk confirms your right to work, it is verified", which has not been true since
    ADR-0041.
  - "If your date of birth on file is wrong, tell the office" is gone. Instead: "The date
    above is used for this check, and saved to your profile once the office verifies it."
  - With the check off, the share-code form gets its own "The office checks it with
    gov.uk, with the date of birth above".
  - The Documents page flash `share` now points at the row below as the source of truth.

### Route 3 · Request a change → Date of birth

- **What the worker sees.**
  - Profile details shows **Date of birth** as a locked row: "Checked with gov.uk
    alongside your share code — corrections go through the office."
  - **Request a change** opens `/profile/details/request?kind=dob`, which asks for:
    - a typed date;
    - **evidence**, required as for a name (a passport or birth certificate, in
      `documents/<id>/change-requests/`);
    - an optional note.
  - The pending status line, Withdraw, and "Not changed: {reason}" + Request again work as
    for a name.
  - `staff_me()` returns `dob`.
- **Data.**
  - `profile_change_requests.kind` gains `'dob'`.
  - `proposed_dob date` is added, with two CHECKs:
    - `profile_change_requests_dob_shape`: a dob row has its date and evidence, and no
      name or photo;
    - `profile_change_requests_dob_only`: only a dob row has a date.
  - The state guard treats `proposed_dob` as immutable, like the other proposed values.
  - GDPR removal sets it to the `1900-01-01` sentinel, as `staff.dob` is set.
- **The worker's door.** `request_dob_change(p_dob date, p_evidence_path text, p_note text
  default null)` applies `request_profile_change()`'s gates in its order:
  - compliant, or blocked on documents / conviction review, but not a manual hold;
  - one pending request;
  - three a day;
  - a note of 500 characters at most.

  Then it applies the rule, requires the evidence (`evidence_upload_problem`), and queues
  RC1. `request_profile_change()` is **not** restated and still refuses `'dob'` as
  `bad_kind`.
- **The office decides** in its existing queue (`/staff/requests`, and the `/staff/:id`
  banner): now → requested, the evidence, and the tick "I've checked the evidence shows
  this date of birth". `office_decide_profile_change()` is restated with a dob branch:
  - owners and managers only for a dob request, either way (`not_permitted`; a viewer
    gets `read_only`);
  - the rule is checked again against the profile **now**;
  - it then has route 1's effect (`staff.dob_corrected`, `source: change_request`,
    `requestId`) and sends RC2.
  - A scheduler sees the request and "Owners and managers decide a date of birth", with no
    buttons.
- **Notifications** (`packages/notifications`): RC1–RC3 are reused unchanged, with
  `{field}` = "date of birth":
  - "{name} has asked the office to change their date of birth.";
  - "Your date of birth has been updated.";
  - "We couldn't update your date of birth: {reason}".

  RC4 ("Name changed", to payroll) stays name-only. The register needed no DOB variant,
  so there is no new copy. Only the trigger descriptions and the office inbox label
  ("Profile change requested") were updated.

### Under 18

**Under 18 is refused, never stored.** Every route refuses an under-18 date out loud
(`under_18`), as `/apply` does. The `staff.age_18` CHECK (20260923040000) would refuse the
row anyway. So no worker can hold a signed opt-out while under 18 **today**.

A correction can still move the 18th birthday **past the day an opt-out was signed**.
That case is **flagged, not refused, and not revoked**:

- **Flagged.** `optOutSignedUnder18` is set in the RPC result and on the audit row. The
  office dialog turns it into "ask them to sign it again from the app".
- **Not refused.** The true date must be recordable.
- **Not revoked.** Cancelling an opt-out is the worker's act, with a notice period
  (`cancel_wtr_optout`).
- **The cap is already right.** The weekly cap is calculated, never stored. `weekly_cap()`
  already voids the opt-out for any week the worker was under 18 (`cap_under_18`, from
  the date of birth), so it follows the corrected date by itself.

### Scope §10.1, amended

§10.1 locks the name and the avatar ("corrections go through the office"). It is amended:

- **The date of birth** is also locked on Profile details, and corrected through the
  office: Request a change, or the office's own "Correct".
- It can also be corrected **by the worker, together with a new share code**, on the
  Documents hub, because gov.uk checks the pair.

## Consequences

- **Tests.**
  - pgTAP `717` (118 assertions) covers:
    - shape and grants;
    - the vectors;
    - owner/manager allowed; scheduler, viewer, worker, client and anon refused;
    - every refusal, including a removed profile;
    - staff.dob and the audit row;
    - the re-queue (queued, superseding needs_review in `rtw_checks_latest_v`), a check
      still queued left alone, running, off and none;
    - the opt-out flag;
    - the share-code path: the date claimed on the document, never on the profile;
      `rtw_check_claim()` sends the claimed date; reject leaves `staff.dob`; verify copies
      it (`share_code_verified`); an office correction clears a pending claim; the office's
      view; nobody writes `claimed_dob` directly; the cap; manual hold; anon, a client and
      an office session refused;
    - the dob change request (refusals, RC1 keys, the worker's read, scheduler/viewer
      refused, a worker `not_authorised`, manager approves → dob, RC2, audit, no RC4,
      reject → RC3; closed as withdrawn / rejected when another route sets the date);
    - §1.7 removal (proposed date → 1900-01-01, snapshot / reason / note cleared, RC1's
      dates and note gone, no audit row keeps the dates or the office's reason, no
      `claimed_dob` left).
  - The `dobs` vectors carry a leap-day pair with their own `today` (born 29.02.2008:
    under 18 on 28.02.2026, 18 on 01.03.2026).
  - Every existing file passes unchanged (700, 701, 702, 715, 716, 741, 750, 600, 676,
    430, 230, 670 …). Only 002 6–7 fail locally, as they always do (ADR-0010).
  - Vitest:
    - `packages/domain` `dob.test.ts`, and `changeRequest.test.ts` (which now reads the
      kind CHECK from the newest migration that adds it);
    - office: `_components/__tests__/dob-correction.test.tsx`,
      `staff/[id]/__tests__/dobRow.test.tsx`, the requests model / screen / actions
      tests, `onboarding/__tests__/candidate.test.tsx`, `activity/__tests__/view-model`
      ("Date of birth: from → to");
    - staff: `documents/__tests__/share-code-dob.test.tsx`,
      `profile/__tests__/request-change.test.tsx`.
- **Restated from their latest definitions, every line carried:**
  - `office_can` (20261001201100)
  - `profile_change_requests_state_guard` (20260930200100)
  - `staff_removed_purge_additions` (20260930205200)
  - `office_decide_profile_change` (20260930206000)
  - `staff_me` (20260928110700)
  - `rtw_check_claim` (20260928100000)
  - `my_profile_change_requests` (20260930202200)
  - `office_profile_change_requests` (20260930203000)

  The last two gained appended columns (`proposed_dob`; `current_dob`, `proposed_dob`), so
  they are dropped and created, with grants re-issued.
- **Generated types.** `packages/db/src/types.generated.ts`: `proposed_dob` hand-added;
  regenerate after deploy.
- **The activity log.** "Corrected date of birth" and "Entered a different date of birth
  with a share code". A `{from, to}` pair under any key reads "Key: from → to", dates as
  dd.mm.yyyy.
- **An approved date-of-birth request** says what happened, as "Correct" does: the gov.uk
  re-check and the opt-out warning, above the queue or the banner once the request has
  left it.

### Deviations from the wireframes

- `wireframes/backoffice/staff-profile.html` and `candidate.html` show the date of birth
  without "Correct".
- `wireframes/staff/documents.html` has no date of birth on the share-code form.
- `wireframes/staff/request-change.html` has no date-of-birth kind. The form copies the
  name form's layout: Now (locked), the typed date, evidence, note, Send.
- `wireframes/backoffice/change-requests.html` has no date-of-birth card. It reuses the
  name card: now → requested, evidence, and its own tick.
- The office dialog is new UI in the Emergency contact dialog's shape (Modal, fields,
  Note).
- The typed date uses slashes (`DD/MM/YYYY`, as `/apply`), while the office prints dates
  with dots. Dots are accepted while typing.

### Open for THC

- **Payroll.** Does payroll need an email when a date of birth changes after the New
  Starter report has gone? Today only the activity log records it. RC4 is name-only, and
  no new register entry was invented.
- **Evidence.** Should a date-of-birth request's evidence also be attached to the
  worker's right-to-work record? Today it stays with the request, as a name's does.
