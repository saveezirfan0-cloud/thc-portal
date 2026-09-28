# ADR-0069 · Message the line-up: a push with the office's own words

**Status:** Accepted (owner request, 28.09.2026). An addition to scope v1.6; §8's register is otherwise unchanged.

## Context

Every push in §8 has fixed copy. The office had no way to pass on last-minute information to the people working an event (a different staff entrance, parking, "bring black shoes") other than phoning each of them. The owner asked for exactly that: "Can push notifications be sent off the cuff to staff members to pass on last-minute info?"

## Decision

**Where:** a **Message staff** button in the event board header (`/events/:id`), next to Duplicate and Cancel event. It shows while the event is Upcoming or Ongoing. It is hidden once the event is Completed, and hidden when it is Cancelled, because N12 has already told everyone. The database refuses both cases too (`event_over`, `event_cancelled`), not only the page.

**The form:**

- **To:** everyone on the event, or one role (the role name and its UK times).
- **Also invited:** a checkbox, off by default.
- **Message:** 1–300 characters. iOS shows about 178 on the lock screen and the rest on a long press.

**Who receives it** is decided by `send_event_message()` (20261001208000) from the bookings, never from a list the page sends:

- confirmed and worked (checked in) bookings, plus invited ones when the box is ticked;
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

## Not done

- **No in-app inbox.** A worker who dismisses the notification cannot read it again in the app. If that is needed, it is a Staff App screen of its own.
- **No message to a single worker** from their profile, and no message to staff who are not on an event.
- **No SMS fallback.** SMS is Willo's job (§1.3).
