# ADR-0163 · Personal data leaves the API roles; anon holds no table grant

**Status:** Accepted · Scope §1.4, §2.5–§2.10, §4.1, §9.6, §10.1, RULE-20 · **Source:** pre-launch security review 17.10.2026, findings M1, L3, L4, L5 · Builds on ADR-0004, ADR-0017, ADR-0026

## Context

The review's M1: a worker's own session could read their NI number, share code, date of birth, home address, sort code and account number straight from PostgREST (`GET /rest/v1/bank_details?select=*`). The Staff App masks the NI number and the office's profile masks the bank details, but the masks live in `staff_me()` and `staff_profile_v`; the table grants did not care. A stolen, signed-in phone (400-day cookie, token readable by script) was a complete identity-and-bank pack, and after the office disabled the login the token kept reading these rows for up to an hour, because the ten `staff_self*` policies checked `auth.uid()` only.

L3: the same worker could read the AI's extraction, confidence and manual-review reason on their own documents — enough to tune a forged letter until the flag cleared.

L4: `anon` held Supabase's default full DML on every public table and view (47 tables, 12 views with INSERT/UPDATE/DELETE/TRUNCATE on the live project, 19.10.2026). RLS was the only wall.

L5: nothing pinned the set of `SECURITY DEFINER` functions `authenticated` can execute, so a new one shipped without review; docs/14 §4's count had drifted.

RLS filters rows, never columns, and admin and worker are the same Postgres role (`authenticated`), so the fix is the one #44 and ADR-0017 used for `block_reason` and `rejection_reason`, a few columns wider.

## Decision

1. **The columns leave both API roles** (`20261020120000`). `staff.dob`, `home_address`, `ni_number`, `share_code`; `bank_details.sort_code`, `account_number`; `compliance_docs.share_code`, `claimed_dob`, `ai_extracted`, `ai_confidence`, `needs_manual_review`, `manual_review_reason`. `bank_details` and `compliance_docs` lose their table-wide SELECT and get the rest back by name (fail-closed: a later column is unreadable until its migration grants it). The service role keeps everything.
2. **The office reads them through three owner-rights views** (ADR-0004), columns named, gate in the body: `staff_identity_v` (admin), `staff_bank_masked_v` (the two masks only, never the numbers; admin with `office_can('finance')`, as `bank_details.office_finance_read`), `compliance_doc_review_v` (admin). A caller that is not an API role (a definer, a job, the service role) passes the gate too — it already reads the base tables in full.
3. **The six security_invoker office views read through them** — `staff_profile_v`, `onboarding_candidates_v`, `student_visa_v`, `share_code_dob_claims_v`, `staff_documents_v`, `compliance_review_queue_v` — with every output column's name, type and order unchanged, re-created from the bodies on the live project / the go-live branch (docs/10 §3b).
4. **The two invoker helpers branch on the caller's own privilege.** `weekly_cap_for()` (the under-18 cap) and `onboarding_documents_missing()` run as the caller. As the owner, a job or the service role they run their previous body unchanged — that is where every definer chain that judges *another* worker runs (`accept_invite`, `apply_to_shift`, the auto-assign rounds), so no admin gate can silently drop the under-18 cap there. As an API caller they read the date of birth and "a share code was entered" from the new definer **`staff_identity_facts(uuid)`**, which answers an admin or the worker themselves (`staff_caller()`) and nobody else — exactly the rows staff's RLS returns to each. A helper in `private` was rejected: 522 and 608 pin that schema shut to both API roles.
5. **The worker's screens are unchanged.** `staff_me()`, `onboarding_state()` and `staff_documents()` are definers and already return what each wireframe shows — Profile's Bank & payroll form is drawn prefilled with the full sort code and account number, the onboarding review hub prints the share code, the NI number is masked. L3's one change there: `onboarding_state()` no longer carries `needsManualReview`, which no worker screen read.
6. **A disabled login stops reading its rows at once** (`20261020120100`). The ten `staff_self*` policies match on `(select staff_caller())` — the caller's staff id only while the token's session exists and the login is not banned, the test every worker RPC already makes. One initplan per statement, cheaper than the per-policy subquery on `staff` it replaces.
7. **anon holds nothing on any table, view or sequence in public** (`20261020120200`), and the migration role's default privileges stop handing it to the next one. Every logged-out route was checked: `/apply`, `/activate`, the throttles and every job use the service key; `/forgot` and `/reset` are GoTrue. USAGE on the schema stays (PostgREST needs it; the two RLS helpers live there).
8. **L5:** `892` pins the 189 definers `authenticated` can execute, by signature, and asserts no definer outside `public` is reachable. A new one fails by name until it is reviewed and added.

## Not done, on purpose

- **The worker's own RPCs still return their own bank details and share code in full**, because the wireframes draw them that way. Masking them (and asking for the current password before showing them, as ADR-0113 does before changing them) is a wireframe decision for THC.
- **`staff.home_location` and `home_postcode`** stay readable on the worker's own row: the coordinates feed the invoker auto-assign pool and Radar, and moving them is a larger change than this review asked for.
- **Supabase-owned objects.** PostGIS's `spatial_ref_sys`, `geometry_columns`, `geography_columns` keep PostGIS's grant to PUBLIC, and `supabase_admin`'s default privileges in public still include anon; only that role can change either (ADR-0131's support ticket).
- **GraphQL.** `pg_graphql` is not installed on the live project, so `graphql_public.graphql()` is Supabase's stub and introspects nothing; the schema grants to anon belong to `supabase_admin`. Keep the extension off and drop `graphql_public` from the API's exposed schemas in the dashboard (docs/14 §4).

## Tests

`040` (anon: every read and write is now 42501; the grant itself is pinned over the whole catalog, columns and sequences included, with the default privileges and a table created in the test), `890` (the twelve columns, the worker's refused reads and working screens, the office's views with and without finance, a client, and the cap and missing-documents helpers agreeing in every context), `891` (a deleted session and a banned login read none of the ten tables; the office and client unchanged; every `staff_self*` policy asks `staff_caller()`), `892` (the definer set). Existing tests that asserted the old grants were updated where the assertion itself was the old rule: `001`, `360`, `390`, `410`, `411`, `445`, `480`, `540`, `571`, `753`, `792`, `853`, `855`.
