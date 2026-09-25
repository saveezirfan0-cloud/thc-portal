# ADR-0037 · Emergency contact: office-only worker data, never on a client document

Status: proposed — awaiting THC · 25.09.2026

Addition to Scope v1.6: §1.5 (Staff entity), §9.6, §10.1 Profile details, §1.7 GDPR.
**§11.3 unchanged.** Plan: `docs/18-staff-features-plan.md` §2. THC: Q11, Q12
(`docs/15-open-questions.md`).

## Context

The scope collects no emergency contact. If a worker collapses on shift, the office has
nobody to call. The product owner approved an optional emergency contact the worker
keeps up to date in the Staff App and the office can read and correct.

The data is personal data about a third party. The places it could leak are the
client-facing ones: the Client Portal line-up and the two §11.3 PDFs (allocation sheet,
sign-out timesheet), which are client documents and carry no worker personal data today.

## Decision

1. **A separate table, not a `staff` column.** A column would enter every `staff` view
   and the column-grant regime #44 built for `staff`; a table stays out of all of them.
2. **Optional.** Profile details shows an amber "Emergency contact not set" subline on
   the Profile hub while it is empty — a nudge, never an app lock (Q11).
3. **Office-only.** The worker reads and writes their own through RPCs; admins read it
   on `/staff/:id` Overview (an "Emergency contact" card with Edit / Clear, "Not
   provided" when empty) and, in Phase 2, on the `/checkin` worker detail. Every office
   write is audited.
4. **Never on a client document.** The allocation sheet and the timesheet (§11.3) do not
   change; no `client_*` view reads the table; `qa-reviewer` checks the PDF loader in
   `apps/office/app/api/documents/**` never selects it.
5. **Phone format is the `/apply` rule**: E.164, `^\+[1-9][0-9]{6,14}$`, entered with the
   same international picker. Relationship is free text 1–40 with suggestions (Parent,
   Partner, Sibling, Friend, Other).

### Data model (Phase 0)

`staff_emergency_contacts`: `staff_id uuid pk → staff`, `name` 1–100, `relationship`
1–40, `phone` (E.164 CHECK), `updated_at`, `updated_by` (auth uid). RLS: one
`admin_read` select policy; no staff or client policy. Worker RPCs:
`my_emergency_contact()`, `save_my_emergency_contact(p_name, p_relationship, p_phone)`,
`clear_my_emergency_contact()`. Office RPCs: `office_save_emergency_contact(p_staff, …)`,
`office_clear_emergency_contact(p_staff)`, admin only, writing `audit_log`. Domain:
`validateEmergencyContact()` in `packages/domain/src/emergencyContact.ts`, reusing the
existing phone check, with `emergencyContact.vectors.json` also run against the CHECK.

## Consequences

- **What never changes.** `packages/pdf`, `apps/client`, every `client_*` view, the
  allocation sheet and timesheet. The client sees nothing (ADR-0004/0026). No
  notification is added.
- GDPR removal deletes the row (`staff_removed_purge_additions`, pgTAP 652). A leaver
  (`inactive`) can still read it but not write it; a removed worker is refused.
- pgTAP 650 (matrix + no `client_*` dependency), 652, 660 (worker save → read → clear,
  bad phone refused, no cross-worker access), 661 (office save audited, non-admin
  refused).
- **THC to confirm** (docs/15): Q11 — should it be mandatory, or asked during
  onboarding; Q12 — should it be deleted when a worker leaves (§10.6) rather than only
  on Remove.

## Implementation notes (Phase 1, `directory` · `20260930130000_office_staff_additions.sql`)

- `office_save_emergency_contact` / `office_clear_emergency_contact` are definers with
  the admin check in their own body (the `office_invite_worker` pattern), called
  through the manager's session, so `auth.uid()` is both `updated_by` and the audit
  actor — no service-role door. A removed worker is refused (`staff_removed`); the
  phone has its separators stripped before the E.164 check (`bad_phone`,
  `bad_name`, `bad_relationship`, 22023).
- **The audit row records which fields changed, never their values**
  (`emergency_contact.office_save` → `{created, changed: [...]}`;
  `emergency_contact.office_clear`). The contact is a third party's personal data;
  the table row is deleted on GDPR removal, and `audit_log` is not.
- The card reads through `office_emergency_contact(p_staff)`, which also says who
  saved it last ("by the worker" / "by the office (name)") — an admin cannot read
  another manager's `profiles` row directly.
- Checked (read-only): `apps/office/app/api/documents/**`, `packages/pdf` and
  `apps/client` contain no reference to `staff_emergency_contacts`.
- pgTAP 661.
