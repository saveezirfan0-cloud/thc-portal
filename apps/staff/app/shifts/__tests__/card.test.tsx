import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingRow } from '../../data';

/**
 * The My shifts cards and the segmented header (§10.4, §3.5,
 * wireframes/staff/shifts.html), rendered server-side with the clock
 * pinned to the wireframe's Sunday 14:32 UK.
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

const { ShiftCardView } = await import('../ShiftCard');
const { default: Page } = await import('../page');

/**
 * The page returns the async `StaffShell` element; `renderToStaticMarkup`
 * cannot await a server component, so the shell is called as the function
 * it is and what it returns is rendered (as chrome.test.tsx does).
 */
async function shell(searchParams: { tab?: string }): Promise<string> {
  const page = await Page({ searchParams: Promise.resolve(searchParams) });
  const element = page as unknown as {
    type: (props: unknown) => Promise<React.ReactElement>;
    props: unknown;
  };
  return renderToStaticMarkup(await element.type(element.props));
}

const START = new Date('2026-06-14T16:00:00Z');
const END = new Date('2026-06-14T22:30:00Z');
const NOW = '2026-06-14T13:32:00Z';
const daysFrom = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

const booking = (over: Partial<BookingRow> = {}): BookingRow => ({
  bookingId: 'b1',
  status: 'confirmed',
  source: 'auto',
  createdAt: new Date('2026-06-10T09:00:00Z'),
  confirmedAt: new Date('2026-06-12T09:00:00Z'),
  dayBeforeConfirmedAt: new Date('2026-06-13T09:00:00Z'),
  onDayConfirmedAt: null,
  reconfirmRequired: false,
  reconfirmReason: null,
  appliedAt: null,
  cancelCause: null,
  shiftId: 's1',
  startsAt: START,
  endsAt: END,
  payRate: 14,
  dressCode: 'Black & whites',
  headcount: 6,
  buffer: 1,
  confirmedCount: 6,
  role: 'Waiting Staff',
  eventId: 'e1',
  eventTitle: 'Gala Dinner',
  eventDate: '2026-06-14',
  venueName: 'Leonardo Royal Hotel',
  venueAddress: '10 Godliman St, EC4V 5AJ',
  eventCancelledAt: null,
  distanceKm: 4.1,
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

const venue = { lat: 51.5, lng: -0.1, radiusM: 150 };

function card(over: Partial<BookingRow> = {}, at = NOW): string {
  vi.setSystemTime(new Date(at));
  return renderToStaticMarkup(<ShiftCardView booking={booking(over)} venue={venue} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the today card', () => {
  it('carries check-in inside the card once stage 3 is done (§10.4)', () => {
    const h = card({ onDayConfirmedAt: new Date('2026-06-14T08:00:00Z') });
    expect(h).toContain('>Today<');
    expect(h).toContain('>Confirmed<');
    expect(h).toContain('Check in — verify GPS');
    expect(h).toContain('Check-in opens at 16:30 UK time · shift starts in 2 h 28 m');
    expect(h).not.toContain('Confirm today');
  });

  it('shows "Not confirmed today" and the on-the-day button before stage 3 (§3.5)', () => {
    const h = card();
    expect(h).toContain('>Today<');
    expect(h).toContain('>Not confirmed today<');
    expect(h).not.toContain('>Confirmed<');
    expect(h).toContain('Reminder only — no deadline.');
    expect(h).toContain('Confirm today’s shift');
    expect(h).not.toContain('Check in — verify GPS');
  });

  it('carries check-in for a booking already worked (checked in) too', () => {
    const h = card({ status: 'worked' });
    expect(h).toContain('>Confirmed<');
    expect(h).toContain('Check in — verify GPS');
  });
});

describe('the day-before card', () => {
  it('says "Confirm by 12:00 today" — the card only ever shows on the day before', () => {
    const h = card(
      { startsAt: daysFrom(START, 1), endsAt: daysFrom(END, 1), dayBeforeConfirmedAt: null },
      '2026-06-14T08:00:00Z',
    );
    expect(h).toContain('>Needs confirmation<');
    expect(h).toContain('Confirm by <b>12:00 today (UK time)</b> — or you’ll be removed');
    expect(h).not.toContain('the day before');
    expect(h).toContain('I’m ready for tomorrow');
  });
});

describe('the Time changed card', () => {
  it('reads the office’s field codes as a sentence, never a column name', () => {
    const h = card({
      startsAt: daysFrom(START, 6),
      endsAt: daysFrom(END, 6),
      reconfirmRequired: true,
      reconfirmReason: 'starts_at,ends_at',
    });
    expect(h).toContain('>Time changed<');
    expect(h).toContain('>Awaiting<');
    expect(h).toContain('Start and end time moved by the office');
    expect(h).not.toContain('starts_at');
    expect(h).toContain('Confirm new time');
  });
});

describe('the confirmed card', () => {
  it('words RULE-04 as the wireframe does, without a bare "(UK)"', () => {
    const h = card({ startsAt: daysFrom(START, 6), endsAt: daysFrom(END, 6) });
    expect(h).toContain('>Confirmed<');
    expect(h).toContain('Cancel available until Wed 17, 17:00 (72 h before start)');
    expect(h).not.toContain('(UK)');
    expect(h).toContain('Cancel shift');
    // Layout from classes, not inline literals (ADR-0007).
    expect(h).toContain('<div class="row">');
    expect(h).not.toContain('style="gap');
    expect(h).not.toContain('style="margin-left');
  });
});

describe('the No check-out card (RULE-02)', () => {
  it('stays listed with a coral pill and the approved sentence', () => {
    const h = card({
      status: 'worked',
      startsAt: daysFrom(START, -1),
      endsAt: daysFrom(END, -1),
      noCheckoutOpen: true,
    });
    expect(h).toContain('<span class="pill coral">No check-out</span>');
    expect(h).toContain('We didn’t receive your check-out for this shift');
    expect(h).not.toContain('>Confirmed<');
    expect(h).not.toContain('Check in — verify GPS');
  });
});

describe('the segmented header', () => {
  it('stretches the control and marks the active segment for assistive tech', async () => {
    // No Supabase in the test environment: the lists are empty and the
    // chrome renders unlocked, which is what these two assertions are about.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const mine = await shell({});
    expect(mine).toContain('class="seg block"');
    expect(mine).toMatch(/<a[^>]*href="\/shifts"[^>]*role="tab"[^>]*aria-selected="true"/);
    expect(mine).toMatch(
      /<a[^>]*href="\/shifts\?tab=open"[^>]*role="tab"[^>]*aria-selected="false"/,
    );

    const open = await shell({ tab: 'open' });
    expect(open).toMatch(/<a[^>]*href="\/shifts\?tab=open"[^>]*aria-selected="true"/);
    expect(open).toContain('Auto-assign still runs; self-apply is an extra channel (RULE-08).');
  });
});
