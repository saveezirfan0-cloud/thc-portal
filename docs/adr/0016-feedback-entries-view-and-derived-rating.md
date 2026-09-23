# ADR-0016 · Feedback is read through an owner-rights view, and the rating is derived from it

**Status:** Accepted, 23.09.2026. Implemented in
`supabase/migrations/20260923140000_feedback_inbox.sql`, tested in
`supabase/tests/420_feedback.sql`. Three decisions §9.10 does not spell out, recorded
together because they meet in the same migration.

## 1. `feedback_entries_v` runs with owner rights

§9.10 prints names on every entry: "the author shown is the manager's own name, not a
generic 'Office' label", and the wireframe shows the portal user on a client entry
("from Sophie L. (client)") and the reader on a read one ("Read · Gisela M. · 07 Sep").
All three names live in `profiles`, and `profiles` has one policy, `profiles_self`.
`010_rls_admin` pins that as a known gap: an admin cannot read a colleague's profile.

A `security_invoker` view — the office default — would therefore name the signed-in
manager and print NULL for every colleague, which is the generic label §9.10 rules out.
The existing `staff_feedback_v` has exactly that bug for office entries written by
anyone else.

The alternative was an admin read policy on `profiles`. It would fix this screen and
also change what every other admin surface can reach, and it would break the two tests
that document the gap on purpose. That is a platform decision, not this screen's.

So `feedback_entries_v` (and the small `feedback_authors_v` behind the author filter)
run with owner rights and carry the tenancy rule in their own body —
`where current_app_role() = 'admin'` — the same shape ADR-0004 gave the client views,
with the opposite role in the test. They name their columns, carry no money and no
contact details, are revoked from `anon`, and return nothing to a client or a worker
(asserted in 420).

If an admin policy on `profiles` is ever added, both views can become
`security_invoker` again with no change to their callers.

## 2. `staff.rating` is derived from feedback, immediately, by a trigger

Nothing computed `staff.rating` before this migration; it held whatever the seed put
there. `docs/03-data-model.md` expected `compliance-daily` to materialise it nightly.
§9.10 says office feedback "counts toward the rating immediately on submission" and a
client entry counts once the manager presses Mark as read, so a nightly job would rank
auto-assign on yesterday's figure for up to a day after either. The trigger
`feedback_rating_hook` recomputes on the change instead.

- The rating is the mean of the counted entries — office entries, and client entries
  with `read_at` set — rounded to the two places the column holds.
- No counted entry means NULL. §6's scorer already treats NULL as the neutral 4.0.
- The trigger recomputes **only when the set of counted entries changes**. That is
  §9.10's rule, not an optimisation: "submission alone does not affect the rating", so
  an unread client entry arriving must not rewrite the column, not even to the value
  it already had.
- The one-off backfill recomputes only workers who already have a counted entry. A
  worker with none keeps the rating they have — seeded, or carried over from before the
  platform — until their first counted entry arrives.

## 3. §9.10's editing rules are enforced in the database

`admin_all` lets the office update and delete any feedback row, so without a guard a
client entry is read-only only for as long as nobody sends a PATCH to the REST API.
`feedback_guard` refuses any edit to a client entry's stars, comment or event, any
un-reading, and any delete of a client entry unless the worker has been removed (§1.7's
redaction exception). It binds every role a request arrives as (`anon`,
`authenticated`, `service_role`) and not the database owner, which can drop the trigger
anyway and which fixtures run as.

The client's direct INSERT policy from 0001 is kept, because 001 and 020 rely on it,
but narrowed: the row must arrive unread and under the caller's own `author_id`.
Without that, a customer could insert an entry that is already "read" and move a
worker's rating with no one in the office seeing it.

`feedback.event_id` is now optional for office entries only: both wireframes offer "Not
tied to an event", because a compliment that arrives by phone is often about the
person, not a shift.
