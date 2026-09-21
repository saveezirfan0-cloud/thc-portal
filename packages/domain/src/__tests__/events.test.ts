import { describe, expect, it } from 'vitest';
import {
  EVENT_STATUS_LABEL,
  eventFill,
  eventStatus,
  formatCounter,
  formatEventFill,
  formatOpen,
  isEventFull,
} from '../events';
import { derivedEventWindow } from '../shift';
import { ukInstant, ukRoleWindow } from '../time';

const DATE = '2026-09-18';

const galaDinner = [
  ukRoleWindow(DATE, '07:00', '15:00'),
  ukRoleWindow(DATE, '09:00', '17:00'),
  ukRoleWindow(DATE, '17:00', '23:30'),
];
const window = derivedEventWindow(galaDinner)!;

describe('event status is derived, not stored (§1.5)', () => {
  it('is Upcoming before the derived window starts', () => {
    expect(eventStatus(window, null, ukInstant(DATE, '06:59'))).toBe('upcoming');
  });

  it('is Ongoing from the first role start to the last role end', () => {
    expect(eventStatus(window, null, ukInstant(DATE, '07:00'))).toBe('ongoing');
    // 16:00: Chef is over, Waiting Staff has not begun — the EVENT is ongoing.
    expect(eventStatus(window, null, ukInstant(DATE, '16:00'))).toBe('ongoing');
    expect(eventStatus(window, null, ukInstant(DATE, '23:30'))).toBe('ongoing');
  });

  it('is Completed once the last role has ended', () => {
    expect(eventStatus(window, null, ukInstant(DATE, '23:31'))).toBe('completed');
  });

  it('is Cancelled whatever the clock says', () => {
    expect(eventStatus(window, new Date(), ukInstant(DATE, '06:00'))).toBe('cancelled');
    expect(eventStatus(window, '2026-09-16T10:00:00Z', ukInstant(DATE, '12:00'))).toBe('cancelled');
    expect(eventStatus(null, new Date(), ukInstant(DATE, '12:00'))).toBe('cancelled');
  });

  it('reads as Upcoming while the event has no roles and so no window', () => {
    expect(eventStatus(null, null, ukInstant(DATE, '12:00'))).toBe('upcoming');
  });

  it('labels every status the way the pill reads', () => {
    expect(EVENT_STATUS_LABEL.upcoming).toBe('Upcoming');
    expect(EVENT_STATUS_LABEL.cancelled).toBe('Cancelled');
  });
});

describe('fill counts confirmed against headcount (§3.1, §3.2)', () => {
  // The wireframe's Gala Dinner: 2 (+0), 3 (+1), 12 (+2) = 17 (+3).
  const gala = [
    { headcount: 2, buffer: 0, confirmed: 2 },
    { headcount: 3, buffer: 1, confirmed: 3 },
    { headcount: 12, buffer: 2, confirmed: 8 },
  ];

  it('reports 13 of 17 with 4 open, never 13 of 20', () => {
    const fill = eventFill(gala);
    expect(formatEventFill(fill)).toBe('13 of 17');
    expect(formatOpen(fill)).toBe('4 open');
    expect(fill.headcount).toBe(17);
    expect(fill.buffer).toBe(3);
    expect(isEventFull(fill)).toBe(false);
  });

  it('is full at headcount, and reports the buffer seats apart from the count', () => {
    // "6 of 6" with "+1 buffer confirmed" — the wireframe's Product Launch.
    const fill = eventFill([{ headcount: 6, buffer: 1, confirmed: 7 }]);
    expect(formatEventFill(fill)).toBe('6 of 6');
    expect(fill.bufferConfirmed).toBe(1);
    expect(fill.open).toBe(0);
    expect(isEventFull(fill)).toBe(true);
    expect(formatOpen(fill)).toBeNull();
  });

  it('never lets one over-confirmed role cover another that is short', () => {
    const fill = eventFill([
      { headcount: 4, buffer: 2, confirmed: 6 },
      { headcount: 4, buffer: 0, confirmed: 1 },
    ]);
    expect(formatEventFill(fill)).toBe('5 of 8');
    expect(fill.open).toBe(3);
    expect(fill.bufferConfirmed).toBe(2);
  });

  it('counts nothing on a brand-new event', () => {
    const fill = eventFill([{ headcount: 16, buffer: 2, confirmed: 0 }]);
    expect(formatEventFill(fill)).toBe('0 of 16');
    expect(formatOpen(fill)).toBe('16 open');
  });

  it('has no fill at all before the first role exists', () => {
    const fill = eventFill([]);
    expect(formatEventFill(fill)).toBe('0 of 0');
    expect(isEventFull(fill)).toBe(true);
  });
});

describe('the day and period counters (§3.1)', () => {
  it('reads "13 ev · 45 open"', () => {
    expect(formatCounter(13, 45)).toBe('13 ev · 45 open');
    expect(formatCounter(2, 0)).toBe('2 ev · 0 open');
  });
});
