import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingRow, Loaded, OpenShift } from '../data';

/**
 * Go-live audit L4 / H2 · how many prefetch requests a list screen makes.
 *
 * In Next 15.5, each `<Link>` that prefetches sends one request (through
 * the middleware, rendering up to the route's loading skeleton) for its
 * URL. It sends it when the link comes within 200 px of the viewport, and
 * again whenever the list is mounted afresh after a refresh or a server
 * action has cleared the router's cache (`AutoRefresh` every ~150 s, every
 * "I'm ready", every Apply). A card link on every row multiplied that by
 * the length of the list.
 *
 * Measured here as the number of distinct URLs on a screen whose link
 * still prefetches. (The four bottom tabs belong to the shell, which is
 * replaced by a pass-through below; they keep prefetching.) The fixture:
 * a today shift, 8 upcoming, 5 past, 12 open shifts and 6 invitations.
 *
 *                       before   after
 *   /shifts               17       4   2 segment links + today's 2 (its card, its check-in)
 *   /shifts?tab=open      14       2   the segment links
 *   /radar                12       0
 *   /invites               6       0
 *
 * (Before = the same fixture against the pages as they were. The 5 past
 * rows sit in a closed <details>, so they only prefetched once it was
 * opened; everything else prefetched as it came near the viewport.)
 *
 * A card that does not prefetch still opens at once: NavProgress paints on
 * the tap, and the route's loading skeleton is the first thing the server
 * streams back.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-25T13:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch,
    className,
  }: {
    href: string;
    children: ReactNode;
    prefetch?: boolean | null;
    className?: string;
  }) => (
    <a href={href} className={className} data-prefetch={prefetch === false ? 'off' : 'on'}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, replace: () => {} }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('../_components/StaffShell', () => ({
  StaffShell: ({ children, below }: { children: ReactNode; below?: ReactNode }) => (
    <div>
      {below}
      {children}
    </div>
  ),
}));

let bookings: Loaded<BookingRow> = { rows: [], problem: null };
let openShifts: Loaded<OpenShift> = { rows: [], problem: null };
vi.mock('../data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadBookings: async () => bookings,
  loadOpenShifts: async () => openShifts,
}));

const { default: ShiftsPage } = await import('../shifts/page');
const { default: InvitesPage } = await import('../invites/page');
const { default: RadarPage } = await import('../radar/page');

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const booking = (n: number, over: Partial<BookingRow> = {}): BookingRow => ({
  bookingId: `b${n}`,
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
  shiftId: `s${n}`,
  startsAt: new Date(Date.now() + n * DAY),
  endsAt: new Date(Date.now() + n * DAY + 6 * HOUR),
  payRate: 14,
  dressCode: 'Black & whites',
  headcount: 4,
  buffer: 1,
  confirmedCount: 3,
  role: 'Waiting Staff',
  eventId: `e${n}`,
  eventTitle: `Gala Dinner ${n}`,
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

const openShift = (n: number): OpenShift => ({
  shiftId: `o${n}`,
  qualified: n % 2 === 0,
  hoursLimit: false,
  appliedAt: null,
  distanceKm: n,
  startsAt: new Date(Date.now() + n * DAY),
  endsAt: new Date(Date.now() + n * DAY + 6 * HOUR),
  eventId: `oe${n}`,
  eventTitle: `Open event ${n}`,
  eventDate: '2026-09-26',
  role: 'Bar Staff',
  payRate: 13,
  dressCode: '',
  venueName: 'Somewhere',
  venueAddress: '1 High St',
  headcount: 4,
  buffer: 0,
  confirmedCount: 1,
  weekStart: null,
  bookedHours: null,
  capHours: null,
  venueLat: null,
  venueLng: null,
  geofenceRadiusM: null,
  homeLat: null,
  homeLng: null,
});

function fixture() {
  const today = booking(0, {
    startsAt: new Date(Date.now() + 10 * 60_000),
    endsAt: new Date(Date.now() + 6 * HOUR),
    onDayConfirmedAt: new Date(Date.now() - HOUR),
  });
  const upcoming = Array.from({ length: 8 }, (_, i) => booking(i + 2));
  const past = Array.from({ length: 5 }, (_, i) =>
    booking(100 + i, {
      status: 'worked',
      startsAt: new Date(Date.now() - (i + 2) * DAY),
      endsAt: new Date(Date.now() - (i + 2) * DAY + 6 * HOUR),
    }),
  );
  const invites = Array.from({ length: 6 }, (_, i) =>
    booking(200 + i, { status: 'invited', confirmedAt: null, dayBeforeConfirmedAt: null }),
  );
  bookings = { rows: [today, ...upcoming, ...past, ...invites], problem: null };
  openShifts = { rows: Array.from({ length: 12 }, (_, i) => openShift(i + 1)), problem: null };
}

/** The distinct URLs on the screen whose link still prefetches. */
async function prefetched(page: unknown): Promise<string[]> {
  const html = renderToStaticMarkup((await page) as ReactElement);
  const urls = [...html.matchAll(/<a href="([^"]+)"[^>]*data-prefetch="on"/g)].map((m) =>
    m[1]!.replace(/&amp;/g, '&'),
  );
  return [...new Set(urls)].sort();
}

/** Every distinct link URL on the screen, prefetching or not. */
async function linked(page: unknown): Promise<string[]> {
  const html = renderToStaticMarkup((await page) as ReactElement);
  return [...new Set([...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]!))];
}

beforeEach(fixture);

describe('card links do not prefetch; the segment links and today’s check-in do', () => {
  it('/shifts: the two segment links and today’s card, nothing else', async () => {
    const page = () => ShiftsPage({ searchParams: Promise.resolve({}) });
    expect(await prefetched(page())).toEqual(
      ['/shifts', '/shifts/b0', '/shifts/b0?checkin=1', '/shifts?tab=open'].sort(),
    );
    // The cards are all still there, as links.
    const all = await linked(page());
    for (const id of ['b2', 'b9', 'b100', 'b104']) expect(all).toContain(`/shifts/${id}`);
  });

  it('/shifts?tab=open: the segment links only', async () => {
    const page = () => ShiftsPage({ searchParams: Promise.resolve({ tab: 'open' }) });
    expect(await prefetched(page())).toEqual(['/shifts', '/shifts?tab=open']);
    expect((await linked(page())).filter((u) => u.startsWith('/radar/'))).toHaveLength(12);
  });

  it('/radar: no card prefetches', async () => {
    expect(await prefetched(RadarPage())).toEqual([]);
    expect((await linked(RadarPage())).filter((u) => u.startsWith('/radar/'))).toHaveLength(12);
  });

  it('/invites: no card prefetches', async () => {
    expect(await prefetched(InvitesPage())).toEqual([]);
    expect((await linked(InvitesPage())).filter((u) => u.startsWith('/invites/'))).toHaveLength(6);
  });
});
