import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import vectors from '../cap.vectors.json' with { type: 'json' };
import {
  canRoster,
  capEvidence,
  capWeekDays,
  capWeekStart,
  explainCap,
  remainingHours,
  resolveTermState,
  weeklyCap,
} from '../cap';
import type { CapInput } from '../cap';
// The generator that produces the pgTAP copy of these vectors. Importing it
// here is what keeps the two suites honest: see the drift test below.
import { VECTORS_PSQL, renderCapVectors } from '../../../../supabase/tests/_shared/cap-vectors.mjs';

describe('weekly cap (RULE-20)', () => {
  it.each(vectors.cases)('$name', ({ input, expect: expected }) => {
    expect(weeklyCap(input as CapInput)).toEqual({
      capHours: expected.capHours,
      band: expected.band,
    });
  });

  it('never reports negative remaining hours', () => {
    expect(remainingHours({ capHours: 20, band: 'student_term_20' }, 26)).toBe(0);
  });

  it('reports no ceiling as null, not Infinity', () => {
    expect(remainingHours({ capHours: null, band: 'uncapped' }, 60)).toBeNull();
  });
});

// The vectors are only a contract while both sides run the same ones.
// supabase/tests/090_weekly_cap.sql loads a generated copy of this JSON,
// so a case added here without regenerating would quietly leave the SQL
// implementation untested. That is what this catches.
describe('cap vectors are the same on both sides', () => {
  it('supabase/tests/_shared/cap_vectors.psql matches cap.vectors.json', () => {
    expect(readFileSync(VECTORS_PSQL, 'utf8')).toBe(renderCapVectors(vectors));
  });

  it('covers every band the resolver can return', () => {
    const bands = new Set(vectors.cases.map((c) => c.expect.band));
    expect([...bands].sort()).toEqual([
      'graduated_48',
      'standard_48',
      'student_holiday_48',
      'student_term_10',
      'student_term_20',
      'uncapped',
      'visa_expired_0',
    ]);
  });
});

// §4.4: the week is Mon–Sun, and it takes the LOWEST cap in force on any
// day of it. resolveTermState is the half of that which reads the letter.
describe('term state off the verified holiday ranges', () => {
  const holidays = [{ from: '2026-12-17', to: '2027-01-05' }];

  it('starts the week on Monday', () => {
    expect(capWeekStart('2026-11-08')).toBe('2026-11-02'); // Sunday
    expect(capWeekStart('2026-11-02')).toBe('2026-11-02'); // Monday
  });

  it('is holiday only when every day of the week is inside a range', () => {
    expect(resolveTermState(holidays, '2026-12-23')).toBe('holiday');
  });

  it('is term when no day of the week is inside a range', () => {
    expect(resolveTermState(holidays, '2026-11-04')).toBe('term');
  });

  it('straddles the week the holiday begins in', () => {
    expect(resolveTermState(holidays, '2026-12-17')).toBe('straddle');
  });

  it('straddles the week term restarts in, which is then a 20-hour week', () => {
    expect(resolveTermState(holidays, '2027-01-07')).toBe('straddle');
    expect(
      weeklyCap({
        visaLimited: true,
        termState: resolveTermState(holidays, '2027-01-07'),
        completionLetterVerified: false,
        optOut48h: false,
      }).capHours,
    ).toBe(20);
  });

  it('reads no ranges on file as term time, the safe reading', () => {
    expect(resolveTermState([], '2026-11-04')).toBe('term');
  });
});

// §2.3 / §4.4: "displayed, never edited" — the profile shows the cap and
// what produced it. There is no field to type a number into.
describe('the profile line', () => {
  const student: CapInput = {
    visaLimited: true,
    termState: 'term',
    completionLetterVerified: false,
    optOut48h: false,
  };

  it('names term time and the date it runs to', () => {
    expect(explainCap(student, weeklyCap(student), { until: '2026-12-13' })).toBe(
      '20 h/week — term time until 13.12.2026',
    );
  });

  it('names the university holiday and the date it runs to', () => {
    const input = { ...student, termState: 'holiday' as const };
    expect(explainCap(input, weeklyCap(input), { until: '2027-01-05' })).toBe(
      '48 h/week — university holiday until 05.01.2027',
    );
  });

  it('replaces the term-time cycle once the completion letter is verified', () => {
    const input = { ...student, completionLetterVerified: true };
    expect(explainCap(input, weeklyCap(input), { graduatedOn: '2026-07-04' })).toBe(
      '48 h/week — graduated, completion letter verified 04.07.2026',
    );
  });

  it('says no weekly limit where the opt-out has removed the ceiling', () => {
    const input = { ...student, termState: 'holiday' as const, optOut48h: true };
    expect(explainCap(input, weeklyCap(input))).toBe('No weekly limit — 48-hour opt-out signed');
  });

  it('reports which document set the cap, for the §9.6 Student visa view', () => {
    expect(capEvidence(student)).toBe('term_letter');
    expect(capEvidence({ ...student, completionLetterVerified: true })).toBe('completion_letter');
    expect(capEvidence({ ...student, visaLimited: false })).toBe('none');
  });
});

// ---------------------------------------------------------------------
// The per-shift right-to-work hard stop (University Completion Letter
// Requirement §2.3, acceptance criterion 6). The weekly cap cannot express
// this: the week a visa expires has workable days before it and none after.
// ---------------------------------------------------------------------
describe('canRoster — the visa expiry hard stop', () => {
  it('allows a shift on the expiry date itself, which is inclusive', () => {
    expect(canRoster('2026-09-30', '2026-09-30')).toBe(true);
  });

  it('blocks the day after expiry', () => {
    expect(canRoster('2026-10-01', '2026-09-30')).toBe(false);
  });

  it('allows everything when no expiry is recorded', () => {
    expect(canRoster('2030-01-01')).toBe(true);
  });

  it('blocks the back half of the week the visa expires', () => {
    // The same week weeklyCap() still reports 48: the cap is not the gate
    // here, this is.
    const week = capWeekDays('2026-09-28');
    expect(week.map((d) => canRoster(d, '2026-09-30'))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});
