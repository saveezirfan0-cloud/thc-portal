# ADR-0061 · Schedulers see no money — the rate columns themselves

**Status:** Accepted · **Builds on:** ADR-0056 (office roles), closing its residual gaps 1–3 · **§9.7, §9.8, §3.2, §3.3, §11.1** · `20261001203000_scheduler_sees_no_money.sql`, pgTAP 753

## Context

ADR-0056 gated every money-only object behind `office_can('finance')` and said plainly what it had not closed: the rate columns on rows scheduling needs — `roles.pay_rate`, `shift_requirements.pay_rate` / `charge_rate`, `client_rate_cards.charge_rate`, and their copies on `payable_shifts_v` — were still readable by a scheduler over the API, the event builder and board still drew them, and the client card drew rate-card buttons that failed.

RLS filters rows, not columns. Every signed-in session is the one database role `authenticated`, so a column GRANT cannot tell a manager from a scheduler, and a policy cannot hide one column of a row it returns.

## Options

| Option | Blast radius | Airtight? |
|---|---|---|
| Move the rates to new tables (`shift_rates`, `role_rates`, rate-card charges) with finance-gated policies | Every reader of the columns changes — the pay engine, payroll and finance reports, §11.3 documents, the worker's RPCs, the seed, ~40 pgTAP files — and the row pairs must be kept in step on every write | Yes |
| A database role per office role (custom access-token hook setting the JWT `role`) | Auth configuration, every grant in the schema doubled, the Supabase dashboard and PostgREST role switching | Yes, but a new failure mode everywhere |
| **Revoke SELECT on the four columns from `anon` and `authenticated`; serve them to finance roles through gated owner-rights views** | The six security-invoker views that read a rate, four invoker functions, three office-callable RPCs, and the office screens that read a rate. Definer code — the whole pay and report engine — is untouched | Yes: no API session can select, filter, order on or return a rate column; there is no policy to get wrong |

The third was chosen.

## Decision

1. **Columns.** `anon` and `authenticated` hold SELECT on every column of `roles`, `shift_requirements` and `client_rate_cards` except the four rates (computed from the catalogue in the migration; 753 asserts it column by column, so a column added later without its grant fails a test, not a screen). Writes are unchanged — INSERT and UPDATE do not need SELECT on the column written — so RLS and ADR-0056's restrictive finance policies still decide who may write a rate.
2. **The finance read path.** Three owner-rights, `security_barrier`, SELECT-only views: `shift_rates_v (shift_id, event_id, pay_rate, charge_rate)`, `role_rates_v (role_id, pay_rate)`, `rate_card_rates_v (id, client_id, role_id, charge_rate)`. Their one gate is `office_rates_visible()` — security invoker, so `current_user` is the caller's role: an API session (`anon` / `authenticated`) passes only with `office_can('finance')`; any other role — the owner inside a security definer function, `service_role` — always. Any office role that holds finance — the read-only `viewer` of ADR-0060 included (750 12) — sees them with no change here. No `client_` prefix: that belongs to the Client Portal and 050 forbids money on it.
3. **Invoker readers.** `payable_shifts_v`, `dashboard_sections_v`, `clients_margins_v`, `clients_rate_card_v`, `role_directory_v`, `clients_event_list_v` are re-created from their live definitions with each rate read from the views above over a LEFT JOIN — same rows, same columns and types — so their dependants are untouched. `anon` loses its default grant on `payable_shifts_v` and `staff_shift_history_v` (it never read a row through either).
4. **Functions**, re-created from their live bodies by pattern with one statement each changed (the migration stops if a pattern does not match exactly once):
   - `resolve_violation`, `office_mark_no_show` (`select * into sr from shift_requirements`), `remove_client_role` (`select * into v`) and `add_client_role` (`ON CONFLICT … SET charge_rate = excluded.charge_rate`, which reads the column) would otherwise have been refused for every office login.
   - `staff_bookings(p_staff)`, `staff_open_shifts(p_staff)` and `check_out` are definer RPCs an office login may point at any worker, and returned that worker's base rate — to a scheduler too. They now return it as NULL to an office login without finance and exactly as before to everyone else, the worker included.
5. **A scheduler's role sections carry the catalogue rates — set, not checked.** ADR-0056's trigger refused a scheduler's section whose rates differed from the catalogue (`rates_need_finance`). A refusal that depends on the value typed is an oracle: "is it £14.00? £14.50?" answers what the column no longer will. `shift_rates_office_guard()` now SETS the role's pay rate and the client's rate-card charge (0 without one) on a scheduler's new section, keeps the stored rates on an edit, and applies the new role's catalogue rates on a role change. It runs as definer (it must read the catalogue) and recognises a signed-in write by the `role` setting PostgREST sets; the trigger is renamed `shift_requirements_catalogue_rates` so it fires before `shift_requirements_edit_lock`, whose "has anything changed on a started event" would otherwise answer the same question.
6. **Back Office** (the permission is `officeCan(role, 'finance')` from `_lib/permissions.ts`):
   - Event builder (`/events/new`, `/events/:id/edit`): no charge / pay fields, no margin on the section header, no charge / pay / margin in the summary — "Rates hidden for your role" instead — and no rate is sent on save. Saving an edit UPDATEs stored sections and INSERTs new ones; the upsert it replaced reads `excluded.pay_rate` and would be refused for managers too.
   - Event board: the rates come from `shift_rates_v`; with none, the section header draws no rate line.
   - Client card: the rate card is a list of roles and dress codes (read from `client_rate_cards` itself), marked "Rates hidden for your role", with no add / edit / remove controls; no Average margin tile; no Margin column on the events list. `/clients` has no margin column or margin sort.
   - Roles & rates stays "Not available for your role" (ADR-0056).

## Consequences

- A rate is never on a row a scheduler's session can fetch. What they can still infer: the number of role sections, headcounts and hours — scheduling itself.
- Tests: pgTAP **753** (104 assertions: shape, and owner / manager / scheduler / client / staff reading each column, rate view, invoker view and office RPC). Changed expectations, each because the rule changed: **741** 113, 114, 116 — a scheduler's off-catalogue rate is no longer refused but replaced (753 reads the stored values back); **010** 16–17 — the owner fixture reads a section's rates from `shift_rates_v`, not the table; **150** 15 — the catalogue lookup by pay rate goes through `role_directory_v`; **750** 12 — the viewer (finance) reads a section's rates through `shift_rates_v`; **001** 15–16 — the three rate views join the pinned owner-rights set (seventeen; fourteen selectable by a signed-in caller — `docs/14-handover.md` updated). Vitest: `events/__tests__/rates-on-save`, `summary-rates`, `clients/[id]/__tests__/rateCard`.
- `packages/db/src/types.generated.ts`: the three views and `office_rates_visible` hand-added; regenerate after deploy. The generated `Row` types of the three tables still list the rate columns — selecting one is now a runtime "permission denied", which is the point.
- A new column on `roles`, `shift_requirements` or `client_rate_cards` needs `grant select (<col>) … to anon, authenticated` in its migration.
- The staff app is unchanged: every worker read is a definer RPC.
