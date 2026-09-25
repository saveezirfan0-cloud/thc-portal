import { describe, expect, it } from 'vitest';
import { ukInstant } from '@thc/domain';
import type { ListedEvent } from '../data';
import { FILL_BOOKING_STATUSES, countsTowardsFill, tallyFill } from '../fill';
import {
  bucketByDay,
  cancelledLine,
  fillTone,
  periodTotals,
  toEventRow,
  toEventRows,
} from '../view-model';

const DATE = '2026-09-18';

function event(over: Partial<ListedEvent> = {}): ListedEvent {
  return {
    id: 'e1',
    title: 'Gala Dinner',
    date: DATE,
    clientName: 'Leonardo Hotel St Pauls',
    venueName: 'Leonardo Royal Hotel',
    venueAddress: '10 Godliman St, London EC4V 5AJ',
    geofenceRadiusM: 150,
    poNumber: '4471-A',
    onsiteContact: 'Marco V.',
    cancelledAt: null,
    cancelReason: '',
    roles: [
      { roleName: 'Chef', start: '07:00', end: '15:00', headcount: 2, buffer: 0, confirmed: 2 },
      {
        roleName: 'Kitchen Porter',
        start: '09:00',
        end: '17:00',
        headcount: 3,
        buffer: 1,
        confirmed: 3,
      },
      {
        roleName: 'Waiting Staff',
        start: '17:00',
        end: '23:30',
        headcount: 12,
        buffer: 2,
        confirmed: 8,
      },
    ],
    ...over,
  };
}

const before = ukInstant(DATE, '06:00');

describe('a row carries the derived window, not the typed one (RULE-18)', () => {
  it('reads earliest role start to latest role end', () => {
    expect(toEventRow(event(), before).windowLabel).toBe('07:00 – 23:30');
  });

  it('flags a window that runs past midnight, as the list sub-line does', () => {
    const late = event({
      roles: [
        {
          roleName: 'Bar Staff',
          start: '18:00',
          end: '01:00',
          headcount: 6,
          buffer: 1,
          confirmed: 6,
        },
      ],
    });
    const row = toEventRow(late, before);
    expect(row.windowLabel).toBe('18:00 – 01:00');
    expect(row.endsNextDay).toBe(true);
  });

  it('does not flag a window that ends the same evening', () => {
    expect(toEventRow(event(), before).endsNextDay).toBe(false);
    expect(toEventRow(event(), before).endsLabel).toBeNull();
  });

  it('names the UK day the window ends on, as the list sub-line does', () => {
    const late = event({ roles: [role('18:00', '01:00')] });
    expect(toEventRow(late, before).endsLabel).toBe('ends Sat 19 Sep');
  });

  // §1.8: the "ends next day" question is a London one. In BST the UTC day
  // turns at 01:00 London, so a comparison of UTC dates was wrong at both
  // edges of the night.
  it('flags 23:30–00:30 in BST, which crosses midnight in London but not in UTC', () => {
    const row = toEventRow(event({ roles: [role('23:30', '00:30')] }), before);
    expect(row.endsNextDay).toBe(true);
    expect(row.endsLabel).toBe('ends Sat 19 Sep');
  });

  it('does not flag 00:30–08:00 in BST, which starts and ends on the same London day', () => {
    const row = toEventRow(event({ roles: [role('00:30', '08:00')] }), before);
    expect(row.endsNextDay).toBe(false);
  });

  it('flags 23:30–00:30 in GMT too, where the two calendars agree', () => {
    const row = toEventRow(
      event({ date: '2026-12-18', roles: [role('23:30', '00:30')] }),
      ukInstant('2026-12-18', '06:00'),
    );
    expect(row.endsNextDay).toBe(true);
    expect(row.endsLabel).toBe('ends Sat 19 Dec');
  });

  it('has no window, and reads Upcoming, before the first role exists', () => {
    const empty = toEventRow(event({ roles: [] }), before);
    expect(empty.window).toBeNull();
    expect(empty.windowLabel).toBe('—');
    expect(empty.status).toBe('upcoming');
  });
});

describe('the fill chip (§3.1)', () => {
  it('counts confirmed against headcount and shows what is open', () => {
    const row = toEventRow(event(), before);
    expect(row.fill.confirmed).toBe(13);
    expect(row.fill.headcount).toBe(17);
    expect(row.fill.open).toBe(4);
    expect(fillTone(row)).toBe('amber');
  });

  it('turns green once every role is confirmed', () => {
    const full = event({
      roles: event().roles.map((role) => ({ ...role, confirmed: role.headcount })),
    });
    expect(fillTone(toEventRow(full, before))).toBe('green');
  });

  it('is neutral for a cancelled event, whatever its fill', () => {
    const cancelled = toEventRow(event({ cancelledAt: '2026-09-16T10:00:00Z' }), before);
    expect(cancelled.status).toBe('cancelled');
    expect(fillTone(cancelled)).toBe('neutral');
  });

  // §3.1 / §3.2: check-in moves a booking confirmed → worked, and the worker
  // still holds the slot. An Ongoing event with everyone on site is
  // "10 of 10" green, never "0 of 10 · 10 open" — the loader counts both.
  it('counts worked bookings as filling the slot, like every SQL fill', () => {
    expect([...FILL_BOOKING_STATUSES]).toEqual(['confirmed', 'worked']);
    expect(countsTowardsFill('worked')).toBe(true);
    expect(countsTowardsFill('confirmed')).toBe(true);
    expect(countsTowardsFill('invited')).toBe(false);
    expect(countsTowardsFill('applied')).toBe(false);
    expect(countsTowardsFill('cancelled')).toBe(false);
    expect(countsTowardsFill('turned_away')).toBe(false);

    const tally = tallyFill([
      { shift_id: 's1', status: 'worked' },
      { shift_id: 's1', status: 'worked' },
      { shift_id: 's1', status: 'confirmed' },
      { shift_id: 's1', status: 'invited' },
      { shift_id: 's2', status: 'applied' },
    ]);
    expect(tally.get('s1')).toBe(3);
    expect(tally.get('s2')).toBeUndefined();

    // A Completed section whose six workers all checked in reads "6 of 6".
    const worked = event({
      roles: [
        {
          roleName: 'Waiting Staff',
          start: '06:00',
          end: '11:00',
          headcount: 6,
          buffer: 1,
          confirmed: 6,
        },
      ],
    });
    const row = toEventRow(worked, ukInstant(DATE, '12:00'));
    expect(row.status).toBe('completed');
    expect(row.fill.open).toBe(0);
    expect(fillTone(row)).toBe('green');
  });
});

describe('status is inclusive of the last minute (§1.5)', () => {
  const single = event({ roles: [role('17:00', '23:00')] });

  it('is upcoming before the start, ongoing from the start, completed after the end', () => {
    expect(toEventRow(single, ukInstant(DATE, '16:59')).status).toBe('upcoming');
    expect(toEventRow(single, ukInstant(DATE, '17:00')).status).toBe('ongoing');
    expect(toEventRow(single, ukInstant(DATE, '23:00')).status).toBe('ongoing');
    expect(toEventRow(single, new Date(ukInstant(DATE, '23:00').getTime() + 1000)).status).toBe(
      'completed',
    );
  });
});

describe('the cancelled sub-line (§3.3)', () => {
  it('names the UK day and quotes the reason', () => {
    expect(
      cancelledLine({ cancelledAt: '2026-09-16T10:00:00Z', cancelReason: 'event postponed to Q1' }),
    ).toBe('cancelled Wed 16 Sep — "event postponed to Q1"');
  });

  it('reads the day in London, not UTC', () => {
    expect(cancelledLine({ cancelledAt: '2026-09-16T23:30:00Z', cancelReason: '' })).toBe(
      'cancelled Thu 17 Sep',
    );
  });

  it('is nothing for a live event', () => {
    expect(cancelledLine({ cancelledAt: null, cancelReason: '' })).toBeNull();
  });
});

describe('ordering (§3.1)', () => {
  it('sorts by date, then by the event window start within a day', () => {
    const rows = toEventRows(
      [
        event({ id: 'late', roles: [role('17:00', '23:00')] }),
        event({ id: 'next-day', date: '2026-09-19', roles: [role('08:00', '16:00')] }),
        event({ id: 'early', roles: [role('07:00', '15:00')] }),
      ],
      before,
    );
    expect(rows.map((r) => r.id)).toEqual(['early', 'late', 'next-day']);
  });

  it('puts an event with no roles last within its day, not first', () => {
    const rows = toEventRows(
      [
        event({ id: 'empty', roles: [] }),
        event({ id: 'has-roles', roles: [role('17:00', '23:00')] }),
      ],
      before,
    );
    expect(rows.map((r) => r.id)).toEqual(['has-roles', 'empty']);
  });
});

function role(start: string, end: string) {
  return { roleName: 'Waiting Staff', start, end, headcount: 4, buffer: 0, confirmed: 1 };
}

describe('the day counters (§3.1)', () => {
  const days = ['2026-09-18', '2026-09-19', '2026-09-20'];

  it('counts events and open positions per day', () => {
    const rows = toEventRows(
      [event(), event({ id: 'e2', date: '2026-09-19', roles: [role('11:00', '16:00')] })],
      before,
    );
    const buckets = bucketByDay(rows, days);
    expect(buckets.get('2026-09-18')!.count).toBe(1);
    expect(buckets.get('2026-09-18')!.open).toBe(4);
    expect(buckets.get('2026-09-19')!.open).toBe(3);
    expect(buckets.get('2026-09-20')!.count).toBe(0);
  });

  it('leaves a cancelled event out of the open count — nobody has to fill it', () => {
    const rows = toEventRows([event({ cancelledAt: '2026-09-16T10:00:00Z' })], before);
    const bucket = bucketByDay(rows, days).get('2026-09-18')!;
    expect(bucket.count).toBe(1);
    expect(bucket.open).toBe(0);
    expect(bucket.allCancelled).toBe(true);
  });

  it('does not call a day all-cancelled when a live event shares it', () => {
    const rows = toEventRows(
      [event({ cancelledAt: '2026-09-16T10:00:00Z' }), event({ id: 'live' })],
      before,
    );
    expect(bucketByDay(rows, days).get('2026-09-18')!.allCancelled).toBe(false);
  });

  it('ignores an event whose day is outside the period being shown', () => {
    const rows = toEventRows([event({ date: '2026-10-05' })], before);
    const buckets = bucketByDay(rows, days);
    expect([...buckets.values()].every((b) => b.count === 0)).toBe(true);
  });
});

describe('the period totals under the list (§3.1)', () => {
  it('counts every event but only the live open positions', () => {
    const rows = toEventRows(
      [event(), event({ id: 'x', cancelledAt: '2026-09-16T10:00:00Z' })],
      before,
    );
    expect(periodTotals(rows)).toEqual({ events: 2, open: 4 });
  });
});
