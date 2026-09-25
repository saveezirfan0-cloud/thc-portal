import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import vectors from '../availability.vectors.json' with { type: 'json' };
import {
  CALENDAR_GATE,
  expandWeekly,
  overlapsSection,
  unavailabilityRange,
  validateUnavailability,
  withAvailability,
  type UnavailabilityInput,
} from '../availability';
import type { CandidateRow } from '../autoAssign';
import { HARD_GATES } from '../scoring';

/**
 * ADR-0036 (docs/18 §1). availability.vectors.json is the contract between
 * this module and unavailability_range() / staff_unavailable() / the
 * staff_unavailability CHECKs; pgTAP 651 runs the same cases through the
 * generated availability_vectors.psql.
 */
const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../../scripts/gen-vectors-sql.mjs');
const generated = resolve(here, '../../../../supabase/tests/_shared/availability_vectors.psql');

const iso = (d: Date) => d.toISOString();
const HOUR = 3_600_000;

describe('unavailabilityRange — shared vectors (TS ↔ SQL unavailability_range)', () => {
  it.each(vectors.ranges.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const period = unavailabilityRange(c.input as UnavailabilityInput);
    if ('error' in c.expect) {
      expect(period).toBeNull();
      return;
    }
    expect(period).not.toBeNull();
    expect(iso(period!.start)).toBe(c.expect.lower);
    expect(iso(period!.end)).toBe(c.expect.upper);
    expect((period!.end.getTime() - period!.start.getTime()) / HOUR).toBe(c.expect.hours);
    expect(period!.allDay).toBe(c.input.fromTime === null);
  });

  it('carries every case the plan names (docs/18 §1)', () => {
    const names = vectors.ranges.map((c) => c.name);
    for (const name of [
      'all_day_bst_12_oct',
      'all_day_spring_forward_29_mar_is_23h',
      'all_day_autumn_back_25_oct_is_25h',
      'window_gmt_0900_1300',
      'overnight_gmt_2200_0200_crosses_into_next_uk_date',
      'seven_day_range_is_seven_days',
      'from_equals_to_is_bad_window',
    ]) {
      expect(names).toContain(name);
    }
  });
});

describe('overlapsSection — half-open against the ROLE section (RULE-18)', () => {
  it.each(vectors.overlaps.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const period = unavailabilityRange(c.entry as UnavailabilityInput)!;
    expect(
      overlapsSection(period, {
        startsAt: new Date(c.section.startsAt),
        endsAt: new Date(c.section.endsAt),
      }),
    ).toBe(c.overlaps);
  });
});

describe('expandWeekly — each copy keeps its UK wall-clock time', () => {
  it.each(vectors.weekly.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const periods = expandWeekly(c.input as UnavailabilityInput);
    expect(periods?.map((p) => ({ lower: iso(p.start), upper: iso(p.end) }))).toEqual(c.expect);
  });

  it('refuses a negative or fractional repeat', () => {
    expect(expandWeekly({ fromDate: '2026-10-12', repeatWeeks: -1 })).toBeNull();
    expect(expandWeekly({ fromDate: '2026-10-12', repeatWeeks: 1.5 })).toBeNull();
  });
});

describe('validateUnavailability — the Add sheet (Q10)', () => {
  it.each(vectors.validation.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const result = validateUnavailability(c.input as UnavailabilityInput, new Date(c.now));
    if (c.expect === null) expect(result.ok).toBe(true);
    else expect(result).toEqual({ ok: false, reason: c.expect });
  });

  it('carries every refusal the plan names', () => {
    const reasons = new Set(vectors.validation.map((c) => c.expect));
    for (const r of ['in_past', 'too_far', 'too_long', 'too_many', 'bad_window']) {
      expect(reasons.has(r)).toBe(true);
    }
  });

  it('returns the periods to write, one per week', () => {
    const r = validateUnavailability(
      { fromDate: '2026-10-18', fromTime: '18:00', toTime: '22:00', repeatWeeks: 2 },
      new Date('2026-09-25T10:00:00Z'),
    );
    expect(r.ok && r.periods.length).toBe(3);
  });
});

describe('withAvailability — the calendar as a gate, not a score (ADR-0036)', () => {
  const row = (staff_id: string, gate: string | null = null): CandidateRow => ({
    staff_id,
    gate,
    qualified: true,
    booking_status: null,
    reliability: 100,
    rating: 5,
    distance_km: 1,
    future_shifts: 0,
    venue_times: 0,
  });

  it('gates an ungated row and leaves the SQL gate where there is one', () => {
    const out = withAvailability([row('a'), row('b', 'blocked'), row('c')], ['a', 'b']);
    expect(out.map((r) => r.gate)).toEqual([CALENDAR_GATE, 'blocked', null]);
  });

  it('is not one of the §6 hard gates — HARD_GATES is unchanged', () => {
    expect((HARD_GATES as readonly string[]).includes(CALENDAR_GATE)).toBe(false);
  });
});

describe('the generated pgTAP vectors', () => {
  it('match availability.vectors.json — run `pnpm --filter @thc/domain gen:vectors`', () => {
    const fresh = execFileSync('node', [script, '--stdout', 'availability'], { encoding: 'utf8' });
    expect(readFileSync(generated, 'utf8')).toBe(fresh);
  });
});
