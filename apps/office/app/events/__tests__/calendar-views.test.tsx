import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ListedEvent } from '../data';
import { bucketByDay, toEventRows } from '../view-model';

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

function busyDay(count: number): ListedEvent[] {
  return Array.from({ length: count }, (_, i) => ({
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
  }));
}

describe('the month cell on a 30-event day (ADR-0094)', () => {
  const rows = toEventRows(busyDay(12), before);
  const buckets = bucketByDay(rows, [DATE]);
  const html = renderToStaticMarkup(
    <MonthView
      cells={[{ iso: DATE, dayOfMonth: 13, inMonth: true }]}
      buckets={buckets}
      today="2026-10-06"
      dayHref={(iso) => `/events?view=day&date=${iso}`}
    />,
  );

  it('draws three chips and a "+9 more" link to the day, with the daily counter intact', () => {
    expect(html.match(/class="evchip/g)).toHaveLength(3);
    expect(html).toContain('+9 more');
    expect(html).toContain('href="/events?view=day&amp;date=2026-10-13"');
    expect(html).toContain('12 ev · 36 open');
  });
});

describe('the week column on a busy day (ADR-0094)', () => {
  const rows = toEventRows(busyDay(12), before);
  const buckets = bucketByDay(rows, [DATE]);
  const html = renderToStaticMarkup(
    <WeekView days={[DATE]} buckets={buckets} today="2026-10-06" />,
  );

  it('is folded into bands, not a scroll box, and keeps every event reachable', () => {
    expect(html).toContain('<details class="band"');
    expect(html.match(/class="wchip/g)).toHaveLength(12);
  });

  it('opens a band that still needs staff', () => {
    expect(html).toContain('<details class="band" open=""');
  });
});
