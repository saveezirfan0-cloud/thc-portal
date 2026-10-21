# ADR-0181 · Suggested overs: the Shift Builder pre-fills a new role's buffer from "1 for every 5"

**Status:** Accepted · 21.10.2026 · **Asked by:** THC, 21.10.2026 (the rule, then the client's
answers to its two open questions, the same day) · **Adds to:** §3.2 (Buffer = an absolute
number per role section, RULE-07) — a deliberate addition, not a change to it · **Builds on:**
ADR-0140 §2 (the buffer always reads "6 (+1)"), ADR-0164 (a settings row with a shape guard),
ADR-0056 (settings writes are owners only), ADR-0085 (times typed in `TimeField`)

`packages/domain/src/bufferSuggestion.ts` (`suggestBuffer`, `readBufferRule`,
`bufferRuleProblem`, `startsEarly`, `describeSuggestion`, `bufferRuleSentence`,
`DEFAULT_BUFFER_RULE`) and `bufferSuggestion.vectors.json` ·
`supabase/migrations/20261022180000_buffer_suggestion.sql` · pgTAP `916` ·
`apps/office/app/events/draft.ts` (`bufferTouched`, `editRole`, `newRoleDraft`,
`bufferSuggestionPatch`), `_components/RoleSection.tsx`, `_components/ShiftBuilder.tsx`,
`data.ts` (`ReferenceData.bufferRule`) · `/settings` → **Suggested overs**
(`apps/office/app/settings/BufferSuggestionBlock.tsx`, `saveBufferSuggestion`; the blocks'
shared furniture moved to `apps/office/app/settings/blocks.tsx`)

## Context

THC books "overs" — the buffer — on top of the client's headcount to cover late arrivals and
drop-outs (§3.2), and works to a rule of one extra for every five staff. Until now the manager
typed the buffer by hand on every role section, and a new section started at headcount 1 /
buffer 0. Allocation per hour already follows headcount + buffer until the manager types one
(§3.4); the buffer had no such default.

Two questions went to the client, and were answered on 21.10.2026:

- "7 staff → 2 overs, round up."
- "Fewer than 5 staff: depends on the times of the shift — an early start would add an extra
  just in case."

## Decision

1. **A suggestion, not a new kind of buffer.** The buffer stays the absolute number §3.2 asks
   for, typed or accepted by the manager and stored in `shift_requirements.buffer`. The rule only
   proposes the number the manager would otherwise have typed. Nothing in the database computes a
   buffer; no auto-assign, fill, cap or pay path reads the rule.
2. **The rule** is `settings.buffer_suggestion` =
   `{"enabled": true, "per": 5, "rounding": "up", "from_headcount": 5, "early_start_before": "08:00", "early_start_extra": 1}`:
   - a role of `from_headcount` or more staff gets `ceil(headcount / per)` (or `floor` when
     rounding is `down`);
   - a smaller role gets 0 — unless its **own** start (the role section's start, UK time, RULE-18;
     never the event window) is before `early_start_before`, when it gets `early_start_extra`.
     `early_start_before: null` means no early-start rule. A role with nobody on it gets 0;
   - so with THC's rule: 4 → 0 (1 if starting before 08:00), 5 → 1, 6 → 2, 7 → 2, 10 → 2,
     11 → 3. `bufferSuggestion.vectors.json` holds these and the edge cases;
   - `per` is a whole number 1–100, `from_headcount` 0–100, `early_start_extra` 0–20,
     `early_start_before` `"HH:MM"` (00:00–23:59) or null, `rounding` `down` | `up`, `enabled` a
     boolean, and no other keys. `settings_buffer_suggestion_guard` refuses anything else (22023
     `buffer_suggestion_invalid`); the vectors file's accepted and refused shapes are the ones
     pgTAP 916 runs against it. The screen and the builder read a missing or malformed row as the
     default, never as "off" (`readBufferRule`);
   - off: no suggestion; a new section starts at 0 and the builder behaves as before.
   - The first version of this record seeded `{per 5, down, minimum 0}`. The client's answers
     replaced it before anything was merged, so the migration was edited in place rather than
     followed by a second one; `minimum` is gone (round-up plus `from_headcount` covers it).
3. **Follows until touched** — the allocation's pattern (§3.4):
   - A **new** role section (on a new event, a Duplicate, or added to a saved event) starts at the
     suggestion for headcount 1 at its pre-filled start, and follows the suggestion as the
     headcount **or the section's own start** changes.
   - Typing in Buffer stops it following (`bufferTouched`), even if the typed number equals the
     suggestion. Allocation per hour still follows headcount + buffer as before.
   - **A saved buffer is never changed by the suggestion.** A section reopened for editing, and a
     Duplicate's copied section ("Duplicate keeps the copied buffer"), start touched. On those
     the suggestion is at most a hint.
   - **"Use suggestion (N)"**, a button below the field when the buffer differs from the
     suggestion. On a section not saved yet it hands the buffer back to the suggestion, which
     follows again; on a saved section it only sets the number, once — a manual edit, which (like
     every buffer edit, §3.5) is silent.
4. **What the office sees.**
   - Under Buffer, the hint (plain text):
     `Suggested: 2 (1 for every 5, rounded up) · absolute, not % · shown as 10 (+2)`; for a small
     role `Suggested: 0 (under 5 staff) · …` or `Suggested: 1 (under 5 staff, starts before 08:00)
     · …`, the time on the operator's clock (ADR-0085). With the rule off the hint is the existing
     `absolute, not % · shown as 6 (+1)`. The "Use suggestion (N)" button sits under the field,
     outside the hint.
   - On /settings, a **Suggested overs** block: an on/off switch; five labelled fields — "One
     extra for every (staff)", "Rounded" (up/down), "Roles under (staff) get none", "Unless they
     start before (UK time)" (a `TimeField`; blank = no early-start extra), "Then this many
     extra"; the rule read back as one sentence — "One extra for every 5 staff, rounded up. Roles
     under 5 staff get none, unless they start before 08:00 — then 1 extra." — then "The Shift
     Builder fills this in; you can always change it.", a line of worked examples in the `6 (+1)`
     form, and a note that it is each role's own start that counts and that a saved buffer is
     never changed by it. Owners save it (`office_can('settings')`); every office role reads it,
     the viewer included, because the builder does; the settings_audit trigger records each
     change; staff and clients cannot read it.
5. **Where it is read.** `loadReferenceData()` reads the row on the server with the rest of the
   builder's reference data and passes the rule down as `ReferenceData.bufferRule`. A failed read
   of this one row falls back to the default rather than refusing the builder.

## Deviation from the wireframe

`wireframes/backoffice/shift-builder.html` draws the Buffer hint as "absolute, not %" / "shown as
3 (+1)". With the rule on, the hint starts with the suggestion and keeps both; the "Use
suggestion (N)" button under the field is new. The field, its place and its label are
unchanged. /settings has no wireframe ("simple form").

## Changing the rule later

No release: an owner opens **/settings → Suggested overs**, changes the fields and presses
**Save suggested overs**. Blank the early-start time to drop the early extra; set "Roles under"
to 0 to apply the one-per-five rule to every size. Role sections added from then on follow the
new rule; events already saved keep their buffers.

## Consequences

- New role sections now often start with a buffer (any role of 5+, and a small role starting
  before 08:00), so auto-assign's confirmation target (headcount + buffer) and the default
  allocation are higher for them than before — exactly as if the manager had typed it.
- A new event's overall window pre-fills 07:00, so a role added before the manager moves its
  start reads 1 extra; moving the start to 08:00 or later takes it back to 0 while the buffer is
  still following.
- pgTAP 916: the seeded row, the guard (the vectors' accepted shapes and 25 refusals, including a
  non-string rounding, a null `enabled` and bad times), RLS (scheduler, manager and viewer read;
  none of them writes; staff and client neither read nor write; owner writes) and the audit row.
