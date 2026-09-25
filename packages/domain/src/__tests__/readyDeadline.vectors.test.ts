import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import vectors from '../readyDeadline.vectors.json' with { type: 'json' };
import { readyDeadline, shiftCard, type StaffBooking } from '../staff';
import {
  READY_VECTORS_PSQL,
  renderReadyDeadlineVectors,
} from '../../../../supabase/tests/_shared/ready-deadline-vectors.mjs';

const HOUR = 3_600_000;

describe('readyDeadline — shared vectors (TS ↔ SQL ready_deadline, §3.5)', () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(readyDeadline(new Date(c.startsAt)).toISOString()).toBe(c.deadline);
  });

  it('supabase/tests/_shared/ready_deadline_vectors.psql matches readyDeadline.vectors.json', () => {
    expect(readFileSync(READY_VECTORS_PSQL, 'utf8')).toBe(renderReadyDeadlineVectors(vectors));
  });

  it('carries both DST cases a fixed 24 h gets wrong', () => {
    const names = vectors.cases.map((c) => c.name);
    expect(names).toContain('autumn_2330_gmt_on_the_changeover_day');
    expect(names).toContain('spring_0030_bst_the_day_after_the_change');
    // Proof that they would catch the old arithmetic: start − 24 h falls on
    // a different UK day from the true day before in both.
    for (const name of [
      'autumn_2330_gmt_on_the_changeover_day',
      'spring_0030_bst_the_day_after_the_change',
    ]) {
      const c = vectors.cases.find((v) => v.name === name)!;
      const minus24 = new Date(new Date(c.startsAt).getTime() - 24 * HOUR);
      const ukDay = (d: Date) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d);
      expect(ukDay(minus24)).not.toBe(ukDay(new Date(c.deadline)));
    }
  });
});

describe('the "I\'m ready" card opens at 00:00 UK the day before, on a changeover day too', () => {
  // 10:00 BST Mon 30 Mar 2026; the day before is Sun 29 Mar, when the
  // clocks go forward at 01:00 GMT. Its 00:00 is 2026-03-29T00:00Z (GMT).
  const b: StaffBooking = {
    status: 'confirmed',
    startsAt: new Date('2026-03-30T09:00:00Z'),
    endsAt: new Date('2026-03-30T15:00:00Z'),
    confirmedAt: new Date('2026-03-20T09:00:00Z'),
    dayBeforeConfirmedAt: null,
    onDayConfirmedAt: null,
    reconfirmRequired: false,
    cancelCause: null,
    eventCancelledAt: null,
    noCheckoutOpen: false,
  };

  it('is not asking yet at 23:30 GMT on Sat 28 Mar (noon − 12 h would have opened it at 23:00)', () => {
    expect(shiftCard(b, new Date('2026-03-28T23:30:00Z'))).toBe('confirmed');
  });

  it('asks from 00:00 UK on Sun 29 Mar', () => {
    expect(shiftCard(b, new Date('2026-03-29T00:00:00Z'))).toBe('needs_ready');
  });
});
