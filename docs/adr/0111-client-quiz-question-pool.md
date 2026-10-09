# ADR-0111 · A client quiz deals its questions from a pool

**Status:** Accepted · Amends ADR-0110 · **Owner request:** 09.10.2026

## Context

ADR-0110's quiz served every active question, in position order, on every sitting. A worker who failed the Leonardo bar menu quiz saw the identical ten on attempts two and three. Asked whether the questions rotate, the owner asked for them to — and for a bigger pool to rotate from.

## Decision

- **A quiz may say how many questions a sitting gets** (`client_quizzes.questions_per_attempt`). Null is the ADR-0110 behaviour, every active question in order, so a quiz that wants a fixed paper keeps it.
- **A sitting is a hand** (`client_quiz_draws`): `questions_per_attempt` active questions drawn at random, in a random order, the moment the worker opens the quiz with attempts left (`staff_client_quiz`). The hand is kept across reloads and closed by the attempt marked against it (`submit_client_quiz_attempt` marks the open hand and nothing else — an answer to a question not on it, or no open hand, is `quiz_changed` and the sitting starts again). The next opening deals a fresh hand. A hand holding a question retired since it was dealt is thrown away and dealt again. A passed or failed worker is dealt nothing; the slides stay readable.
- **The options keep their printed order.** Price lists read in ascending order and size lists in ascending size; shuffling them would make the question harder to read, not harder to guess. The answer key still never leaves the database, and the worker is told their score, not which answers were wrong.
- **The bar menu quiz has 35 questions, dealt 10 at a time.** The original ten keep their positions; twenty-five more cover the rest of the menu as photographed 08.10.2026. The list lives in `bar_menu_quiz_questions()` so the installer and the top-up are one list. `install_bar_menu_quiz` now **tops up** a quiz it finds — adds the positions it lacks, never rewrites one it has, sets ten per sitting where nothing was set — and the migration runs it again for every Leonardo card.
- **What the worker is told**: the front page says the ten are dealt from a set of 35, so no two sittings ask quite the same ones; a retry says the next questions will be different. The office's client card says "10 of 35 questions, dealt at random" beside the quiz.

## Consequences

- `client_quiz_draws` is the seventh admin-only table of the feature (viewer write guard, `001_rls_guard` at 60). `staff_client_quiz` is no longer `stable`: opening the quiz writes the hand. Supabase calls it by POST, as before.
- The pool is not stratified by menu section: ten at random from 35 may lean towards one section. A `topic` on each question and a per-topic draw is the change if THC wants an even spread.
- Adding a question is still data: a row in `client_quiz_questions` (or a line in `bar_menu_quiz_questions()` and a run of the installer, for the bar menu). Retiring one is `active = false`; open hands holding it are dealt again.
- The stand-alone preview page (not in the repository) deals the same way so THC can see it; its marking is on the page, the app's is in the database.
