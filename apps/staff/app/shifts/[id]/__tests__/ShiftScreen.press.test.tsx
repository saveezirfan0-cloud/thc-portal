// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShiftDetail } from '../types';

/**
 * Go-live audit B3, B4 and B5 on the live shift screen.
 *
 * - B3: a press makes no `router.refresh()` of its own — the action's
 *   revalidated response is the refresh — and the screen shows the new
 *   state as soon as those props arrive.
 * - B4: during the check-in window the location follows the worker
 *   (`watchPosition`), and "Refresh location" takes a new reading, so a
 *   worker who opened the screen far away or timed out can check in
 *   without reloading.
 * - B5: a press that never gets an answer frees the button and says so; a
 *   press or ping refused by a newer deploy reloads onto it.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const checkIn = vi.hoisted(() => vi.fn());
const checkOut = vi.hoisted(() => vi.fn());
const recordPing = vi.hoisted(() => vi.fn());
const reloadForNewBuild = vi.hoisted(() => vi.fn(() => true));

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
  checkOut: (...args: unknown[]) => checkOut(...args),
  startBreak: vi.fn(),
  finishBreak: vi.fn(),
  recordPing: (...args: unknown[]) => recordPing(...args),
}));
vi.mock('../../../_lib/stale-deploy', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reloadForNewBuild,
}));

const { ShiftScreen } = await import('../ShiftScreen');
const { NOT_SENT } = await import('../messages');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VENUE = { lat: 51.502, lng: -0.16 };
/** About 1.8 km north of the venue: well outside a 150 m geofence. */
const AWAY = { lat: 51.518, lng: -0.16 };
const CHECK_IN = 'Check in — verify GPS';

const shift = (over: Partial<ShiftDetail> = {}): ShiftDetail => ({
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
  // Inside the check-in window: it opened 20 minutes ago.
  startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  endsAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
  payRate: 15,
  venueLat: VENUE.lat,
  venueLng: VENUE.lng,
  geofenceRadiusM: 150,
  breaksLogged: false,
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

const position = (at: { lat: number; lng: number }) =>
  ({ coords: { latitude: at.lat, longitude: at.lng, accuracy: 5 } }) as GeolocationPosition;

/** A fake `Geolocation`: one-off readings from a queue, and a watch the test drives. */
function fakeGeo() {
  const readings: Array<{ lat: number; lng: number } | 'timeout'> = [];
  let watcher: PositionCallback | null = null;
  const geo = {
    getCurrentPosition: vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null) => {
      const next = readings.length > 1 ? readings.shift()! : readings[0];
      if (!next) return;
      if (next === 'timeout') {
        fail?.({ code: 3, PERMISSION_DENIED: 1, TIMEOUT: 3 } as GeolocationPositionError);
      } else ok(position(next));
    }),
    watchPosition: vi.fn((ok: PositionCallback) => {
      watcher = ok;
      return 7;
    }),
    clearWatch: vi.fn(() => {
      watcher = null;
    }),
  };
  return {
    geo,
    readings,
    /** The watch reports a new position. */
    async move(at: { lat: number; lng: number }) {
      await act(async () => watcher?.(position(at)));
    },
    get watching() {
      return watcher !== null;
    },
  };
}

let container: HTMLDivElement;
let root: Root;
let gps: ReturnType<typeof fakeGeo>;

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button reads "${label}"`);
  return found;
}

async function mount(detail: ShiftDetail, props: { autoCheckIn?: boolean } = {}) {
  await act(async () => {
    root.render(<ShiftScreen shift={detail} {...props} />);
  });
}

async function click(label: string) {
  await act(async () => {
    button(label).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  gps = fakeGeo();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: gps.geo });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('B3 · the press is the refresh', () => {
  it('a check-in makes no router.refresh(), and the action’s new props show at once', async () => {
    gps.readings.push(VENUE);
    checkIn.mockResolvedValue({
      ok: true,
      result: { decision: 'checked_in', messageKey: 'checked_in' },
    });
    await mount(shift());
    await click(CHECK_IN);
    expect(checkIn).toHaveBeenCalledWith('b1', VENUE.lat, VENUE.lng, 5);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(container.textContent).toContain('You’re checked in. Have a good shift.');

    // What the revalidated action response hands down: the booking checked in.
    await mount(shift({ checkInAt: new Date().toISOString() }));
    expect(container.textContent).toContain('Checked in');
    expect(button('Check out')).toBeTruthy();
    expect(container.textContent).not.toContain(CHECK_IN);
    // The confirmation survives the new props: state is the screen's own.
    expect(container.textContent).toContain('You’re checked in. Have a good shift.');
  });
});

describe('B4 · the location stays fresh while check-in is open', () => {
  it('opened away from the venue: walking into the geofence turns the button on', async () => {
    gps.readings.push(AWAY);
    await mount(shift());
    expect(button(CHECK_IN).disabled).toBe(true);
    expect(gps.watching).toBe(true);
    await gps.move(VENUE);
    expect(button(CHECK_IN).disabled).toBe(false);
    expect(container.textContent).toContain('On site');
  });

  it('the today card’s auto check-in goes when the watch puts the worker inside', async () => {
    gps.readings.push(AWAY);
    checkIn.mockResolvedValue({ ok: true, result: { messageKey: 'checked_in' } });
    await mount(shift(), { autoCheckIn: true });
    expect(checkIn).not.toHaveBeenCalled();
    gps.readings.splice(0, gps.readings.length, VENUE);
    await gps.move(VENUE);
    expect(checkIn).toHaveBeenCalledTimes(1);
  });

  it('a timed-out first reading: "Refresh location" tries again without a reload', async () => {
    gps.readings.push('timeout', VENUE);
    await mount(shift());
    expect(container.textContent).toContain('We couldn’t get your location just now');
    expect(button(CHECK_IN).disabled).toBe(true);
    await click('Refresh location');
    expect(gps.geo.getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('We couldn’t get your location just now');
    expect(button(CHECK_IN).disabled).toBe(false);
  });

  it('before the window: one reading and the refresh control, no watch yet', async () => {
    gps.readings.push(VENUE);
    await mount(shift({ startsAt: new Date(Date.now() + 5 * 3600_000).toISOString() }));
    expect(gps.geo.watchPosition).not.toHaveBeenCalled();
    expect(button('Refresh location')).toBeTruthy();
    expect(button(CHECK_IN).disabled).toBe(true);
  });

  it('checked in: the watch stops (the pings take over) and the control goes', async () => {
    gps.readings.push(VENUE);
    await mount(shift());
    expect(gps.watching).toBe(true);
    await mount(shift({ checkInAt: new Date().toISOString() }));
    expect(gps.geo.clearWatch).toHaveBeenCalledWith(7);
    expect(container.textContent).not.toContain('Refresh location');
  });
});

describe('B5 · a press is never left hanging', () => {
  it('no answer from the server: the button comes back and the worker is told to press again', async () => {
    gps.readings.push(VENUE);
    checkIn.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await mount(shift());
    await click(CHECK_IN);
    expect(container.textContent).toContain(NOT_SENT);
    expect(button(CHECK_IN).disabled).toBe(false);
    expect(reloadForNewBuild).not.toHaveBeenCalled();

    // The second press goes through (the RPC would answer already_checked_in
    // if the first had in fact landed).
    checkIn.mockResolvedValueOnce({ ok: true, result: { messageKey: 'already_checked_in' } });
    await click(CHECK_IN);
    expect(container.textContent).not.toContain(NOT_SENT);
    expect(container.textContent).toContain('You’re already checked in.');
  });

  it('a press refused by a newer deploy reloads onto it', async () => {
    gps.readings.push(VENUE);
    const stale = Object.assign(new Error('Server Action "x" was not found'), {
      name: 'UnrecognizedActionError',
    });
    checkIn.mockRejectedValueOnce(stale);
    await mount(shift());
    await click(CHECK_IN);
    expect(reloadForNewBuild).toHaveBeenCalledTimes(1);
  });

  it('check-out with no answer frees the button too', async () => {
    gps.readings.push(VENUE);
    checkOut.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await mount(
      shift({
        startsAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        checkInAt: new Date(Date.now() - 55 * 60_000).toISOString(),
      }),
    );
    await click('Check out');
    expect(container.textContent).toContain(NOT_SENT);
    expect(button('Check out').disabled).toBe(false);
  });

  it('a ping refused by a newer deploy reloads; a lost ping is just dropped', async () => {
    gps.readings.push(VENUE);
    const checkedIn = {
      startsAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      checkInAt: new Date(Date.now() - 55 * 60_000).toISOString(),
    };
    recordPing.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await mount(shift(checkedIn));
    expect(recordPing).toHaveBeenCalledTimes(1);
    expect(reloadForNewBuild).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(NOT_SENT);

    act(() => root.unmount());
    root = createRoot(container);
    recordPing.mockRejectedValueOnce(
      Object.assign(new Error('not found'), { name: 'UnrecognizedActionError' }),
    );
    await mount(shift(checkedIn));
    expect(reloadForNewBuild).toHaveBeenCalledTimes(1);
  });
});

describe('a check-out that raises RULE-02 on the press shows its own answer (§5.1)', () => {
  // The action revalidates the page in the same response that carries the
  // answer, so the props arrive with `noCheckoutOpen` already set. The
  // §10.4 dead end ("We didn't receive your check-out") is for a check-out
  // never pressed; it must not replace (i) / (j) at the moment of the press.
  const onShift = {
    status: 'worked' as const,
    startsAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    checkInAt: new Date(Date.now() - 55 * 60_000).toISOString(),
  };

  it('no on-site fix after check-in: "We couldn’t confirm when you left the venue"', async () => {
    gps.readings.push(AWAY);
    checkOut.mockResolvedValue({
      ok: true,
      result: {
        decision: 'no_on_site_fix',
        recordedAt: onShift.checkInAt,
        violation: 'no_checkout',
        messageKey: 'no_check_out_office_confirms',
        distanceM: 1780,
      },
    });
    await mount(shift(onShift));
    await click('Check out');
    // What the revalidated response hands down with the answer.
    await mount(shift({ ...onShift, checkOutAt: onShift.checkInAt, noCheckoutOpen: true }));
    expect(container.querySelector('[data-full="no_on_site_fix"]')).not.toBeNull();
    expect(container.textContent).toContain(
      'We couldn’t confirm when you left the venue — the office will confirm your finish time with you.',
    );
    expect(container.textContent).not.toContain('We didn’t receive your check-out');
    // Wireframe (j): nothing is confirmed yet, so no green "Checked out" pill.
    expect(container.textContent).not.toContain('Checked out');

    // Dismissed, the booking is the §10.4 dead end until the office resolves it.
    await click('OK, I understand');
    expect(container.querySelector('[data-static="no_checkout"]')).not.toBeNull();
  });

  it('a stale on-site fix (ADR-0035): the normal off-site message, quoting the fix', async () => {
    const lastOnSite = new Date(Date.now() - 50 * 60_000).toISOString();
    gps.readings.push(AWAY);
    checkOut.mockResolvedValue({
      ok: true,
      result: {
        decision: 'recorded_last_on_site',
        recordedAt: lastOnSite,
        violation: 'no_checkout',
        messageKey: 'checked_out_off_site',
        distanceM: 1780,
      },
    });
    await mount(shift(onShift));
    await click('Check out');
    await mount(shift({ ...onShift, checkOutAt: lastOnSite, noCheckoutOpen: true }));
    expect(container.querySelector('[data-full="off_site"]')).not.toBeNull();
    expect(container.textContent).toContain(
      'You checked out away from the venue — we’ve recorded your last time on site',
    );
    expect(container.textContent).not.toContain('We didn’t receive your check-out');
  });
});
