# ADR-0187 · The Potential pool opens with Radar applicants first

**Status:** Accepted (owner request, 22.10.2026). Refines scope v1.6 §3.3 ("the manager can sort/filter the pool by application status; the pool's existing ranking and search stay intact").

## Context

The pool opened in score order, so a Radar applicant (Accept application) sat between workers who had not applied (Invite) and the manager had to scan the whole list for them. "Sort: applied first" existed but was not the default, and it ordered applicants oldest-application-first, which put the lowest-scoring applicant on top.

## Decision

1. The pool opens on **Sort: applied first**: every applicant above everyone to Invite.
2. Inside each group the order is the engine's rank (score, wave 1 before wave 2; nearest first once the section has started). The rank number never renumbers.
3. "Sort: score ↓" (or "nearest ↓" in escalation) and "Sort: name" stay in the dropdown. The wave-break line shows only under the score sort, as before.
4. Applied-first now orders applicants by rank, not oldest application; their "Applied 3d ago" chip still shows how long each has waited.

No database, auto-assign or notification change. Wireframe `event-board.html` lists the options in the new order.
