// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ukInstant } from '@thc/domain';
import type { TimeFormat } from '@thc/domain';
import { TimeFormatProvider } from '@thc/ui';

/**
 * ADR-0085 on /profile/availability. The Add sheet's two "(UK time)" inputs
 * were the browser's `<input type="time">`, which a browser draws on the
 * DEVICE clock — "5:00 PM" on a 12-hour phone whatever the platform wanted.
 * They are `TimeField`s now: a text field on the worker's own clock whose
 * value is always "HH:MM", so the UK-time rule (§1.8) never sees the clock.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const add = vi.hoisted(() => vi.fn());
vi.mock('../actions', () => ({ addUnavailability: add, removeUnavailability: vi.fn() }));
vi.mock('../../../_components/useViewerZone', () => ({ useViewerZone: () => 'Europe/London' }));

const { AvailabilityScreen } = await import('../AvailabilityScreen');

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.clearAllMocks();
});

const entries = [
  {
    id: 'b',
    startsAt: ukInstant('2026-10-01', '18:00').toISOString(),
    endsAt: ukInstant('2026-10-01', '23:00').toISOString(),
    allDay: false,
    seriesId: null,
    seriesIndex: null,
    seriesCount: null,
  },
];

function mount(format: TimeFormat) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <TimeFormatProvider format={format}>
        <AvailabilityScreen entries={entries} />
      </TimeFormatProvider>,
    ),
  );
  return host;
}

function openAddSheet() {
  const addButton = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.startsWith('+ Add days'),
  )!;
  act(() => addButton.click());
  // "All day" is on by default; the time fields appear when it is off.
  const allDay = document.querySelector<HTMLButtonElement>('button[role="switch"]')!;
  act(() => allDay.click());
}

const field = (label: string) => {
  const found = [...document.querySelectorAll('label')].find((l) =>
    l.textContent?.startsWith(label),
  );
  return found ? (document.getElementById(found.htmlFor) as HTMLInputElement | null) : null;
};

describe('the list', () => {
  it('writes an entry’s UK window on the worker’s clock', () => {
    expect(mount('24h').textContent).toContain('Thu 1 Oct · 18:00 – 23:00');
  });

  it('flips to 12-hour for a worker who chose it, still marked UK time', () => {
    const text = mount('12h').textContent!;
    expect(text).toContain('Thu 1 Oct · 6:00 pm – 11:00 pm');
    expect(text).toContain('UK time');
    expect(text).not.toContain('18:00');
  });
});

describe('the Add sheet’s time fields', () => {
  it('are text fields keeping their "(UK time)" labels, never the device clock’s time input', () => {
    mount('24h');
    openAddSheet();
    expect(document.querySelector('input[type="time"]')).toBeNull();
    const from = field('From (UK time)');
    const to = field('To (UK time)');
    expect(from?.type).toBe('text');
    expect(from?.value).toBe('18:00');
    expect(to?.value).toBe('23:00');
  });

  it('show their value on the 12-hour clock for a worker who chose it', () => {
    mount('12h');
    openAddSheet();
    expect(field('From (UK time)')?.value).toBe('6:00 pm');
    expect(field('To (UK time)')?.value).toBe('11:00 pm');
  });
});
