# ADR-0036 · Office roles: owner, manager, scheduler — enforced in the database

**Status:** Accepted (product owner approved finer Back Office permissions, 30.09.2026) · **Builds on:** ADR-0035 "Proposal, not built: finer office permissions" · **§1.4, §9.1, §9.7, §9.8, §9.9, §9.11, §9.12**

## Context

Every Back Office login is `profiles.role = 'admin'`, and every policy and RPC asked only that. ADR-0035 said a permissions toggle on `/users` that did not change the database rules would be a lie, so none was shown, and sketched the shape that would work. THC has approved it. §1.4 still names three app roles (admin / client / staff); this adds a second axis *inside* admin, and does not touch the first: `app_role`, the three apps' middleware, routing and every existing `current_app_role() = 'admin'` predicate are unchanged.

## Decision

### The roles

`profiles.office_role` — enum `office_role` (`owner`, `manager`, `scheduler`). A check constraint makes it non-null for admin rows and null for client and staff rows. Every admin that existed at migration time became `owner` (they all had full access). A newly invited Back Office login is a `manager` unless the inviting owner chooses otherwise. An admin row inserted any other way (the Supabase dashboard, `seed.sql`, a test fixture) is given `owner` by an insert trigger — whoever does that already holds the database. ADR-0035's sketch had a fourth role, `viewer`; it was not approved and is not built.

| Permission | What it covers | owner | manager | scheduler |
|---|---|---|---|---|
| `users` | `/users`: list logins, invite, switch off/on, change office role | yes | — | — |
| `settings` | writes to `settings` and `venue_types` (`/settings`) | yes | — | — |
| `finance` | pay and charge rates, rate cards, margins, payroll, finance reports, bank details | yes | yes | — |

Everything else — scheduling, onboarding, compliance, check-in, staff (non-money), clients (non-money), venues, feedback, the activity log, My profile — is open to all three.

`office_can(p_perm text) returns boolean` — security definer, stable, `search_path = public` — answers the table above for the signed-in session. It is false for a client or staff session, for no session, and for any permission name other than the three (a typo fails closed). Like `current_app_role()` it reads `profiles` live, so a role change applies on the caller's next request. It is granted to `authenticated` (policies and security-invoker views evaluate it as the caller) and not to anon.

### What the database now refuses

**users.** `admin_accounts`, `admin_login_lookup`, `admin_register_account` and `admin_set_login_disabled` (20260930100000) are re-created with every check their bodies had, in the same order, plus `office_can('users')` straight after the admin check (docs/10 §3b — `651_office_roles` asserts the old refusals as well as the new). `admin_accounts` also returns `office_role`. `admin_register_account` gains a six-argument form taking `p_office_role`; the original five-argument signature is kept and passes `'manager'` for an admin login — a single function with a defaulted sixth argument would make every five-argument call ambiguous in Postgres. The office role is applied to a **new** login only: a re-invite ("New invite link") never changes it, so a re-invite can never demote an owner. `admin_set_login_disabled` additionally refuses to switch off the last working owner. New: `admin_set_office_role(p_user, p_role)` — owners only, admin logins only, never the caller's own role, never leaves zero working (not switched-off) owners, locks the owner rows first so two owners cannot demote each other at once, audited as `account.role_changed` with `from` / `to`.

**settings.** Restrictive policies on `settings` and `venue_types` for INSERT / UPDATE / DELETE require `office_can('settings')`. Reads are unchanged (the event board reads `scoring_weights`; the venue form reads `venue_types`).

**finance.** Inventory of every object carrying money (grepped for pay_rate, charge_rate, margin, payroll, bank, holiday), and what now happens to it for a scheduler:

| Object | Kind | Scheduler |
|---|---|---|
| `bank_details` | table | reads nothing (restrictive SELECT policy); writes refused by a trigger — 571 pins `admin_all` as the only write policy. The worker's own read is unaffected. |
| `payroll_export_lines`, `report_sends` | tables | read nothing (restrictive SELECT) |
| `finance_report`, `payroll_report`, `payroll_report_people`, `new_starter_report`, `retry_finance_report` | definer RPCs | `not_permitted` — their live bodies re-created with one line changed, `assert_reports_caller()` → `assert_finance_caller()`. The §11.3 document functions keep the old gate: a scheduler prints allocation sheets and timesheets. |
| `prepare_finance_reports`, `payroll_export_rows`, `new_starter_export_rows`, `queue_finance_report_email`, `report_payroll_lines_v`, `report_first_shifts_v` | service role only | already unreachable |
| `roles`, `client_rate_cards` | tables | **writes** refused (restrictive INSERT / UPDATE / DELETE), so `create_role` / `update_role` / `delete_role` and the three rate-card functions, which run as the caller, change nothing. **Reads open** — see residual gaps. |
| `shift_requirements.pay_rate` / `charge_rate` | table | a trigger on direct writes: a new section must carry the role's `pay_rate` and the client's rate-card charge (0 when the client has none — the builder's own default); an edit may not change the rates unless the role changes, when the new role's catalogue rates apply. Otherwise `rates_need_finance`. |
| `clients_margins_v`, `clients_rate_card_v`, `role_directory_v`, `dashboard_week_finance_v` | invoker views, money only | no rows |
| `dashboard_sections_v` → `dashboard_upcoming_v` | invoker views, mixed | rows kept; `charge_rate`, `base_rate`, `final_pay_rate`, `margin_per_hour` NULL |
| `clients_event_list_v`, `clients_directory_v` | invoker views, mixed | rows kept; `margin_gbp`, `margin_pct`, `avg_margin_pct` NULL |
| `staff_profile_v` | invoker view | bank fields NULL (they come from `bank_details`) |
| `booking_payroll_exported()` | function | made security definer: it returned "not exported" to a scheduler once `payroll_export_lines` was closed, which would have removed RULE-06's "already in payroll" warning from the check-in screen. It returns one boolean and no money. |
| `staff_shift_history_v.pay` | view | not money — minutes and status only; unchanged |
| worker RPCs (`staff_earnings`, `staff_open_shifts`, `staff_shift_detail`, …) | definer | unchanged; the worker's own base rate |

The view gates read "not a Back Office login without finance" where the view has no admin filter of its own, so the table owner, the service role and the pgTAP fixtures read what they always read; every other caller is still held by the RLS underneath. anon's leftover SELECT grants on the five client/role views were revoked (it never read a row through them).

## Residual gaps — what a scheduler can still read

Stated plainly, because a claim of protection that is not there is worse than none:

1. **Rate columns on rows scheduling needs.** `roles.pay_rate`, `shift_requirements.pay_rate` / `charge_rate`, `client_rate_cards.charge_rate` and the copies on `payable_shifts_v` stay readable to every Back Office login through the API. RLS filters rows, not columns, and a scheduler needs these rows: role names, a client's dress codes (on the rate card row), the role sections of an event, the payable minutes the check-in screen and timesheets read. From those a scheduler can compute a margin by hand. Closing it means moving the rates off those rows — a `shift_rates` table keyed by section, rates off `roles` into a `role_rates` table, dress codes off `client_rate_cards` — or column privileges with separate database roles per office role. Both are a larger change with their own ADR.
2. **The event builder and event board show those rates on screen** to a scheduler (`apps/office/app/events/**`, not changed here). They cannot change them — the trigger refuses — but they see them.
3. **Client card** (`/clients/[id]`): margins show "—" and the rate card section is empty for a scheduler, but its Add / Edit / Remove role controls are still drawn and are refused by the database with an error when used. `ClientCard.tsx` / `RateCard.tsx` were out of this change's paths.
4. **Staff profile**: the bank fields read as blank for a scheduler rather than as "hidden".
5. **HMRC starter checklist** (`hmrc_checklists`) stays readable: it is tax status that onboarding reviews, not an amount. The New Starter report that exports it is finance-only.
6. ~~**Switched-off logins** keep an issued access token until it expires~~ — **closed by `20260930160000`**: `current_app_role()` gives a switched-off login no role, and `office_can()` goes through it. The last-owner guard counts only working owners, so a switched-off owner with a live token cannot use it to demote the last working one.

## Back Office

- `apps/office/app/_lib/permissions.ts` (pure, tested) mirrors `office_can()`'s matrix, maps routes to permissions and filters the menu. An unknown role hides nothing — the database decides.
- `officeUser()` returns the office role (and its label for the sidebar foot); it is wrapped in React `cache` so a gated page shares the layout's lookup.
- The menu hides Reports and Roles & rates from a scheduler, and Settings and Users & access from a manager or scheduler. Opened by URL those four pages show "Not available for your role" (`_components/NotAvailable.tsx`).
- Dashboard: for a scheduler the weekly financial snapshot is not drawn (and not queried) and the ten-day list has no margin column.
- `/users`: an Office role column on the Back Office tab, Change role (owners — the whole page is theirs — and never on your own row), an office-role picker in Invite (default Manager), and the "Finer permissions" panel is now "Office roles", describing what exists and what is not hidden.

## Consequences

- `20260930110000_office_roles.sql`, `supabase/tests/651_office_roles.sql` (136 assertions); `001_rls_guard` pins the fifteen restrictive policies exactly (assertions 10, 10b).
- `packages/db/src/types.generated.ts`: `profiles.office_role` and the enum hand-added; regenerate after deploy.
- The Back Office's invite now calls the six-argument `admin_register_account`.
- Adding an office role, or a permission, is a migration (`office_can`) and a change to `permissions.ts`, each held by its own test.
