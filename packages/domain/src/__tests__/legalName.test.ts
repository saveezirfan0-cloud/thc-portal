import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LEGAL_NAME_MAX, NAME_FAULTS, givenNames, nameFault } from '../legalName.ts';
import vectors from '../legalName.vectors.json' with { type: 'json' };

/**
 * ADR-0187: a name as it is printed on the passport. nameFault() here and
 * name_fault() in 20261023130000_legal_names_in_full.sql are the same rule,
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
