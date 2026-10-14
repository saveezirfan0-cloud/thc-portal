import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GENERIC,
  GONE,
  NOT_ALLOWED,
  asSentence,
  explainDbError,
  writtenForPeople,
} from '../dbError';

/**
 * Release audit 14.10.2026, D-M5: no Postgres text on screen. The cases
 * are the ones the audit saw, plus each SQLSTATE class the mapper knows.
 */
const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
afterEach(() => errorLog.mockClear());

describe('explainDbError', () => {
  it('a duplicate role name reads as a sentence, never the constraint', () => {
    const said = explainDbError(
      {
        code: '23505',
        message: 'duplicate key value violates unique constraint "roles_name_key"',
        details: 'Key (name)=(Waiting Staff) already exists.',
      },
      { unique: 'A role with that name already exists.' },
    );
    expect(said).toBe('A role with that name already exists.');
    // …and the detail is logged on the server, so it can still be found.
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('works from the text alone when the caller has no SQLSTATE', () => {
    expect(
      explainDbError('duplicate key value violates unique constraint "roles_name_key"'),
    ).not.toMatch(/constraint|duplicate key/);
    expect(
      explainDbError('insert or update on table "x" violates foreign key constraint "x_y_fkey"'),
    ).not.toMatch(/constraint|table/);
  });

  it('the B1 refusal reads as "not allowed", not the RLS text and not "only the office"', () => {
    const said = explainDbError({
      code: '42501',
      message: 'new row violates row-level security policy for table "audit_log"',
    });
    expect(said).toBe(NOT_ALLOWED);
    expect(said).not.toMatch(/audit_log|row-level|Only the office/);
  });

  it('keeps a sentence our own function raised, without the scope reference', () => {
    expect(
      explainDbError({
        code: '23514',
        message: 'Do not return needs a reason — it is shown on this client’s events (§9.6)',
      }),
    ).toBe('Do not return needs a reason — it is shown on this client’s events.');
    expect(
      explainDbError({
        code: '23503',
        message:
          'This role is on 2 rate card(s) and 0 event role section(s); remove it from those rate cards first',
      }),
    ).toBe(
      'This role is on 2 rate card(s) and 0 event role section(s); remove it from those rate cards first.',
    );
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('a check constraint from a table is worded, not quoted', () => {
    expect(
      explainDbError(
        {
          code: '23514',
          message: 'new row for relation "shift_requirements" violates check constraint "min_4h"',
        },
        { check: 'A role section is at least four hours.' },
      ),
    ).toBe('A role section is at least four hours.');
  });

  it('maps codes: the caller’s first, then the shared ones', () => {
    expect(
      explainDbError(
        { code: 'P0001', message: 'unknown_qualification' },
        {
          codes: { unknown_qualification: 'That qualification no longer exists.' },
        },
      ),
    ).toBe('That qualification no longer exists.');
    expect(explainDbError({ code: '42501', message: 'read_only' })).toMatch(/read-only/);
    expect(explainDbError({ code: '42501', message: 'not_authorised' })).toBe(NOT_ALLOWED);
    expect(explainDbError({ code: 'P0001', message: 'some_new_code' })).toBe(GENERIC);
  });

  it('an id in the message is not shown', () => {
    expect(
      explainDbError({ code: 'P0002', message: 'No client 6b1c9c1e-0000-4000-8000-000000000001' }),
    ).toBe(GONE);
  });

  it('falls back to the screen’s own generic sentence, and logs', () => {
    expect(
      explainDbError(
        { code: '22P02', message: 'invalid input syntax for type uuid: "x"' },
        { generic: 'The venue could not be saved.' },
      ),
    ).toBe('The venue could not be saved.');
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});

describe('writtenForPeople / asSentence', () => {
  it('tells a sentence from a code or a template', () => {
    expect(writtenForPeople('A comment is required')).toBe(true);
    expect(writtenForPeople('jo@x is not an email address')).toBe(true);
    expect(writtenForPeople('unknown_feedback')).toBe(false);
    expect(writtenForPeople('rota_guard_visa_cap: 24 h')).toBe(false);
    expect(writtenForPeople('permission denied for table roles')).toBe(false);
  });

  it('takes off scope and ADR references and ends with a full stop', () => {
    expect(asSentence('Refused (§9.6)')).toBe('Refused.');
    expect(asSentence('Refused (ADR-0060).')).toBe('Refused.');
    expect(asSentence('Already ended!')).toBe('Already ended!');
  });
});
