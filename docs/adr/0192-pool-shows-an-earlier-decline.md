# ADR-0192 · The Potential pool shows an earlier decline as a badge, and the button says "Invite again"

**Status:** Accepted (owner request, 22.10.2026). Refines scope §3.3 and §3.6 (D33); `wireframes/backoffice/event-board.html` gains a pool row showing it (ADR-0037 described the earlier ending as plain text; the wireframe itself drew none). Supersedes that line of ADR-0037.

## Context

§3.6 bars only a self-cancel from being invited to a section again; a decline, a withdrawal or a closed invitation leaves the worker invitable by hand (D33), and auto-assign does not re-invite after a decision. The pool row said so in one line of small grey text ("earlier: Declined · manual only") beside an ordinary **Invite** button. The owner opened an event where four workers had declined and did not see that they had: the row read like any other candidate.

## Decision

- An ended booking on the section is a **pill on the row**, in the row's own line with the Qualified pill: *Declined earlier* in coral, any other ending as *Earlier: Withdrawn*, *Earlier: Slot taken*, … in amber. The tone follows the booking's cancel cause, not the wording. Coral is the owner's choice for a decline; it is the colour the board uses for hard bars, and the Invite again button beside it is live, so say if it should be amber. The tooltip keeps the explanation (auto-assign may or may not reach them).
- A person-decided ending also carries the small line *manual invite only*.
- The button reads **Invite again** (and its accessible name "Invite X again") for any such row, so pressing it is a deliberate second ask. Behaviour is unchanged: it is the same `inviteWorker` call, the same hard-gate re-check, and no confirmation step.

## Consequences

- No rule moves. Who is in the pool, the order, the waves and who auto-assign invites are untouched.
- Test: `apps/office/app/events/__tests__/pool-declined.test.tsx`. `board-view.test.ts` already pins the label and `autoInvitable`.
- If the owner wants a decline to need a confirmation before the second invitation, it is a Modal on this button (the board's pattern), not a rule change.
