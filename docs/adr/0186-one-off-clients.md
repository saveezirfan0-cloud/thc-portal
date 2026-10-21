# ADR-0186 · One-off clients — the lists workers are qualified from lead without clients that will not order again

**Status:** Accepted, 23.10.2026 (product owner request) · **Builds on:** [ADR-0124](0124-clients-rows-per-page.md) (the directory is one query, filtered in the browser), [ADR-0081](0081-name-badges-with-the-allocation-timesheet.md) (a per-client switch on the card, audited), [ADR-0146](0146-bar-from-a-client.md) (the one place that still lists every client) · **§9.6, §9.7, §3.4 RULE-17** · **Code:** migration `20261023110000_client_one_off.sql`; pgTAP `923` (and `892`'s pin); `apps/office/app/clients` (`ClientsScreen.tsx`, `actions.ts`, `[id]/OneOffClient.tsx`), `apps/office/app/onboarding/CandidateScreen.tsx`, `apps/office/app/staff/[id]/Qualifications.tsx`

## Context

Private and one-off events each created a client, so the directory is now mostly names that will not book again. Qualifying a worker (§9.6) means picking clients from that directory: the candidate's Client qualification panel on the Documents step offers every client (with a "Select all"), and the staff profile's "+ Add client" is one long dropdown. The office was ticking past hundreds of dead clients to reach the few that matter, and "Select all" could not be used at all.

§9.7 says a client can be edited but never deleted, so the list cannot simply be pruned.

## Decision

### 1 · A flag, not a state

`clients.one_off boolean not null default false`. It means only "not expected to order again". It gates nothing:

- an event can still be built for the client, and a one-off client can be switched back at any time;
- its qualifications stay, and a clean shift still grants a new one (§9.6);
- auto-assign (RULE-17), Radar, Do not return and the Client Portal do not read it. The Client Portal cannot: the client role holds no table policy and no `client_*` view names the column (ADR-0026).

It is set through `set_clients_one_off(uuid[], boolean)` (admin only, a viewer refused by `office_read_only`, `security definer`, pinned by 892). Each change is one `client.one_off` row on the client's History, with what it was and what it became; setting a client to the value it has is a no-op and writes nothing.

### 2 · Where it is set

- **Client card → General info → One-off client** switch (viewer sees text), like Name badges.
- **Clients directory** — the quick way for the backlog. New filters: **Regular clients (N) / One-off clients (N) / All clients (N)** — Regular is the default — and **Events: any / Ordered once or never / Ordered more than once**. With a view chosen, **Mark the N shown as one-off** (or **Move the N shown back to regular**) acts on the whole filtered list after a confirm that says what does and does not change. So _Ordered once or never_ + search + one click clears a long tail. The view is not counted as a filter ("Clear filters" does not appear for the default).

Nothing is marked automatically. A client with one event may have an upcoming second; the office decides.

### 3 · Where it is used

- **Candidate profile → Client qualification** (onboarding): one-off clients are not listed, and so not ticked by **Select all**; a link, **Show N one-off clients**, brings them in (and **Hide** takes them out). Anything already ticked stays listed.
- **Staff profile → Client qualification → + Add client**: the dropdown leaves them out until **Include the N one-off clients** is ticked; a chosen client stays in the list; one-off names read "(one-off)".
- **Not changed:** the Shift Builder's client list (a one-off client that books again must be easy to find), **Bar from a client** (a bar must be able to name any client), the qualified-staff picker on the client card (it lists workers), Feedback and Users filters.

## Consequences

- No client is hidden for good: every list that leads without them has a way to show them, and the directory's _All clients_ view lists both.
- A one-off client that orders again keeps the flag until the office clears it. We chose not to clear it when an event is built for the client: it would make the flag a thing the Shift Builder changes, and the Shift Builder is a shared hot spot (docs/10).
- Existing clients are all regular until marked: the first use is one pass through the directory.
- `Client` (the directory row) and `ClientOption` (the pickers) gain `one_off`; both pickers read it from `clients` directly.
