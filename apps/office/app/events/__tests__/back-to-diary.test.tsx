import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { backLabel, boardHref, safeBackHref } from '../_lib/back';
import type { ListedEvent } from '../data';
import { bucketByDay, toEventRows } from '../view-model';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { DayView, MonthView, WeekView } = await import('../_components/EventViews');

const DATE = '2026-10-13';

const EVENT: ListedEvent = {
  id: 'e1',
  title: 'Waiting Staff',
  date: DATE,
  clientId: 'c',
  clientName: 'Como',
  venueName: 'The Halkin',
  venueAddress: '',
  poNumber: '',
  cancelledAt: null,
  cancelReason: '',
  roles: [
    {
      roleName: 'Waiting Staff',
      start: '15:00',
      end: '23:00',
      headcount: 4,
      buffer: 0,
      confirmed: 1,
    },
  ],
};

const WEEK_URL = '/events?view=week&date=2026-10-13&client=c1';

describe('the way back from an event (office feedback 22.10.2026)', () => {
  it('carries the diary URL on the link, encoded', () => {
    expect(boardHref('/events/e1', WEEK_URL)).toBe(
      `/events/e1?back=${encodeURIComponent(WEEK_URL)}`,
    );
    expect(boardHref('/events/e1')).toBe('/events/e1');
  });

  it('accepts only the diary itself', () => {
    expect(safeBackHref(WEEK_URL)).toBe(WEEK_URL);
    expect(safeBackHref('/events')).toBe('/events');
    for (const bad of [
      'https://evil.example/events?x=1',
      '//evil.example',
      '/events/other',
      '/eventsfoo',
      '/staff',
      '/events?x=\\evil',
      '',
      undefined,
    ]) {
      expect(safeBackHref(bad)).toBeNull();
    }
  });

  it('says which view it returns to', () => {
    expect(backLabel(WEEK_URL)).toBe('Back to week view');
    expect(backLabel('/events?view=month&date=2026-10-01')).toBe('Back to month view');
    expect(backLabel('/events')).toBe('Back to scheduling');
    expect(backLabel(null)).toBe('Back to scheduling');
  });

  it('is on every event link of the Month, Week and Day views', () => {
    const rows = toEventRows([EVENT], new Date('2026-10-13T08:00:00Z'));
    const buckets = bucketByDay(rows, [DATE]);
    const href = `/events/e1?back=${encodeURIComponent(WEEK_URL)}`.replace(/&/g, '&amp;');
    const month = renderToStaticMarkup(
      <MonthView
        cells={[{ iso: DATE, dayOfMonth: 13, inMonth: true }]}
        buckets={buckets}
        today={DATE}
        backHref={WEEK_URL}
      />,
    );
    const week = renderToStaticMarkup(
      <WeekView days={[DATE]} buckets={buckets} today={DATE} backHref={WEEK_URL} />,
    );
    const day = renderToStaticMarkup(<DayView rows={rows} backHref={WEEK_URL} />);
    for (const html of [month, week, day]) expect(html).toContain(`href="${href}"`);
  });

  it('leaves the link plain when the diary state is not passed', () => {
    const rows = toEventRows([EVENT], new Date('2026-10-13T08:00:00Z'));
    expect(renderToStaticMarkup(<DayView rows={rows} />)).toContain('href="/events/e1"');
  });
});
