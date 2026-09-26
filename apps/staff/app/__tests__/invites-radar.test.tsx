import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RADAR_GROUP_LABEL, ukInstant } from '@thc/domain';
import type * as Data from '../data';
import type { BookingRow, OpenShift, WeekMeter } from '../data';
import type { StaffProfile } from '../profile/types';

/**
 * /invites, /invites/:id, /radar and /radar/:id against
 * wireframes/staff/{invites,radar}.html, with the two RPC loaders mocked
 * (§10.4). What is pinned here is what the e2e suite skips without a
 * Supabase project: RULE-16 on the list, the "Limit Reached" pill and
 * disabled button, the amber overlap pre-warning, the withheld rows, the
 * Applied section, the week strip for the CURRENT week, the map and the
 * meter on the detail — and one Shifts badge on every page.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('../actions', () => ({
  acceptInvite: vi.fn(),
  declineInvite: vi.fn(),
  applyForShift: vi.fn(),
  withdrawApplication: vi.fn(),
  cancelShift: vi.fn(),
  confirmToday: vi.fn(),
  markReady: vi.fn(),
  reconfirm: vi.fn(),
  takeOfferedShift: vi.fn(),
}));
vi.mock('../profile/photos', () => ({ signOwnPhoto: async () => null }));
vi.mock('../profile/data', () => ({
  readProfile: async (): Promise<{ kind: 'ok'; profile: StaffProfile }> => ({
    kind: 'ok',
    profile: {
      staffId: 's1',
      firstName: 'Amara',
      lastName: 'Kalu',
      employeeId: 417,
      email: 'amara@example.test',
      phone: '+447700900123',
      homeAddress: null,
      photoPath: null,
      photoLocked: true,
      status: 'compliant',
      blockKind: null,
      leftAt: null,
      rtwBranch: 'uk_irish',
      niMasked: null,
      hasNiNumber: true,
      rating: null,
      reliability: null,
      quizAttempts: 1,
      roles: ['Waiting Staff', 'Bar Staff'],
      blockers: [],
      checkedIn: false,
      bank: null,
    },
  }),
}));

const bookings = vi.fn<() => Promise<BookingRow[]>>();
const openShifts = vi.fn<() => Promise<OpenShift[]>>();
const meter = vi.fn<() => Promise<WeekMeter | null>>();
// The loaders hand back { rows | row, problem } (audit D18); these reads
// all succeed, so `problem` is null throughout.
vi.mock('../data', async (importOriginal) => ({
  ...(await importOriginal<typeof Data>()),
  loadBookings: async () => ({ rows: await bookings(), problem: null }),
  loadOpenShifts: async () => ({ rows: await openShifts(), problem: null }),
  loadWeekMeter: async () => ({ row: await meter(), problem: null }),
  findBooking: async (id: string) => ({
    row: (await bookings()).find((b) => b.bookingId === id) ?? null,
    problem: null,
  }),
  findOpenShift: async (id: string) => ({
    row: (await openShifts()).find((s) => s.shiftId === id) ?? null,
    problem: null,
  }),
}));

// ADR-0045's two offer reads (audit D18): they succeed with nothing unless
// a test says otherwise.
type OfferLoad = { rows: never[]; problem: string | null };
const offerReads = vi.hoisted(() => ({
  booking: { rows: [], problem: null } as { rows: never[]; problem: string | null },
  open: { rows: [], problem: null } as { rows: never[]; problem: string | null },
  one: { row: null, problem: null } as { row: null; problem: string | null },
}));
vi.mock('../shifts/offers-data', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadBookingOffers: async (): Promise<OfferLoad> => offerReads.booking,
  loadOpenOffers: async (): Promise<OfferLoad> => offerReads.open,
  findOpenOffer: async () => offerReads.one,
}));

const { default: InvitesPage } = await import('../invites/page');
const { default: InvitePage } = await import('../invites/[id]/page');
const { default: RadarPage } = await import('../radar/page');
const { default: RadarDetailPage } = await import('../radar/[id]/page');
const { default: ShiftsPage } = await import('../shifts/page');
const { default: RadarOfferPage } = await import('../radar/offers/[id]/page');

// Every fixture is placed against the real clock, because RULE-16 is.
const NOW = Date.now();
const hours = (n: number) => new Date(NOW + n * 3_600_000);
// The Awards Night, a week out, at UK wall-clock times the card prints.
const isoDay = (daysAhead: number) =>
  new Date(NOW + daysAhead * 86_400_000).toISOString().slice(0, 10);
const AWARDS_START = ukInstant(isoDay(7), '16:00');
const AWARDS_END = ukInstant(isoDay(8), '02:00');
const AWARDS_BAR_START = ukInstant(isoDay(7), '17:00');

const booking = (over: Partial<BookingRow>): BookingRow => ({
  bookingId: 'b',
  status: 'invited',
  source: 'auto',
  createdAt: hours(-2),
  confirmedAt: null,
  dayBeforeConfirmedAt: null,
  onDayConfirmedAt: null,
  reconfirmRequired: false,
  reconfirmReason: null,
  appliedAt: null,
  cancelCause: null,
  shiftId: 's',
  startsAt: hours(96),
  endsAt: hours(103),
  payRate: 15.5,
  dressCode: 'Black shirt, black trousers, black shoes',
  headcount: 8,
  buffer: 1,
  confirmedCount: 2,
  role: 'Bar Staff',
  eventId: 'e',
  eventTitle: 'Product Launch — Bar',
  eventDate: '2026-09-19',
  venueName: 'Mandarin Oriental',
  venueAddress: '66 Knightsbridge, SW1X 7LA',
  eventCancelledAt: null,
  distanceKm: 3.4,
  onsiteContact: null,
  notes: null,
  paysBreaks: null,
  noCheckoutOpen: false,
  hoursLimit: false,
  weekStart: '2026-09-14',
  bookedHours: 8,
  capHours: 20,
  ...over,
});

const FIXTURE_BOOKINGS: BookingRow[] = [
  booking({ bookingId: 'inv-launch' }),
  // Confirmed Awards Night · Waiting Staff 16:00 – 02:00 UK, and an
  // invitation to the same night's bar at the same venue: intersecting.
  booking({
    bookingId: 'held-awards',
    status: 'confirmed',
    confirmedAt: hours(-30),
    shiftId: 's-awards-ws',
    eventTitle: 'Awards Night',
    role: 'Waiting Staff',
    venueName: 'The Dorchester',
    venueAddress: '53 Park Lane, W1K 1QA',
    startsAt: AWARDS_START,
    endsAt: AWARDS_END,
  }),
  booking({
    bookingId: 'inv-awards',
    shiftId: 's-awards-bar',
    eventTitle: 'Awards Night',
    role: 'Bar Staff',
    venueName: 'The Dorchester',
    venueAddress: '53 Park Lane, W1K 1QA',
    startsAt: AWARDS_BAR_START,
    endsAt: AWARDS_END,
  }),
  booking({
    bookingId: 'inv-limit',
    shiftId: 's-breakfast',
    eventTitle: 'Conference Breakfast',
    role: 'Waiting Staff',
    venueName: 'ExCeL London',
    venueAddress: 'Royal Victoria Dock, E16 1XL',
    startsAt: hours(240),
    endsAt: hours(248),
    hoursLimit: true,
    weekStart: '2026-09-21',
    bookedHours: 18,
    capHours: 20,
  }),
  booking({
    bookingId: 'inv-ended',
    eventTitle: 'Ended Gala',
    startsAt: hours(-30),
    endsAt: hours(-24),
  }),
  booking({
    bookingId: 'inv-cancelled',
    eventTitle: 'Cancelled Gala',
    eventCancelledAt: hours(-1),
  }),
  booking({ bookingId: 'worked-1', status: 'worked', eventTitle: 'Board Lunch' }),
  // The screenshot: a booking two weeks gone, still `confirmed` because
  // nobody checked in (a No-show is a violation, not a status). It is
  // history — in no badge, and under "Past shifts", not above today.
  booking({
    bookingId: 'stale',
    status: 'confirmed',
    confirmedAt: hours(-400),
    eventTitle: 'Stale Lunch',
    startsAt: hours(-14 * 24),
    endsAt: hours(-14 * 24 + 5),
  }),
  booking({
    bookingId: 'applied-1',
    status: 'applied',
    shiftId: 's-wedding',
    appliedAt: hours(-1),
  }),
];

const shift = (over: Partial<OpenShift>): OpenShift => ({
  shiftId: 's',
  eventId: 'e',
  eventTitle: 'Board Dinner',
  eventDate: '2026-09-19',
  role: 'Waiting Staff',
  startsAt: hours(100),
  endsAt: hours(105),
  payRate: 14,
  dressCode: 'Black & whites',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, London EC4V 5AJ',
  distanceKm: 1.2,
  headcount: 8,
  buffer: 1,
  confirmedCount: 6,
  qualified: true,
  hoursLimit: false,
  appliedAt: null,
  weekStart: '2026-09-14',
  bookedHours: 8,
  capHours: 20,
  venueLat: 51.513,
  venueLng: -0.099,
  geofenceRadiusM: 150,
  homeLat: 51.53,
  homeLng: -0.05,
  ...over,
});

const FIXTURE_SHIFTS: OpenShift[] = [
  shift({ shiftId: 's-board' }),
  shift({
    shiftId: 's-awards-bar',
    eventTitle: 'Awards Night',
    role: 'Bar Staff',
    venueName: 'The Dorchester',
    qualified: false,
    distanceKm: 4.1,
  }),
  shift({
    shiftId: 's-brunch',
    eventTitle: 'Brunch Service',
    venueName: 'Private client (Hurst)',
    qualified: false,
    hoursLimit: true,
    startsAt: hours(240),
    endsAt: hours(244),
    weekStart: '2026-09-21',
    bookedHours: 18,
    capHours: 20,
    distanceKm: 6.8,
  }),
  shift({
    shiftId: 's-wedding',
    eventTitle: 'Wedding — Marquee',
    venueName: 'Hurst Manor',
    qualified: true,
    appliedAt: hours(-1),
    distanceKm: 38,
  }),
];

const FIXTURE_METER: WeekMeter = {
  weekStart: '2026-09-14',
  weekEnd: '2026-09-20',
  bookedHours: 8,
  capHours: 20,
  roles: ['Bar Staff', 'Waiting Staff'],
};

/** Page → StaffShell element → awaited shell → markup. */
async function render(page: Promise<unknown>): Promise<string> {
  const element = (await page) as ReactElement<{ [key: string]: unknown }>;
  const shell = element.type as (props: unknown) => Promise<ReactElement>;
  return renderToStaticMarkup(await shell(element.props));
}

const disabledButton = (html: string, label: string) =>
  new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`).test(html);

beforeEach(() => {
  offerReads.booking = { rows: [], problem: null };
  offerReads.open = { rows: [], problem: null };
  offerReads.one = { row: null, problem: null };
  bookings.mockReset().mockResolvedValue(FIXTURE_BOOKINGS);
  openShifts.mockReset().mockResolvedValue(FIXTURE_SHIFTS);
  meter.mockReset().mockResolvedValue(FIXTURE_METER);
});

describe('the Shifts badge is the same number on every tab (§10.1)', () => {
  it.each([
    ['/invites', () => InvitesPage()],
    ['/invites/:id', () => InvitePage({ params: Promise.resolve({ id: 'inv-launch' }) })],
    ['/radar', () => RadarPage()],
    ['/radar/:id', () => RadarDetailPage({ params: Promise.resolve({ id: 's-board' }) })],
    ['/shifts', () => ShiftsPage({ searchParams: Promise.resolve({}) })],
  ])(
    '%s counts upcoming confirmed + worked (2) and the open invitations (3)',
    async (_route, page) => {
      const html = await render(page());
      expect(html).toContain('Shifts<span class="n">2</span>');
      expect(html).toContain('Invites<span class="n">3</span>');
    },
  );
});

describe('/shifts — My shifts (§10.4, shifts.html)', () => {
  it('groups upcoming shifts soonest first and keeps the past collapsed below them', async () => {
    const html = await render(ShiftsPage({ searchParams: Promise.resolve({}) }));
    const awards = html.indexOf('Awards Night · Waiting Staff');
    const board = html.indexOf('Board Lunch');
    const past = html.indexOf('Past shifts · 1');
    const stale = html.indexOf('Stale Lunch');
    // Board Lunch (hours 96–103) and the Awards Night (a week out).
    expect(board).toBeGreaterThan(-1);
    expect(awards).toBeGreaterThan(board);
    expect(past).toBeGreaterThan(awards);
    expect(stale).toBeGreaterThan(past);
    expect(html).toContain('<details class="past-shifts">');
  });

  it('the stale booking reads "Not checked in", never "Confirmed"', async () => {
    const html = await render(ShiftsPage({ searchParams: Promise.resolve({}) }));
    const row = html.slice(html.indexOf('Stale Lunch'));
    expect(row.slice(0, row.indexOf('</a>'))).toContain('Not checked in');
  });

  it('the venue name leads and the address sits under it', async () => {
    const html = await render(ShiftsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(
      '<span class="venue-name">The Dorchester</span><span class="venue-addr">53 Park Lane, W1K 1QA</span>',
    );
  });

  it('carries the current week’s hours meter (RULE-20), the same as Radar', async () => {
    const html = await render(ShiftsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('This week (Mon 14 – Sun 20)');
    expect(html).toContain('8 h of 20 h');
  });
});

describe('/invites (§10.4, invites.html)', () => {
  it('RULE-16: an ended event’s invitation and a cancelled event’s are not offered', async () => {
    const html = await render(InvitesPage());
    expect(html).toContain('Product Launch — Bar · Bar Staff');
    expect(html).not.toContain('Ended Gala');
    expect(html).not.toContain('Cancelled Gala');
  });

  it('Limit Reached: the coral pill, the arithmetic, and a disabled Accept reading the same', async () => {
    const html = await render(InvitesPage());
    expect(html).toContain('<span class="pill coral">Limit Reached</span>');
    expect(html).toContain('18 h + 8 h is 26 h against your 20 h limit');
    expect(disabledButton(html, 'Limit Reached')).toBe(true);
  });

  it('draws the amber overlap line on the card BEFORE the worker taps', async () => {
    const html = await render(InvitesPage());
    expect(html).toContain(
      '<div class="m amber">Overlaps your confirmed Awards Night · Waiting Staff 16:00 – 02:00</div>',
    );
    // Exactly one card carries it: the Product Launch invitation is clear.
    expect(html.split('m amber').length - 1).toBe(1);
  });

  it('shows the dress code on the card and never the on-site contact', async () => {
    const html = await render(InvitesPage());
    expect(html).toContain('Dress code: Black shirt, black trousers, black shoes');
    expect(html).not.toContain('On-site contact');
  });
});

describe('/invites/:id', () => {
  it('withholds the on-site contact and breaks as struck-through rows', async () => {
    const html = await render(InvitePage({ params: Promise.resolve({ id: 'inv-launch' }) }));
    expect(html).toContain(
      '<span class="k">On-site contact</span><span class="v">Shown after you accept</span>',
    );
    expect(html).toContain(
      '<span class="k">Breaks</span><span class="v">Shown after you accept</span>',
    );
    expect(html.split('class="kv off"').length - 1).toBe(2);
    expect(html).toContain('<b>Black shirt, black trousers, black shoes</b>');
  });

  it('carries the overlap warning as an amber alert', async () => {
    const html = await render(InvitePage({ params: Promise.resolve({ id: 'inv-awards' }) }));
    expect(html).toContain('class="alert amber"');
    expect(html).toContain('Overlaps your confirmed Awards Night · Waiting Staff 16:00 – 02:00.');
  });

  it('Limit Reached: the pill, the coral alert and the disabled button', async () => {
    const html = await render(InvitePage({ params: Promise.resolve({ id: 'inv-limit' }) }));
    expect(html).toContain('<span class="pill coral">Limit Reached</span>');
    expect(html).toContain('<b>Limit Reached.</b>');
    expect(disabledButton(html, 'Limit Reached')).toBe(true);
  });

  it('a booking that is not an invitation is a 404 here', async () => {
    await expect(InvitePage({ params: Promise.resolve({ id: 'held-awards' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});

describe('/radar (§10.4, radar.html)', () => {
  it('the strip is the CURRENT UK week — its range, the roles line and the figure', async () => {
    const html = await render(RadarPage());
    expect(html).toContain('This week (Mon 14 – Sun 20)');
    expect(html).toContain('Bar Staff · Waiting Staff');
    expect(html).toContain('8 h of 20 h');
    expect(html).toContain('style="width:40%"');
  });

  it('the strip does not depend on the soonest open shift', async () => {
    openShifts.mockResolvedValue([]);
    const html = await render(RadarPage());
    expect(html).toContain('This week (Mon 14 – Sun 20)');
    expect(html).toContain('Nothing open nearby');
  });

  it('with no meter there is no strip, and nothing invented in its place', async () => {
    meter.mockResolvedValue(null);
    const html = await render(RadarPage());
    expect(html).not.toContain('This week');
  });

  it('groups: worked-here-before first, other clients, then Applied with Withdraw', async () => {
    const html = await render(RadarPage());
    const qualified = html.indexOf(RADAR_GROUP_LABEL.qualified.replace("'", '&#x27;'));
    const other = html.indexOf(RADAR_GROUP_LABEL.other);
    const applied = html.indexOf(RADAR_GROUP_LABEL.applied);
    expect(qualified).toBeGreaterThan(-1);
    expect(qualified).toBeLessThan(other);
    expect(other).toBeLessThan(applied);
    expect(html).toContain('<span class="pill purple">Worked here before</span>');
    expect(html).toContain('<span class="pill purple">Applied</span>');
    expect(html).toContain('Withdraw application');
    expect(html.indexOf('Wedding — Marquee')).toBeGreaterThan(applied);
  });

  it('a Limit Reached card is muted with a disabled button, not a live View & apply', async () => {
    const html = await render(RadarPage());
    expect(html).toContain('<span class="pill coral">Limit Reached</span>');
    expect(disabledButton(html, 'Limit Reached')).toBe(true);
    // Two live cards (Board Dinner, Awards Night); Brunch Service is not one.
    expect(html.split('View &amp; apply').length - 1).toBe(2);
    expect(html).toContain('18 h + 4 h is 22 h against your 20 h limit');
  });
});

describe('/radar/:id', () => {
  it('an allowed shift gets the map and the week meter with the shift added, in green', async () => {
    const html = await render(RadarDetailPage({ params: Promise.resolve({ id: 's-board' }) }));
    expect(html).toContain('class="map radar-map"');
    expect(html).toContain('1.2 km from home');
    expect(html).toContain('class="me"');
    expect(html).toContain('Week of Mon 14 with this shift');
    expect(html).toContain('13 h of 20 h');
    expect(html).toContain('class="fill green" style="width:65%"');
    expect(html).toContain('2 of 8 (+1) still to fill');
    expect(html).not.toContain('meter over');
    expect(html).toMatch(
      /<button[^>]*class="btn primary lg block"[^>]*>Apply for this shift<\/button>/,
    );
    expect(html).not.toContain('On-site contact</span>');
  });

  it('Limit Reached: the meter goes coral and over, with the arithmetic, and Apply is disabled', async () => {
    const html = await render(RadarDetailPage({ params: Promise.resolve({ id: 's-brunch' }) }));
    expect(html).toContain('class="meter over"');
    expect(html).toContain('Week of Mon 21 with this shift');
    expect(html).toContain('22 h of 20 h');
    expect(html).toContain('class="fill coral" style="width:100%"');
    expect(html).toContain('18 h + 4 h is 22 h against your 20 h limit');
    expect(disabledButton(html, 'Limit Reached')).toBe(true);
    expect(html).not.toContain('Apply for this shift');
  });

  it('without a home pin the map still draws the venue, and no "me" dot', async () => {
    openShifts.mockResolvedValue([shift({ shiftId: 's-board', homeLat: null, homeLng: null })]);
    const html = await render(RadarDetailPage({ params: Promise.resolve({ id: 's-board' }) }));
    expect(html).toContain('class="map radar-map"');
    expect(html).not.toContain('class="me"');
  });
});

/**
 * Audit D18 on ADR-0045's offer reads: a failed read shows `<LoadProblem>`,
 * never "Nothing open nearby", a missing Offered chip, or a 404.
 */
describe('offer reads that fail (audit D18)', () => {
  const TIMEOUT = 'canceling statement due to timeout';

  it('/radar: a failed offer read is the load-problem state, not "Nothing open nearby"', async () => {
    openShifts.mockResolvedValue([]);
    offerReads.open = { rows: [], problem: TIMEOUT };
    const html = await render(RadarPage());
    expect(html).toContain('data-load-problem');
    expect(html).toContain('We couldn’t load shifts up for grabs');
    expect(html).not.toContain('Nothing open nearby');
  });

  it('/radar: with every read answered and nothing open, the empty state stands', async () => {
    openShifts.mockResolvedValue([]);
    const html = await render(RadarPage());
    expect(html).toContain('Nothing open nearby');
    expect(html).not.toContain('data-load-problem');
  });

  it('/radar/offers/:id: a failed read is the load-problem state, never a 404', async () => {
    offerReads.one = { row: null, problem: TIMEOUT };
    const html = await render(RadarOfferPage({ params: Promise.resolve({ id: 'o1' }) }));
    expect(html).toContain('data-load-problem');
    expect(html).toContain('We couldn’t load this shift');
  });

  it('/radar/offers/:id: an offer this worker may not see is still a 404', async () => {
    await expect(RadarOfferPage({ params: Promise.resolve({ id: 'o1' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('/shifts: a failed offer read says so above the booked shifts', async () => {
    offerReads.booking = { rows: [], problem: TIMEOUT };
    const html = await render(ShiftsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('We couldn’t load your shift offers');
    // The shifts themselves are still there: only the offers are unknown.
    expect(html).toContain('Awards Night · Waiting Staff');
  });

  it('/shifts: no load-problem line when the offer read succeeded', async () => {
    const html = await render(ShiftsPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain('your shift offers');
  });
});
