# ADR-0031 · A worker reads criminal declarations through RPCs only

Status: accepted · 27.09.2026 · 20260928110500 · Refines ADR-0004 (owner-rights views), follows 20260923090000 (block_reason) and 20260923220000 (rejection_reason)

## Context

§10.7 step 5: "The details the worker typed are never displayed back to them on a
shared screen." The Staff App honours it — `staff_documents()` and
`onboarding_state()` are `security definer` and neither selects `details` or
`conviction_date`; pgTAP 430 pins what they omit — but the application was not
the boundary. `criminal_declarations` had carried a worker row policy since
0001 (`staff_self_decl`, restated 20260921123503:207), and RLS has no column
dimension, so the same session could read the text back with

    GET /rest/v1/criminal_declarations?select=details

Own data, not a leak to anyone else; listed because the RPC-only pattern is
the stated mechanism and it was bypassable (audit 27.09, staff-10).

## Options

1. **Column privilege** — the shape 20260923090000 used for `staff.block_reason`:
   revoke table-wide SELECT from `authenticated`, re-grant every column but
   `details`, `conviction_date`, `review_note`, and give the office an
   owner-rights view. Rejected here because the office's route to those columns
   is wider than one view: `compliance_review_queue_v` is `security_invoker` and
   selects `c.details`, and `/staff/:id` and `/onboarding/:id` read the column
   through the session client (`apps/office/app/staff/[id]/data.ts`,
   `apps/office/app/onboarding/data.ts`). Admin and worker are the same Postgres
   role, so the revoke takes the Needs review queue and both office screens down
   with it, and the repair spans a view restatement, two office data files and a
   type regeneration against the live project.

2. **Drop the worker's row policy.** Every worker-facing read of a declaration
   is already a definer RPC that withholds the text, and every worker write is
   one too (`declare_my_conviction`, `onboarding_submit_documents`). Nothing in
   `apps/staff` selects the table directly, no `security_invoker` view a worker
   uses reads it (`onboarding_candidates_v` reads `answer`/`review_status` for
   the OFFICE; a worker's row simply shows null there), and the office keeps
   `admin_all`. The direct path had exactly one use — reading `details` back —
   and §10.7 forbids that use.

## Decision

Option 2. `20260928110500` drops `staff_self_decl`. RLS stays enabled, so the
table is deny-all for a worker: `030_rls_staff` now asserts a worker reaches
no declaration row, `001_rls_guard` takes the table out of the self-policy
list, and `599` pins that `select details` returns nothing while
`staff_documents()` still reports the declaration's status without the text.

This is the inverse of 20260923090000's reasoning, and deliberately: there the
worker's own `staff` row was load-bearing (`weekly_cap_for()` reads it as the
invoker, `staff_directory_v` is `security_invoker`), so the row policy had to
stay and the column had to go. Here the row policy carried nothing, so it goes
and the columns stay for the office.

## Consequences

- A future worker-facing read of a declaration must be a definer RPC and must
  keep omitting `details` and `conviction_date`; there is no direct path to fall
  back on, which is the point.
- The office's paths are untouched: `admin_all`, `compliance_review_queue_v`,
  and the two data files keep reading the columns they print.
- If a worker screen ever needs a declaration column beyond what
  `staff_documents()` returns, extend that function (and 430), not the policy.
