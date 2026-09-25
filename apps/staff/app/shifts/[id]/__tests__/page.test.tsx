import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffProfile } from '../../../profile/types';
import type { ShiftDetail } from '../types';

/**
 * `/shifts/:id` renders inside `StaffShell` (§10.1, docs/15): the app lock
 * stands in front of the shift screen, so a held, auto-blocked or leaver
 * worker opening a deep link or a stale push never reaches check-in. And
 * the §10.4 dead ends render as their static screens — no map, no check-in
 * or check-out, no breaks — with the approved copy and the one button.
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
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('../actions', () => ({
  checkIn: vi.fn(),
  checkOut: vi.fn(),
  startBreak: vi.fn(),
  finishBreak: vi.fn(),
  recordPing: vi.fn(),
}));

const profile = vi.fn<() => Promise<StaffProfile | null>>();
vi.mock('../../../profile/data', () => ({ loadProfile: () => profile() }));

const shift = vi.fn<() => Promise<ShiftDetail | null>>();
vi.mock('../data', () => ({ loadShift: () => shift(), supabaseConfigured: () => true }));
vi.mock('../../../data', () => ({ loadBookings: async () => [], openInvites: () => [] }));

const { default: Page } = await import('../page');

const worker = (over: Partial<StaffProfile> = {}): StaffProfile => ({
  staffId: 's1',
  firstName: 'Tom',
  lastName: 'Reid',
  employeeId: 1001,
  email: 'tom@example.test',
  phone: '+447700900123',
  homeAddress: null,
  photoPath: null,
  photoLocked: true,
  status: 'compliant',
  blockKind: null,
  leftAt: null,
  rtwBranch: 'uk_irish',
  niMasked: null,
  hasNiNumber: false,
  rating: null,
  reliability: null,
  quizAttempts: 0,
  roles: ['Waiting Staff'],
  blockers: [],
  checkedIn: false,
  bank: null,
  ...over,
});

// Today, inside the check-in window: the live screen would offer the button.
const soon = () => new Date(Date.now() + 10 * 60_000).toISOString();
const later = () => new Date(Date.now() + 6 * 3600_000).toISOString();

const detail = (over: Partial<ShiftDetail> = {}): ShiftDetail => ({
  bookingId: 'b1',
  status: 'confirmed',
  confirmedAt: '2026-06-12T09:00:00Z',
  eventTitle: 'Autumn Gala',
  eventDate: '2026-06-14',
  venueName: 'Mandarin Oriental',
  venueAddress: '66 Knightsbridge',
  onsiteContact: 'Priya on 07700 900999',
  notes: null,
  dressCode: 'Black tie',
  roleName: 'Waiting Staff',
  startsAt: soon(),
  endsAt: later(),
  payRate: 15,
  venueLat: 51.502,
  venueLng: -0.16,
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
  ...over,
});

/** Page → StaffShell element → awaited shell → markup. */
async function render(): Promise<string> {
  const page = (await Page({ params: Promise.resolve({ id: 'b1' }) })) as ReactElement<{
    [key: string]: unknown;
  }>;
  const shell = page.type as (props: unknown) => Promise<ReactElement>;
  return renderToStaticMarkup(await shell(page.props));
}

beforeEach(() => {
  profile.mockReset();
  shift.mockReset();
});

describe('§10.1 the app lock stands in front of the shift screen', () => {
  it('shows a compliant worker their shift and its check-in', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail());
    const html = await render();
    expect(html).toContain('Autumn Gala · Waiting Staff');
    expect(html).toContain('Check in — verify GPS');
  });

  it('shows a worker on hold the hold screen, and no check-in', async () => {
    profile.mockResolvedValue(worker({ status: 'blocked', blockKind: 'manual' }));
    shift.mockResolvedValue(detail());
    const html = await render();
    expect(html).toContain('Your account is on hold.');
    expect(html).not.toContain('Check in');
    expect(html).not.toContain('Mandarin Oriental');
  });

  it('shows an auto-blocked worker the Documents lock, and no check-in', async () => {
    profile.mockResolvedValue(worker({ blockers: ['document_expired:passport'] }));
    shift.mockResolvedValue(detail());
    const html = await render();
    expect(html).not.toContain('Check in');
    expect(html).not.toContain('Mandarin Oriental');
  });

  it('shows a leaver the leaver screen, and no check-in', async () => {
    profile.mockResolvedValue(worker({ status: 'inactive', leftAt: '2026-09-18T10:00:00Z' }));
    shift.mockResolvedValue(detail());
    const html = await render();
    expect(html).toContain('You’ve left The Hospitality Company.');
    expect(html).not.toContain('Check in');
  });

  it('uses the shell’s tabs, Documents included as a real link', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail());
    const html = await render();
    expect(html).toContain('href="/documents"');
  });

  it('is a 404 for a booking that is not the worker’s', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('§10.4 the static screens', () => {
  const noLiveControls = (html: string) => {
    expect(html).not.toContain('Check in');
    expect(html).not.toContain('Check out');
    expect(html).not.toContain('Start break');
    expect(html).not.toContain('from the venue');
    expect(html).toContain(
      'If you believe there has been an error, please contact us at: <b class="cyan">admin@thehospitalitycompany.co.uk</b>',
    );
    expect(html).toContain('OK, I understand');
  };

  it('a cancelled event (N12)', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(
      detail({
        status: 'cancelled',
        cancelCause: 'event_cancelled',
        eventCancelledAt: '2026-06-13T09:00:00Z',
      }),
    );
    const html = await render();
    expect(html).toContain('This event has been cancelled');
    noLiveControls(html);
  });

  it('a withdrawn booking (N10b)', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail({ status: 'cancelled', cancelCause: 'office_withdraw' }));
    const html = await render();
    expect(html).toContain('You’ve been removed from this shift');
    noLiveControls(html);
  });

  it('No check-out (RULE-02), with the whole §10.4 sentence', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(
      detail({ status: 'worked', checkInAt: soon(), checkOutAt: soon(), noCheckoutOpen: true }),
    );
    const html = await render();
    expect(html).toContain(
      'We didn’t receive your check-out for this shift — the office is following up with you directly.',
    );
    noLiveControls(html);
  });
});

describe('§5.1 / §5.2b the live screen, phase by phase', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const ahead = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
  const disabledButton = (html: string, label: string) =>
    new RegExp(`<button[^>]*\\bdisabled(?:=""|)[^>]*>${label}</button>`).test(html);

  it('draws the Breaks block locked before check-in, with the hint (wireframe (e))', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail()); // the check-in window is open, nobody has pressed
    const html = await render();
    expect(html).toContain('Check in — verify GPS');
    expect(html).toContain('Unlocks after check-in');
    expect(disabledButton(html, 'Start break')).toBe(true);
  });

  it('and before the window opens too', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail({ startsAt: ahead(120), endsAt: ahead(600) }));
    const html = await render();
    expect(html).toContain('Check-in opens at');
    expect(html).toContain('Unlocks after check-in');
    expect(disabledButton(html, 'Start break')).toBe(true);
  });

  it('draws no Breaks block at all where the client pays for breaks', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail({ breaksLogged: false }));
    const html = await render();
    expect(html).not.toContain('Start break');
    expect(html).not.toContain('Unlocks after check-in');
  });

  it('holds check-out until the section starts, and says when (§5.1)', async () => {
    profile.mockResolvedValue(worker());
    // Checked in during the 30 minutes before the start.
    shift.mockResolvedValue(detail({ checkInAt: ago(5), startsAt: ahead(10), endsAt: ahead(490) }));
    const html = await render();
    expect(disabledButton(html, 'Check out')).toBe(true);
    expect(html).toContain('Check-out opens at ');
    // Start break is live now: check-in has happened.
    expect(disabledButton(html, 'Start break')).toBe(false);
    expect(html).not.toContain('Unlocks after check-in');
  });

  it('offers check-out once the section has started', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail({ checkInAt: ago(70), startsAt: ago(60), endsAt: ahead(420) }));
    const html = await render();
    expect(disabledButton(html, 'Check out')).toBe(false);
    expect(html).not.toContain('Check-out opens at');
  });

  it('shows the >6 h break banner on shift where the client does not pay breaks (§5.2b)', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail({ checkInAt: ago(60), startsAt: ago(60), endsAt: ahead(360) }));
    const html = await render();
    expect(html).toContain(
      'A break will be applied to all shifts over 6 hours — please check with your Manager on site',
    );
  });

  it('and not on a shift of six hours or less', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail({ checkInAt: ago(60), startsAt: ago(60), endsAt: ahead(300) }));
    const html = await render();
    expect(html).not.toContain('A break will be applied');
  });

  it('on a break: the button reads Finish break and the chargeable timer is paused', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(
      detail({
        checkInAt: ago(60),
        startsAt: ago(60),
        endsAt: ahead(420),
        breaks: [{ id: 'br1', startedAt: ago(10), endedAt: null }],
      }),
    );
    const html = await render();
    expect(html).toContain('Finish break — back to work');
    expect(html).toContain('paused while you’re on a break');
    expect(html).not.toContain('>Start break<');
  });

  it('closed: duration, the base rate, the emphasised total and the payroll sentence (§5.1)', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(
      detail({
        status: 'worked',
        startsAt: ago(9 * 60),
        endsAt: ago(60),
        checkInAt: ago(9 * 60 + 5),
        checkOutAt: ago(60),
      }),
    );
    const html = await render();
    expect(html).toContain('Shift complete');
    expect(html).toContain('8 h');
    expect(html).toContain('£15.00 / h');
    expect(html).toContain('Total earnings for this shift');
    expect(html).toContain('£120.00');
    expect(html).toContain('before tax · base rate only');
    expect(html).toContain(
      'Your hours are sent to the office as a timesheet. You’re paid the Friday after the week you worked.',
    );
    expect(html).not.toContain('Check out');
    expect(html).not.toContain('12.07');
  });
});

describe('§3.2 the strict-buffer turn-away screen (RULE-15)', () => {
  const PAID = 'We’ve logged that you arrived on time and you’ll be paid for 4 hours.';
  const OPENING =
    'Thanks for coming — this shift is already fully staffed, so you’re not needed today.';
  const CLOSING = 'Please check your app for other shifts.';

  const noLiveControls = (html: string) => {
    expect(html).not.toContain('Check in');
    expect(html).not.toContain('Check out');
    expect(html).not.toContain('Start break');
    expect(html).not.toContain('from the venue');
    expect(html).not.toContain('marked as not attended');
  };

  it('on time: the wireframe’s screen, with the four-hour sentence', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(
      detail({ status: 'turned_away', turnedAwayAt: soon(), turnedAwayPayMin: 240 }),
    );
    const html = await render();
    expect(html).toContain('data-static="turned_away"');
    expect(html).toContain('Not needed today');
    expect(html).toContain('<h2>Thanks for coming</h2>');
    expect(html).toContain(`<p>${OPENING} ${PAID} ${CLOSING}</p>`);
    expect(html).toContain('href="/shifts"');
    expect(html).toContain('OK, I understand');
    expect(html).toContain('href="/radar"');
    expect(html).toContain('Open Radar');
    noLiveControls(html);
  });

  it('late: the same screen, without the sentence — a late turn-away is paid nothing', async () => {
    // Pressed 35 minutes after a start 40 minutes ago: past the grace, so
    // RULE-15 gave the attempt 0.
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(
      detail({
        status: 'turned_away',
        startsAt: ago(40),
        turnedAwayAt: ago(35),
        turnedAwayPayMin: 0,
      }),
    );
    const html = await render();
    expect(html).toContain(`<p>${OPENING} ${CLOSING}</p>`);
    expect(html).not.toContain(PAID);
    expect(html).not.toContain('4 hours');
    noLiveControls(html);
  });

  it('reads the database’s minutes, not the clock: late by the row even inside the window', async () => {
    // The attempt is stamped ten minutes BEFORE the start, so the phone's
    // clock would call it on time — but the row says RULE-15 paid 0, and
    // the screen follows the row.
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(
      detail({
        status: 'turned_away',
        turnedAwayAt: new Date().toISOString(),
        turnedAwayPayMin: 0,
      }),
    );
    const html = await render();
    expect(html).toContain('Thanks for coming');
    expect(html).toContain(`<p>${OPENING} ${CLOSING}</p>`);
    expect(html).not.toContain(PAID);
  });

  it('with no RULE-15 decision on the row at all, still turns away but promises nothing', async () => {
    // A turned_away booking whose attempt carries no minutes: the screen
    // never promises four hours the payroll view would not pay.
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(
      detail({ status: 'turned_away', turnedAwayAt: null, turnedAwayPayMin: null }),
    );
    const html = await render();
    expect(html).toContain('Thanks for coming');
    expect(html).toContain(`<p>${OPENING} ${CLOSING}</p>`);
    expect(html).not.toContain(PAID);
    noLiveControls(html);
  });
});
