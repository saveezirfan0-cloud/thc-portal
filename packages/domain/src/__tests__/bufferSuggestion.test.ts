import { describe, expect, it } from 'vitest';
import {
  BUFFER_RULE_LIMITS,
  type BufferSuggestionRule,
  DEFAULT_BUFFER_RULE,
  bufferRuleProblem,
  describeBufferRule,
  formatAllocationPair,
  readBufferRule,
  suggestBuffer,
} from '../buffer';

/**
 * ADR-0181: THC's "one extra for every five staff", as a suggestion the
 * Shift Builder pre-fills. Configurable on /settings because two answers
 * are still with the client (under five: 0 or 1? seven: 1 or 2?).
 */
const rule = (over: Partial<BufferSuggestionRule> = {}): BufferSuggestionRule => ({
  ...DEFAULT_BUFFER_RULE,
  ...over,
});

describe('the default: one for every five, rounded down, no minimum', () => {
  it('is what THC asked for', () => {
    expect(DEFAULT_BUFFER_RULE).toEqual({ enabled: true, per: 5, rounding: 'down', minimum: 0 });
  });

  it.each([
    [0, 0],
    [1, 0],
    [4, 0],
    [5, 1],
    [6, 1],
    [7, 1],
    [9, 1],
    [10, 2],
    [11, 2],
    [14, 2],
    [15, 3],
    [100, 20],
    [1000, 200],
  ])('%i staff → %i extra', (headcount, extra) => {
    expect(suggestBuffer(headcount, DEFAULT_BUFFER_RULE)).toBe(extra);
  });

  it('is still shown as a pair, never added in', () => {
    expect(formatAllocationPair(10, suggestBuffer(10, DEFAULT_BUFFER_RULE)!)).toBe('10 (+2)');
  });
});

describe('rounded up', () => {
  const up = rule({ rounding: 'up' });

  it.each([
    [0, 0],
    [1, 1],
    [4, 1],
    [5, 1],
    [6, 2],
    [7, 2],
    [10, 2],
    [11, 3],
    [1000, 200],
    [1001, 201],
  ])('%i staff → %i extra', (headcount, extra) => {
    expect(suggestBuffer(headcount, up)).toBe(extra);
  });
});

describe('a minimum per role', () => {
  it('lifts a small role to the minimum', () => {
    const atLeastOne = rule({ minimum: 1 });
    expect(suggestBuffer(1, atLeastOne)).toBe(1);
    expect(suggestBuffer(4, atLeastOne)).toBe(1);
    expect(suggestBuffer(10, atLeastOne)).toBe(2);
  });

  it('never applies to a role with nobody on it', () => {
    expect(suggestBuffer(0, rule({ minimum: 3 }))).toBe(0);
  });

  it('works with rounding up too', () => {
    expect(suggestBuffer(6, rule({ rounding: 'up', minimum: 3 }))).toBe(3);
    expect(suggestBuffer(16, rule({ rounding: 'up', minimum: 3 }))).toBe(4);
  });
});

describe('other group sizes', () => {
  it('one per staff member is the headcount', () => {
    expect(suggestBuffer(7, rule({ per: 1 }))).toBe(7);
  });

  it('one per ten', () => {
    expect(suggestBuffer(9, rule({ per: 10 }))).toBe(0);
    expect(suggestBuffer(25, rule({ per: 10 }))).toBe(2);
    expect(suggestBuffer(25, rule({ per: 10, rounding: 'up' }))).toBe(3);
  });
});

describe('no suggestion at all', () => {
  it('when switched off', () => {
    expect(suggestBuffer(10, rule({ enabled: false }))).toBeNull();
  });

  it('when there is no rule, or it is malformed', () => {
    expect(suggestBuffer(10, null)).toBeNull();
    expect(suggestBuffer(10, undefined)).toBeNull();
    expect(suggestBuffer(10, rule({ per: 0 }))).toBeNull();
  });
});

describe('a headcount still being typed', () => {
  it('reads empty, negative or not a number as nobody', () => {
    expect(suggestBuffer(Number(''), DEFAULT_BUFFER_RULE)).toBe(0);
    expect(suggestBuffer(-5, DEFAULT_BUFFER_RULE)).toBe(0);
    expect(suggestBuffer(Number.NaN, rule({ minimum: 2 }))).toBe(0);
  });

  it('reads a fraction as the whole people it names', () => {
    expect(suggestBuffer(9.9, DEFAULT_BUFFER_RULE)).toBe(1);
  });
});

describe('validating a rule (the settings screen and the database agree)', () => {
  it('accepts the default and the edges', () => {
    expect(bufferRuleProblem(DEFAULT_BUFFER_RULE)).toBeNull();
    expect(bufferRuleProblem(rule({ per: BUFFER_RULE_LIMITS.perMin }))).toBeNull();
    expect(bufferRuleProblem(rule({ per: BUFFER_RULE_LIMITS.perMax }))).toBeNull();
    expect(bufferRuleProblem(rule({ minimum: BUFFER_RULE_LIMITS.minimumMax }))).toBeNull();
    expect(bufferRuleProblem(rule({ enabled: false, rounding: 'up' }))).toBeNull();
  });

  it.each<[string, unknown]>([
    ['nothing', null],
    ['a list', [1, 2]],
    ['a number', 5],
    ['no on/off', { per: 5, rounding: 'down', minimum: 0 }],
    ['on/off as text', { ...DEFAULT_BUFFER_RULE, enabled: 'true' }],
    ['per 0', rule({ per: 0 })],
    ['per too large', rule({ per: 101 })],
    ['per a fraction', rule({ per: 2.5 })],
    ['per as text', { ...DEFAULT_BUFFER_RULE, per: '5' }],
    ['another rounding', { ...DEFAULT_BUFFER_RULE, rounding: 'nearest' }],
    ['a negative minimum', rule({ minimum: -1 })],
    ['a minimum too large', rule({ minimum: 21 })],
    ['a fractional minimum', rule({ minimum: 0.5 })],
  ])('refuses %s', (_, value) => {
    expect(bufferRuleProblem(value)).toEqual(expect.any(String));
  });

  it('says what is wrong in plain words', () => {
    expect(bufferRuleProblem(rule({ per: 0 }))).toBe(
      '"For every" is a whole number of staff from 1 to 100.',
    );
    expect(bufferRuleProblem(rule({ minimum: -1 }))).toBe(
      '"At least" is a whole number from 0 to 20.',
    );
  });
});

describe('reading the stored rule', () => {
  it('keeps a valid one, and only its four keys', () => {
    expect(readBufferRule({ enabled: false, per: 4, rounding: 'up', minimum: 1, x: 1 })).toEqual({
      enabled: false,
      per: 4,
      rounding: 'up',
      minimum: 1,
    });
  });

  it('falls back to the default when missing or malformed — never to "off"', () => {
    expect(readBufferRule(undefined)).toEqual(DEFAULT_BUFFER_RULE);
    expect(readBufferRule(null)).toEqual(DEFAULT_BUFFER_RULE);
    expect(readBufferRule({ enabled: true, per: 0 })).toEqual(DEFAULT_BUFFER_RULE);
    expect(readBufferRule('{"per":5}')).toEqual(DEFAULT_BUFFER_RULE);
  });

  it('returns a copy, so nobody can change the default by accident', () => {
    const read = readBufferRule(null);
    read.per = 9;
    expect(DEFAULT_BUFFER_RULE.per).toBe(5);
  });
});

describe('the rule in words, for the builder hint', () => {
  it('reads as THC says it', () => {
    expect(describeBufferRule(DEFAULT_BUFFER_RULE)).toBe('1 for every 5');
    expect(describeBufferRule(rule({ rounding: 'up' }))).toBe('1 for every 5, rounded up');
    expect(describeBufferRule(rule({ per: 4, minimum: 1 }))).toBe('1 for every 4, at least 1');
  });
});
