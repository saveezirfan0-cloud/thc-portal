# ADR-0169 · The onboarding app reminder goes by email when notifications are off

**Status:** Accepted (owner request, 19.10.2026). *Amended by ADR-0186, 21.10.2026: the email also goes beside the push to a candidate who has notifications on, with the step's instructions.* Amends ADR-0071 ("after sign-up: the reminder is in the app"). An addition to scope v1.6 §8. The three emails are new copy for THC's approval, alongside ADR-0071's.

## Context

After sign-up, the daily onboarding reminder is a push (OC3, ADR-0071). Notifications in the Staff App are opt-in: the candidate has to tap Allow, and on an iPhone the app must first be on the home screen. Many candidates sign up in a browser and go straight into the wizard without turning them on. The drain fails each of their pushes ("no push subscription: the worker has not enabled notifications on any device"). The board shows "App reminder 1 not delivered — notifications are off on their phone. Phone them" and, after three, the Stalled line. The candidate has been reminded of nothing at all. The owner sent two such cards (one stalled at the quiz, one a day after activation, at right to work) and asked: "can the candidate be emailed, if their notifications are off on their phone. There are a lot of examples where notifications are off and candidates are being held up in the onboarding process". They agreed to the proposal: email in place of the push, only when notifications are not on, and clearer wording on the card.

## Decision

1. **OC4, the app reminder by email.** A new register code: email from admin@ to the candidate, with three rungs (`first`, `second`, `repeat`) that mirror OC3's. Each one names the step (`{step}`, OC3's words) and carries `{link}`, the Staff App's `/onboarding`, drawn as the button "Carry on with onboarding". The first says why it is an email and how to turn notifications on, so the reminder can move back into the app.
2. **When.** `onboarding_chasers()` queues OC4 in place of an OC3 that is due when the candidate has **no `push_subscriptions` row**, `staff.email` is the address they sign in with (their login's, the rule OC2 and `link_staff_account()` use, so an office edit to the address never sends their onboarding to somebody else), and the job was given a good link. In every other case it queues the OC3 push as before. One check at queue time covers both "never turned on" and "every device pruned as gone".
3. **One ladder, one key.** OC4 is queued under OC3's key, `OC3:staff:<id>:<epoch>:<n>`. The unique key makes each rung one reminder by exactly one channel. A candidate who turns notifications on (or off) part-way carries on the same count. Progress still starts the count again, and the cadence, the 10:00–18:00 UK window, the variants and who is chased do not change. `onboarding_chaser_candidates()` reads both templates on that ladder.
4. **The link.** The Edge Function passes `<STAFF_APP_URL>/onboarding` as `p_app_link`. The SQL accepts only an https origin (or `http://localhost` / `127.0.0.1` with a port, for development) followed by exactly `/onboarding`, as `invite_roster_reminders()` does for `/apply`. Anything else counts as no link, and the reminder stays a push. The page needs the candidate's login, so a forwarded email gives nothing away. Unlike OC2's link, it is neither fenced nor redacted.
5. **The board.** `onboarding_chaser_state()` returns `last_channel`. An emailed app reminder reads "App reminder 2 emailed (notifications aren't on) 20 Oct · next 21 Oct". If that email fails, the card turns amber with "the email bounced". If the drain settled it because OC4 is switched off on `/settings`, it says "switched off in Settings" instead (`last_switched_off`), for every chaser track. A failed push now reads "notifications aren't turned on in the app" instead of "notifications are off on their phone", because nearly always they were never turned on.
6. **Settings.** OC4 has its own switch under Candidate & login emails on `/settings` → Notifications. While it is off, candidates with notifications off are not reminded at all (the drain settles their rows). The OC3 switch still governs the pushes. OC4 is bulk in the drain's order (ADR-0158), like OC3.

## Consequences

- **Deploy.** Migration `20261021120000` drops and recreates `onboarding_chaser_candidates()`, `onboarding_chaser_state()` (a new output column) and `onboarding_chasers()` (a new argument, `p_app_link`), with their grants restated. It also restates `notification_priorities()` with OC4. The onboarding-chasers Edge Function must be redeployed with the migration (ci.yml does both). Until it is, the old function calls `onboarding_chasers(p_now)`, which still resolves (the link defaults to null), so every reminder stays a push. `STAFF_APP_URL` is already set. No schedule changes.
- **More email from admin@.** Each candidate with notifications off now gets one email a day while they are idle, as OC1 and OC2 already do. ADR-0071's warning about bulk-mail reputation applies: watch bounces, and `every_days` widens the interval.
- **The first run after deploy** emails every signed-up candidate with notifications off whose next rung is due. It is one email each, at their next rung; it does not catch up the days already missed.
- The `onboarding-chasers` job note names OC4.
- pgTAP 900 (new); 394 and 805 follow the new signature; 856 lists OC4. Vitest: packages/notifications (outbox, templates, priority), packages/db (chasers), apps/office (chasers.test.tsx).

## Not done

- **A wizard step to turn notifications on** ("Add to home screen" on iPhone, then Allow) before the documents, so fewer candidates need the email at all. Offered to the owner as a separate Staff App change.
- **The office's own pushes** (OM1/OM2, ADR-0082) still have no email fallback. ADR-0082 records that deliberately, and the office is still shown who has notifications off.
- **Other worker pushes** (N5 invitations, N9 check-in and so on) are unchanged.
