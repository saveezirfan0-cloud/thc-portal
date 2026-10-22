import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LEGAL_NAME_MAX,
  NAME_CORRECTION_MESSAGES,
  NAME_CORRECTION_REASON_MAX,
  NAME_CORRECTION_REASON_MIN,
  NAME_FAULTS,
  givenNames,
  nameFault,
  tidyName,
  validateNameCorrection,
} from '../legalName.ts';
import vectors from '../legalName.vectors.json' with { type: 'json' };

/**
 * ADR-0189: a name as it is printed on the passport. nameFault() here and
 * name_fault() in 20261023130100_legal_names_in_full.sql are the same rule,
 * and both are held to legalName.vectors.json — here, and in pgTAP 120
 * through legal_name_vectors.psql.
 */
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../../scripts/gen-vectors-sql.mjs');
const generated = resolve(here, '../../../../supabase/tests/_shared/legal_name_vectors.psql');

describe('nameFault — shared vectors (TS ↔ SQL name_fault)', () => {
  it.each(vectors.cases)('$name', ({ text, optional, fault }) => {
    expect(nameFault(text, optional)).toBe(fault);
  });

  it('only ever answers with a reason the SQL function and the form both know', () => {
    const reasons = new Set(vectors.cases.map((c) => c.fault).filter((f) => f !== null));
    for (const reason of reasons) expect(NAME_FAULTS).toContain(reason);
    // 'required' is the empty required field; the rest are the other three.
    expect(reasons).toEqual(new Set(['required', 'initial', 'characters', 'too_long']));
  });

  it('draws the limit where the vectors do', () => {
    expect(LEGAL_NAME_MAX).toBe(100);
  });
});

describe('the surnames in the report that started this', () => {
  it.each(['M.', 'M', 'G.', 'g.', 'E.', 'C.'])('refuses %s', (surname) => {
    expect(nameFault(surname)).toBe('initial');
  });

  it.each(['Martinez', 'Garcia', 'Edwards', 'Costa'])('takes %s', (surname) => {
    expect(nameFault(surname)).toBeNull();
  });
});

describe('givenNames', () => {
  it('joins the first and middle names as the passport lists them', () => {
    expect(givenNames('Marc', 'Antoni')).toBe('Marc Antoni');
    expect(givenNames('  Marc ', '  Antoni  Joan ')).toBe('Marc Antoni Joan');
  });

  it('is just the first name when there is no middle name', () => {
    expect(givenNames('Marc', '')).toBe('Marc');
    expect(givenNames('Marc', '   ')).toBe('Marc');
  });

  it('changes nothing else: capitalisation is the person’s own', () => {
    expect(givenNames('carlos', 'JOSE')).toBe('carlos JOSE');
  });
});

describe('the generated pgTAP vectors', () => {
  it('match legalName.vectors.json — run `pnpm --filter @thc/domain gen:vectors`', () => {
    const fresh = execFileSync('node', [script, '--stdout', 'legalName'], { encoding: 'utf8' });
    expect(readFileSync(generated, 'utf8')).toBe(fresh);
  });
});

describe('validateNameCorrection — the office puts a name right (ADR-0194)', () => {
  const current = { first: 'Marc', last: 'M.' };
  const reason = 'Passport checked in the office';

  it('takes a full name and a reason, tidied', () => {
    expect(
      validateNameCorrection(
        { first: '  Marc   Antoni ', last: ' Martinez ', reason: `  ${reason}  ` },
        current,
      ),
    ).toEqual({ ok: true, first: 'Marc Antoni', last: 'Martinez', reason });
  });

  it('refuses an initial, naming the part', () => {
    expect(validateNameCorrection({ first: 'Marc', last: 'M.', reason }, current)).toEqual({
      ok: false,
      field: 'last',
      reason: 'last_initial',
    });
    expect(validateNameCorrection({ first: 'J', last: 'Martinez', reason }, current)).toEqual({
      ok: false,
      field: 'first',
      reason: 'first_initial',
    });
  });

  it('asks for the first name before the surname, and the name before the reason', () => {
    expect(validateNameCorrection({ first: '', last: '', reason: '' }, current).ok).toBe(false);
    expect(validateNameCorrection({ first: '', last: 'M.', reason: '' }, current)).toMatchObject({
      field: 'first',
      reason: 'first_required',
    });
    expect(
      validateNameCorrection({ first: 'Marc', last: 'Martinez', reason: '' }, current),
    ).toMatchObject({ field: 'reason', reason: 'reason_required' });
  });

  it('refuses the name already on file, by the tidied text', () => {
    expect(
      validateNameCorrection(
        { first: ' Marc ', last: 'M.x', reason },
        { first: 'Marc', last: 'M.x' },
      ),
    ).toMatchObject({ reason: 'last_initial' });
    expect(
      validateNameCorrection(
        { first: ' Amara ', last: 'Kalu', reason },
        { first: 'Amara', last: 'Kalu' },
      ),
    ).toEqual({ ok: false, field: 'first', reason: 'unchanged' });
  });

  it('takes a capitalisation fix, which is a change', () => {
    expect(
      validateNameCorrection(
        { first: 'Carlos', last: 'Garcia', reason },
        { first: 'carlos', last: 'garcia' },
      ),
    ).toMatchObject({ ok: true });
  });

  it('bounds the reason at 10 to 300 characters', () => {
    const ok = { first: 'Marc', last: 'Martinez' };
    expect(
      validateNameCorrection(
        { ...ok, reason: 'x'.repeat(NAME_CORRECTION_REASON_MIN - 1) },
        current,
      ),
    ).toMatchObject({ reason: 'reason_too_short' });
    expect(
      validateNameCorrection({ ...ok, reason: 'x'.repeat(NAME_CORRECTION_REASON_MIN) }, current).ok,
    ).toBe(true);
    expect(
      validateNameCorrection({ ...ok, reason: 'x'.repeat(NAME_CORRECTION_REASON_MAX) }, current).ok,
    ).toBe(true);
    expect(
      validateNameCorrection(
        { ...ok, reason: 'x'.repeat(NAME_CORRECTION_REASON_MAX + 1) },
        current,
      ),
    ).toMatchObject({ reason: 'reason_too_long' });
  });

  it('has a sentence for every refusal it can give', () => {
    const codes = [
      ...NAME_FAULTS.map((f) => `first_${f}`),
      ...NAME_FAULTS.map((f) => `last_${f}`),
      'unchanged',
      'reason_required',
      'reason_too_short',
      'reason_too_long',
    ];
    expect(Object.keys(NAME_CORRECTION_MESSAGES).sort()).toEqual(codes.sort());
    for (const message of Object.values(NAME_CORRECTION_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10);
    }
  });

  it('tidyName composes accents and collapses spaces, as the database does', () => {
    expect(tidyName('  Zoe\u0308   Ann ')).toBe('Zo\u00eb Ann');
  });
});
