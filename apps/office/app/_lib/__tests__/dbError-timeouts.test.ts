import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TIMED_OUT,
  UNREACHABLE,
  explainDbError,
  isStatementTimeout,
  isUnreachable,
  readProblem,
} from '../dbError';

/**
 * A read the database did not answer in time says so in a sentence
 * (go-live audit 17.10.2026, M1), on every loader (`readProblem`) and every
 * action (`explainDbError`) — never "canceling statement due to statement
 * timeout" or "TypeError: fetch failed" on the screen.
 */

afterEach(() => vi.restoreAllMocks());

const TIMEOUT = { code: '57014', message: 'canceling statement due to statement timeout' };
// What postgrest-js resolves to when the fetch is aborted or fails.
const ABORTED = {
  code: '',
  message: 'AbortError: This operation was aborted',
  details: '',
};
const FETCH_FAILED = {
  code: '',
  message: 'TypeError: fetch failed',
  details: 'TypeError: fetch failed\n\nCaused by: Error: read ECONNRESET (ECONNRESET)',
};

describe('readProblem', () => {
  it('a statement timeout, by code or by text, is the busy sentence', () => {
    expect(readProblem(TIMEOUT)).toBe(TIMED_OUT);
    expect(readProblem({ message: 'canceling statement due to statement timeout' })).toBe(
      TIMED_OUT,
    );
    expect(readProblem('canceling statement due to statement timeout')).toBe(TIMED_OUT);
  });

  it('an aborted or failed fetch is the unreachable sentence', () => {
    expect(readProblem(ABORTED)).toBe(UNREACHABLE);
    expect(readProblem(FETCH_FAILED)).toBe(UNREACHABLE);
    expect(readProblem({ message: 'upstream request timeout' })).toBe(UNREACHABLE);
  });

  it('wins over the context, which would only frame a sentence that is already whole', () => {
    expect(readProblem(TIMEOUT, 'The event could not be read')).toBe(TIMED_OUT);
  });

  it('keeps any other message as before, after its context', () => {
    expect(readProblem({ message: 'permission denied for view staff_directory_v' })).toBe(
      'permission denied for view staff_directory_v',
    );
    expect(readProblem({ message: 'boom' }, 'Events could not be loaded')).toBe(
      'Events could not be loaded: boom',
    );
  });

  it('null in, null out — so `readProblem(a.error ?? b.error)` replaces the old chains', () => {
    expect(readProblem(null)).toBeNull();
    expect(readProblem(undefined)).toBeNull();
  });
});

describe('the detectors', () => {
  it('do not mistake an ordinary refusal for either', () => {
    for (const err of [
      { code: '23505', message: 'duplicate key value violates unique constraint "roles_name_key"' },
      { code: '42501', message: 'admins_only' },
      { message: 'There are more than 20,000 staff to read at once. Narrow the filters.' },
    ]) {
      expect(isStatementTimeout(err)).toBe(false);
      expect(isUnreachable(err)).toBe(false);
    }
  });
});

describe('explainDbError', () => {
  it('maps a timeout and an unreachable database for actions too, and logs them', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(explainDbError(TIMEOUT)).toBe(TIMED_OUT);
    expect(explainDbError(FETCH_FAILED, { log: '[roles]' })).toBe(UNREACHABLE);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('still lets a screen’s own code win', () => {
    expect(explainDbError({ code: '57014', message: 'read_only' })).not.toBe(TIMED_OUT);
  });
});
