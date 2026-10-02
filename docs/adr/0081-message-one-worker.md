# ADR-0081 · Send push to one worker from their profile

**Status:** Accepted (owner request, 02.10.2026). An addition to scope v1.6; §8's register is otherwise unchanged. Builds on ADR-0069.

## Context

ADR-0069 lets the office message the people on an event: the whole line-up, one role, or one person booked on it. Its *Not done* left out two things: a message sent from a worker's profile, and a message to someone who is not on an event. The owner: "We should be able to push notify individual staff as well." Examples are a uniform ready to collect, a document the office needs, or "call the office". None of these belongs to an event, and the worker may be booked on nothing at all.

## Decision

**Where:** a **Send push** button in the `/staff/:id` header, before Block / Reset to candidate / Remove (GDPR). Any office login that may write sees it (`officeCan(role, 'write')`: owner, manager, scheduler). A viewer does not, and it is never shown on a removed profile. The database refuses both cases too, not only the page.

**The form:** one **Message** field, 1–300 characters, the same limit and count as ADR-0069 (`MESSAGE_MAX`, `messageLength`, shared from the event board's model rather than copied). If the worker has not activated the Staff App yet (`staff_account_activated`), an amber line says the push will not reach them and to phone them instead.

**Who receives it:** the worker on the profile, and only them. `send_staff_message(p_staff, p_message)` (20261002109000) takes no list and no booking. Anyone with a staff row who has not been removed can be messaged, including a candidate, a blocked worker or a leaver. The database cannot know what the office needs to tell them, and someone without the app simply comes back as "notifications off".

**The push is register code OM2** (`packages/notifications`, `MESSAGE_CODES`):

- **Title:** `Message from the office`. There is no event to name.
- **Body:** `{message}`, the manager's words as typed and trimmed. As with OM1, braces in the text stay text.
- **Tap:** opens the app (`/`), which sends the worker wherever their lock allows: the wizard for a candidate, Shifts for everyone else.
- **Tag:** `OM2:{messageId}`, so a second message does not replace the first on the phone.

It goes through `notification_outbox` like every other send, keyed `OM2:{messageId}`.

**Notifications off:** the answer names the worker when they have no push subscription. The manager sees "Sent to 1 person. This person has notifications off and will not get it — phone them: …". The row is still queued, and the drain fails it as "no push subscription", as it does for any push.

**Access:** admin only (`current_app_role()`), and refused for a viewer login (ADR-0060, `assert_not_read_only()`). The server action checks the session first, then calls the function through the session client, so `auth.uid()` is the manager. Refusals: `staff_removed`, `message_required`, `message_too_long`; `staff_not_found` is raised.

**Record:** every send writes `staff.message_sent` to `audit_log` on the worker, with the text, so it appears in the profile's History tab ("Sent a push to the worker").

**GDPR removal (§1.7):** `remove_worker()` already scrubs the worker's outbox rows by recipient. A message written *to* one person is about them in a way a line-up message is not, so a new trigger, `staff_removed_scrub_messages`, drops the text from their `staff.message_sent` audit rows when they are removed. The rows keep that a message was sent, and by whom.

Tests: pgTAP 769, `packages/notifications` (templates, outbox), `apps/office/app/staff/[id]/__tests__/messageWorker.test.ts`.

## Not done

- **No message to several hand-picked workers** (e.g. ticked rows in the Staff directory). It is one worker from their profile, or a line-up from an event (ADR-0069).
- **No in-app inbox**, as in ADR-0069. A worker who dismisses the notification cannot read it again in the app.
- **No SMS or email fallback.** Someone with notifications off is named so the office can phone them.
