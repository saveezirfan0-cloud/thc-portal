/**
 * ADR-0181 — the suggested buffer ("overs").
 *
 * THC works to a rule of one extra person for every five staff. The Shift
 * Builder pre-fills a new role section's Buffer with it, and the manager can
 * always type over it. The buffer stays an absolute number, never a
 * percentage (§3.2, `buffer.ts`): the rule only proposes the number the
 * manager would otherwise have typed.
 *
 * The client's answers (21.10.2026): seven staff get two overs (round up);
 * a role under five gets none, unless it starts early — then one extra,
 * just in case. The rule lives in `settings.buffer_suggestion` so it can be
 * tuned on /settings without a release. Its keys are the stored row's own
 * spelling.
 *
 * Every time here is the role section's OWN start (RULE-18), "HH:MM" on
 * the UK wall clock as the builder holds it — never the event window.
 */

export type BufferRounding = 'down' | 'up';

export interface BufferSuggestionRule {
  /** Off: the builder suggests nothing and a new section starts at 0. */
  enabled: boolean;
  /** One extra for every `per` staff. A whole number, at least 1. */
  per: number;
  /** How a part-group counts: 7 staff at 1 per 5 is 1 ('down') or 2 ('up'). */
  rounding: BufferRounding;
  /** A role with fewer staff than this gets no extras by the group rule. */
  from_headcount: number;
  /**
   * "HH:MM", UK time, or null for no early-start rule: a role under
   * `from_headcount` whose own start is before this gets `early_start_extra`.
   */
  early_start_before: string | null;
  /** The extras a small, early role gets. */
  early_start_extra: number;
}

/** What THC asked for on 21.10.2026. */
export const DEFAULT_BUFFER_RULE: Readonly<BufferSuggestionRule> = Object.freeze({
  enabled: true,
  per: 5,
  rounding: 'up',
  from_headcount: 5,
  early_start_before: '08:00',
  early_start_extra: 1,
});

/** The bounds /settings and the database hold the rule to. */
export const BUFFER_RULE_LIMITS = Object.freeze({
  perMin: 1,
  perMax: 100,
  fromMin: 0,
  fromMax: 100,
  extraMin: 0,
  extraMax: 20,
});

/** The six keys, and no others (the database's guard holds the same list). */
export const BUFFER_RULE_KEYS = Object.freeze([
  'enabled',
  'per',
  'rounding',
  'from_headcount',
  'early_start_before',
  'early_start_extra',
] as const);

/** "HH:MM" on the 24-hour clock, 00:00–23:59 — the guard's pattern too. */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  const { perMin, perMax, fromMin, fromMax, extraMin, extraMax } = BUFFER_RULE_LIMITS;
  if (typeof rule['enabled'] !== 'boolean') return 'Choose whether the suggestion is on or off.';
  if (!wholeIn(rule['per'], perMin, perMax)) {
    return `"One extra for every" is a whole number of staff from ${perMin} to ${perMax}.`;
  }
  if (rule['rounding'] !== 'down' && rule['rounding'] !== 'up') {
    return 'Choose rounded up or down.';
  }
  if (!wholeIn(rule['from_headcount'], fromMin, fromMax)) {
    return `"Roles under" is a whole number of staff from ${fromMin} to ${fromMax}.`;
  }
  const early = rule['early_start_before'];
  if (early !== null && (typeof early !== 'string' || !CLOCK.test(early))) {
    return 'The early start is a time like 08:00, or blank for none.';
  }
  if (!wholeIn(rule['early_start_extra'], extraMin, extraMax)) {
    return `The early-start extra is a whole number from ${extraMin} to ${extraMax}.`;
  }
  const known: readonly string[] = BUFFER_RULE_KEYS;
  if (Object.keys(rule).some((key) => !known.includes(key))) {
    return 'Nothing else can be saved with the rule.';
  }
  return null;
}

/**
 * The rule as stored, or THC's default when the row is missing or not a
 * rule at all. A broken row must not quietly become "suggest nothing" — nor
 * a nonsense number; the default is what the office agreed. Only the six
 * keys are read, so a stray extra key does not throw the rule away.
 */
export function readBufferRule(raw: unknown): BufferSuggestionRule {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_BUFFER_RULE };
  const row = raw as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of BUFFER_RULE_KEYS) if (key in row) picked[key] = row[key];
  if (bufferRuleProblem(picked) !== null) return { ...DEFAULT_BUFFER_RULE };
  return picked as unknown as BufferSuggestionRule;
}

/** Does a role section starting at `start` ("HH:MM", UK) start before the rule's early start? */
export function startsEarly(
  start: string | null | undefined,
  rule: Pick<BufferSuggestionRule, 'early_start_before'>,
): boolean {
  return (
    rule.early_start_before !== null &&
    typeof start === 'string' &&
    CLOCK.test(start) &&
    start < rule.early_start_before
  );
}

/** The whole number of people a headcount being typed names; below one is none. */
function peopleIn(headcount: number): number {
  return Number.isFinite(headcount) ? Math.max(0, Math.floor(headcount)) : 0;
}

/**
 * The buffer a role section of `headcount` staff, starting at `start`,
 * should start with; or null when there is no suggestion (the rule is off,
 * missing or malformed).
 *
 *   THC's rule — 1 per 5, rounded up, from 5, +1 before 08:00:
 *   1–4 → 0 (1 if the role starts before 08:00) · 5 → 1 · 6–10 → 2 · 11 → 3
 *
 * A role with nobody on it gets nothing, early or not. A headcount still
 * being typed (empty, negative, a fraction) is read as the whole number of
 * people it names. A start still being typed is not early.
 */
export function suggestBuffer(
  headcount: number,
  rule: BufferSuggestionRule | null | undefined,
  start?: string | null,
): number | null {
  if (!rule || bufferRuleProblem(rule) !== null || !rule.enabled) return null;
  const people = peopleIn(headcount);
  if (people < 1) return 0;
  if (people < rule.from_headcount) return startsEarly(start, rule) ? rule.early_start_extra : 0;
  return rule.rounding === 'up' ? Math.ceil(people / rule.per) : Math.floor(people / rule.per);
}

/** Writes an "HH:MM" time the way the reader reads clocks; as typed by default. */
export type ClockWriter = (hhmm: string) => string;
const asTyped: ClockWriter = (hhmm) => hhmm;

/**
 * Why the builder suggests what it does, for the hint under Buffer:
 * "1 for every 5, rounded up" · "under 5 staff" ·
 * "under 5 staff, starts before 08:00".
 */
export function describeSuggestion(
  headcount: number,
  rule: BufferSuggestionRule,
  start?: string | null,
  clock: ClockWriter = asTyped,
): string {
  const people = peopleIn(headcount);
  if (people >= 1 && people < rule.from_headcount) {
    return startsEarly(start, rule)
      ? `under ${rule.from_headcount} staff, starts before ${clock(rule.early_start_before!)}`
      : `under ${rule.from_headcount} staff`;
  }
  return `1 for every ${rule.per}${rule.rounding === 'up' ? ', rounded up' : ''}`;
}

/**
 * The whole rule in the office's words, for /settings:
 * "One extra for every 5 staff, rounded up. Roles under 5 staff get none,
 * unless they start before 08:00 — then 1 extra."
 */
export function bufferRuleSentence(
  rule: BufferSuggestionRule,
  clock: ClockWriter = asTyped,
): string {
  const groups = `One extra for every ${rule.per} staff, rounded ${rule.rounding}.`;
  if (rule.from_headcount <= 1) return groups;
  const small = `Roles under ${rule.from_headcount} staff get none`;
  if (rule.early_start_before === null || rule.early_start_extra === 0) {
    return `${groups} ${small}.`;
  }
  return `${groups} ${small}, unless they start before ${clock(rule.early_start_before)} — then ${rule.early_start_extra} extra.`;
}
