import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ukInstant } from '@thc/domain';
import type { ListedEvent } from '../data';
import { bucketByDay, toEventRow, toEventRows } from '../view-model';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const { DayPills, DayView, ListView, MonthView, WeekView, chipClasses, roleFill, windowSubline } =
  await import('../_components/EventViews');

const DATE = '2026-09-18';

function event(over: Partial<ListedEvent> = {}): ListedEvent {
  return {
    id: 'e1',
    title: 'Conference Day 2',
    date: DATE,
    clientName: 'ExCeL London',
    venueName: 'ExCeL London',
    venueAddress: 'Royal Victoria Dock, E16 1XL',
    geofenceRadiusM: 400,
    poNumber: 'EX-2026-311',
    onsiteContact: 'Dana R. (ExCeL events desk)',
    cancelledAt: null,
    cancelReason: '',
    roles: [
      { roleName: 'Host', start: '08:00', end: '16:00', headcount: 4, buffer: 0, confirmed: 4 },
      {
        roleName: 'Bar Staff',
        start: '12:00',
        end: '20:00',
        headcount: 6,
        buffer: 1,
        confirmed: 6,
      },
    ],
    ...over,
  };
}

const during = ukInstant(DATE, '14:32');

describe('the week chip (§3.1, §3.2; events.html:165)', () => {
  it('is green only when nothing is open, and carries the Ongoing pill', () => {
    const full = toEventRow(event(), during);
    expect(chipClasses('wchip', full)).toBe('wchip ongoing full');

    // §3.3: a no-show re-opened a slot on an ongoing event — amber, not green.
    const short = toEventRow(
      event({ roles: [{ ...event().roles[0]!, confirmed: 3 }, event().roles[1]!] }),
      during,
    );
    expect(chipClasses('wchip', short)).toBe('wchip ongoing');
    expect(chipClasses('evchip', short)).toBe('evchip ongoing');

    const cancelled = toEventRow(event({ cancelledAt: '2026-09-16T10:00:00Z' }), during);
    expect(chipClasses('wchip', cancelled)).toBe('wchip cancelled');
  });

  it('renders the Ongoing pill inside the name line, and the cancelled note', () => {
    const rows = toEventRows(
      [
        event(),
        event({ id: 'e2', cancelledAt: '2026-09-16T10:00:00Z', cancelReason: 'postponed' }),
      ],
      during,
    );
    const html = renderToStaticMarkup(
      <WeekView days={[DATE]} buckets={bucketByDay(rows, [DATE])} today={DATE} />,
    );
    expect(html).toMatch(/class="n">Conference Day 2<span class="pill green"/);
    // React escapes the quotes in static markup.
    expect(html).toContain(
      'cancelled Wed 16 Sep — &quot;postponed&quot; — stays visible, greyed (§3.3)',
    );
  });

  it('heads a day whose only event is cancelled with "1 ev · cancelled", not "0 open"', () => {
    const rows = toEventRows([event({ cancelledAt: '2026-09-16T10:00:00Z' })], during);
    const html = renderToStaticMarkup(
      <WeekView days={[DATE]} buckets={bucketByDay(rows, [DATE])} today={DATE} />,
    );
    expect(html).toContain('<span class="c">1 ev · cancelled</span>');
    expect(html).not.toContain('0 open');
  });
});

describe('the month grid (§3.1; events.html:204)', () => {
  it('prints "0 ev" on an in-month empty day and nothing on a spill day', () => {
    const html = renderToStaticMarkup(
      <MonthView
        cells={[
          { iso: '2026-08-31', dayOfMonth: 31, inMonth: false },
          { iso: '2026-09-01', dayOfMonth: 1, inMonth: true },
        ]}
        buckets={bucketByDay([], ['2026-08-31', '2026-09-01'])}
        today={DATE}
      />,
    );
    expect(html.split('0 ev').length - 1).toBe(1);
  });
});

describe('the day rows (§3.1, §3.2; events.html:210-231)', () => {
  const rows = toEventRows([event()], during);

  it('carries the label row, each role with its own times and fill, the PO, the contact and the geofence', () => {
    const html = renderToStaticMarkup(<DayView rows={rows} now={during} />);
    expect(html).toContain('Window (UK time)');
    expect(html).toContain('Roles · headcount (+buffer)');
    expect(html).toContain('08:00–16:00');
    expect(html).toContain('4 (+0)');
    expect(html).toMatch(/pill green">4 of 4/);
    expect(html).toMatch(/pill green">6 of 6/);
    expect(html).toContain('PO EX-2026-311');
    expect(html).toContain('on-site: Dana R. (ExCeL events desk)');
    expect(html).toContain('Royal Victoria Dock, E16 1XL · geofence 400 m');
    expect(html).toContain('12 h window');
  });

  it('says "starts in N min" inside the hour before the start', () => {
    const soon = toEventRow(event(), ukInstant(DATE, '07:32'));
    expect(windowSubline(soon, ukInstant(DATE, '07:32'))).toBe('starts in 28 min');
    expect(roleFill({ confirmed: 3, headcount: 4 })).toEqual({ text: '3 of 4', tone: 'amber' });
    expect(roleFill({ confirmed: 5, headcount: 4 })).toEqual({ text: '4 of 4', tone: 'green' });
  });

  it('puts the counters in the toolbar: "1 ev · 0 open" and "1 ongoing"', () => {
    const html = renderToStaticMarkup(<DayPills rows={rows} />);
    expect(html).toContain('1 ev · 0 open');
    expect(html).toContain('1 ongoing');
  });
});

describe('the list rows (§3.1; events.html:109-178)', () => {
  it('makes the whole live row clickable and dates the cancellation', () => {
    const rows = toEventRows(
      [
        event(),
        event({
          id: 'e2',
          title: 'Conference Lunch',
          cancelledAt: '2026-09-16T10:00:00Z',
          cancelReason: 'event postponed to Q1',
        }),
      ],
      during,
    );
    const html = renderToStaticMarkup(<ListView rows={rows} today={DATE} />);
    expect(html).toMatch(/<tr class="clickable" tabindex="0"/);
    expect(html).toContain('cancelled Wed 16 Sep — &quot;event postponed to Q1&quot;');
    // A zero buffer is spelled out (§3.2).
    expect(html).toContain('4 (+0)');
  });
});
