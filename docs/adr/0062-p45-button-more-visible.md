# ADR-0062 · Request my P45: a coral outline button, not a muted text link

Status: accepted · 27.09.2026 (product owner)

Scope v1.6 §10.6, §10.1 · `wireframes/staff/profile.html` · `apps/staff/app/profile/_components/ProfileHub.tsx`

## Context

§10.6 puts "Request my P45" "at the bottom of the profile sheet … below the sign-out
link, set apart from the everyday links and not styled as a primary action". The
wireframe drew it as small muted underlined text, the quietest thing on the sheet. The
product owner reports workers could not find it: a leaver who cannot find the exit keeps
sitting on confirmed bookings, which is the exact problem §10.6 exists to solve.

## Decision

The action becomes a full-width **coral outline** button (`btn danger block`), in the same
place: last on the Profile hub, below Sign out and the help line, behind the dashed rule.

- **Set apart**: unchanged — the dashed rule and its position below sign-out.
- **Not primary**: it is an outline, never filled (`solid`), and coral marks it as the
  one consequential action rather than an everyday one.
- Label, disabled state while checked in ("Available once you've checked out") and the
  two-step confirmation ("Leaving The Hospitality Company?" then "Are you sure?") are
  unchanged.

## Consequences

The wireframe's P45 line is redrawn as the outline button. `p45-flow.test.tsx` asserts
the classes (`btn danger block`, never `primary` or `solid`).
