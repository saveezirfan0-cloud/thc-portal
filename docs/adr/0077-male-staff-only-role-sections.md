# ADR-0077 · "Male staff only" on a role section

**Status:** Accepted, 01.10.2026 (product owner) · **Builds on:** [ADR-0043](0043-worker-availability-hard-gate.md) (a gate overlaid on the pool), [ADR-0060](0060-viewer-role-two-step-reset-activation-links.md) (the viewer writes nothing), [ADR-0076](0076-payroll-codes-as-employee-id.md) (staff brought across from payroll) · **§3.2, §3.3, §3.4, §6, §9.6, §9.9 Tab 3, §10.4** · **Code:** migration `20261002105000_male_only_role_sections.sql`; pgTAP `765`; `packages/domain/src/scoring.ts` (`HARD_GATES`, `showsUnderUnavailable`), `staff.ts`, `board.ts`, `state.ts`, `shift.ts`; `apps/office/app/events/_components/RoleSection.tsx` (the tick box), `events/[id]/board-model.ts`, `staff/[id]/GenderField.tsx`

## Context

The product owner asked on 01.10.2026: *"Male staff requirement from some clients — auto assign needs to book only male staff when this request comes in. Maybe a tick box for when the roles are being built in the event."*

The scope has no such requirement. Two things already exist that it can build on:

- **Gender is on file.** §9.9 Tab 3 (the HMRC New Starter report) needs it, so onboarding step 7 asks it, as HMRC's own M or F (`staff.gender`, `20260926100100`). Nothing new is asked of anyone.
- **Every path that books someone reads one pool.** `auto_assign_candidates(section)` gives each worker a gate or none. The hourly rounds, the first round, the 12:05 refills, same-day escalation, `invite_worker` (manual invites too), `accept_invite`, `apply_to_shift`, `accept_application`, Radar (`staff_open_shifts`) and the shift-offer pushes and takes all re-read it.

## Decision

### 1 · A tick box per role section

`shift_requirements.male_only boolean not null default false`. The Shift Builder shows a **Male staff only** tick box on every role section. The event board shows a *Male staff only* pill on that role. A Duplicate keeps it, because it is the client's ask for the role, not a decision about one day's people. Changing it re-confirms nobody, so it is a silent field. It is not under the §3.2 edit lock, the same as the Auto-Assign switch: it steers who is invited next, not the shift as booked.

### 2 · Two hard gates, straight after `wrong_role`

On a `male_only` section only:

| `staff.gender` | Gate | Event board |
|---|---|---|
| `M` | none | in the pool as usual |
| `F` | `male_only` | **no row**, like `wrong_role`. Listing every woman would bury the section the same way. |
| null | `gender_not_recorded` | under Unavailable → *Gender not recorded*, so the office can record it. |

This is a gate, not a score. §6's five weights are untouched. It is checked straight after `wrong_role` because, like that gate, it is about what the section asks for and not the worker's week. A blocked woman therefore reads `male_only`, not `blocked`. A blocked man still reads `blocked`.

**No gender on file counts as "not male".** The client asked for men, and nobody can be shown to be one without a record. Staff brought across from payroll (ADR-0076), and anyone onboarded before step 7 asked, have none. The board lists them, and the office records it (§4).

### 3 · Nothing standing is withdrawn

§3.4: auto-assign never withdraws an invitation. Ticking the box on a section where a woman is already invited leaves her invitation open. Her Accept is then refused by the gate's name (*"The client has asked for male staff on this role"*). A confirmed booking stays until the manager withdraws it on the event board (§3.6). The Shift Builder says so when the box is ticked on a section with people booked.

A manager's manual invite is held to the gate too. It is the client's requirement, not the machine's. The office can untick the box if the client agrees otherwise.

### 4 · The office records gender on /staff/:id

There is a **Gender** row on the Overview card *Contacts & identity*, with a Male / Female / Not recorded select. It is shown to any office login that may write. `set_staff_gender(staff, gender)` takes M or F (or null to clear). It refuses a viewer, a worker and a removed account. It writes an `audit_log` row (`staff.gender_set`) that names the worker but **not the value**. Every office role reads `audit_log`, and a GDPR removal (§1.7) must not leave the answer behind in it. The worker's own answer on step 7 still writes the same column.

## Consequences

- An office login can see a worker's recorded gender on their profile, and the refusal copy tells a worker why a male-only shift is closed to them.
- Only male-only is offered. A female-only request would be a second boolean (or turning this one into an enum) plus the mirror pair of gates. The structure is the same.
- **Legal:** a sex-specific requirement is lawful in the UK only where it is an occupational requirement under the Equality Act 2010 (Sch. 9 para 1) — e.g. privacy and decency, such as searching or toilet attendants. THC decides when a client's request qualifies. The tick box enforces it; it does not judge it.
- The wireframe `wireframes/backoffice/shift-builder.html` does not draw the tick box. This ADR is the record of the deviation, per CLAUDE.md.
