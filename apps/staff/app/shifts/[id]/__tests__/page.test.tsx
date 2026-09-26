import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffProfile } from '../../../profile/types';
import type { ShiftDetail } from '../types';

// The fixtures place shifts hours from "now". After 22:00 UK that crossed
// into the next London day and the today-only states ("Not confirmed today",
// "Check-in opens at") failed every evening. Pin the clock to a UK
// afternoon so the suite means the same thing at any hour it runs.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-25T13:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

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
/** Set to make `staff_me()` fail (audit D16). */
let profileFails = false;
vi.mock('../../../profile/data', () => ({
  readProfile: async () => {
    if (profileFails) return { kind: 'problem', message: 'timeout' };
    const p = await profile();
    return p ? { kind: 'ok', profile: p } : { kind: 'unconfigured' };
  },
}));
vi.mock('../../../profile/photos', () => ({ signOwnPhoto: async () => null }));

const shift = vi.fn<() => Promise<ShiftDetail | null>>();
/** Set to make `staff_shift_detail()` fail (audit D18). */
let shiftFails = false;
vi.mock('../data', () => ({
  loadShift: async () =>
    shiftFails ? { shift: null, problem: 'timeout' } : { shift: await shift(), problem: null },
  supabaseConfigured: () => true,
}));
vi.mock('../../../data', () => ({
  loadBookings: async () => ({ rows: [], problem: null }),
  openInvites: () => [],
  shiftsBadge: () => 0,
}));

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
async function render(search: { checkin?: string } = {}): Promise<string> {
  const page = (await Page({
    params: Promise.resolve({ id: 'b1' }),
    searchParams: Promise.resolve(search),
  })) as ReactElement<{
    [key: string]: unknown;
  }>;
  const shell = page.type as (props: unknown) => Promise<ReactElement>;
  return renderToStaticMarkup(await shell(page.props));
}

beforeEach(() => {
  profile.mockReset();
  shift.mockReset();
  profileFails = false;
  shiftFails = false;
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

  it('uses the shell’s tabs, Profile — the home of Documents — included as a real link', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail());
    const html = await render();
    // ADR-0041: Shifts · Invites · Radar · Profile.
    // The tab icon sits between the link and its label.
    expect(html).toMatch(/<a href="\/profile">(?:(?!<\/a>).)*<span class="l">Profile<\/span><\/a>/);
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

describe('audit D16 · the lock fails closed when the profile cannot be read', () => {
  it('shows the retry, not the tabs and not the check-in', async () => {
    profileFails = true;
    shift.mockResolvedValue(detail());
    const html = await render();
    expect(html).toContain('We couldn’t load your account — pull to refresh or try again.');
    expect(html).toContain('Try again');
    expect(html).not.toContain('Check in');
    expect(html).not.toContain('Mandarin Oriental');
    expect(html).not.toContain('bottom-nav');
    expect(html).not.toContain('href="/documents"');
    expect(html).not.toContain('href="/profile"');
  });
});

describe('audit D18 · a failed read is not a 404', () => {
  it('says the shift could not be loaded, with a retry', async () => {
    profile.mockResolvedValue(worker());
    shiftFails = true;
    const html = await render();
    expect(html).toContain('We couldn’t load this shift — pull to refresh or try again.');
    expect(html).toContain('Try again');
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

  it('counts down to the check-in window before it opens (start − 30 min)', async () => {
    profile.mockResolvedValue(worker());
    // Starts in 2 h 45 min: the window opens in 2 h 15 min.
    shift.mockResolvedValue(detail({ startsAt: ahead(165), endsAt: ahead(600) }));
    const html = await render();
    expect(html).toMatch(/Check-in opens in 2 h 1[45] min/);
  });

  it('offers Directions, Add to calendar and a tap-to-call contact (§10.4)', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail({ startsAt: ahead(120), endsAt: ahead(600) }));
    const html = await render();
    expect(html).toContain(
      'href="https://www.google.com/maps/dir/?api=1&amp;destination=51.502%2C-0.16"',
    );
    expect(html).toContain('href="/shifts/b1/calendar.ics"');
    expect(html).toContain('Priya on <a href="tel:07700900999">07700 900999</a>');
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
    // A finished shift needs neither directions nor a diary entry.
    expect(html).not.toContain('Add to calendar');
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

describe('the shift screen against wireframes/staff/shift-detail.html', () => {
  it('draws the geofence map (ADR-0005), no GL library', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail());
    const html = await render();
    expect(html).toContain('shift-map');
    expect(html).toContain('Geofence 150 m');
  });

  it('labels the check-in window and lock times as UK (§1.8)', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail());
    const html = await render();
    expect(html).toMatch(
      /Check-in window \d{2}:\d{2} \(UK\)(<!-- -->)? – (<!-- -->)?\d{2}:\d{2} \(UK\)/,
    );
  });

  it('never quotes start+30 to a booking confirmed after the start (§3.4)', async () => {
    profile.mockResolvedValue(worker());
    const startsAt = new Date(Date.now() - 60 * 60_000).toISOString();
    shift.mockResolvedValue(
      detail({ startsAt, confirmedAt: new Date(Date.now() - 10 * 60_000).toISOString() }),
    );
    const html = await render();
    expect(html).toContain('Check in — verify GPS');
    expect(html).toContain('check-in stays open until');
    expect(html).not.toContain('check-in locks');
    expect(html).not.toContain('Check-in closed');
  });

  it('offers Cancel shift on the detail screen while more than 72 h remain (RULE-04)', async () => {
    profile.mockResolvedValue(worker());
    const startsAt = new Date(Date.now() + 5 * 24 * 3600_000).toISOString();
    const endsAt = new Date(Date.parse(startsAt) + 6 * 3600_000).toISOString();
    shift.mockResolvedValue(detail({ startsAt, endsAt }));
    const html = await render();
    expect(html).toContain('Cancel shift');
    expect(html).toMatch(/Cancel available until .* \(UK\), 72 h(<!-- -->)? before the start/);
  });

  it('does not offer it inside 72 h', async () => {
    profile.mockResolvedValue(worker());
    shift.mockResolvedValue(detail());
    const html = await render();
    expect(html).not.toContain('Cancel shift');
  });

  it('replaces the screen with "Not attended" once check-in has locked', async () => {
    profile.mockResolvedValue(worker());
    const startsAt = new Date(Date.now() - 45 * 60_000).toISOString();
    shift.mockResolvedValue(detail({ startsAt }));
    const html = await render();
    expect(html).toContain('data-full="not_attended"');
    expect(html).toContain('Not attended');
    expect(html).toContain('Check-in closed');
    expect(html).toContain('You’ve been marked as not attended — contact the office.');
    expect(html).toContain('30 minutes after your start time');
    expect(html).not.toContain('Check in — verify GPS');
  });

  it('replaces the screen with "Shift complete — thank you, Tom" and Done once checked out', async () => {
    profile.mockResolvedValue(worker());
    const startsAt = new Date(Date.now() - 7 * 3600_000).toISOString();
    const endsAt = new Date(Date.now() - 1 * 3600_000).toISOString();
    shift.mockResolvedValue(
      detail({ status: 'worked', startsAt, endsAt, checkInAt: startsAt, checkOutAt: endsAt }),
    );
    const html = await render();
    expect(html).toContain('Shift complete — thank you, Tom');
    expect(html).toContain('Total earnings for this shift');
    expect(html).toContain('>Done<');
    expect(html).not.toContain('Check out');
  });

  it('carries the check-out line while checked in', async () => {
    profile.mockResolvedValue(worker());
    const startsAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    shift.mockResolvedValue(detail({ status: 'worked', startsAt, checkInAt: startsAt }));
    const html = await render();
    expect(html).toContain('Check out');
    expect(html).toMatch(/Check-out works from anywhere until (<!-- -->)?\d{2}:\d{2} \(UK\)/);
    expect(html).not.toContain('Unlocks after check-in');
  });
});
