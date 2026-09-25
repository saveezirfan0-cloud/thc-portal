import { describe, expect, it } from 'vitest';
import {
  MIN_SHIFT_HOURS,
  ROLE_SECTION_MESSAGE,
  RECONFIRM_FIELDS,
  SILENT_FIELDS,
  defaultAllocationPerHour,
  derivedEventWindow,
  forecastEvent,
  formatHours,
  isEditLocked,
  isRoleSectionValid,
  marginPerHourPence,
  reconfirmingChanges,
  requiresReconfirmation,
  sectionHours,
  validateRoleSection,
} from '../shift';
import { formatAllocation, formatAllocationPair, formatConfirmationTarget } from '../buffer';
import { formatTimeIn, ukInstant, ukRoleWindow, UK_ZONE } from '../time';
import vectors from '../shift.vectors.json';

type SectionVector = (typeof vectors.roleSections)[number];
type WindowVector = (typeof vectors.eventWindows)[number];

function draftFrom(v: SectionVector['input']) {
  return {
    ...ukRoleWindow(v.date, v.start, v.end),
    headcount: v.headcount,
    buffer: v.buffer,
    allocationPerHour: v.allocationPerHour,
  };
}

describe('role section vectors (§3.2)', () => {
  for (const vector of vectors.roleSections as SectionVector[]) {
    it(vector.name, () => {
      const draft = draftFrom(vector.input);
      expect(sectionHours(draft)).toBe(vector.expect.hours);
      expect(validateRoleSection(draft)).toEqual(vector.expect.issues);
      expect(formatAllocationPair(draft.headcount, draft.buffer)).toBe(vector.expect.allocation);
      expect(defaultAllocationPerHour(draft.headcount, draft.buffer)).toBe(vector.expect.target);
    });
  }
});

describe('the buffer is absolute (§3.2)', () => {
  it('never collapses 6 (+1) into 7, in either display form', () => {
    expect(formatAllocation(6, 1)).toBe('6 (+1)');
    expect(formatAllocationPair(6, 1)).toBe('6 (+1)');
    expect(formatAllocation(6, 1)).not.toBe('7');
    expect(formatAllocationPair(6, 1)).not.toBe('7');
  });

  it('spells out a zero buffer on the builder and in the list alike (§3.2)', () => {
    expect(formatAllocationPair(2, 0)).toBe('2 (+0)');
    expect(formatAllocation(2, 0)).toBe('2 (+0)');
  });

  it('keeps the sum beside the pair on the confirmation target, never instead of it', () => {
    expect(formatConfirmationTarget(3, 1)).toBe('3 (+1) = 4');
    expect(formatConfirmationTarget(2, 0)).toBe('2 (+0) = 2');
  });
});

describe('allocation defaults to headcount plus buffer (§3.4)', () => {
  it('is the whole confirmation target, not the working headcount', () => {
    expect(defaultAllocationPerHour(12, 2)).toBe(14);
    expect(defaultAllocationPerHour(3, 1)).toBe(4);
    expect(defaultAllocationPerHour(2, 0)).toBe(2);
  });

  it('stays editable — an edited value is not overwritten by the default', () => {
    const draft = {
      ...ukRoleWindow('2026-09-18', '17:00', '23:30'),
      headcount: 12,
      buffer: 2,
      allocationPerHour: 6, // the manager slowed it down by hand
    };
    expect(isRoleSectionValid(draft)).toBe(true);
    expect(draft.allocationPerHour).not.toBe(defaultAllocationPerHour(12, 2));
  });

  it('rejects an allocation of nothing, which would never fill the role', () => {
    const draft = {
      ...ukRoleWindow('2026-09-18', '17:00', '23:30'),
      headcount: 12,
      buffer: 2,
      allocationPerHour: 0,
    };
    expect(validateRoleSection(draft)).toEqual(['allocation_below_one']);
  });
});

describe('every timing rule uses the role section, never the event window (RULE-18)', () => {
  for (const vector of vectors.eventWindows as WindowVector[]) {
    it(vector.name, () => {
      const sections = vector.sections.map((s) => ukRoleWindow(vector.date, s.start, s.end));
      const window = derivedEventWindow(sections)!;
      expect(formatTimeIn(window.startsAt, UK_ZONE)).toBe(vector.expect.start);
      expect(formatTimeIn(window.endsAt, UK_ZONE)).toBe(vector.expect.end);
      expect(window.endsAt.getTime() > ukInstant(vector.date, '23:59').getTime()).toBe(
        vector.expect.endsNextDay,
      );
    });
  }

  it('leaves the sections themselves alone — the window is derived, not imposed', () => {
    const chef = ukRoleWindow('2026-09-18', '07:00', '15:00');
    const waiting = ukRoleWindow('2026-09-18', '17:00', '23:30');
    const window = derivedEventWindow([chef, waiting])!;

    // The event runs 07:00–23:30, but the Waiting Staff shift is 6.5 h, not 16.5 h.
    expect(sectionHours(window)).toBe(16.5);
    expect(sectionHours(waiting)).toBe(6.5);
    expect(waiting.startsAt).not.toEqual(window.startsAt);
  });

  it('has no window before the first role is added', () => {
    expect(derivedEventWindow([])).toBeNull();
  });
});

describe('a section is at least four hours (§3.2)', () => {
  const date = '2026-09-18';
  const counts = { headcount: 1, buffer: 0, allocationPerHour: 1 };

  it('rejects the wireframe error case and says why', () => {
    const draft = { ...ukRoleWindow(date, '18:00', '21:00'), ...counts };
    expect(validateRoleSection(draft)).toContain('below_minimum_hours');
    expect(ROLE_SECTION_MESSAGE.below_minimum_hours).toBe('Minimum shift length is 4 hours');
    expect(MIN_SHIFT_HOURS).toBe(4);
  });

  it('accepts exactly four hours', () => {
    expect(isRoleSectionValid({ ...ukRoleWindow(date, '10:00', '14:00'), ...counts })).toBe(true);
  });

  it('allows an after-midnight end that is long enough', () => {
    const draft = { ...ukRoleWindow(date, '17:00', '01:30'), ...counts };
    expect(sectionHours(draft)).toBe(8.5);
    expect(isRoleSectionValid(draft)).toBe(true);
  });

  it('still rejects a short after-midnight end', () => {
    expect(isRoleSectionValid({ ...ukRoleWindow(date, '23:00', '02:00'), ...counts })).toBe(false);
  });

  it('formats the header length the way the role header reads it', () => {
    expect(formatHours(8)).toBe('8 h');
    expect(formatHours(6.5)).toBe('6.5 h');
  });
});

describe('editing is locked once the event has started (§3.2)', () => {
  const sections = [
    ukRoleWindow('2026-09-18', '07:00', '15:00'),
    ukRoleWindow('2026-09-18', '17:00', '23:30'),
  ];
  const start = sections[0]!.startsAt;

  it('is open right up to the derived start', () => {
    expect(isEditLocked(sections, new Date(start.getTime() - 60_000))).toBe(false);
  });

  it('locks at the derived start, not at each role start', () => {
    expect(isEditLocked(sections, start)).toBe(true);
    // 16:00: the Chef section is over, the Waiting Staff one has not begun.
    expect(isEditLocked(sections, ukInstant('2026-09-18', '16:00'))).toBe(true);
  });

  it('stays locked for a past event', () => {
    expect(isEditLocked(sections, ukInstant('2026-10-01', '09:00'))).toBe(true);
  });

  it('never locks an event with no roles yet', () => {
    expect(isEditLocked([], ukInstant('2030-01-01', '09:00'))).toBe(false);
  });
});

describe('which edits ask the booked staff to re-confirm (§3.5)', () => {
  it('times, date, venue address and dress code do', () => {
    for (const field of RECONFIRM_FIELDS) expect(requiresReconfirmation(field)).toBe(true);
  });

  it('headcount, buffer, charge rate, PO number and notes apply silently', () => {
    for (const field of SILENT_FIELDS) expect(requiresReconfirmation(field)).toBe(false);
  });

  it('picks the triggering fields out of a mixed edit', () => {
    expect(reconfirmingChanges(['headcount', 'starts_at', 'po_number', 'dress_code'])).toEqual([
      'starts_at',
      'dress_code',
    ]);
    expect(reconfirmingChanges(['headcount', 'buffer', 'charge_rate'])).toEqual([]);
  });
});

describe('the forecast summary', () => {
  const sections = [
    {
      ...ukRoleWindow('2026-09-18', '07:00', '15:00'),
      headcount: 2,
      chargeRatePence: 3069,
      payRatePence: 1900,
    },
    {
      ...ukRoleWindow('2026-09-18', '09:00', '17:00'),
      headcount: 3,
      chargeRatePence: 2123,
      payRatePence: 1350,
    },
    {
      ...ukRoleWindow('2026-09-18', '17:00', '23:30'),
      headcount: 12,
      chargeRatePence: 2297,
      payRatePence: 1400,
    },
  ];

  it('forecasts headcount hours, leaving the buffer out', () => {
    // 2×8 + 3×8 + 12×6.5 = 118 h, matching the wireframe's summary panel.
    expect(forecastEvent(sections).payableHours).toBe(118);
  });

  it('breaks holiday pay out rather than blending it into the rate', () => {
    const forecast = forecastEvent(sections);
    expect(forecast.basePayPence).toBe(16 * 1900 + 24 * 1350 + 78 * 1400);
    expect(forecast.holidayPence).toBe(Math.round(forecast.basePayPence * 0.1207));
    expect(forecast.marginPence).toBe(
      forecast.chargePence - forecast.basePayPence - forecast.holidayPence,
    );
  });

  it('reads the per-hour margin off the final rate, not the base', () => {
    expect(marginPerHourPence(3069, 1900)).toBe(940); // +£9.40/h
    expect(marginPerHourPence(2123, 1350)).toBe(610); // +£6.10/h
    expect(marginPerHourPence(2297, 1400)).toBe(728); // +£7.28/h
  });
});

describe('typed times are Europe/London wall clock (§1.8)', () => {
  it('reads a zoneless value as UK time, in summer and in winter', () => {
    expect(ukInstant('2026-07-01', '17:00').toISOString()).toBe('2026-07-01T16:00:00.000Z');
    expect(ukInstant('2026-12-01', '17:00').toISOString()).toBe('2026-12-01T17:00:00.000Z');
  });

  it('skips the hour that does not exist on a spring-forward night', () => {
    // 01:30 never happens on 29 March 2026: the clock goes 01:00 GMT → 02:00
    // BST. The instant it names is 02:30 BST, which is what Postgres does too.
    expect(formatTimeIn(ukInstant('2026-03-29', '01:30'), UK_ZONE)).toBe('02:30');
  });

  it('measures a section in real hours across both changeovers', () => {
    // Reads four hours on the manager's clock, is three in fact — so it fails
    // the §3.2 floor, exactly as the DB's interval check would.
    const spring = ukRoleWindow('2026-03-28', '23:00', '03:00');
    expect(spring.endsAt.getTime() - spring.startsAt.getTime()).toBe(3 * 3_600_000);

    // Reads eight, is nine, because the clocks go back inside the shift.
    const autumn = ukRoleWindow('2026-10-24', '22:00', '06:00');
    expect(autumn.endsAt.getTime() - autumn.startsAt.getTime()).toBe(9 * 3_600_000);
  });

  it('rolls an after-midnight end forward a day', () => {
    const { startsAt, endsAt } = ukRoleWindow('2026-09-18', '17:00', '01:30');
    expect(formatTimeIn(startsAt, UK_ZONE)).toBe('17:00');
    expect(formatTimeIn(endsAt, UK_ZONE)).toBe('01:30');
    expect(endsAt.getTime() - startsAt.getTime()).toBe(8.5 * 3_600_000);
  });
});
