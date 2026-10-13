# ADR-0129 · Each role on the event board leads with its fill and its window

**Status:** Accepted · **Departs from:** `wireframes/backoffice/event-board.html` (role header: count line only) · **Owner request:** 13.10.2026

## Context
The role header on the event board said how full a role was only in its 12px mono line — "0 confirmed · 0 invited · 2 open of 2" — set at the same weight as the window, the dress code and the pay line beside it. With long role names and long dress codes the line was hard to find, and a manager scanning a board of several roles could not tell at a glance which were filled and how far the others had to go.

## Decision
- Every role header carries a **fill badge** straight after the role name: the confirmed count large, "/ headcount" beside it, "filled · 2 to fill" (or "Full", or "Full · +1 buffer") and a short bar.
- It counts exactly what the header line counts (§3.3): **confirmed against headcount**, never headcount + buffer. Invitations fill nothing. Buffer seats taken past headcount are named, not added, and the bar stops at full.
- **Amber while short, green once full** — the same tones the `/events` list uses for its Fill pill.
- The rule is `roleFill()` in `packages/domain/src/board.ts`, beside `roleBoardHeader()`, with its tests.
- After the fill badge, the role's **own window** (RULE-18) is a chip of its own: start – finish large, "UK time · 9 h" small beside it, and the "your time" line under the times for a viewer outside the UK (§1.8). Before this it was a 12px mono run-on after the count line, and on a busy day the start and finish times were hard to pick out.
- The "N confirmed · M invited · K open of H" line stays as the wireframe draws it, after the two chips.

## Consequences
- A manager reads each role's fill and its start and finish before anything else in its header.
- The wireframe still draws the header without the badge and with the window inline. This ADR records the deviation.
