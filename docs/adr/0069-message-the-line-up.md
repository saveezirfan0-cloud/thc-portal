# ADR-0069 · Message the line-up: a push with the office's own words

**Status:** Accepted (owner request, 28.09.2026). An addition to scope v1.6; §8's register is otherwise unchanged. Amended 29.09.2026: the "Also invited" checkbox became a **Who** choice, so invitees can be messaged on their own (see *Amendment* below).

## Context

Every push in §8 has fixed copy. The office had no way to pass on last-minute information to the people working an event (a different staff entrance, parking, "bring black shoes") other than phoning each of them. The owner asked for exactly that: "Can push notifications be sent off the cuff to staff members to pass on last-minute info?"

## Decision

**Where:** a **Message staff** button in the event board header (`/events/:id`), next to Duplicate and Cancel event. It shows while the event is Upcoming or Ongoing. It is hidden once the event is Completed, and hidden when it is Cancelled, because N12 has already told everyone. The database refuses both cases too (`event_over`, `event_cancelled`), not only the page.

**The form:**

- **To:** everyone on the event, or one role (the role name and its UK times).
- **Who:** *Confirmed and checked-in staff* (the default), *Invited only — people who have not accepted yet*, or *Confirmed, checked-in and invited*. Any choice works with any **To**.
- **Message:** 1–300 characters. iOS shows about 178 on the lock screen and the rest on a long press.

**Who receives it** is decided by `send_event_message()` (20261001209000, audience from 20261001211000) from the bookings, never from a list the page sends:

- by audience: `booked` = confirmed and worked (checked in); `invited` = invited only; `booked_and_invited` = both. Anything else is refused as `audience_unknown`;
- never applied, closed, cancelled or turned away bookings;
- one push per worker, even when they hold two roles on the event. It links to the role they start first, or to the role that was messaged.

**The push is register code OM1** (`packages/notifications`, `MESSAGE_CODES`):

- **Title:** `{event} · {date}`.
- **Body:** `{message}`, the manager's words as typed and trimmed. `render()` replaces in one pass, so braces in the text stay text.
- **Tap:** opens the worker's shift (`/shifts/{bookingId}`).
- **Tag:** `OM1:{messageId}`, so a second message does not replace the first on the phone.

It goes through `notification_outbox` like every other send, with a unique key per message and booking.

**Notifications off:** the answer names every recipient with no push subscription. The manager sees "These people have notifications off and will not get it — phone them: …". Their rows are still queued, and the drain fails them as "no push subscription", as it does for any push.

**Access:** admin only (`current_app_role()`), and refused for a viewer login (ADR-0060, `assert_not_read_only()`). Every send writes `event.message_sent` to `audit_log`, with the text, so it appears in the event's history. GDPR removal already scrubs the worker's outbox rows by recipient (20260930120100). It matches ids, emails and NI numbers, not names, so a message that *names* a worker who is later removed keeps that name in `audit_log` and in the other recipients' sent rows. Managers should refer to people by role, not by name, in these messages.

## Amendment (29.09.2026): choose who

The first version could only add invitees on top of the confirmed line-up, so there was no way to chase the people who had not answered an invitation without also messaging everyone already booked. The owner asked for more flexibility. The checkbox is now a **Who** select next to **To**, and `send_event_message(p_event, p_section, p_audience text, p_message)` replaces the boolean signature. The old one is dropped, not overloaded. When nobody matches, the refusal says who was missing: with *Confirmed* chosen it points to *Invited only*, and with *Invited only* chosen it says nobody has an open invitation. `audit_log` records `audience` in place of `includeInvited`.

## Amendment (29.09.2026): one person

The owner: "We also need to be able to message individual staff, for example one of the Waiting Staff who is booked on — not all of them." The **To** list now has a group per role, **One person · {role}**, listing that role's confirmed and checked-in workers and then its invitees, marked "(invited)". Picking one messages only them; **Who** is hidden, because it does not apply to a named person.

`send_event_message()` gains `p_booking uuid default null` (20261002102000). The four-argument version is dropped, so there is no overloading. The booking must be on this event (and in the named section, if there is one) and still live: confirmed, checked in or invited. Otherwise it is refused as `booking_not_on_event` or `person_not_booked`. `audit_log` records audience `person` and the booking. pgTAP 762.

## Not done

- **No in-app inbox.** A worker who dismisses the notification cannot read it again in the app. If that is needed, it is a Staff App screen of its own.
- **No message from a worker's profile**, and no message to staff who are not on an event. One person is messaged from the event they are booked on. *Since done:* ADR-0081 adds **Send push** on `/staff/:id` (OM2), to one worker whatever they are booked on.
- **No SMS fallback.** SMS is Willo's job (§1.3).
