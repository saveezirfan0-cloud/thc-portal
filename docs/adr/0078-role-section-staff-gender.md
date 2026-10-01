# ADR-0078 · A staff gender on a role section — Male staff only / Female staff only

**Status:** Accepted, 01.10.2026 (product owner) · **Builds on:** [ADR-0043](0043-worker-availability-hard-gate.md) (a gate overlaid on the pool), [ADR-0060](0060-viewer-role-two-step-reset-activation-links.md) (the viewer writes nothing), [ADR-0076](0076-payroll-codes-as-employee-id.md) (staff brought across from payroll) · **§3.2, §3.3, §3.4, §6, §9.6, §9.9 Tab 3, §10.4** · **Code:** migration `20261002107000_role_section_staff_gender.sql`; pgTAP `766`; `packages/domain/src/scoring.ts` (`HARD_GATES`, `showsUnderUnavailable`), `staff.ts`, `board.ts`, `state.ts`, `shift.ts`; `apps/office/app/events/_components/RoleSection.tsx` (the Staff gender select), `events/draft.ts` (`RequiredGender`, `REQUIRED_GENDER_LABEL`), `events/[id]/board-model.ts`, `staff/[id]/GenderField.tsx`

## Context

The product owner asked on 01.10.2026: *"Male staff requirement from some clients — auto assign needs to book only male staff when this request comes in. Maybe a tick box for when the roles are being built in the event."* They then asked the same for female staff.

The scope has no such requirement. Two things already exist that it can build on:

- **Gender is on file.** §9.9 Tab 3 (the HMRC New Starter report) needs it, so onboarding step 7 asks it, as HMRC's own M or F (`staff.gender`, `20260926100100`). Nothing new is asked of anyone.
- **Every path that books someone reads one pool.** `auto_assign_candidates(section)` gives each worker a gate or none. All of these re-read it:
  - the hourly rounds, the first round and the 12:05 refills
  - same-day escalation
  - `invite_worker` (manual invites too)
  - `accept_invite`, `apply_to_shift` and `accept_application`
  - Radar (`staff_open_shifts`)
  - the shift-offer pushes and takes

## Decision

### 1 · A "Staff gender" choice per role section

`shift_requirements.required_gender text check (required_gender in ('M', 'F'))`, null by default. The Shift Builder shows a **Staff gender** select on every role section, with three options: *Any*, *Male staff only* or *Female staff only*. A single column rather than two tick boxes means a section can never ask for both.

A section with a gender carries a *Male staff only* or *Female staff only* pill, in the Shift Builder and on the event board. Otherwise it behaves like this:

- **Duplicate keeps it**, because it is the client's ask for the role, not a decision about one day's people.
- **It re-confirms nobody**, so it is a silent field (`required_gender` in `SILENT_FIELDS`).
- **It is not under the §3.2 edit lock**, the same as the Auto-Assign switch: it steers who is invited next, not the shift as booked.

### 2 · Three hard gates, straight after `wrong_role`

| Section | `staff.gender` | Gate | Event board |
|---|---|---|---|
| M | `M` | none | in the pool as usual |
| M | `F` | `male_only` | **no row**, like `wrong_role` |
| F | `F` | none | in the pool as usual |
| F | `M` | `female_only` | **no row**, like `wrong_role` |
| M or F | null | `gender_not_recorded` | under Unavailable → *Gender not recorded*, so the office can record it |

Listing everyone of the other gender under Unavailable would bury the section, for the same reason `wrong_role` produces no row.

This is a gate, not a score. §6's five weights are untouched. It sits straight after `wrong_role` because, like that gate, it is about what the section asks for and not the worker's week. So a blocked worker of the other gender reads `male_only` or `female_only`, while a blocked worker of the right gender still reads `blocked`.

**No gender on file counts as "does not match".** Nobody can be shown to match without a record. Two groups have none:

- staff brought across from payroll (ADR-0076);
- anyone onboarded before step 7 asked.

The board lists them, and the office records it (§4).

### 3 · Nothing standing is withdrawn

§3.4: auto-assign never withdraws an invitation. Choosing a gender on a section where someone of the other gender is already invited leaves that invitation open. Their Accept is then refused by the gate's name, for example *"The client has asked for female staff on this role"*. A confirmed booking stays until the manager withdraws it on the event board (§3.6). The Shift Builder says so when a gender is chosen on a section with people booked.

A manager's manual invite is held to the gate too. It is the client's requirement, not the machine's. If the client agrees otherwise, the office sets the section back to *Any*.

### 4 · The office records gender on /staff/:id

The Overview card *Contacts & identity* has a **Gender** row with a select: Not recorded, Male or Female.

- **Who sees the select:** any office login that may write. A read-only login sees the value as text instead.
- **What the database accepts:** `set_staff_gender(staff, gender)` takes M or F, or null to clear.
- **Who it refuses:** a viewer, a worker and a removed account.
- **What it logs:** an `audit_log` row (`staff.gender_set`) that names the worker but **not the value**. Every office role reads `audit_log`, and a GDPR removal (§1.7) must not leave the answer behind in it.

The worker's own answer on step 7 still writes the same column.

## Consequences

- An office login can see a worker's recorded gender on their profile. The refusal copy tells a worker why a gender-only shift is closed to them.
- **Legal:** in the UK a sex-specific requirement is lawful only where it is an occupational requirement under the Equality Act 2010 (Sch. 9 para 1). Examples are privacy and decency, such as searching or toilet attendants. THC decides when a client's request qualifies. The select enforces the request; it does not judge it.
- The wireframe `wireframes/backoffice/shift-builder.html` does not draw the select. This ADR records the deviation, per CLAUDE.md.
- `design-pass/harness` fixtures now carry a Male-only and a Female-only section and a worker with no gender on file. They also carry the board fields that had fallen behind: `handovers`, `offer` and `attendance`.
