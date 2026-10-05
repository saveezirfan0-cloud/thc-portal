import { describe, expect, it, vi } from 'vitest';
import { ukInstant } from '@thc/domain';

/**
 * ADR-0085 in the pure presentation rules: each takes the worker's clock as
 * its LAST, optional argument (24-hour when it is left out) and changes only
 * how a time is written — never which instant, never the UK-first rule (§1.8).
 */
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const { overlapWarning } = await import('../data');
const offers = await import('../shifts/offers');
const { entryTitle, addSheetYourTime } = await import('../profile/availability/model');
const { ukStamp, statusLine } = await import('../profile/change-requests');
const { formatStamp } = await import('../documents/model');

// Sat 19 Sep 2026, 17:00 UK (BST) — and 22:00 the same evening for a late example.
const evening = new Date('2026-09-19T16:00:00Z');
const night = new Date('2026-09-19T21:00:00Z');

describe('shifts/offers.ts', () => {
  it('writes the UK date and time on either clock, "UK time" label untouched', () => {
    expect(offers.ukDateTime(evening)).toBe('Sat 19 Sep, 17:00');
    expect(offers.ukDateTime(evening, '12h')).toBe('Sat 19 Sep, 5:00 pm');
    expect(offers.ukShortDateTime(evening, '12h')).toBe('Sat 19, 5:00 pm');
    expect(offers.offeredChip(evening)).toBe('Offered · open until Sat 19, 17:00 (UK time)');
    expect(offers.offeredChip(evening, '12h')).toBe(
      'Offered · open until Sat 19, 5:00 pm (UK time)',
    );
    expect(offers.offeredLine(night, '12h')).toContain('before Sat 19, 10:00 pm (UK time)');
    expect(offers.offeredCardLine(night, '12h')).toBe(
      'Offered to other workers · open until Sat 19, 10:00 pm (UK time)',
    );
  });

  it('writes the viewer’s "your time" on their own clock', () => {
    expect(offers.yourTimeAt(evening, 'Asia/Tashkent')).toBe('Sat 19, 21:00 your time');
    expect(offers.yourTimeAt(evening, 'Asia/Tashkent', true, '12h')).toBe(
      'Sat 19, 9:00 pm your time',
    );
    expect(offers.yourTimeAt(evening, 'Asia/Tashkent', false, '12h')).toBe('9:00 pm your time');
    expect(offers.yourTimeAt(evening, 'Europe/London', true, '12h')).toBeNull();
  });
});

describe('overlapWarning (data.ts)', () => {
  const held = {
    bookingId: 'held',
    status: 'confirmed' as const,
    eventTitle: 'Awards Night',
    role: 'Waiting Staff',
    venueName: 'The Dorchester',
    venueAddress: '53 Park Lane',
    startsAt: new Date('2026-09-22T15:00:00Z'),
    endsAt: new Date('2026-09-23T01:00:00Z'),
  };
  const invite = { ...held, bookingId: 'inv', startsAt: new Date('2026-09-22T16:00:00Z') };

  it('names the held shift’s UK window on the worker’s clock', () => {
    expect(overlapWarning(invite, [held])).toBe(
      'Overlaps your confirmed Awards Night · Waiting Staff 16:00 – 02:00',
    );
    expect(overlapWarning(invite, [held], '12h')).toBe(
      'Overlaps your confirmed Awards Night · Waiting Staff 4:00 pm – 2:00 am',
    );
  });
});

describe('availability/model.ts', () => {
  const entry = (from: string, to: string, fromDate = '2026-10-01', toDate = fromDate) => ({
    id: 'a',
    startsAt: ukInstant(fromDate, from),
    endsAt: ukInstant(toDate, to),
    allDay: false,
    seriesId: null,
    seriesIndex: null,
    seriesCount: null,
  });

  it('titles a window on either clock, still in UK time', () => {
    expect(entryTitle(entry('18:00', '23:00'))).toBe('Thu 1 Oct · 18:00 – 23:00');
    expect(entryTitle(entry('18:00', '23:00'), '12h')).toBe('Thu 1 Oct · 6:00 pm – 11:00 pm');
    expect(entryTitle(entry('22:00', '02:00', '2026-10-03', '2026-10-04'), '12h')).toBe(
      'Sat 3 Oct · 10:00 pm – 2:00 am',
    );
  });

  it('writes the "your time" line under the two UK inputs on the viewer’s clock', () => {
    const form = {
      mode: 'day' as const,
      fromDate: '2026-10-01',
      toDate: '2026-10-01',
      allDay: false,
      fromTime: '18:00',
      toTime: '23:00',
      repeatWeeks: 0,
    };
    expect(addSheetYourTime(form, 'Europe/Madrid')).toBe('19:00 – 00:00 your time (Madrid)');
    expect(addSheetYourTime(form, 'Europe/Madrid', '12h')).toBe(
      '7:00 pm – 12:00 am your time (Madrid)',
    );
    // A time field that is not a time yet has no line to draw, in either clock.
    expect(addSheetYourTime({ ...form, toTime: '' }, 'Europe/Madrid', '12h')).toBeNull();
  });
});

describe('profile/change-requests.ts', () => {
  const createdAt = '2026-09-18T13:37:00Z'; // 14:37 BST

  it('stamps the request in UK time on either clock', () => {
    expect(ukStamp(createdAt)).toBe('Fri 18 Sep, 14:37');
    expect(ukStamp(createdAt, '12h')).toBe('Fri 18 Sep, 2:37 pm');
  });

  it('carries the clock into the pending line', () => {
    const request = {
      id: 'r1',
      kind: 'name' as const,
      status: 'pending' as const,
      proposedFirstName: 'Amara',
      proposedLastName: 'Okafor',
      proposedPhotoPath: null,
      workerNote: null,
      decisionReason: null,
      createdAt,
      decidedAt: null,
    };
    const line = statusLine([request], 'name', '12h');
    expect(line && 'detail' in line && line.detail).toBe(
      'Requested: Amara Okafor · Fri 18 Sep, 2:37 pm (UK time)',
    );
  });
});

describe('documents/model.ts formatStamp — an audit stamp stays UK-only', () => {
  it('is "dd.mm.yyyy HH:MM" by default and "2:44 pm" on the 12-hour clock', () => {
    expect(formatStamp('2026-09-18T13:44:00Z')).toBe('18.09.2026 14:44');
    expect(formatStamp('2026-09-18T13:44:00Z', '12h')).toBe('18.09.2026 2:44 pm');
    expect(formatStamp('2026-09-18T23:05:00Z', '12h')).toBe('19.09.2026 12:05 am');
  });
});
