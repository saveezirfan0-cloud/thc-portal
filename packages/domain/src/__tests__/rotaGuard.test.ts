import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import vectors from '../rotaGuard.vectors.json' with { type: 'json' };
import { rotaGuardMessage, rotaGuardVerdict } from '../rotaGuard';
import type { RotaGuardInput } from '../rotaGuard';
import {
  ROTA_VECTORS_PSQL,
  renderRotaGuardVectors,
} from '../../../../supabase/tests/_shared/rota-guard-vectors.mjs';

describe('rota guard — shared vectors (TS ↔ SQL rota_guard_decide)', () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(rotaGuardVerdict(c.input as RotaGuardInput)).toEqual(c.expect);
  });

  it('supabase/tests/_shared/rota_guard_vectors.psql matches rotaGuard.vectors.json', () => {
    expect(readFileSync(ROTA_VECTORS_PSQL, 'utf8')).toBe(renderRotaGuardVectors(vectors));
  });

  it('covers every verdict and every reason, so no branch is untested on either side', () => {
    const verdicts = new Set(vectors.cases.map((c) => c.expect.verdict));
    const reasons = new Set(vectors.cases.map((c) => c.expect.reason));
    expect([...verdicts].sort()).toEqual(['block', 'ok', 'warn']);
    expect(reasons).toEqual(new Set([null, 'rtw_expired', 'visa_cap', 'wtr_cap']));
  });
});

describe('what the setting can and cannot relax', () => {
  const over = (band: RotaGuardInput['band'], cap: number): RotaGuardInput => ({
    canRoster: true,
    capHours: cap,
    band,
    bookedHours: cap,
    shiftHours: 4,
    mode: 'warn',
  });

  it('warn mode never relaxes a Student visa band', () => {
    expect(rotaGuardVerdict(over('student_term_20', 20)).verdict).toBe('block');
    expect(rotaGuardVerdict(over('student_term_10', 10)).verdict).toBe('block');
  });

  it('warn mode never relaxes the right-to-work stop', () => {
    expect(rotaGuardVerdict({ ...over('uncapped', 0), capHours: null, canRoster: false })).toEqual({
      verdict: 'block',
      reason: 'rtw_expired',
    });
  });

  it('warn mode relaxes only the Working Time 48', () => {
    for (const band of ['standard_48', 'graduated_48', 'student_holiday_48'] as const) {
      expect(rotaGuardVerdict(over(band, 48))).toEqual({ verdict: 'warn', reason: 'wtr_cap' });
    }
  });

  it('has a message for every reason the database can raise', () => {
    for (const reason of ['rtw_expired', 'visa_cap', 'wtr_cap'] as const) {
      expect(rotaGuardMessage(reason)).toMatch(/\w/);
    }
  });
});
