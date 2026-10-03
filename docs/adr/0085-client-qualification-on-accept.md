# ADR-0085 · Client qualification can be set on the Accept panel

**Status:** Accepted (owner request, 03.10.2026: "I want to accept Sarah and qualify her against Clients … can assigning the clients please be in the same area as assigning the roles"). Extends §2.4 and §9.6 of the scope; does not change what a qualification means.

## Context

§9.6 puts client qualification on the staff profile ("+ Add client") and on the client card, and §2.4 puts only *role* qualification on Accept. A manager accepting a candidate who is already known at a venue had to accept, wait for the profile, then add each client + role by hand.

## Decision

The Accept panel on `/onboarding/:id` (Interview completed) shows **Qualified at client(s) — optional** directly under the role picker.

- Clients come from the directory. Ticking one qualifies the candidate at that client for **every role picked above**; each client + role pair can be unticked, because §9.6 holds the entry per client **and** per role.
- It is optional. Accept still needs at least one role and nothing else.
- With no role picked the clients are listed but disabled, with the reason beside them: an entry names one of the worker's roles.
- Roles unpicked after a client was ticked drop out of that client's entries; a role picked later joins every ticked client unless that pair was unticked.

## How it is written

`acceptCandidate` runs the existing accept (login, `onboarding_accept_with_account`, E3), then calls `grant_client_qualification` for each pair — the same function the profile and the client card use, so the three screens cannot drift. That function requires the role to be held already, which is why the grants follow the accept rather than sit inside it. If a grant fails the candidate is still accepted, and the panel says how many entries were not saved so they can be added on the profile. No migration.

## Not changed

Automatic grants after a clean shift, Do not return, and removal are as in §9.6. The profile and the client card remain editable. The wireframe `wireframes/backoffice/candidate.html` is updated to match.
