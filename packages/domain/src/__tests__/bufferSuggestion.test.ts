import { describe, expect, it } from 'vitest';
import { formatAllocationPair } from '../buffer';
import {
  BUFFER_RULE_KEYS,
  type BufferSuggestionRule,
  DEFAULT_BUFFER_RULE,
  bufferRuleProblem,
  bufferRuleSentence,
  describeSuggestion,
  readBufferRule,
  startsEarly,
  suggestBuffer,
} from '../bufferSuggestion';
import vectors from '../bufferSuggestion.vectors.json';

/**
 * ADR-0181: THC's suggested overs, as the client answered on 21.10.2026 —
 * one for every five, rounded up; a role under five gets none unless it
 * starts before 08:00, then one. The vectors file is the contract with the
 * database's guard (pgTAP 916 holds the same accepted and refused shapes).
 */
const rule = (over: Partial<BufferSuggestionRule> = {}): BufferSuggestionRule => ({
  ...DEFAULT_BUFFER_RULE,
  ...over,
});

describe('the default is what the client asked for', () => {
  it('matches the vectors file and the seed', () => {
    expect(DEFAULT_BUFFER_RULE).toEqual(vectors.defaultRule);
    expect(bufferRuleProblem(DEFAULT_BUFFER_RULE)).toBeNull();
  });
});

describe('suggestions (vectors)', () => {
  it.each(vectors.suggestions)('$name → $expect', ({ headcount, start, rule: over, expect: n }) => {
    expect(suggestBuffer(headcount, rule(over as Partial<BufferSuggestionRule>), start)).toBe(n);
  });

  it('4 → 0 (1 if early), 5 → 1, 6 → 2, 7 → 2, 10 → 2, 11 → 3', () => {
    const late = [4, 5, 6, 7, 10, 11].map((n) => suggestBuffer(n, DEFAULT_BUFFER_RULE, '17:00'));
    expect(late).toEqual([0, 1, 2, 2, 2, 3]);
    expect(suggestBuffer(4, DEFAULT_BUFFER_RULE, '07:00')).toBe(1);
  });

  it('is shown as a pair, never added in', () => {
    expect(formatAllocationPair(11, suggestBuffer(11, DEFAULT_BUFFER_RULE, '17:00')!)).toBe(
      '11 (+3)',
    );
  });
});

describe('the start that counts is the role section’s own', () => {
  it('a small role with no start known is not early', () => {
    expect(suggestBuffer(3, DEFAULT_BUFFER_RULE)).toBe(0);
    expect(suggestBuffer(3, DEFAULT_BUFFER_RULE, null)).toBe(0);
  });

  it('compares wall-clock times, strictly before', () => {
    expect(startsEarly('07:59', DEFAULT_BUFFER_RULE)).toBe(true);
    expect(startsEarly('08:00', DEFAULT_BUFFER_RULE)).toBe(false);
    expect(startsEarly('7:00', DEFAULT_BUFFER_RULE)).toBe(false);
    expect(startsEarly('07:00', rule({ early_start_before: null }))).toBe(false);
  });
});

describe('no suggestion at all', () => {
  it('when switched off, missing or malformed', () => {
    expect(suggestBuffer(10, rule({ enabled: false }))).toBeNull();
    expect(suggestBuffer(10, null)).toBeNull();
    expect(suggestBuffer(10, undefined)).toBeNull();
    expect(suggestBuffer(10, rule({ per: 0 }))).toBeNull();
  });
});

describe('a headcount still being typed', () => {
  it('reads empty, negative or not a number as nobody', () => {
    expect(suggestBuffer(Number(''), DEFAULT_BUFFER_RULE, '06:00')).toBe(0);
    expect(suggestBuffer(-5, DEFAULT_BUFFER_RULE, '06:00')).toBe(0);
    expect(suggestBuffer(Number.NaN, DEFAULT_BUFFER_RULE, '06:00')).toBe(0);
  });

  it('reads a fraction as the whole people it names', () => {
    expect(suggestBuffer(5.9, DEFAULT_BUFFER_RULE, '17:00')).toBe(1);
    expect(suggestBuffer(4.9, DEFAULT_BUFFER_RULE, '17:00')).toBe(0);
  });
});

describe('validating a rule (vectors shared with the database guard)', () => {
  it.each(vectors.rules.accepted)('accepts $name', ({ value }) => {
    expect(bufferRuleProblem(value)).toBeNull();
  });

  it.each(vectors.rules.refused)('refuses $name', ({ value }) => {
    expect(bufferRuleProblem(value)).toEqual(expect.any(String));
  });

  it('says what is wrong in plain words', () => {
    expect(bufferRuleProblem(rule({ per: 0 }))).toBe(
      '"One extra for every" is a whole number of staff from 1 to 100.',
    );
    expect(bufferRuleProblem(rule({ from_headcount: -1 }))).toBe(
      '"Roles under" is a whole number of staff from 0 to 100.',
    );
    expect(bufferRuleProblem(rule({ early_start_before: '8am' }))).toBe(
      'The early start is a time like 08:00, or blank for none.',
    );
    expect(bufferRuleProblem(rule({ early_start_extra: 21 }))).toBe(
      'The early-start extra is a whole number from 0 to 20.',
    );
  });

  it('names exactly the six keys', () => {
    expect([...BUFFER_RULE_KEYS].sort()).toEqual(Object.keys(DEFAULT_BUFFER_RULE).sort());
  });
});

describe('reading the stored rule', () => {
  it('keeps a valid one, and only its six keys', () => {
    const stored = { ...rule({ enabled: false, per: 4, rounding: 'down' }), stray: 1 };
    expect(readBufferRule(stored)).toEqual(rule({ enabled: false, per: 4, rounding: 'down' }));
  });

  it('keeps a rule with no early start', () => {
    expect(readBufferRule(rule({ early_start_before: null })).early_start_before).toBeNull();
  });

  it('falls back to the default when missing or malformed — never to "off"', () => {
    expect(readBufferRule(undefined)).toEqual(DEFAULT_BUFFER_RULE);
    expect(readBufferRule(null)).toEqual(DEFAULT_BUFFER_RULE);
    expect(readBufferRule({ enabled: true, per: 5, rounding: 'down', minimum: 0 })).toEqual(
      DEFAULT_BUFFER_RULE,
    );
    expect(readBufferRule('{"per":5}')).toEqual(DEFAULT_BUFFER_RULE);
  });

  it('returns a copy, so nobody can change the default by accident', () => {
    const read = readBufferRule(null);
    read.per = 9;
    expect(DEFAULT_BUFFER_RULE.per).toBe(5);
  });
});

describe('the rule in words', () => {
  it('says why, for the builder hint', () => {
    expect(describeSuggestion(10, DEFAULT_BUFFER_RULE, '17:00')).toBe('1 for every 5, rounded up');
    expect(describeSuggestion(10, rule({ rounding: 'down' }), '17:00')).toBe('1 for every 5');
    expect(describeSuggestion(3, DEFAULT_BUFFER_RULE, '17:00')).toBe('under 5 staff');
    expect(describeSuggestion(3, DEFAULT_BUFFER_RULE, '06:00')).toBe(
      'under 5 staff, starts before 08:00',
    );
    expect(
      describeSuggestion(3, DEFAULT_BUFFER_RULE, '06:00', (t) => (t === '08:00' ? '8:00 am' : t)),
    ).toBe('under 5 staff, starts before 8:00 am');
  });

  it('says the whole rule, for /settings', () => {
    expect(bufferRuleSentence(DEFAULT_BUFFER_RULE)).toBe(
      'One extra for every 5 staff, rounded up. Roles under 5 staff get none, unless they start before 08:00 — then 1 extra.',
    );
    expect(bufferRuleSentence(rule({ rounding: 'down', early_start_before: null }))).toBe(
      'One extra for every 5 staff, rounded down. Roles under 5 staff get none.',
    );
    expect(bufferRuleSentence(rule({ from_headcount: 0 }))).toBe(
      'One extra for every 5 staff, rounded up.',
    );
  });
});
