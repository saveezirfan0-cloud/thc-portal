import { describe, expect, it } from 'vitest';
import {
  type UpcomingRow,
  allocationLabel,
  fillChip,
  formatAsOf,
  formatDayLabel,
  formatMarginPerHour,
  formatPercent,
  formatPounds,
  formatWeekRange,
  groupByEvent,
  marginTone,
  relativeDayLabel,
  todayInUk,
} from '../view-model';

/**
 * §9.1's formatting rules. The arithmetic is the database's
 * (20260922182000_dashboard_kpis.sql, pinned by supabase/tests/320); what
 * is asserted here is the part a screen can still get wrong on its own —
 * the buffer, the fill denominator, and dates that must not slide a day.
 */

describe('fill (§3.2)', () => {
  it('counts confirmed against headcount, never headcount + buffer', () => {
    expect(fillChip(9, 12).label).toBe('9 of 12');
    expect(fillChip(12, 12).tone).toBe('green');
  });

  it('bands the colour the way the design board draws it', () => {
    expect(fillChip(3, 5).tone).toBe('amber'); // 60%
    expect(fillChip(9, 18).tone).toBe('coral'); // exactly half is not "most of the way"
    expect(fillChip(0, 1).tone).toBe('coral');
  });

  it('treats an over-confirmed section as full, not as more than full', () => {
    // The surplus is buffer cover, reported beside the headcount and never
    // inside the fill (§3.2).
    expect(fillChip(13, 12).label).toBe('13 of 12');
    expect(fillChip(13, 12).tone).toBe('green');
  });
});

describe('allocation (§3.2)', () => {
  it('spells the buffer out and never adds it in', () => {
    expect(allocationLabel(6, 1)).toBe('6 (+1)');
    expect(allocationLabel(6, 1)).not.toBe('7');
  });

  it('spells out a zero buffer, as §3.2 and dashboard.html do ("2 (+0)")', () => {
    expect(allocationLabel(2, 0)).toBe('2 (+0)');
  });
});

describe('margin (§9.1)', () => {
  it('is signed, per hour, and green', () => {
    expect(formatMarginPerHour(7.28)).toBe('+£7.28/h');
    expect(marginTone(7.28)).toBe('green');
  });

  it('shows a loss as a loss rather than as a small green number', () => {
    expect(formatMarginPerHour(-1.2)).toBe('−£1.20/h');
    expect(marginTone(-1.2)).toBe('coral');
  });
});

describe('the weekly money panel', () => {
  it('rounds the totals to whole pounds', () => {
    expect(formatPounds(48920.4)).toBe('£48,920');
  });

  it('shows no margin at all for an empty week, rather than 0%', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(35.8)).toBe('35.8%');
  });

  it('names the week Monday to Sunday', () => {
    expect(formatWeekRange('2026-09-21', '2026-09-27')).toBe('Mon 21 – Sun 27 Sep');
  });

  it('carries both months when the week straddles one', () => {
    expect(formatWeekRange('2026-09-28', '2026-10-04')).toBe('Mon 28 Sep – Sun 4 Oct');
  });
});

describe('dates (§1.8)', () => {
  it('renders a calendar date without letting a zone move it', () => {
    // `new Date('2026-09-25')` is midnight UTC; formatted in a zone behind
    // London it would read as the 24th. A calendar date has no zone.
    expect(formatDayLabel('2026-09-25')).toBe('Fri 25 Sep');
  });

  it('labels today and tomorrow, and nothing else', () => {
    expect(relativeDayLabel('2026-09-24', '2026-09-24')).toBe('today');
    expect(relativeDayLabel('2026-09-25', '2026-09-24')).toBe('tomorrow');
    expect(relativeDayLabel('2026-09-26', '2026-09-24')).toBeNull();
    // Month end, where +1 day is not +1 in the date string.
    expect(relativeDayLabel('2026-10-01', '2026-09-30')).toBe('tomorrow');
  });

  it("reads 'today' in Europe/London, not in the server's zone", () => {
    // 23:30 UTC on 24 September is already the 25th in London during BST.
    expect(todayInUk(new Date('2026-09-24T23:30:00Z'))).toBe('2026-09-25');
    // And in GMT the two agree again.
    expect(todayInUk(new Date('2026-12-24T23:30:00Z'))).toBe('2026-12-24');
  });

  it('stamps "as of" in UK time', () => {
    const { time, date } = formatAsOf(new Date('2026-09-24T13:32:00Z'));
    expect(time).toBe('14:32'); // BST
    expect(date).toBe('Thu 24 Sep 2026');
  });
});

describe('grouping the ten-day list', () => {
  const row = (over: Partial<UpcomingRow>): UpcomingRow => ({
    shift_id: 's1',
    event_id: 'e1',
    event_title: 'Gala Dinner',
    event_date: '2026-09-25',
    client_name: 'Leonardo Hotel St Pauls',
    venue_name: 'Leonardo Royal Hotel',
    po_number: '4471-A',
    cancelled_at: null,
    role_name: 'Chef',
    starts_at: '2026-09-25T06:00:00Z',
    ends_at: '2026-09-25T14:00:00Z',
    event_starts_at: '2026-09-25T06:00:00Z',
    event_ends_at: '2026-09-25T22:30:00Z',
    headcount: 2,
    buffer: 0,
    confirmed: 2,
    open_positions: 0,
    margin_per_hour: '9.40',
    ...over,
  });

  it('puts every role section of an event under one row, in the order given', () => {
    const events = groupByEvent([
      row({}),
      row({ shift_id: 's2', role_name: 'Kitchen Porter', headcount: 3, buffer: 1, confirmed: 2 }),
      row({ shift_id: 's3', event_id: 'e2', event_title: 'Product Launch — Bar' }),
    ]);

    expect(events.map((e) => e.title)).toEqual(['Gala Dinner', 'Product Launch — Bar']);
    expect(events[0]!.roles.map((r) => r.roleName)).toEqual(['Chef', 'Kitchen Porter']);
    // The event window travels on the row and is the derived one (RULE-18).
    expect(events[0]!.endsAt).toBe('2026-09-25T22:30:00Z');
  });

  it('parses numeric money out of the strings PostgREST sends', () => {
    const [event] = groupByEvent([row({ margin_per_hour: '9.40' })]);
    expect(event!.roles[0]!.marginPerHour).toBe(9.4);
  });

  it('keeps a cancelled event on the list (§3.3)', () => {
    const [event] = groupByEvent([row({ cancelled_at: '2026-09-20T10:00:00Z' })]);
    expect(event!.cancelledAt).not.toBeNull();
  });
});
