# ADR-0150 · A client's quiz comes before the confirmation

**Status:** Accepted · Scope §3.4, §10.4, §9.7 · **Owner request:** 18.10.2026 (Leonardo Hotel St Paul's M&E) · Amends ADR-0110

## Context

ADR-0110 asked a worker to pass a client's quiz _after_ they were confirmed on a shift that names it: CR1 on confirmation, a "Quiz needed" card, three failures emailing the office, and the worker staying booked. It said so in terms ("nothing gates", "a hard gate … belongs in its own ADR").

On 18.10.2026 the office reported that Bar Staff and Wine Waiting Service workers booked at Leonardo Hotel St Paul's M&E were getting confirmed on shifts without having taken the quiz, and that it should be compulsory and passed **before** they can confirm themselves onto such a shift. This is that ADR.

## Decision

- **A worker cannot confirm themselves onto a shift whose (client, role) names an active quiz they have not passed, nor put themselves forward for one.** `client_quiz_gate(shift, worker)` returns the quiz still to pass (or null). Four functions read it and answer `reason: 'quiz_required'` with the `quizId`, changing nothing:
  - `accept_invite` (Accept on an invitation),
  - `take_offered_shift` (a Radar take, which is a confirmation),
  - `apply_to_shift` (a worker's own application, and the one the office lodges for them),
  - `accept_application` (the office taking an application forward).
- **It is read after the hard gates**, in the order the other refusals use, so a blocked worker is told they are blocked, not that they need a quiz.
- **Nothing is withdrawn.** An invitation stays live; an application stays pending. The worker sits the quiz and accepts; the office accepts again. An invitation is not a confirmation, so the office can still invite a worker who has not passed and auto-assign is unchanged.
- **A worker who holds a role that names the quiz may open and sit it without a booking** (`client_quiz_required_for`, which previously needed a live booking naming it). Without this a worker turned away at Radar or Apply would have no way to the quiz.
- **A pass is still for good**, covers every role that names the quiz, and three failures still email the office (CR3). Because the worker is no longer confirmed, a worker who has used every attempt now cannot be confirmed until the office uses **Reset attempts** on the client card — the same control, now with consequence.
- **Staff App.** An invitation that needs the quiz shows the note and a "Take the quiz to accept" button in place of Accept (list and detail); with every attempt used it reads "Quiz not passed" and is disabled. A refusal from Accept, Apply or Take reads "Pass the quiz first" with a "Take the quiz" link, from the `quizId` the database returns. Back Office: `accept_application`'s refusal names the quiz and says the application stays.
- **Domain.** `acceptApplication` takes `quizPending` and refuses `quiz_required` after the gates, as the database does. `takeOffer` and its shared vectors are not changed: the take is held to the gate by pgTAP `790` instead.

## Not done, on purpose

- **Not a `bookings` trigger and not a pool gate** (`auto_assign_candidates_pool`, CLAUDE.md "a new pool gate goes in the pool"): a pool gate would drop the worker from invitations and from the board, so they would never be asked; a trigger would refuse the office's own writes and every fixture that inserts a confirmed booking, and raise exceptions where every caller expects `ok: false`.
- **Existing confirmed bookings are untouched.** Workers confirmed at Leonardo before this stay confirmed; CR1 and the card still ask them, as in ADR-0110. The office can see who has not passed on the client card.
- **No new wireframe.** `/quiz/:id`, the Shifts card and the client card were already outside the wireframes (ADR-0110); the invitation note and button follow the same pattern.

## Consequences

- A worker invited to a Leonardo Bar or Wine Waiting Service shift cannot be confirmed without passing, and first has to see that. THC may want to nudge them: CR1 still goes only on confirmation, so an invitation does not push "a quiz is waiting" — a follow-up if THC asks.
- The two Leonardo roles share one quiz, so one pass clears both.
- Any other client that names a quiz in `client_role_requirements` gets the same rule.
- pgTAP `783` assertion C (a worker with no booking cannot open the quiz) now removes the worker's role first; `790_quiz_before_confirm.sql` holds the four paths, the access rule and what did not change.
