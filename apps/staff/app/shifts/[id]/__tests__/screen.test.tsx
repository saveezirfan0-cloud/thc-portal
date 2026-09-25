import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShiftDetail } from '../types';

/**
 * The shift screen, one wireframe state at a time (§5.1, §5.2b, §10.4,
 * wireframes/staff/shift-detail.html (a)–(n)).
 *
 * Rendered server-side with the clock pinned: `shiftPhase()` decides the
 * state from the row and `now`, and each case asserts the pills, the copy
 * and the controls that state carries — and the ones it must NOT (a static
 * screen has no map, no buttons and no breaks block).
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));

const { ShiftScreen } = await import('../ShiftScreen');
const { STATIC_SCREEN_CONTACT, STATIC_SCREEN_COPY, SUPPORT_EMAIL } = await import('@thc/domain');

/** 17:00–23:30 UK on Sunday 14 June 2026 (BST). */
const START = '2026-06-14T16:00:00Z';
const END = '2026-06-14T22:30:00Z';

const base: ShiftDetail = {
  bookingId: 'b1',
  status: 'confirmed',
  confirmedAt: '2026-06-12T09:00:00Z',
  cancelCause: null,
  eventCancelledAt: null,
  noCheckoutOpen: false,
  leftEarly: false,
  eventDate: '2026-06-14',
  eventTitle: 'Gala Dinner',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, EC4V 5AJ',
  onsiteContact: 'Marco, Banqueting Manager — 07700 900123',
  notes: 'Use the Godliman St staff entrance.',
  dressCode: 'Black & whites',
  roleName: 'Waiting Staff',
  startsAt: START,
  endsAt: END,
  payRate: 14,
  venueLat: 51.5,
  venueLng: -0.1,
  geofenceRadiusM: 150,
  breaksLogged: true,
  checkInAt: null,
  checkOutAt: null,
  noCheckOut: 'none',
  turnedAwayAt: null,
  breaks: [],
};

function render(shift: Partial<ShiftDetail>, at: string, firstName = 'Amara'): string {
  vi.setSystemTime(new Date(at));
  return renderToStaticMarkup(<ShiftScreen shift={{ ...base, ...shift }} firstName={firstName} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('(a) before the day', () => {
  const html = () => render({}, '2026-06-12T13:32:00Z');

  it('carries the date, the hours and rate, the Rate row and the Maps link', () => {
    const h = html();
    expect(h).toContain('>Confirmed<');
    expect(h).toContain('Sun 14 Jun');
    expect(h).toContain('17:00 – 23:30 UK time');
    expect(h).toContain('6.5 h');
    expect(h).toContain('£14.00 per hour · base rate');
    expect(h).toContain('Open in Maps ↗');
    expect(h).toContain('Leonardo Royal Hotel, 10 Godliman St, EC4V 5AJ');
  });

  it('says when check-in opens and what the break policy is', () => {
    const h = html();
    expect(h).toContain('Check-in opens Sun 14 Jun at 16:30 UK time (30 min before start)');
    expect(h).toContain('within 150 m of the venue');
    expect(h).toContain('Breaks: unpaid by this client — the Breaks block unlocks after check-in.');
  });

  it('draws the map with the pin and the geofence, and the Breaks block locked', () => {
    const h = html();
    expect(h).toContain('class="geo-map"');
    expect(h).toContain('Leonardo Royal Hotel · geofence 150 m');
    expect(h).toContain('Unlocks after check-in');
    expect(h).toMatch(/<button[^>]*disabled[^>]*>Start break<\/button>/);
  });

  it('offers Cancel shift while more than 72 h remain, worded as RULE-04', () => {
    // Four days out: the deadline is Thursday 11 June, 17:00 UK.
    const h = render({}, '2026-06-10T13:32:00Z');
    expect(h).toContain('Cancel available until Thu 11, 17:00 (72 h before start)');
    expect(h).toContain('Cancel shift');
    // At 48 h out the row is gone.
    expect(render({}, '2026-06-12T17:00:00Z')).not.toContain('Cancel available until');
  });

  it('says nothing about breaks to log where the client pays them', () => {
    const h = render({ breaksLogged: false }, '2026-06-12T13:32:00Z');
    expect(h).toContain('Breaks: paid by this client — nothing to log.');
    expect(h).not.toContain('Unlocks after check-in');
  });
});

describe('(b)(c) today, the check-in window', () => {
  it('shows Today + Confirmed, the button and the labelled window sentence', () => {
    const h = render({}, '2026-06-14T15:48:00Z');
    expect(h).toContain('>Today<');
    expect(h).toContain('>Confirmed<');
    expect(h).toContain('Check in — verify GPS');
    expect(h).toContain('Check-in window 16:30 – 17:30 UK time');
    expect(h).toContain('at 17:30 check-in locks (§5.1)');
    // Not a bare "(UK)" anywhere (§1.8).
    expect(h).not.toMatch(/\d{2}:\d{2} UK</);
  });

  it('keeps the Breaks block on screen, disabled, with the hint (§5.2b)', () => {
    const h = render({}, '2026-06-14T15:48:00Z');
    expect(h).toContain('Unpaid by client');
    expect(h).toContain('Unlocks after check-in');
    expect(h).toContain('A break will be applied to all shifts over 6 hours');
  });
});

describe('(l) locked after the grace', () => {
  it('shows Not attended, a disabled Check-in closed button and the office email', () => {
    const h = render({}, '2026-06-14T16:31:00Z');
    expect(h).toContain('>Today<');
    expect(h).toContain('>Not attended<');
    expect(h).toMatch(/<button[^>]*disabled[^>]*>Check-in closed<\/button>/);
    expect(h).toContain('You’ve been marked as not attended — contact the office.');
    expect(h).toContain('Check-in closed at 17:30 UK time, 30 minutes after your start time.');
    expect(h).toContain(`a manager can register your arrival: ${SUPPORT_EMAIL}`);
    expect(h).not.toContain('Start break');
  });
});

describe('(d) checked in', () => {
  const on = { status: 'worked', checkInAt: '2026-06-14T15:52:00Z' };

  it('runs the chargeable clock from the paid start, as HH:MM:SS, under its label', () => {
    const h = render(on, '2026-06-14T18:14:36Z');
    expect(h).toContain('Checked in');
    expect(h).toContain('On shift · chargeable time');
    expect(h).toContain('>02:14:36<');
    expect(h).toContain('paid from 17:00 UK time (RULE-01) · scheduled end 23:30');
  });

  it('carries the keep-open bar, the unlocked Breaks block and the check-out hint', () => {
    const h = render(on, '2026-06-14T18:14:36Z');
    expect(h).toContain('Keep this screen open during your shift');
    expect(h).not.toContain('Unlocks after check-in');
    expect(h).toMatch(/<button[^>]*>Start break<\/button>/);
    expect(h).not.toMatch(/<button[^>]*disabled[^>]*>Start break<\/button>/);
    expect(h).toContain('No breaks logged yet.');
    expect(h).toContain('>Check out<');
    expect(h).toContain('Check-out works from anywhere until 03:30 UK time');
    expect(h).toContain('(4 h after the end) — being on site only affects the time we record.');
    expect(h).toContain('Marco, Banqueting Manager');
  });

  it('(g) has no break buttons at all where the client pays breaks', () => {
    const h = render({ ...on, breaksLogged: false }, '2026-06-14T18:14:36Z');
    expect(h).not.toContain('Start break');
    expect(h).toContain('Paid by this client — take them as your manager on site directs.');
  });
});

describe('(f) on break', () => {
  it('runs the break timer, pauses the chargeable one and offers Finish break', () => {
    const h = render(
      {
        status: 'worked',
        checkInAt: '2026-06-14T15:52:00Z',
        breaks: [{ id: '1', startedAt: '2026-06-14T18:31:00Z', endedAt: null }],
      },
      '2026-06-14T18:39:12Z',
    );
    expect(h).toContain('>On break<');
    expect(h).toContain('Break · running');
    expect(h).toContain('>00:08:12<');
    expect(h).toContain('Chargeable time · paused');
    expect(h).toContain('Resumes when you finish your break');
    expect(h).toContain('Finish break — back to work');
    expect(h).toContain('– now');
  });
});

describe('(h) after the scheduled end, still on shift', () => {
  it('says the shift ended, prices the break row and offers another break', () => {
    const h = render(
      {
        status: 'worked',
        checkInAt: '2026-06-14T15:52:00Z',
        breaks: [{ id: '1', startedAt: '2026-06-14T18:31:00Z', endedAt: '2026-06-14T18:51:00Z' }],
      },
      '2026-06-14T22:31:02Z',
    );
    expect(h).toContain('Shift ended 23:30');
    expect(h).toContain('>06:11:02<');
    expect(h).toContain('1 break (20 min) · paid up to 23:30 UK time');
    expect(h).toContain('checking out within 15 min of the end doesn’t add time (RULE-01)');
    expect(h).toContain('· 20 min');
    expect(h).toContain('Start another break');
    expect(h).toContain(
      'Still available until you check out, even after the scheduled end (§5.2b).',
    );
    expect(h).toContain('class="geo-map"');
  });
});

describe('(k) checked out', () => {
  const done = {
    status: 'worked',
    checkInAt: '2026-06-14T15:52:00Z',
    checkOutAt: '2026-06-14T22:32:00Z',
    breaks: [{ id: '1', startedAt: '2026-06-14T18:31:00Z', endedAt: '2026-06-14T18:51:00Z' }],
  };

  it('shows the stamp, thanks the worker by name, the paid window and Done', () => {
    const h = render(done, '2026-06-14T22:33:00Z');
    expect(h).toContain('Checked out · 23:32');
    expect(h).toContain('Shift complete — thank you, Amara');
    expect(h).toContain('17:00 – 23:30 · 6 h 30 m');
    expect(h).toContain('− 20 m');
    expect(h).toContain('6 h 10 m');
    expect(h).toContain('£14.00 / h');
    expect(h).toContain('Total earnings for this shift');
    expect(h).toContain('£86.33');
    expect(h).toContain('You’re paid the Friday after the week');
    expect(h).toMatch(/<a[^>]*href="\/shifts"[^>]*>Done<\/a>/);
    expect(h).not.toContain('Check out<');
  });

  it('prints the paid window, not the schedule, for an early leaver', () => {
    const h = render(
      { ...done, breaks: [], checkOutAt: '2026-06-14T21:00:00Z' },
      '2026-06-14T22:33:00Z',
    );
    expect(h).toContain('17:00 – 22:00 · 5 h');
  });

  it('thanks the worker without a name when none is on file', () => {
    expect(render(done, '2026-06-14T22:33:00Z', '')).toContain('Shift complete — thank you<');
  });
});

describe('(n) the static screens — no map, no buttons, no breaks block', () => {
  it('No check-out: the approved copy, the pill, the shift line, the contact and OK', () => {
    const h = render(
      {
        status: 'worked',
        checkInAt: '2026-06-14T15:52:00Z',
        checkOutAt: '2026-06-14T15:52:00Z',
        noCheckoutOpen: true,
        noCheckOut: 'unresolved',
      },
      '2026-06-15T08:20:00Z',
    );
    expect(h).toContain('Awaiting the office');
    expect(h).toContain(STATIC_SCREEN_COPY.no_checkout.title);
    expect(h).toContain(STATIC_SCREEN_COPY.no_checkout.body);
    expect(h).toContain('Gala Dinner · 17:00 – 23:30 UK time · checked in 16:52');
    expect(h).toContain(STATIC_SCREEN_CONTACT);
    expect(h).toContain('OK, I understand');
    expect(h).not.toContain('geo-map');
    expect(h).not.toContain('Check out');
    expect(h).not.toContain('Start break');
  });

  it('No check-out by the clock: four hours after the end with no press', () => {
    const h = render(
      { status: 'worked', checkInAt: '2026-06-14T15:52:00Z' },
      '2026-06-15T02:31:00Z',
    );
    expect(h).toContain(STATIC_SCREEN_COPY.no_checkout.title);
    expect(h).toContain('Awaiting the office');
  });

  it('Event cancelled (N12)', () => {
    const h = render({ eventCancelledAt: '2026-06-13T10:00:00Z' }, '2026-06-14T15:48:00Z');
    expect(h).toContain('>Cancelled<');
    expect(h).toContain(STATIC_SCREEN_COPY.event_cancelled.title);
    expect(h).toContain('Gala Dinner · Sun 14 Jun · Leonardo Royal Hotel');
    expect(h).toContain(STATIC_SCREEN_CONTACT);
    expect(h).toContain('OK, I understand');
    expect(h).not.toContain('Check in — verify GPS');
    expect(h).not.toContain('geo-map');
  });

  it('Withdrawn (N10b)', () => {
    const h = render(
      { status: 'cancelled', cancelCause: 'office_withdraw' },
      '2026-06-14T15:48:00Z',
    );
    expect(h).toContain('>Withdrawn<');
    // The apostrophe is HTML-escaped in static markup; the sentence is the scope's.
    expect(h).toContain('been removed from this shift');
    expect(h).toContain(STATIC_SCREEN_COPY.withdrawn.body);
    expect(h).not.toContain('Check in — verify GPS');
  });
});

describe('(m) the strict-buffer turn-away (RULE-15)', () => {
  it('is terminal: the pill, the thanks, the four hours when on time, OK and Radar', () => {
    const h = render(
      { status: 'turned_away', turnedAwayAt: '2026-06-14T15:58:00Z' },
      '2026-06-14T16:10:00Z',
    );
    expect(h).toContain('Not needed today');
    expect(h).toContain('Thanks for coming');
    expect(h).toContain('you’ll be paid for 4 hours');
    expect(h).toContain('Please check your app for other shifts.');
    expect(h).toContain('OK, I understand');
    expect(h).toContain('Open Radar');
    expect(h).not.toContain('Check in — verify GPS');
  });

  it('pays nothing to a worker turned away late', () => {
    const h = render(
      { status: 'turned_away', turnedAwayAt: '2026-06-14T16:35:00Z' },
      '2026-06-14T16:40:00Z',
    );
    expect(h).toContain('Not needed today');
    expect(h).not.toContain('paid for 4 hours');
  });
});
