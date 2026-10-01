# ADR-0077 · Mark interview complete without Willo

**Status:** Accepted (owner request, 01.10.2026). An addition to scope v1.6 §2.4.

## Context

§2.4 moves a candidate out of **Interview requested** only when Willo's "New Response" webhook arrives. The profile says so: "Status arrives from the Willo webhook by itself — nothing to update by hand".

That leaves the office with no way forward when Willo is not the route for one person:

- a test candidate on the live app, where nobody will record a Willo video;
- a candidate interviewed in person or by phone;
- a webhook that never arrived.

The owner asked to move a test candidate on, and for "an option where we can simply approve" a candidate, for admins only.

## Decision

**Mark interview complete**, a button on the Willo panel of `/onboarding/:id` while the candidate is in Interview requested.

- **Who:** owners and managers. Schedulers and viewers do not see the button, and `onboarding_mark_interview_complete()` (20261002105000) refuses them (`not_permitted`, 42501). A viewer's audit write would also be refused by `office_read_only`.
- **What it does:** takes the same edge the webhook takes, `interview_requested → interview_completed`, and stamps `willo_completed_at`. It sends nothing to the candidate.
- **Reason:** mandatory. It goes to `audit_log` (action `interview_marked_complete`) with the actor and their name. The Interview completed panel then shows "marked complete by {name} without Willo: “{reason}”" instead of "card moved here on its own".
- **The decision is still the office's Accept or Reject.** The existing Accept (role pick, E3, the candidate's login) or Reject (E2) follows, unchanged. So the override is one click plus the Accept the office already knows. It is not a second accept path that skips the role pick or E3.
- **Willo afterwards:** a later "New Response" is a no-op, because `willo_record_event` only moves `interview_requested`. A later Willo Accept behaves as it does today for a candidate in Interview completed.

## Consequences

- One more `security definer` RPC callable by `authenticated`. It is guarded internally, closed to anon and PUBLIC, and pinned by `765_interview_override`.
- `canMarkInterviewComplete()` in `apps/office/app/_lib/permissions.ts` mirrors the owner/manager pair. Unlike `officeCan`, it answers `false` for an unknown role, so the override only shows to someone the screen knows may use it.
