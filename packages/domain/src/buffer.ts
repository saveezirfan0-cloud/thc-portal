/**
 * Headcount, buffer and fill counts — Scope §3.2, §3.3.
 *
 * The buffer is an absolute number of extra people on top of the headcount.
 * It is displayed as `6 (+1)` and never collapsed into `7`, because the
 * headcount is what the client pays for and the buffer is THC's own cover.
 * Fill counts count CONFIRMED bookings only — invited and potential never
 * count towards the fill.
 */

export interface RoleSectionCounts {
  headcount: number;
  buffer: number;
  confirmed: number;
  invited: number;
}

/**
 * "6 (+1)" — and "2 (+0)": the buffer is always spelled out, never dropped
 * and never added in.
 *
 * Every screen writes it this way (ADR-0140, release audit 14.10.2026). The
 * wireframes draw "(+0)" on the dashboard, the events list, the event board
 * and the client card alike, and CLAUDE.md's "displays as 6 (+1)" names one
 * form; the events list dropping a zero buffer while the dashboard beside
 * it said "2 (+0)" read as two different numbers.
 *
 * A negative buffer is never stored (the builder refuses it), but while one
 * is typed it reads "0 (−2)" with a real minus, not "0 (+-2)".
 */
export function formatAllocationPair(headcount: number, buffer: number): string {
  return `${headcount} (${buffer < 0 ? '−' : '+'}${Math.abs(buffer)})`;
}

/** The same pair as `formatAllocationPair` — kept for the screens that call it by this name. */
export function formatAllocation(headcount: number, buffer: number): string {
  return formatAllocationPair(headcount, buffer);
}

/** "3 (+1) = 4" — what auto-assign fills up to, with the sum kept visible. */
export function formatConfirmationTarget(headcount: number, buffer: number): string {
  return `${formatAllocationPair(headcount, buffer)} = ${allocationTarget(headcount, buffer)}`;
}

/** How many people auto-assign may seat in total: headcount plus buffer. */
export function allocationTarget(headcount: number, buffer: number): number {
  return headcount + buffer;
}

/** "4/6" — confirmed against headcount, never against headcount+buffer. */
export function formatFill(counts: RoleSectionCounts): string {
  return `${counts.confirmed}/${counts.headcount}`;
}

export function isFilled(counts: RoleSectionCounts): boolean {
  return counts.confirmed >= counts.headcount;
}

/** Seats auto-assign still wants to offer, measured against headcount+buffer. */
export function seatsToOffer(counts: RoleSectionCounts): number {
  return Math.max(0, allocationTarget(counts.headcount, counts.buffer) - counts.confirmed);
}

/**
 * RULE-15 strict buffer at check-in: the first `headcount` people to check in
 * work the shift. Anyone after that is turned away — paid a fixed 4 hours if
 * they arrived on time, nothing if they were late.
 */
export function isTurnedAway(checkInOrdinal: number, headcount: number): boolean {
  return checkInOrdinal > headcount;
}

// ---------------------------------------------------------------------
// ADR-0181 — the suggested buffer ("overs")
//
// THC works to a rule of one extra person for every five staff. The Shift
// Builder pre-fills a new role section's Buffer with it, and the manager can
// always type over it. It stays an absolute number, never a percentage: the
// rule only proposes the number the manager would otherwise have typed.
//
// The rule lives in `settings.buffer_suggestion`, so the open questions
// (does a role under five get 0 or 1? does 7 round down to 1 or up to 2?)
// are answered on /settings, not in code.
// ---------------------------------------------------------------------

export type BufferRounding = 'down' | 'up';

export interface BufferSuggestionRule {
  /** Off: the builder suggests nothing and a new section starts at 0. */
  enabled: boolean;
  /** One extra for every `per` staff. A whole number, at least 1. */
  per: number;
  /** How a part-group counts: 7 staff at 1 per 5 is 1 ('down') or 2 ('up'). */
  rounding: BufferRounding;
  /** The fewest extras on any role with at least one person on it. */
  minimum: number;
}

/** What THC asked for on 21.10.2026: one for every five, rounded down, no minimum. */
export const DEFAULT_BUFFER_RULE: Readonly<BufferSuggestionRule> = Object.freeze({
  enabled: true,
  per: 5,
  rounding: 'down',
  minimum: 0,
});

/** The bounds /settings and the database hold the rule to. */
export const BUFFER_RULE_LIMITS = Object.freeze({
  perMin: 1,
  perMax: 100,
  minimumMin: 0,
  minimumMax: 20,
});

const wholeIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/**
 * Why a stored or typed rule cannot be used, in words for the settings
 * screen — or null when it is fine. The database's guard refuses the same
 * shapes (20261022180000_buffer_suggestion.sql).
 */
export function bufferRuleProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Nothing to save.';
  const rule = raw as Record<string, unknown>;
  if (typeof rule['enabled'] !== 'boolean') return 'Choose whether the suggestion is on or off.';
  const { perMin, perMax, minimumMin, minimumMax } = BUFFER_RULE_LIMITS;
  if (!wholeIn(rule['per'], perMin, perMax)) {
    return `"For every" is a whole number of staff from ${perMin} to ${perMax}.`;
  }
  if (rule['rounding'] !== 'down' && rule['rounding'] !== 'up') return 'Choose rounded down or up.';
  if (!wholeIn(rule['minimum'], minimumMin, minimumMax)) {
    return `"At least" is a whole number from ${minimumMin} to ${minimumMax}.`;
  }
  return null;
}

/**
 * The rule as stored, or THC's default when the row is missing or not a
 * rule at all. A broken row must not quietly become "suggest nothing" — nor
 * a nonsense number; the default is what the office agreed.
 */
export function readBufferRule(raw: unknown): BufferSuggestionRule {
  if (bufferRuleProblem(raw) !== null) return { ...DEFAULT_BUFFER_RULE };
  const rule = raw as BufferSuggestionRule;
  return {
    enabled: rule.enabled,
    per: rule.per,
    rounding: rule.rounding,
    minimum: rule.minimum,
  };
}

/**
 * The buffer a role section of `headcount` staff should start with, or null
 * when there is no suggestion (the rule is off, missing or malformed).
 *
 *   one per 5, down: 1–4 → 0, 5–9 → 1, 10–14 → 2
 *   one per 5, up:   1–5 → 1, 6–10 → 2
 *
 * `minimum` applies only to a role with someone on it: 0 staff is 0 extras.
 * A headcount still being typed (empty, negative, a fraction) is read as the
 * whole number of people it names, and below one as none.
 */
export function suggestBuffer(
  headcount: number,
  rule: BufferSuggestionRule | null | undefined,
): number | null {
  if (!rule || bufferRuleProblem(rule) !== null || !rule.enabled) return null;
  const people = Number.isFinite(headcount) ? Math.floor(headcount) : 0;
  if (people < 1) return 0;
  const groups =
    rule.rounding === 'up' ? Math.ceil(people / rule.per) : Math.floor(people / rule.per);
  return Math.max(rule.minimum, groups);
}

/**
 * The rule in a few words for the builder's hint: "1 for every 5",
 * "1 for every 5, rounded up", "1 for every 5, at least 1".
 */
export function describeBufferRule(rule: BufferSuggestionRule): string {
  const parts = [`1 for every ${rule.per}`];
  if (rule.rounding === 'up') parts.push('rounded up');
  if (rule.minimum > 0) parts.push(`at least ${rule.minimum}`);
  return parts.join(', ');
}
