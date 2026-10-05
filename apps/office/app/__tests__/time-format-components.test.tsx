import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TimeFormatProvider } from '@thc/ui';

/**
 * ADR-0085: the app-local wrappers around `ScheduledWindow`, the dashboard's
 * start, the payroll stamps and the board's attendance stamps all read the
 * operator's clock from the provider in the root layout. First paint is UK
 * (the reader's zone arrives on mount), so these show the UK line; the "your
 * time" line has its own tests in packages/ui.
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { ScheduledWindow: EventsWindow } = await import('../events/_components/ScheduledWindow');
const { ScheduledWindow: DashboardWindow } =
  await import('../dashboard/_components/ScheduledWindow');
const { ScheduledStart } = await import('../dashboard/_components/ScheduledStart');
const { ScheduledWindow: PayrollWindow, ActualTime } = await import('../reports/_components/zone');
const { AttendancePills, AttendanceStamp } = await import('../events/[id]/_components/Attendance');

const START = '2026-09-25T17:00:00Z'; // 18:00 UK
const END = '2026-09-25T22:30:00Z'; // 23:30 UK

const within = (format: '24h' | '12h', node: React.ReactNode) =>
  renderToStaticMarkup(<TimeFormatProvider format={format}>{node}</TimeFormatProvider>);

describe('scheduled windows, in the app-local wrappers (§1.8)', () => {
  it('/events', () => {
    expect(
      within('24h', <EventsWindow startsAt={START} endsAt={END} suffix="UK time" />),
    ).toContain('18:00 – 23:30 UK time');
    expect(
      within('12h', <EventsWindow startsAt={START} endsAt={END} suffix="UK time" />),
    ).toContain('6:00 pm – 11:30 pm UK time');
  });

  it('/dashboard', () => {
    expect(within('24h', <DashboardWindow startsAt={START} endsAt={END} />)).toContain(
      '18:00–23:30',
    );
    expect(within('12h', <DashboardWindow startsAt={START} endsAt={END} />)).toContain(
      '6:00 pm–11:30 pm',
    );
  });

  it('/reports payroll column', () => {
    // The "(UK)" label shows beside the "your time" line, which needs a
    // reader outside the UK and so comes in on mount.
    expect(within('12h', <PayrollWindow startsAt={START} endsAt={END} />)).toContain(
      '6:00 pm – 11:30 pm',
    );
    expect(within('24h', <PayrollWindow startsAt={START} endsAt={END} />)).toContain(
      '18:00 – 23:30',
    );
  });
});

describe('the short-staffed start (§9.1)', () => {
  it('writes the day and the clock, UK first and the viewer’s zone on a second line', () => {
    const twelve = within('12h', <ScheduledStart startsAt={START} zone="America/New_York" />);
    expect(twelve).toContain('Fri 25 Sep · 6:00 pm UK time');
    expect(twelve).toContain('Fri 25 Sep · 1:00 pm your time');
    const twentyFour = within('24h', <ScheduledStart startsAt={START} zone="America/New_York" />);
    expect(twentyFour).toContain('Fri 25 Sep · 18:00 UK time');
    expect(twentyFour).toContain('Fri 25 Sep · 13:00 your time');
  });
});

describe('actual stamps are the viewer’s own clock, on the chosen format (§1.8)', () => {
  it('the payroll check-in', () => {
    expect(within('12h', <ActualTime at={START} />)).toContain('6:00 pm');
    expect(within('24h', <ActualTime at={START} />)).toContain('18:00');
    expect(within('12h', <ActualTime at={null} />)).toContain('—');
  });

  it('the event board’s in / out stamp and pills', () => {
    const attendance = {
      checkInAt: '2026-09-25T17:52:00Z',
      checkOutAt: '2026-09-26T00:34:00Z',
      lateMinutes: null,
      leftEarly: false,
      noCheckout: false,
    };
    const twelve = within('12h', <AttendanceStamp attendance={attendance} />);
    expect(twelve).toContain('<b>6:52 pm</b>');
    expect(twelve).toContain('<b>1:34 am</b>');
    const twentyFour = within('24h', <AttendanceStamp attendance={attendance} />);
    expect(twentyFour).toContain('<b>18:52</b>');
    expect(twentyFour).toContain('<b>01:34</b>');
    expect(() => within('12h', <AttendancePills attendance={attendance} />)).not.toThrow();
  });
});
