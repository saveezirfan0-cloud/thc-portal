# ADR-0197 · The Check-in monitor says "Day-of confirm pending", not "Not confirmed today"

**Status:** Accepted (instruction of the product owner, 23.10.2026) · a wording change to §9.5, **raise with THC**: the scope names this status "Not confirmed today".

## Context

The monitor's status reads only `bookings.on_day_confirmed_at`, stage 3 of §3.5 (the on-the-day "Confirm today's shift" reminder). A worker who accepted and pressed "I'm ready" the day before (stages 1 and 2) but has not yet pressed the stage 3 button was shown as "Not confirmed today", which the office and the client read as "never confirmed" (John Lily Joel Vunnamatla, Lift and Shift at Conduit Club, 23.10.2026).

## Decision

The monitor pill reads **Day-of confirm pending**. Nothing else changes: same status value (`not_confirmed_today`), same amber tone, still a variant of Due, still a reminder and never a hold, still offers "Send push". The Staff App's own "Not confirmed today" pill, which prompts the worker to press the button, is unchanged.
