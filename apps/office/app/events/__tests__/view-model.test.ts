import { describe, expect, it } from 'vitest';
import { ukInstant } from '@thc/domain';
import type { ListedEvent } from '../data';
import {
  bucketByDay,
  filterEventRows,
  fillTone,
  periodTotals,
  scheduledWindowLines,
  toEventRow,
  toEventRows,
} from '../view-model';

const DATE = '2026-09-18';

function event(over: Partial<ListedEvent> = {}): ListedEvent {
  return {
    id: 'e1',
    title: 'Gala Dinner',
    date: DATE,
    clientId: 'client-leonardo',
    clientName: 'Leonardo Hotel St Pauls',
    venueName: 'Leonardo Royal Hotel',
    venueAddress: '10 Godliman St, London EC4V 5AJ',
    poNumber: '4471-A',
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

describe('the toolbar filters (§3.1)', () => {
  const rows = toEventRows(
    [
      event({ id: 'a', clientId: 'c-1', clientName: 'Leonardo Hotel' }),
      // A second client with the SAME display name: a hotel group's properties.
      event({ id: 'b', clientId: 'c-2', clientName: 'Leonardo Hotel', title: 'Product Launch' }),
      event({ id: 'c', clientId: 'c-3', clientName: 'Mandarin Oriental', poNumber: 'PO-77' }),
    ],
    before,
  );

  it('filters the client by id, never by name', () => {
    expect(filterEventRows(rows, { clientId: 'c-2', status: '', q: '' }).map((r) => r.id)).toEqual([
      'b',
    ]);
  });

  it('returns everything with no filters, and searches title, client, venue and PO', () => {
    expect(filterEventRows(rows, { clientId: '', status: '', q: '' })).toHaveLength(3);
    expect(
      filterEventRows(rows, { clientId: '', status: '', q: ' po-77 ' }).map((r) => r.id),
    ).toEqual(['c']);
    expect(
      filterEventRows(rows, { clientId: '', status: '', q: 'launch' }).map((r) => r.id),
    ).toEqual(['b']);
  });

  it('filters by status', () => {
    expect(filterEventRows(rows, { clientId: '', status: 'completed', q: '' })).toEqual([]);
    expect(filterEventRows(rows, { clientId: '', status: 'upcoming', q: '' })).toHaveLength(3);
  });
});

describe('scheduled windows carry a "your time" line outside the UK (§1.8)', () => {
  const start = ukInstant(DATE, '07:00');
  const end = ukInstant('2026-09-19', '01:30');

  it('is UK-only for a UK viewer', () => {
    expect(scheduledWindowLines(start, end, 'Europe/London')).toEqual({
      uk: '07:00 – 01:30',
      local: null,
    });
  });

  it('adds the viewer-zone line anywhere else', () => {
    expect(scheduledWindowLines(start, end, 'Europe/Athens')).toEqual({
      uk: '07:00 – 01:30',
      local: '09:00 – 03:30 your time',
    });
    expect(scheduledWindowLines(start, end, 'America/New_York').local).toBe(
      '02:00 – 20:30 your time',
    );
  });

  it('a list row carries its window and each role window as instants for that line', () => {
    const row = toEventRow(event(), before);
    expect(row.windowIso).toEqual({
      startsAt: ukInstant(DATE, '07:00').toISOString(),
      endsAt: ukInstant(DATE, '23:30').toISOString(),
    });
    expect(row.roles.map((r) => [r.startsAt, r.endsAt])).toEqual([
      [ukInstant(DATE, '07:00').toISOString(), ukInstant(DATE, '15:00').toISOString()],
      [ukInstant(DATE, '09:00').toISOString(), ukInstant(DATE, '17:00').toISOString()],
      [ukInstant(DATE, '17:00').toISOString(), ukInstant(DATE, '23:30').toISOString()],
    ]);
    expect(toEventRow(event({ roles: [] }), before).windowIso).toBeNull();
  });
});
