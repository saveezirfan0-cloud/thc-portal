import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingRow, Loaded, OpenShift } from '../data';

/**
 * /shifts, /invites and /radar against their wireframes, and against audit
 * D18: a read that failed says so, with a retry, and never renders as
 * "No shifts booked", "Nothing open" or "No open invitations".
 *
 * `StaffShell` is replaced by a pass-through here — the lock in front of
 * these screens has its own tests (shell-lock.test.tsx) — so what is
 * rendered is exactly the screen's body, plus the counts it hands the nav.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, replace: () => {} }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('../_components/StaffShell', () => ({
  StaffShell: ({
    children,
    below,
    shifts,
    invites,
  }: {
    children: ReactNode;
    below?: ReactNode;
    shifts?: number;
    invites?: number;
  }) => (
    <div data-shifts={shifts ?? 'none'} data-invites={invites ?? 'none'}>
      {below}
      {children}
    </div>
  ),
}));

let bookings: Loaded<BookingRow> = { rows: [], problem: null };
let openShifts: Loaded<OpenShift> = { rows: [], problem: null };
vi.mock('../data', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    loadBookings: async () => bookings,
    loadOpenShifts: async () => openShifts,
  };
});

const { default: ShiftsPage } = await import('../shifts/page');
const { default: InvitesPage } = await import('../invites/page');
const { default: RadarPage } = await import('../radar/page');

const HOUR = 3600_000;

const booking = (over: Partial<BookingRow> = {}): BookingRow => ({
  bookingId: 'b1',
  status: 'confirmed',
  source: 'auto',
  createdAt: new Date(Date.now() - 2 * HOUR),
  confirmedAt: new Date(Date.now() - 48 * HOUR),
  dayBeforeConfirmedAt: new Date(Date.now() - 20 * HOUR),
  onDayConfirmedAt: null,
  reconfirmRequired: false,
  reconfirmReason: null,
  appliedAt: null,
  cancelCause: null,
  shiftId: 's1',
  startsAt: new Date(Date.now() + 2 * HOUR),
  endsAt: new Date(Date.now() + 8 * HOUR),
  payRate: 14,
  dressCode: 'Black & whites',
  headcount: 4,
  buffer: 1,
  confirmedCount: 3,
  role: 'Waiting Staff',
  eventId: 'e1',
  eventTitle: 'Gala Dinner',
  eventDate: '2026-09-25',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St',
  eventCancelledAt: null,
  distanceKm: 1.8,
  onsiteContact: null,
  notes: null,
  paysBreaks: false,
  noCheckoutOpen: false,
  hoursLimit: false,
  weekStart: null,
  bookedHours: null,
  capHours: null,
  ...over,
});

async function render(page: Promise<unknown> | unknown): Promise<string> {
  return renderToStaticMarkup((await page) as ReactElement);
}

beforeEach(() => {
  bookings = { rows: [], problem: null };
  openShifts = { rows: [], problem: null };
});

describe('audit D18 · a failed read is not an empty list', () => {
  it('/shifts says it could not load, not "No shifts booked"', async () => {
    bookings = { rows: [], problem: 'timeout' };
    const html = await render(ShiftsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('We couldn’t load your shifts — pull to refresh or try again.');
    expect(html).toContain('Try again');
    expect(html).not.toContain('No shifts booked');
    // And no count it could not vouch for on the nav.
    expect(html).toContain('data-shifts="none"');
  });

  it('/shifts?tab=open says it could not load, not "Nothing open"', async () => {
    openShifts = { rows: [], problem: 'timeout' };
    const html = await render(ShiftsPage({ searchParams: Promise.resolve({ tab: 'open' }) }));
    expect(html).toContain('We couldn’t load open shifts');
    expect(html).not.toContain('Nothing open right now');
  });

  it('/invites says it could not load, not "No open invitations"', async () => {
    bookings = { rows: [], problem: 'timeout' };
    const html = await render(InvitesPage());
    expect(html).toContain('We couldn’t load your invitations');
    expect(html).not.toContain('No open invitations');
  });

  it('/radar says it could not load, not "Nothing open nearby"', async () => {
    openShifts = { rows: [], problem: 'timeout' };
    const html = await render(RadarPage());
    expect(html).toContain('We couldn’t load open shifts');
    expect(html).not.toContain('Nothing open nearby');
  });

  it('the empty states still show when the read succeeded and there is nothing', async () => {
    expect(await render(ShiftsPage({ searchParams: Promise.resolve({}) }))).toContain(
      'No shifts booked',
    );
    expect(await render(InvitesPage())).toContain('No open invitations');
  });
});

describe('/shifts · today’s card carries the check-in (§10.4, wireframes/staff/shifts.html)', () => {
  it('has a primary "Check in — verify GPS" that opens the shift screen and starts verification', async () => {
    bookings = {
      rows: [
        booking({
          startsAt: new Date(Date.now() + 10 * 60_000),
          onDayConfirmedAt: new Date(Date.now() - HOUR),
        }),
      ],
      problem: null,
    };
    const html = await render(ShiftsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Today');
    expect(html).toContain(
      '<a href="/shifts/b1?checkin=1" class="btn block lg primary">Check in — verify GPS</a>',
    );
    expect(html).toContain('Check-in is open until');
    expect(html).toContain('(UK)');
  });

  it('shows "Not confirmed today" while the on-day confirm is outstanding', async () => {
    bookings = { rows: [booking()], problem: null };
    const html = await render(ShiftsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Not confirmed today');
    expect(html).toContain('Confirm today’s shift');
    // The check-in is still there: the on-day confirm never blocks it.
    expect(html).toContain('href="/shifts/b1?checkin=1"');
    expect(html).toContain('Check-in opens at');
  });

  it('shows "Confirmed" once the on-day confirm is in', async () => {
    bookings = {
      rows: [booking({ onDayConfirmedAt: new Date(Date.now() - HOUR) })],
      problem: null,
    };
    const html = await render(ShiftsPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain('Not confirmed today');
    expect(html).toContain('>Confirmed<');
    expect(html).not.toContain('Confirm today’s shift');
  });

  it('a checked-in today card opens the shift, with no check-in and no on-day confirm', async () => {
    bookings = {
      rows: [booking({ status: 'worked', startsAt: new Date(Date.now() - HOUR) })],
      problem: null,
    };
    const html = await render(ShiftsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Checked in');
    expect(html).toContain('Open shift');
    expect(html).not.toContain('Check in — verify GPS');
    expect(html).not.toContain('Confirm today’s shift');
  });
});

describe('/invites · the pill says how long ago (wireframes/staff/invites.html)', () => {
  it('reads "Invited 2 h ago"', async () => {
    bookings = {
      rows: [
        booking({
          status: 'invited',
          createdAt: new Date(Date.now() - 2 * HOUR - 60_000),
          startsAt: new Date(Date.now() + 72 * HOUR),
          endsAt: new Date(Date.now() + 78 * HOUR),
        }),
      ],
      problem: null,
    };
    const html = await render(InvitesPage());
    expect(html).toMatch(/Invited (2 h ago|yesterday)/);
  });
});
