// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListedEvent } from '../data';
import { bucketByDay, toEventRows } from '../view-model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { MonthView, WeekView } = await import('../_components/EventViews');

const DATE = '2026-10-13';
const before = new Date('2026-10-06T09:00:00Z');
const DAY_HREF = (iso: string) => `/events?view=day&date=${iso}`;

function ev(i: number, over: Partial<ListedEvent> = {}): ListedEvent {
  return {
    id: `e${i}`,
    title: `Event ${i}`,
    date: DATE,
    clientId: 'c',
    clientName: 'Client',
    venueName: 'Venue',
    venueAddress: '',
    poNumber: '',
    cancelledAt: null,
    cancelReason: '',
    roles: [
      {
        roleName: 'Waiting Staff',
        start: `${String(6 + i).padStart(2, '0')}:00`,
        end: '23:00',
        headcount: 4,
        buffer: 0,
        confirmed: 1,
      },
    ],
    ...over,
  };
}
const busyDay = (count: number) => Array.from({ length: count }, (_, i) => ev(i));

function month(events: ListedEvent[], dayHref?: (iso: string) => string) {
  const rows = toEventRows(events, before);
  return (
    <MonthView
      cells={[{ iso: DATE, dayOfMonth: 13, inMonth: true }]}
      buckets={bucketByDay(rows, [DATE])}
      today="2026-10-06"
      dayHref={dayHref}
    />
  );
}
function week(events: ListedEvent[]) {
  const rows = toEventRows(events, before);
  return renderToStaticMarkup(
    <WeekView days={[DATE]} buckets={bucketByDay(rows, [DATE])} today="2026-10-06" />,
  );
}

describe('the month cell on a busy day (ADR-0096)', () => {
  const html = renderToStaticMarkup(month(busyDay(12), DAY_HREF));

  it('draws three chips and a "+9 more · 27 open" button, with the daily counter intact', () => {
    expect(html.match(/class="evchip/g)).toHaveLength(3);
    expect(html).toContain('+9 more · 27 open');
    expect(html).toContain('12 ev · 36 open');
  });

  it('does not render the popup until it is opened', () => {
    expect(html).not.toContain('role="dialog"');
  });

  it('draws a cancelled-only day as cancelled chips with no fill', () => {
    const cancelled = renderToStaticMarkup(
      month([ev(0, { cancelledAt: '2026-10-01T10:00:00Z' })], DAY_HREF),
    );
    expect(cancelled).toContain('evchip cancelled');
    expect(cancelled).toContain('1 ev · cancelled');
    expect(cancelled).not.toContain('class="f"');
  });
});

describe('the day popup (ADR-0096)', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const press = (el: Element) =>
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

  it('opens from "+N more" with every event of the day, a day-view link and Close', () => {
    act(() => root.render(month(busyDay(12), DAY_HREF)));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    press(container.querySelector('button.evmore')!);

    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.querySelectorAll('a.wchip')).toHaveLength(12);
    expect(dialog.textContent).toContain('12 ev · 36 open');
    expect(dialog.querySelector(`a[href="${DAY_HREF(DATE)}"]`)?.textContent).toBe('Open day view');

    const close = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Close')!;
    press(close);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens from a collapsed group, and a single event stays a link to its board', () => {
    const same = [
      ev(0, { title: 'Morning Waiting Staff' }),
      ev(1, { title: 'Morning Waiting Staff' }),
    ];
    // Same start so they collapse.
    for (const e of same) e.roles[0]!.start = '07:00';
    act(() => root.render(month([...same, ev(5)], DAY_HREF)));
    const group = container.querySelector('button.evchip')!;
    expect(group.textContent).toContain('Morning Waiting Staff ×2 · Client');
    expect(container.querySelector('a.evchip')?.getAttribute('href')).toBe('/events/e5');
    press(group);
    expect(container.querySelectorAll('[role="dialog"] a.wchip')).toHaveLength(3);
  });

  it('with no day link offered, still lists the day and offers only Close', () => {
    act(() => root.render(month(busyDay(6))));
    press(container.querySelector('button.evmore')!);
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.querySelectorAll('a.wchip')).toHaveLength(6);
    expect(dialog.textContent).not.toContain('Open day view');
  });
});

describe('the week column (ADR-0096)', () => {
  it('folds a long column into bands, opening only those that still need staff', () => {
    // Nine events 06:00–14:00 (mornings → afternoon); the first morning one is fully staffed.
    const events = busyDay(9);
    const full = events.map((e, i) =>
      i < 6 ? { ...e, roles: [{ ...e.roles[0]!, confirmed: 4 }] } : e,
    );
    const html = week(full);
    // Events 0–5 start 06:00–11:00: a fully staffed Morning band stays closed...
    expect(html).toMatch(/<details class="band"><summary>[^]*?Morning/);
    // ...and the Afternoon band, which still has open positions, is open.
    expect(html).toMatch(/<details class="band" open="">[^]*?Afternoon/);
    expect(html.match(/class="wchip/g)).toHaveLength(9);
  });

  it('opens every band of a column of eight or fewer', () => {
    const html = week(busyDay(8).map((e) => ({ ...e, roles: [{ ...e.roles[0]!, confirmed: 4 }] })));
    expect(html.match(/<details class="band" open="">/g)).toHaveLength(2);
    expect(html).not.toMatch(/<details class="band">/);
  });

  it('reads a band of only cancelled events as cancelled, not green "0 open"', () => {
    const html = week([ev(0, { cancelledAt: '2026-10-01T10:00:00Z' })]);
    expect(html).toContain('1 ev · cancelled');
    expect(html).not.toContain('1 ev · 0 open');
  });
});
