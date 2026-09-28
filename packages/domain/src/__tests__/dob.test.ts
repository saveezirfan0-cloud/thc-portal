import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import vectors from '../changeRequest.vectors.json' with { type: 'json' };
import {
  DOB_CORRECTION_MESSAGES,
  DOB_CORRECTION_REASON_MAX,
  DOB_CORRECTION_REASON_MIN,
  dobChangeProblem,
  dobProblem,
  dobShownFrom,
  dobValueFrom,
  formatDobTyping,
  isRealIsoDate,
  validateDobCorrection,
} from '../dob';

/**
 * ADR-0069. dobChangeProblem() and dob_change_problem() in
 * 20261001209000 are held to the `dobs` group of changeRequest.vectors.json
 * — here, and in pgTAP 717 through change_request_vectors.psql.
 */
const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(here, '../../../../supabase/migrations/20261001209000_date_of_birth_corrections.sql'),
  'utf8',
);

describe('dobChangeProblem — the shared vectors', () => {
  it.each(vectors.dobs.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const today = 'today' in c && c.today ? c.today : vectors.dobs.today;
    expect(dobChangeProblem(c.input, vectors.dobs.current, today)).toBe(c.expect);
  });

  it('every case carries its reference', () => {
    for (const c of vectors.dobs.cases) expect(c.ref).toMatch(/ADR-0069|§2\.1/);
  });

  it('refuses in the SQL function what it refuses here, by the same codes', () => {
    const start = migration.indexOf('create or replace function public.dob_change_problem(');
    const body = migration.slice(start, migration.indexOf('$$;', start));
    const codes = [...body.matchAll(/return '([a-z_0-9]+)'/g)].map((m) => m[1]);
    expect(codes).toEqual(['dob_required', 'dob_invalid', 'dob_invalid', 'under_18', 'unchanged']);
  });
});

describe('dobProblem', () => {
  it('refuses a day that does not exist', () => {
    expect(isRealIsoDate('1995-02-31')).toBe(false);
    expect(dobProblem('1995-02-31', '2026-09-28')).toBe('dob_invalid');
    expect(dobProblem('31/01/1995', '2026-09-28')).toBe('dob_invalid');
  });

  it('a 29 February birthday is 18 on 1 March in a common year, not on 28 February', () => {
    expect(dobProblem('2008-02-29', '2026-02-28')).toBe('under_18');
    expect(dobProblem('2008-02-29', '2026-03-01')).toBeNull();
  });

  it('without a date on file, nothing is "unchanged"', () => {
    expect(dobChangeProblem('1995-01-01', null, '2026-09-28')).toBeNull();
  });
});

describe('validateDobCorrection — the office dialog, in office_correct_dob()’s order', () => {
  const today = '2026-09-28';
  const reason = 'Passport shows 31 December';

  it('accepts a real change with a reason, trimmed', () => {
    expect(
      validateDobCorrection({ dob: '1994-12-31', reason: `  ${reason} ` }, '1995-01-01', today),
    ).toEqual({
      ok: true,
      dob: '1994-12-31',
      reason,
    });
  });

  it('checks the date before the reason', () => {
    expect(validateDobCorrection({ dob: '1995-01-01', reason: '' }, '1995-01-01', today)).toEqual({
      ok: false,
      field: 'dob',
      reason: 'unchanged',
    });
  });

  it.each([
    ['', 'reason_required'],
    ['   ', 'reason_required'],
    ['x'.repeat(DOB_CORRECTION_REASON_MIN - 1), 'reason_too_short'],
    ['x'.repeat(DOB_CORRECTION_REASON_MAX + 1), 'reason_too_long'],
  ])('reason %j → %s', (text, code) => {
    expect(validateDobCorrection({ dob: '1994-12-31', reason: text }, '1995-01-01', today)).toEqual(
      {
        ok: false,
        field: 'reason',
        reason: code,
      },
    );
  });

  it('takes exactly the minimum and the maximum', () => {
    for (const n of [DOB_CORRECTION_REASON_MIN, DOB_CORRECTION_REASON_MAX]) {
      expect(
        validateDobCorrection({ dob: '1994-12-31', reason: 'r'.repeat(n) }, '1995-01-01', today).ok,
      ).toBe(true);
    }
  });

  it('has the same bounds as the database', () => {
    expect(migration).toContain(`char_length(v_reason) < ${DOB_CORRECTION_REASON_MIN}`);
    expect(migration).toContain(`char_length(v_reason) > ${DOB_CORRECTION_REASON_MAX}`);
  });

  it('has a sentence for every refusal, with no scope reference in it', () => {
    for (const text of Object.values(DOB_CORRECTION_MESSAGES)) {
      expect(text).not.toMatch(/§|RULE-/);
      expect(text.length).toBeGreaterThan(10);
    }
  });
});

describe('typing it (ADR-0068, lifted from the Staff App)', () => {
  it('draws the slashes and turns autofill round', () => {
    expect(formatDobTyping('05061998')).toBe('05/06/1998');
    expect(formatDobTyping('5/6/1998')).toBe('05/06/1998');
    expect(formatDobTyping('1998-06-05')).toBe('05/06/1998');
    expect(dobValueFrom('05/06/1998')).toBe('1998-06-05');
    expect(dobValueFrom('05/06/19')).toBe('05/06/19');
    expect(dobShownFrom('1998-06-05')).toBe('05/06/1998');
  });
});
