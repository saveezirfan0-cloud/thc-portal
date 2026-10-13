# ADR-0128 · The event board shows each dress code once, in the Event panel

**Status:** Accepted · **Departs from:** `wireframes/backoffice/event-board.html` (dress code in every role header; wireframe updated) · **Owner request:** 13.10.2026

## Context
§3.3 puts the role's dress code in each role block's header on the event board. With real rate cards that is a long line ("Plain White Long Sleeved Collared Shirt (clean and pressed) Plain Black Trousers (not jeans/denim/cargo), Black Socks (not white socks), Black Leather Polishable Shoes (no trainers)"), and on most events every role has the same one. An event with five role sections printed the same sentence five times, a full line in every header, so the role blocks took up much more space than their counts and rates needed.

## Decision
- **The role header no longer carries the dress code.**
- **The Event panel shows each dress code once** (`dressCodeSummary` in `board-model.ts`):
  - one dress code on every section → **Dress code · all roles**, then the text;
  - otherwise each distinct dress code on its own line, after the roles that wear it ("Kitchen Porter · Bar Staff — Kitchen blacks"), in running order. A role split across two sections is named once; a section with no dress code is left out.
- Nothing changes in what is stored, how the Shift Builder picks a dress code, or what the worker sees in the Staff App.

## Consequences
- Each role header is a line shorter. The dress code is still on the page, above the role blocks, next to the on-site contact and notes.
- To see one role's dress code the manager reads it from the Event panel, not from the role block.
