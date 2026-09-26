import { describe, expect, it } from 'vitest';
import {
  availabilityLength,
  availabilityRepeats,
  availabilityWhen,
  contactUpdatedLine,
  formatPhone,
} from '../additions';

/**
 * The docs/19 additions on /staff/:id — ADR-0043 (Availability tab),
 * ADR-0044 (Emergency contact card). Every date and hour is UK wall clock:
 * the entries are built from UK dates (unavailability_range), so an
 * all-day entry across a clock change is 23 h or 25 h, not 24.
 */
const entry = (starts_at: string, ends_at: string, all_day: boolean) => ({
  starts_at,
  ends_at,
  all_day,
});

describe('Availability tab — When (UK)', () => {
  it('reads an all-day entry as its UK date, not the UTC one', () => {
    // 12.10.2026 in BST is [11T23:00Z, 12T23:00Z) — the availability vector.
    expect(availabilityWhen(entry('2026-10-11T23:00:00Z', '2026-10-12T23:00:00Z', true))).toBe(
      'Mon 12 Oct · all day',
    );
  });

  it('names the last day of a range, not the midnight after it', () => {
    expect(availabilityWhen(entry('2026-09-28T23:00:00Z', '2026-10-03T23:00:00Z', true))).toBe(
      'Tue 29 Sep – Sat 3 Oct · all day',
    );
  });

  it('prints a window in UK hours whatever the instant is in UTC', () => {
    // 18:00–23:00 UK on Thu 1 Oct 2026 (BST) is 17:00Z–22:00Z.
    expect(availabilityWhen(entry('2026-10-01T17:00:00Z', '2026-10-01T22:00:00Z', false))).toBe(
      'Thu 1 Oct · 18:00 – 23:00',
    );
  });

  it('says so when a window runs past UK midnight', () => {
    expect(availabilityWhen(entry('2026-11-05T22:00:00Z', '2026-11-06T02:00:00Z', false))).toBe(
      'Thu 5 Nov · 22:00 – 02:00 next day',
    );
  });
});

describe('Availability tab — Length', () => {
  it('is 24 h on an ordinary day', () => {
    expect(availabilityLength(entry('2026-09-22T23:00:00Z', '2026-09-23T23:00:00Z', true))).toBe(
      '24 h',
    );
  });

  it('is 25 h on 25.10.2026 and 23 h on 29.03.2026 (the clock changes)', () => {
    expect(availabilityLength(entry('2026-10-24T23:00:00Z', '2026-10-26T00:00:00Z', true))).toBe(
      '25 h',
    );
    expect(availabilityLength(entry('2026-03-29T00:00:00Z', '2026-03-29T23:00:00Z', true))).toBe(
      '23 h',
    );
  });

  it('counts a range in days, and a window in hours and minutes', () => {
    expect(availabilityLength(entry('2026-09-28T23:00:00Z', '2026-10-03T23:00:00Z', true))).toBe(
      '5 days',
    );
    expect(availabilityLength(entry('2026-10-01T17:00:00Z', '2026-10-01T22:00:00Z', false))).toBe(
      '5 h',
    );
    expect(availabilityLength(entry('2026-10-01T17:00:00Z', '2026-10-01T21:30:00Z', false))).toBe(
      '4 h 30 min',
    );
  });
});

describe('Availability tab — Repeats', () => {
  it('reads a weekly series with its size and last date', () => {
    expect(
      availabilityRepeats({
        series_id: 's1',
        series_count: 6,
        series_last_start: '2026-11-05T18:00:00Z',
      }),
    ).toBe('weekly · 6 (to Thu 5 Nov)');
  });

  it('says nothing for a one-off', () => {
    expect(
      availabilityRepeats({ series_id: null, series_count: 0, series_last_start: null }),
    ).toBeNull();
  });
});

describe('Emergency contact card', () => {
  it('groups a UK number as the wireframe does, and leaves others as stored', () => {
    expect(formatPhone('+447700900456')).toBe('+44 7700 900456');
    expect(formatPhone('+351912345678')).toBe('+351912345678');
  });

  it('stamps the last save in UK time and says who made it (§1.8)', () => {
    expect(
      contactUpdatedLine({
        updatedAt: '2026-09-18T13:36:00Z',
        updatedBy: 'worker',
        updatedByName: null,
      }),
    ).toBe('18.09.2026 14:36 UK time · by the worker');
    expect(
      contactUpdatedLine({
        updatedAt: '2026-09-18T13:36:00Z',
        updatedBy: 'office',
        updatedByName: 'Gisela M.',
      }),
    ).toBe('18.09.2026 14:36 UK time · by the office (Gisela M.)');
  });
});
