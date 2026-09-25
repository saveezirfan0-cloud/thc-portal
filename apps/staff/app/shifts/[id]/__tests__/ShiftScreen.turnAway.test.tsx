// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShiftDetail } from '../types';

/**
 * §3.2 strict buffer, RULE-15 — the press itself, on the live screen.
 *
 * page.test.tsx pins the turn-away screen as the server renders it once the
 * booking reads `turned_away`. This pins the moment before that: the worker
 * presses Check in, `attempt_check_in()` answers `decision: 'turned_away'`
 * with RULE-15's minutes, and "Thanks for coming" must be on screen from
 * that reply alone — the props here never change and `router.refresh()` is
 * a spy that hands nothing down, so nothing but the reply can put it there.
 * Whether the "paid for 4 hours" sentence appears is the reply's minutes,
 * never this test's (or the phone's) clock.
 *
 * A DOM is needed for the tap, so this file runs under jsdom and drives
 * React directly, as profile/__tests__/p45-flow.test.tsx does.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const checkIn = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../actions', () => ({
  checkIn: (...args: unknown[]) => checkIn(...args),
  checkOut: vi.fn(),
  startBreak: vi.fn(),
  finishBreak: vi.fn(),
  recordPing: vi.fn(),
}));

const { ShiftScreen } = await import('../ShiftScreen');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPENING =
  'Thanks for coming — this shift is already fully staffed, so you’re not needed today.';
const PAID = 'We’ve logged that you arrived on time and you’ll be paid for 4 hours.';
const CLOSING = 'Please check your app for other shifts.';

const VENUE = { lat: 51.502, lng: -0.16 };

// Today, inside the check-in window: the live screen offers the button.
const shift = (): ShiftDetail => ({
  bookingId: 'b1',
  status: 'confirmed',
  confirmedAt: '2026-06-12T09:00:00Z',
  eventTitle: 'Autumn Gala',
  eventDate: '2026-06-14',
  venueName: 'Mandarin Oriental',
  venueAddress: '66 Knightsbridge',
  onsiteContact: null,
  notes: null,
  dressCode: null,
  roleName: 'Waiting Staff',
  startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  endsAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
  payRate: 15,
  venueLat: VENUE.lat,
  venueLng: VENUE.lng,
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
});

let container: HTMLDivElement;
let root: Root;

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button reads "${label}"`);
  return found;
}

/** Mount on site (the fix is the venue itself), then press Check in. */
async function pressCheckIn() {
  await act(async () => {
    root.render(<ShiftScreen shift={shift()} />);
  });
  const press = button('Check in — verify GPS');
  expect(press.disabled).toBe(false);
  await act(async () => {
    press.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({
          coords: { latitude: VENUE.lat, longitude: VENUE.lng, accuracy: 5 },
        } as GeolocationPosition),
    },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the check-in press turned away by the strict buffer (§3.2, RULE-15)', () => {
  it('on time: "Thanks for coming" with the four-hour sentence, from the reply alone', async () => {
    checkIn.mockResolvedValue({
      ok: true,
      result: { decision: 'turned_away', turnAwayPayMin: 240, messageKey: 'turned_away_paid' },
    });
    await pressCheckIn();

    expect(checkIn).toHaveBeenCalledWith('b1', VENUE.lat, VENUE.lng);
    const screen = container.querySelector('[data-static="turned_away"]');
    expect(screen).not.toBeNull();
    expect(screen!.querySelector('h2')!.textContent).toBe('Thanks for coming');
    expect(screen!.querySelector('p')!.textContent).toBe(`${OPENING} ${PAID} ${CLOSING}`);
    // The live controls are gone, and not as a message over them.
    expect(container.textContent).not.toContain('Check in — verify GPS');
    expect(container.querySelector('.alert')).toBeNull();
    // The refresh was asked for but delivered nothing: the props above
    // still read `confirmed`, so the screen came from the RPC's answer.
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('late: the same screen with 0 minutes, and no four-hour sentence', async () => {
    checkIn.mockResolvedValue({
      ok: true,
      result: { decision: 'turned_away', turnAwayPayMin: 0, messageKey: 'turned_away_unpaid' },
    });
    await pressCheckIn();

    const screen = container.querySelector('[data-static="turned_away"]');
    expect(screen).not.toBeNull();
    expect(screen!.querySelector('h2')!.textContent).toBe('Thanks for coming');
    expect(screen!.querySelector('p')!.textContent).toBe(`${OPENING} ${CLOSING}`);
    expect(container.textContent).not.toContain(PAID);
    expect(container.textContent).not.toContain('4 hours');
    expect(container.textContent).not.toContain('Check in — verify GPS');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('is not triggered by an ordinary check-in reply', async () => {
    checkIn.mockResolvedValue({
      ok: true,
      result: { decision: 'checked_in', turnAwayPayMin: null, messageKey: 'checked_in' },
    });
    await pressCheckIn();

    expect(container.querySelector('[data-static="turned_away"]')).toBeNull();
    expect(container.textContent).not.toContain('Thanks for coming');
    expect(container.textContent).toContain('You’re checked in. Have a good shift.');
  });
});
