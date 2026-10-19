import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ShiftDetail } from '../types';

/**
 * The server's paint of the shift screen must be the paint the phone
 * hydrates (React #418 on /shifts/:id, found 19.10.2026):
 *
 *  - the day is "Fri 23 Oct" on every engine — `toLocaleDateString` wrote
 *    "Fri 23 Oct" in Node and "Fri, 23 Oct" in Chrome;
 *  - the "your time" line is never drawn on the server from the SERVER's
 *    zone (UTC on Vercel): the first paint is UK-only and the line arrives
 *    once mounted, from the phone's own zone (`useViewerZone`).
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../actions', () => ({
  checkIn: vi.fn(),
  checkOut: vi.fn(),
  startBreak: vi.fn(),
  finishBreak: vi.fn(),
  recordPing: vi.fn(),
}));

const { ShiftScreen } = await import('../ShiftScreen');

const START = new Date(Date.now() + 4 * 24 * 3600_000);

const shift: ShiftDetail = {
  bookingId: 'b1',
  status: 'confirmed',
  confirmedAt: '2026-06-12T09:00:00Z',
  eventTitle: 'Gala Dinner',
  eventDate: '2026-10-23',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St',
  onsiteContact: null,
  notes: null,
  dressCode: null,
  roleName: 'Waiting Staff',
  startsAt: START.toISOString(),
  endsAt: new Date(START.getTime() + 6 * 3600_000).toISOString(),
  payRate: 14,
  venueLat: 51.5,
  venueLng: -0.1,
  geofenceRadiusM: 150,
  breaksLogged: true,
  checkInAt: null,
  checkOutAt: null,
  breaks: [],
  eventCancelledAt: null,
  cancelCause: null,
  noCheckoutOpen: false,
  turnedAwayAt: null,
  turnedAwayPayMin: null,
};

describe('ShiftScreen server paint', () => {
  it('writes the UK day without an engine-dependent comma', () => {
    // Chrome's ICU, emulated: a weekday-day-month label gains a comma.
    const original = Date.prototype.toLocaleDateString;
    const spy = vi
      .spyOn(Date.prototype, 'toLocaleDateString')
      .mockImplementation(function (this: Date, ...args) {
        const out = original.apply(this, args);
        return args[1]?.weekday ? out.replace(/^(\w{3}) /, '$1, ') : out;
      });
    try {
      const html = renderToString(<ShiftScreen shift={shift} />).replace(/<!-- -->/g, '');
      expect(html).toMatch(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2} · /);
      expect(html).not.toMatch(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d/);
    } finally {
      spy.mockRestore();
    }
  });

  it('draws no "your time" line from the server zone, whatever it is', () => {
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ timeZone: 'UTC' } as Intl.ResolvedDateTimeFormatOptions);
    try {
      const html = renderToString(<ShiftScreen shift={shift} />);
      expect(html).not.toContain('your time');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('ShiftScreen head pill', () => {
  it('says Upcoming before the shift and nothing of the sort after it', () => {
    expect(renderToString(<ShiftScreen shift={shift} />)).toContain('Upcoming');
    const past = new Date(Date.now() - 10 * 24 * 3600_000);
    const worked: ShiftDetail = {
      ...shift,
      status: 'worked',
      startsAt: past.toISOString(),
      endsAt: new Date(past.getTime() + 5 * 3600_000).toISOString(),
      checkInAt: past.toISOString(),
      checkOutAt: new Date(past.getTime() + 5 * 3600_000).toISOString(),
    };
    expect(renderToString(<ShiftScreen shift={worked} />)).not.toContain('Upcoming');
  });
});
