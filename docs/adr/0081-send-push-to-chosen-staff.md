# ADR-0081 · Send push to hand-picked staff

**Status:** Accepted (owner request, 02.10.2026: "We should be able to push notify individual staff as well", then "add that as well — several hand picked"). An addition to scope v1.6; §8's register is otherwise unchanged. Builds on ADR-0069.

## Context

ADR-0069 lets the office message the people on an event: the whole line-up, one role, or one person booked on it. Its *Not done* left out two things: a message sent from a worker's profile, and a message to people who are not on an event. Examples are a uniform ready to collect, a document the office needs, or "call the office". None of these belongs to an event. The people concerned may be booked on nothing at all, and may be any handful of workers the office has in mind.

## Decision

**Where:**

- **`/staff/:id`**: a **Send push** button in the header, before Block / Reset to candidate / Remove (GDPR). It is never shown on a removed profile.
- **`/staff` (the directory)**: a tick beside each worker's avatar, never on a removed worker, and **Select everyone on this page** in the header. Ticks are kept across pages, tabs and searches, so a list can be built from several of them. With anyone ticked, a sticky bar (the design system's `SaveBar`) shows "N selected", **Clear** and **Send push (N)**. A send clears the ticks.

Both are for any office login that may write (`officeCan(role, 'write')`: owner, manager, scheduler), not for a viewer. Both open the same dialog (`apps/office/app/staff/SendPush.tsx`), and the database refuses whatever the page shows.

**The form:** who it is to (every name up to four, then "and N more"), and one **Message** field, 1–300 characters. The limit and count are ADR-0069's (`MESSAGE_MAX`, `messageLength`), shared from the event board's model rather than copied. On a profile whose worker has not activated the Staff App yet (`staff_account_activated`), an amber line says the push will not reach them and to phone them instead.

**Who receives it:** the workers on the list, each once. `send_staff_message(p_staff uuid[], p_message)` (20261002109000) takes the ids the manager picked and checks every one of them. It refuses the whole send, never quietly dropping anyone, when the list:

- is empty: `nobody_to_message`;
- has more than 200 workers: `too_many_recipients`. This is for hand-picked people, not a broadcast, and the action stops it before the database too;
- names a removed worker: `staff_removed`;
- names someone who does not exist: `staff_not_found`, raised.

Anyone not removed can be messaged, including a candidate, a blocked worker or a leaver. The database cannot know what the office needs to tell them, and someone without the app simply comes back as "notifications off".

**The push is register code OM2** (`packages/notifications`, `MESSAGE_CODES`):

- **Title:** `Message from the office`. There is no event to name.
- **Body:** `{message}`, the manager's words as typed and trimmed. As with OM1, braces in the text stay text.
- **Tap:** opens the app (`/`), which sends the worker wherever their lock allows: the wizard for a candidate, Shifts for everyone else.
- **Tag:** `OM2:{messageId}`, so a second message does not replace the first on the phone.

It goes through `notification_outbox` like every other send, one row per worker, keyed `OM2:{messageId}:{staffId}`.

**Notifications off:** the answer names every recipient with no push subscription. The manager sees "Sent to N people. These people have notifications off and will not get it — phone them: …". Their rows are still queued, and the drain fails them as "no push subscription", as it does for any push.

**Access:** admin only (`current_app_role()`), and refused for a viewer login (ADR-0060, `assert_not_read_only()`). The server action (`messageStaff`) checks the session first, then calls the function through the session client, so `auth.uid()` is the manager.

**Record:** every send writes `staff.message_sent` to `audit_log` on **each** worker, with the text, the message id (shared by everyone in one send) and how many received it. It appears in each profile's History tab as "Sent a push to the worker".

**GDPR removal (§1.7):** `remove_worker()` already scrubs the worker's outbox rows by recipient. A message written to a handful of named people is about them in a way a line-up message is not, so a new trigger, `staff_removed_scrub_messages`, drops the text from the removed worker's own `staff.message_sent` rows. The rows keep that a message was sent, and by whom. The other recipients' rows keep the text, as with ADR-0069, so managers should not name other workers in these messages.

Tests: pgTAP 769; `packages/notifications` (templates, outbox); `apps/office/app/staff/__tests__/sendPush.test.ts` (the action and its words) and `pickAndPush.test.tsx` (the directory's ticks).

## Not done

- **No in-app inbox**, as in ADR-0069. A worker who dismisses the notification cannot read it again in the app.
- **No SMS or email fallback.** Anyone with notifications off is named so the office can phone them.
- **No ticks in the Student visa view.** Its rows are a compliance report; tick the same people in the directory.
