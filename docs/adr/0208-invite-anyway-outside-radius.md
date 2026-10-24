# ADR-0208 · Invite anyway on "Outside the escalation radius"

**Status:** Accepted (tickets TK-6 and TK-7, reported by Sam Barrington-Wells, 24.10.2026). Brings the board in line with §3.4; nothing in the scope changes.

## Context

Once a role section has started, the event board reads the same-day escalation pool (§3.4): only workers inside `settings.escalation_radius_miles` of the venue (3 today), nearest first. Everyone further away moves from the Potential pool to Unavailable as "Outside the escalation radius", with no button.

On 24.10.2026 a last-minute Barista booking at The Goose and Gridiron started at 10:30 unfilled. At 10:30 the workers Sam was looking at left the Potential pool (TK-7), and from then on the board offered no way to invite anyone more than 3 miles away (TK-6). The database never refused it: `office_invite_worker` → `invite_worker(…, 'manual')` judges a manual invitation without the radius (pgTAP 591: "a manager's own invitation is not held to the radius — §3.4 lets the office invite anyone"). Only the board was missing the button.

## Decision

- An Unavailable row whose reason is `outside_radius` carries **Invite anyway**, like a "Marked unavailable" row (ADR-0043). The worker must have no booking on the section, or an ended one the office may reopen (D33). The confirm says why the machine skips them: "… lives outside the same-day escalation radius of the venue, so auto-assign will not invite them now the shift has started. Invite anyway?"
- The press is the ordinary manual invite. Every other hard gate is checked again in the database, and N5 is queued as from the Potential pool.
- The row's detail now ends "you can still invite by hand".

## Consequences

- No database change. The escalation job still invites only inside the radius.
- Every other hard gate (blocked, booked elsewhere, hours limit, right to work, self-cancelled, do not return, not available all days) still has no button.
