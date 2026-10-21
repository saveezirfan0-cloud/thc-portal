# ADR-0181 · Suggested overs: the Shift Builder pre-fills a new role's buffer from "1 for every 5"

**Status:** Accepted · 21.10.2026 · **Asked by:** THC, 21.10.2026 · **Adds to:** §3.2 (Buffer =
an absolute number per role section, RULE-07) — a deliberate addition, not a change to it ·
**Builds on:** ADR-0140 §2 (the buffer always reads "6 (+1)"), ADR-0164 (a settings row with a
shape guard), ADR-0056 (settings writes are owners only) · **Open with the client:** the rule's
two edge answers (below)

`packages/domain/src/buffer.ts` (`suggestBuffer`, `readBufferRule`, `bufferRuleProblem`,
`describeBufferRule`, `DEFAULT_BUFFER_RULE`) ·
`supabase/migrations/20261022180000_buffer_suggestion.sql` · pgTAP `916` ·
`apps/office/app/events/draft.ts` (`bufferTouched`, `editRole`, `newRoleDraft`,
`bufferSuggestionPatch`), `_components/RoleSection.tsx`, `_components/ShiftBuilder.tsx`,
`data.ts` (`ReferenceData.bufferRule`) · `/settings` → **Suggested overs**
(`apps/office/app/settings/BufferSuggestionBlock.tsx`, `saveBufferSuggestion`)

## Context

THC books "overs" — the buffer — on top of the client's headcount to cover late arrivals and
drop-outs (§3.2), and works to a rule of one extra for every five staff. Until now the manager
typed the buffer by hand on every role section, and a new section started at headcount 1 /
buffer 0. Allocation per hour already follows headcount + buffer until the manager types one
(§3.4); the buffer had no such default.

Two answers are still with the client: does a role under five get 0 or 1, and does 7 round down
to 1 or up to 2? So the rule has to change without a release.

## Decision

1. **A suggestion, not a new kind of buffer.** The buffer stays the absolute number §3.2 asks
   for, typed or accepted by the manager and stored in `shift_requirements.buffer`. The rule only
   proposes the number the manager would otherwise have typed. Nothing in the database computes a
   buffer; no auto-assign, fill, cap or pay path reads the rule.
2. **The rule** is `settings.buffer_suggestion` =
   `{"enabled": true, "per": 5, "rounding": "down", "minimum": 0}`:
   - `suggestBuffer(headcount, rule)` = `floor(headcount / per)` (or `ceil` when rounding is `up`),
     then at least `minimum` — the minimum only on a role with someone on it (0 staff → 0).
     Default: 1–4 → 0, 5–9 → 1, 10–14 → 2. Rounded up: 1–5 → 1, 6–10 → 2.
   - `per` is a whole number 1–100, `minimum` a whole number 0–20, `rounding` `down` | `up`,
     `enabled` a boolean, and no other keys. `settings_buffer_suggestion_guard` refuses anything
     else (22023 `buffer_suggestion_invalid`), and the screen and the builder read a missing or
     malformed row as the default, never as "off" (`readBufferRule`).
   - Off: no suggestion; a new section starts at 0 and the builder behaves as before.
3. **Follows until touched** — the allocation's pattern (§3.4):
   - A **new** role section (on a new event, a Duplicate, or added to a saved event) starts at the
     suggestion for headcount 1 and follows the suggestion as the headcount changes.
   - Typing in Buffer stops it following (`bufferTouched`), even if the typed number equals the
     suggestion. Allocation per hour still follows headcount + buffer as before.
   - **A saved buffer is never changed by the suggestion.** A section reopened for editing, and a
     Duplicate's copied section ("Duplicate keeps the copied buffer"), start touched. On those
     the suggestion is at most a hint.
   - **"Use suggestion (N)"** beside the hint when the buffer differs from it. On a section not
     saved yet it hands the buffer back to the suggestion, which follows again; on a saved section
     it only sets the number, once — a manual edit, which (like every buffer edit, §3.5) is silent.
4. **What the office sees.** Under Buffer: `Suggested: 2 (1 for every 5) · shown as 10 (+2)`; the
   rule's wording adds ", rounded up" and ", at least N" when they apply. With the rule off the
   hint is the existing `absolute, not % · shown as 6 (+1)`. On /settings, a **Suggested overs**
   block: an on/off switch, then "One extra for every [5] staff, rounded [down/up], at least [0]
   per role." and "The Shift Builder fills this in; you can always change it.", a line of worked
   examples in the `6 (+1)` form, and a note that a saved buffer is never changed by it. Owners
   save it (`office_can('settings')`); every office role reads it, because the builder does; the
   settings_audit trigger records each change; staff and clients cannot read it.
5. **Where it is read.** `loadReferenceData()` reads the row on the server with the rest of the
   builder's reference data and passes the rule down as `ReferenceData.bufferRule`. A failed read
   of this one row falls back to the default rather than refusing the builder.

## Deviation from the wireframe

`wireframes/backoffice/shift-builder.html` draws the Buffer hint as "absolute, not %" / "shown as
3 (+1)". With the rule on, the hint starts with the suggestion instead and keeps "shown as …";
the "Use suggestion (N)" link is new. The field, its place and its label are unchanged. /settings
has no wireframe ("simple form").

## Changing the rule once the client answers

No release: an owner opens **/settings → Suggested overs**, changes the numbers and presses
**Save suggested overs**. "Under five gets 1" is `at least 1`; "7 gets 2" is `rounded up`. Role
sections added from then on follow the new rule; events already saved keep their buffers.

## Consequences

- New role sections on a 5+ headcount now start with a buffer, so auto-assign's confirmation
  target (headcount + buffer) and the default allocation are higher for them than before, exactly
  as if the manager had typed it.
- pgTAP 916: the seeded row, the guard (12 refusals, edges accepted, other keys untouched), RLS
  (scheduler and manager read but cannot write; staff and client neither; owner writes) and the
  audit row.
