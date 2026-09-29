# ADR-0072 · A personal pay rate per worker — the third level of pay rate

**Status:** Accepted, 29.09.2026 (product owner) · **Builds on:** [ADR-0056](0056-office-roles.md) (finance permission), [ADR-0061](0061-scheduler-sees-no-money.md) (schedulers see no money), [ADR-0060](0060-viewer-role-two-step-reset-activation-links.md) (the viewer writes nothing) · **§9.6, §9.8, §9.9, §1.5, §3.2** · **Code:** migration `20261001215000_staff_pay_rate.sql`; pgTAP `759` (and `001` assertions 1, 3); `apps/office/app/staff/[id]/PayRateCard.tsx`, `payRate.ts`, `actions.ts` (`savePayRate`, `clearPayRate`); Vitest `staff/[id]/__tests__/payRate.test.tsx`

## Context

The product owner asked on 29.09.2026: *"staff pay rate should be £12.71 for all roles, but should be editable at event level and staff member level"*.

Two of those levels exist already:

| Level | Where | Stored in |
|---|---|---|
| Role | `/roles` (§9.8) | `roles.pay_rate` — the catalogue, copied onto each new role section. A separate PR sets every role to £12.71. |
| Event | the Shift Builder, per role section (§3.2) | `shift_requirements.pay_rate` — each section's own copy, editable until the event starts. |
| **Staff member** | — | **nothing** |

The scope has no per-worker rate. §9.8 prices every shift from the role section. This ADR adds the third level and records how it fits the pay engine, the money rules and the office roles.

## Decision

### 1 · One optional personal base rate per worker

A worker has at most one personal base rate (£/h). It is used for every role they work. Blank means no personal rate. There is no per-role or per-client personal rate: nothing asked for one, and one number is what the office can keep in its head.

### 2 · Precedence, stated once

A worker's base rate on a shift is their personal rate when set, otherwise the role section's rate:

```sql
effective_pay_rate(p_staff uuid, p_section_rate numeric)
  = coalesce((select pay_rate from staff_pay_rates where staff_id = p_staff), p_section_rate)
```

Every place that derives a **worker's** rate asks this one function. `20261001215000` re-creates each of them from its live definition with only the rate expression changed. The functions are re-created by pattern: the migration stops if a pattern does not match exactly once (docs/10 §3b). The views are restated in full and diffed against `pg_get_viewdef` before and after.

| Object | Kind | Latest definition before this | What changed |
|---|---|---|---|
| `payable_shifts_v` | invoker view | `20261001203000` | `rt.pay_rate` → `effective_pay_rate(b.staff_id, rt.pay_rate)::numeric(8,2)`. It feeds `report_payroll_lines_v`, which feeds `payroll_report`, `payroll_export_rows`, `prepare_finance_reports` (BG-08) and `finance_report`'s actual lines. |
| `report_payroll_lines_v` | owner-rights view | `20260923130000` | The §3.3 cancelled-on-the-day branch: `sr.pay_rate` → `effective_pay_rate(b.staff_id, sr.pay_rate)::numeric(8,2)` |
| `staff_bookings(p_staff)` | definer | `20260922140000`, gated by `20261001203000` | inside ADR-0061's finance gate |
| `staff_open_shifts(p_staff)` (Radar) | definer | `20260930110200`, gated by `20261001203000` | inside ADR-0061's finance gate |
| `check_out` | definer | `20260930100000`, gated by `20261001203000` | `payRate`, inside ADR-0061's finance gate |
| `staff_shift_detail` | definer | `20260930100100` | the shift screen's base rate |
| `staff_open_offers` | definer | `20260930201100` | shift offers the worker may take |
| `staff_earnings` | definer | `20260922180000` | the Payments screen |
| `booking_push_payload`, `queue_booking_push` | definer | `20260930110100` / `20260927160500` | the "£x.xx" in N5 and the other booking pushes |
| `queue_offer_notice` | definer | `20260930205000` | OF1's "£x.xx", at the rate of the colleague it is sent to |

**Section-based on purpose.** These figures describe a role section, not a person, and stay on the section's rate:

- the Shift Builder's section rate and its summary;
- the event board's rate line;
- the dashboard's forecast (`dashboard_sections_v` → `dashboard_upcoming_v`, `dashboard_week_finance_v`: headcount × section rate);
- `finance_report`'s **forecast** for sections not yet worked. Its actual lines come from `report_payroll_lines_v` and so carry each worker's rate;
- the client card's margins (`clients_margins_v`, `clients_event_list_v`);
- `shift_rates_v` and `role_directory_v`.

A forecast cannot know who will fill a slot. The actual lines replace it once the shift is worked.

### 3 · Its own table, not a column on `staff`

```sql
staff_pay_rates (staff_id uuid primary key references staff on delete cascade,
                 pay_rate numeric(8,2) not null check (pay_rate >= 0),
                 set_by uuid references profiles(id) on delete set null,
                 set_at timestamptz not null default now())
```

Every office role reads `staff`, a scheduler included. RLS filters rows, not columns, so a rate column on `staff` would put money on a row a scheduler fetches. ADR-0061 closed exactly that gap on `roles` and `shift_requirements`. A separate table carries its own policy:

- **`admin_finance_read`** — one permissive SELECT policy: `(select current_app_role()) = 'admin' and (select office_can('finance'))`. Owners, managers and viewers read it. A scheduler reads an empty table.
- **No write policy, and no INSERT / UPDATE / DELETE grant** to `authenticated`. `anon` holds nothing.
- **No staff, client or anon policy.** `001_rls_guard` pins this.
- **The viewer's `office_read_only` statement trigger**, like every public table (ADR-0060).

There is no `admin_all` for a restrictive policy to narrow, so ADR-0056's pinned set of restrictive policies is unchanged.

### 4 · The one write path

`set_staff_pay_rate(p_staff, p_pay_rate)` is a security definer function:

- **Access.** `assert_finance_caller()`: a Back Office login with finance, or the service role. A scheduler gets `not_permitted`; a worker or client gets `admins_only`. A viewer passes that gate and is refused `read_only` by the table's trigger.
- **Validation.** The rules and words of `assert_role_input`: "A pay rate cannot be negative" and "A pay rate is set to the penny". A third decimal is refused, never rounded.
- **Null clears** the rate (the row is deleted).
- **NaN is refused** (`A pay rate must be a number`), in the function and in the table's check: `'NaN'` passes `>= 0` and fits `numeric(8,2)`. The form's `parseRate` already refused it; the API did not (security review, 29.09.2026).
- **A removed worker is refused** (`staff_removed`, §1.7). Their history keeps the rate it was priced at.
- **The row records `set_by = auth.uid()` and `set_at`.**

**Not written to `audit_log`.** Rate changes on `roles` and `client_rate_cards` are not audited either (`update_role`, the rate-card functions). `audit_log` is readable by every office login through `/activity` and the record history, a scheduler included. An amount written there would undo ADR-0061.

**Push payloads are fenced (`office_rate_payloads`).** N5 and OF1 pushes put the recipient's rate in `notification_outbox.payload` (`'rate' => '£x.xx'`), and that is now the personal rate. `notification_outbox`'s `admin_read` lets every office login read every row, a scheduler included, which was already a section-rate leak ADR-0061 missed. A restrictive SELECT policy, the same shape as `office_users_invite_links`, narrows it: a row whose payload has a `rate` key is read only with `office_can('finance')`. `/inbox` lists office-addressed email templates, none of which carry `rate`, so no screen changes. Definer code (the drain, the jobs) is unaffected.

### 5 · The gate holds without a second check

`effective_pay_rate()` is security **invoker**. `staff_pay_rates`' RLS decides what the function may add:

- **Definer code** (the pay engine, reports, the worker's RPCs, the push payloads) runs as the table owner, which bypasses RLS. It always applies the personal rate. So does `service_role`.
- **A finance office login** reading an invoker view (`payable_shifts_v`) sees the personal rate.
- **A scheduler, worker or client** calling it directly gets back exactly the section rate they passed in. It is no oracle. Inside `payable_shifts_v` a scheduler already has `rt.pay_rate` NULL (ADR-0061), so the column stays NULL.
- The definer RPCs an office login can point at any worker (`staff_bookings(p_staff)`, `staff_open_shifts(p_staff)`, `check_out`) keep ADR-0061's `case when … office_can('finance') then … end` around the new expression.

### 6 · Retroactivity and payroll

CLAUDE.md: payroll exports are never corrected retroactively; show warnings instead.

The personal rate is read live, exactly as the section rate is. `payable_shifts_v` and `report_payroll_lines_v` compute from the current rates. So a change applies to every figure computed from then on:

- future shifts;
- worked shifts **not yet exported** — BG-08's next run prices them at the new rate;
- the worker's own earnings history (`staff_earnings`). It recomputes too.

`payroll_export_lines` stores `rate`, `base` and `holiday` as exported. A personal-rate change never touches it, so an exported CSV (`payroll_export_rows`) is unchanged. `payroll_report`'s existing `changed_since_export` flags a line whose live total no longer matches the export. This is the same warning a No-show or a resolved No check-out after export raises. The office then pays the difference by hand, as it does today.

A section-rate edit reprices the same way, but the edit lock (§3.2) stops it once the event starts. A personal rate has no such lock. That is deliberate: the office sets it for a person, not a shift. The dialog says so: "applies to every shift priced from now on — including worked shifts not yet in a payroll export. Payroll already exported is never changed; the payroll report flags the difference."

### 7 · Who sees what

- **Worker:** their base rate only. It reaches them through the definer RPCs that already carry it: My shifts, Radar, offers, shift detail, check-out, earnings, and the N5 / OF1 pushes. They see the personal rate where one is set. They cannot read `staff_pay_rates` itself, not even their own row. Holiday +12.07% is never blended into what they see.
- **Client:** no money at all. No client policy, no `client_*` view carries it.
- **Office:** owners and managers read and edit. A viewer reads. A scheduler sees nothing: no card, no row, and NULL in every invoker view.

### 8 · Back Office — `/staff/:id` Overview, "Pay rate" card

The card is drawn only for `officeCan(role, 'finance')`. Set / Edit / Clear are offered only with `write` as well, so a viewer reads it, and never on a removed profile.

- **Set:** "Personal pay rate (base £/h)", the holiday line ("Holiday +12.07%", `HOLIDAY_RATE`) and the final rate, derived with `/roles`' own helpers (`roles/money.ts`), and the change stamp in UK time (§1.8).
- **Empty:** "Uses the role or event rate — each shift pays its role section's base rate."
- **Edit dialog:** the same £ … /h field and live Base / Holiday / Final strip as the role dialog.
- **Clear:** a confirmation dialog.

The server action calls `set_staff_pay_rate` through the session, and the database's finance gate decides.

The wireframe (`backoffice/staff-profile.html`) predates this card. **This ADR is the deviation record.** The card sits beside "National Insurance · Bank & payroll · HMRC" on the Overview tab.

## Consequences

- **Tests.**
  - pgTAP `759` (72 assertions): shape, set / clear / validation (NaN included), the outbox fence (a scheduler reads no row carrying a rate; manager and viewer do), precedence in `payable_shifts_v`, the payroll report, the worker RPCs and the N5 payload, section figures unchanged, and owner / manager / viewer / scheduler / worker / client / anon.
  - `001_rls_guard` assertions 1 and 3 gain `staff_pay_rates`; assertions 8 and 9 gain `office_rate_payloads` (eighteen restrictive policies). `310` restates the outbox's policy set.
  - `SECURITY DEFINER` callable by `authenticated` goes up by one (`set_staff_pay_rate`, finance-gated); `docs/14-handover.md` §4.
  - Vitest `staff/[id]/__tests__/payRate.test.tsx`.
- **`packages/db/src/types.generated.ts`:** `staff_pay_rates`, `effective_pay_rate` and `set_staff_pay_rate` are hand-added. Regenerate after deploy.
- **GDPR removal (§1.7)** keeps the row, like the rest of the pay history. Deleting the `staff` row (never done) cascades.
- **Performance.** A new reader of a worker's rate must call `effective_pay_rate()`, not `shift_requirements.pay_rate`. It costs one primary-key lookup per row. `effective_pay_rate()` is not inlined (it pins its `search_path`, 002).
- **Not built:** a history of personal rates with effective dates, which would stop a change repricing unexported past shifts. Add it if the office needs "from next Monday" or wants a change to leave already-worked shifts alone.
