// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShiftDetail } from '../types';

/**
 * ADR-0001 / docs/06 Option A: while the worker is checked in, the shift
 * screen holds a Screen Wake Lock, shows "Keep this screen open during your
 * shift", and sends a location ping the moment the page is visible again.
 * Before check-in and after check-out it does none of that.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const recordPing = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../actions', () => ({
  checkIn: vi.fn(),
  checkOut: vi.fn(),
  startBreak: vi.fn(),
  finishBreak: vi.fn(),
  recordPing: (...args: unknown[]) => recordPing(...args),
}));

const { ShiftScreen } = await import('../ShiftScreen');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BAR = 'Keep this screen open during your shift';
const VENUE = { lat: 51.502, lng: -0.16 };

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
  startsAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  endsAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
  payRate: 15,
  venueLat: VENUE.lat,
  venueLng: VENUE.lng,
  geofenceRadiusM: 150,
  breaksLogged: true,
  checkInAt: new Date(Date.now() - 55 * 60_000).toISOString(),
  checkOutAt: null,
  breaks: [],
  eventCancelledAt: null,
  cancelCause: null,
  noCheckoutOpen: false,
  turnedAwayAt: null,
  turnedAwayPayMin: null,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
let visibility: DocumentVisibilityState;
const release = vi.fn(() => Promise.resolve());
const request = vi.fn();

async function mount(detail: ShiftDetail) {
  await act(async () => {
    root.render(<ShiftScreen shift={detail} />);
  });
}

async function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({
          coords: { latitude: VENUE.lat, longitude: VENUE.lng, accuracy: 5 },
        } as GeolocationPosition),
    },
  });
  request.mockImplementation(() => Promise.resolve({ release, addEventListener: vi.fn() }));
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('keep this screen open (docs/06 Option A)', () => {
  it('checked in: the bar is up and the screen is held on', async () => {
    await mount(shift());
    expect(container.textContent).toContain(BAR);
    expect(request).toHaveBeenCalledWith('screen');
    expect(container.textContent).toContain('Your screen will stay on while this page is open.');
  });

  it('sends a ping at once when the worker comes back to the app', async () => {
    await mount(shift());
    const before = recordPing.mock.calls.length;
    await setVisibility('hidden');
    await setVisibility('visible');
    expect(recordPing.mock.calls.length).toBe(before + 1);
    expect(recordPing).toHaveBeenLastCalledWith('b1', VENUE.lat, VENUE.lng);
  });

  it('releases the lock when the screen goes away', async () => {
    await mount(shift());
    act(() => root.unmount());
    expect(release).toHaveBeenCalled();
    root = createRoot(container);
  });

  it('releases the lock on check-out, with the screen still open', async () => {
    await mount(shift());
    expect(release).not.toHaveBeenCalled();
    // router.refresh() hands the checked-out booking down to the same screen.
    await mount(shift({ checkOutAt: new Date().toISOString(), status: 'worked' }));
    expect(release).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(BAR);
  });

  it('asks for one lock only, however often the page flickers while it waits', async () => {
    let grant: (s: unknown) => void = () => {};
    request.mockImplementation(() => new Promise((ok) => (grant = ok)));
    await mount(shift());
    await setVisibility('hidden');
    await setVisibility('visible');
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => grant({ release, addEventListener: vi.fn() }));
    await mount(shift({ checkOutAt: new Date().toISOString(), status: 'worked' }));
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('a refused lock: the bar says the phone may lock', async () => {
    request.mockImplementation(() => Promise.reject(new Error('NotAllowedError')));
    await mount(shift());
    expect(container.textContent).toContain(BAR);
    expect(container.textContent).toContain('if it does, open the app again');
  });

  it('no wake lock in this browser: the bar still says to keep the app open', async () => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    await mount(shift());
    expect(container.textContent).toContain(BAR);
    expect(container.textContent).toContain('if it does, open the app again');
  });

  it('not checked in yet: no bar, no lock', async () => {
    await mount(
      shift({
        checkInAt: null,
        startsAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    );
    expect(container.textContent).not.toContain(BAR);
    expect(request).not.toHaveBeenCalled();
  });

  it('checked out: no bar, no lock', async () => {
    await mount(shift({ checkOutAt: new Date().toISOString(), status: 'worked' }));
    expect(container.textContent).not.toContain(BAR);
    expect(request).not.toHaveBeenCalled();
  });
});
