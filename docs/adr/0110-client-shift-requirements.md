# ADR-0110 · A client may ask a quiz before the first shift, and a kit message on the day

**Status:** Accepted · Scope §3.5, §9.7, §10.4, §8 · **Owner request:** 08.10.2026

## Context

Leonardo Hotel St Paul's M&E wants two things of anyone THC sends it on a **Bar** or **Wine Waiting Service** shift:

1. The first time ever they are booked on either role for this client, a short quiz on the hotel's bar menu (the menu photographed 08.10.2026, Leonardo Royal Hotel London — Meetings & Events bar menu): the menu as slides, then ten questions, three attempts. Once passed they are accepted for both roles with this client from then on; one pass covers both.
2. On the morning of every such shift, a message — _"Don't forget to bring your bottle opener, notepad and pen to your shift - without this you will not be able to work this shift"_ — which the worker must confirm they have read and understood.

The scope has no per-client ask of a worker beyond the dress code (§9.7) and the day-of-shift rules (§5). Neither of these is special to Leonardo once written down, so they are carried as data.

## Decision

- **Per client, a quiz** (`client_quizzes` with `client_quiz_slides` and `client_quiz_questions`); **per (client, role), a requirement** (`client_role_requirements`): the quiz to pass before the first shift and/or the kit message to confirm on the day. Two roles naming the same quiz is what "taking it for either is sufficient" means. The Leonardo bar menu quiz is installed by `install_bar_menu_quiz(client)` — 10 slides (the menu, section by section, as small price tables), 10 questions on it, pass mark 80 % (8 of 10, the platform's own quiz mark; the owner named no mark), 3 attempts — for every client card named Leonardo Hotel St Paul's M&E (matched as the name badges are, ADR-0081) and for the sample card in `seed.sql`.
- **The worker is asked the moment a booking is confirmed** on a role that names a quiz they have not passed: a push (**CR1**, once per worker per quiz, from a trigger on `bookings` so every confirming path is covered without being restated), a card at the top of **Shifts** ("Quiz needed", with the attempts left) and the same block at the top of the shift screen. An invitee is not asked — the quiz is asked of the booked — but may sit it early from the shift screen's link. `/quiz/:id` shows the slides (the questions unlock on the last one), then the questions one at a time, answers checked at the end against a key the app never receives (`submit_client_quiz_attempt`, as the H&S quiz). A pass is for good: the quiz opens on the passed screen from then on, slides still readable.
- **Three failures tell the office** (**CR3**, email to admin@) with the worker, the client, the roles and their best score. **The worker stays booked**: nothing is released and auto-assign is not changed — the owner specified the attempts, not the consequence, and dropping a worker from a shift is the office's call. The client card's **Shift requirements** block lists every role's ask and everyone who has sat the quiz (passed · when, not passed yet, no attempts left) with **Reset attempts** (office roles that may write; a viewer reads) for a worker who has used them all — the attempts stay as history, superseded.
- **The morning-of message** goes as a push (**CR2**) at **07:00 UK on the day the role section starts, or three hours before the start if earlier, never before that UK day begins** (`kit_reminder_due_at`), to a confirmed booking only, until the worker confirms it. It is queued by `client_kit_reminder_tick()`, which the `booking-tick` job calls beside `booking_tick()` every minute, keyed on booking + start as N6/N7 are (`booking_reminder_key`), so a moved shift is reminded again and a re-run never double-sends. The Shifts card and the shift screen show the message as a note on the nearest cards (Today, Tomorrow) and, from the moment it is due, the client's words with **"I've read this and I'll bring them"** (`acknowledge_shift_kit`, one row per booking in `booking_kit_acknowledgements`). Confirmed, it reads so in green.
- **Nothing gates check-in.** The §5.1 rules are unchanged by a client's ask; the message carries the client's own consequence in its words. The office can see who has not confirmed through the outbox (CR2 queued, no acknowledgement) — a board indicator is a follow-up if THC asks for one.
- **Data path.** Six admin-only tables, each with the viewer write guard (ADR-0060); the worker's every read and write is a definer RPC (`staff_shift_requirements`, `staff_client_quiz`, `submit_client_quiz_attempt`, `acknowledge_shift_kit`; ADR-0031); the office reads `clients_shift_requirements_v` and `clients_quiz_results_v` (the office's `clients_` prefix, never the portal's `client_` — ADR-0004). The client role holds nothing (ADR-0026). `001_rls_guard` lists the tables; pgTAP `783_client_shift_requirements.sql`.
- **Register.** `CR1`–`CR3` sit in `CLIENT_REQUIREMENT_CODES`, each `trigger` naming this ADR and "Not in §8"; switchable on /settings → Notifications (ADR-0083); CR3 on the office inbox.

## Consequences

- Managing the quiz content (slides, questions, which roles) is data, installed by migration as THC's H&S questions are (`20260930140000`). An office screen to write a quiz is a follow-up; the client card shows what is set and who has passed.
- A worker who fails three times is still bookable. If THC wants the opposite — a hard gate in auto-assign, or an automatic release — that is a change to RULE-12's gates and belongs in its own ADR.
- The CR2 time (07:00 / start − 3 h) is ours; THC said "the morning of the day". Change it in `kit_reminder_due_at()` if they want another hour.
- The quiz answer key is inferred from the menu as photographed; the questions and the key are in `install_bar_menu_quiz()` for THC to check.
- Not in the wireframes: `/quiz/:id`, the Shifts card, the shift-screen block and the client card's block. This ADR is the deviation record.
