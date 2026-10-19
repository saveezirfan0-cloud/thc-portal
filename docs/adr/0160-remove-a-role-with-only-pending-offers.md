# ADR-0160 · Remove a role section that has only pending offers on it

**Status:** Accepted · Scope §3.2, §3.3, §3.6, §10.4, §8 · **Owner request:** 19.10.2026 (Leonardo Hotel St Paul's – M&E, Thu 22 Oct, Day Waiting Staff 07:00–16:00)

## Context

The Shift Builder's **Remove** on a role section was off whenever any live booking stood on it: invited, applied, confirmed or worked (`LIVE_BOOKING_STATUSES`). `bookings.shift_id` cascades on delete, so removing the section would have wiped those rows with nobody told. The line under the greyed-out button, and the save's refusal, said to withdraw the people on the board first (PR #265).

That works for an invitation (`withdraw_booking`, N10d) but not for a Radar application. The office has no Decline (ADR-0023 §3): the scope ends an application only by N10, N10c, the worker withdrawing it, or N12. So a role with two pending applications and nobody confirmed could not be removed at all, and the advice on the screen led nowhere. The client hit exactly this on 19.10.2026.

## Decision

1. **Only confirmed (or worked / turned away) people keep Remove off.** The builder reads a new per-section count, `held` (`HELD_BOOKING_STATUSES`), for the button, the line under it and `canRemoveRole()`. `booked` keeps its meaning for the "already booked staff are not removed" notes.
2. **Pending offers are closed on save, and each worker is told.** `remove_shift_sections(p_event, p_shifts[])` (20261019170500) is the one way the builder deletes a section. It is admin only and security definer. It locks the sections in id order, as the other booking RPCs do. It refuses `has_people` while anyone is confirmed, worked or turned away on any of them, all or nothing. Otherwise, in one transaction, it queues N10d to each pending invitee and **N10e** to each pending applicant, writes `event.role_offers_closed` to the audit log naming who was told, and deletes the sections. The section's own delete is still audited by `shift_requirements_audit` (`event.role_removed`).
3. **N10e is an extension:** "The {event} shift on {dateTime} is no longer needed, so your application has been closed. Keep an eye on Radar — new shifts are added regularly." It deep-links to `/radar` and has a switch like every sendable code. N10c would say the role filled and N12 that the event was cancelled, and neither is true here.
4. **The manager is asked first.** Pressing Remove on a section with pending offers opens a confirm that says how many workers hold one and that they are told on save. A section nobody is on is removed straight away, as before.
5. The save checks `held` before it writes anything, so a refusal leaves the event as it was. The RPC checks again under the lock.

## Consequences

- The booking rows for the closed offers go with the section (cascade). The audit row is the record of who held an offer and was told. The outbox rows survive, because they carry no foreign key to the booking.
- §3.6 is unchanged: a confirmed worker still leaves a shift only through Withdraw (N10b) or Cancel event (N12). §3.2's "cutting headcount never auto-removes anyone" is not touched.
- There is still no Decline for a single application (ADR-0023 §3). Removing the whole role is the only office action that closes one.
- **To confirm with THC:** the N10e wording (REGISTER-NOTES).
