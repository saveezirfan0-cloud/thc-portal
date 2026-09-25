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
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(
      detail({ status: 'turned_away', turnedAwayAt: soon(), turnedAwayPayMin: 0 }),
    );
    const html = await render();
    expect(html).toContain(`<p>${OPENING} ${CLOSING}</p>`);
    expect(html).not.toContain(PAID);
    expect(html).not.toContain('4 hours');
    noLiveControls(html);
  });

  it('reads the database’s minutes, not the clock: late by the row even inside the window', async () => {
    // The shift starts in ten minutes, so the phone's clock would call any
    // press "on time" — but the row says RULE-15 paid nothing, and the
    // screen follows the row.
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(
      detail({ status: 'turned_away', turnedAwayAt: null, turnedAwayPayMin: null }),
    );
    const html = await render();
    expect(html).toContain('Thanks for coming');
    expect(html).not.toContain(PAID);
  });
});
