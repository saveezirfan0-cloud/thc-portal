import { describe, expect, it } from 'vitest';
import { parseRtwCheck, rtwLineForDoc } from '../rtwCheck';

/**
 * `my_rtw_check()`'s answer, typed, and when its line may show (ADR-0025).
 * The words themselves are the domain's — see rtwCheckLine.test.ts.
 */

describe('parseRtwCheck', () => {
  it('null, or nothing the RPC could have sent, is "no check"', () => {
    expect(parseRtwCheck(null)).toBeNull();
    expect(parseRtwCheck(undefined)).toBeNull();
    expect(parseRtwCheck('done')).toBeNull();
    expect(parseRtwCheck([])).toBeNull();
    expect(parseRtwCheck({})).toBeNull();
    expect(parseRtwCheck({ status: 'exploded', outcome: null, checkedAt: null })).toBeNull();
  });

  it.each(['queued', 'running', 'done', 'failed', 'cancelled'] as const)(
    'reads status %s',
    (status) => {
      expect(parseRtwCheck({ status, outcome: null, checkedAt: null })).toEqual({
        status,
        outcome: null,
        checkedAt: null,
      });
    },
  );

  it.each([
    'pass',
    'name_mismatch',
    'conditions_mismatch',
    'not_found',
    'no_right_to_work',
  ] as const)('reads outcome %s with its stamp', (outcome) => {
    expect(
      parseRtwCheck({ status: 'done', outcome, checkedAt: '2026-09-23T10:05:00+00:00' }),
    ).toEqual({ status: 'done', outcome, checkedAt: '2026-09-23T10:05:00+00:00' });
  });

  it('an outcome this build does not know reads as none; nothing else is carried', () => {
    expect(
      parseRtwCheck({
        status: 'done',
        outcome: 'something_new',
        checkedAt: '',
        name: 'Amara Kofi',
        conditions: 'Work limited to 20 hours',
      }),
    ).toEqual({ status: 'done', outcome: null, checkedAt: null });
  });
});

describe('rtwLineForDoc', () => {
  const entered = '2026-09-22T09:00:00+00:00';
  const line = { line: 'Checked with gov.uk — the office is confirming it.', checkedAt: null };

  it('shows the line on a pending share code', () => {
    expect(rtwLineForDoc(line, { pending: true, uploadedAt: entered })).toBe(line.line);
  });

  it('shows nothing once the office has decided, or without a check', () => {
    expect(rtwLineForDoc(line, { pending: false, uploadedAt: entered })).toBeNull();
    expect(rtwLineForDoc(null, { pending: true, uploadedAt: entered })).toBeNull();
    expect(rtwLineForDoc(undefined, { pending: true, uploadedAt: entered })).toBeNull();
  });

  it('a check stamped after the code was entered is about this code', () => {
    const after = { ...line, checkedAt: '2026-09-22T09:03:00+00:00' };
    expect(rtwLineForDoc(after, { pending: true, uploadedAt: entered })).toBe(line.line);
  });

  it('a check stamped before the code was entered belongs to an earlier code', () => {
    const before = { ...line, checkedAt: '2026-09-01T12:00:00+00:00' };
    expect(rtwLineForDoc(before, { pending: true, uploadedAt: entered })).toBeNull();
  });
});
