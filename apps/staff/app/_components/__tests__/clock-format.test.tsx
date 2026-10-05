import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TimeFormat } from '@thc/domain';
import { TimeFormatProvider } from '@thc/ui';

/**
 * ADR-0085 on the shared time components: the clock a worker chose changes
 * how a time is WRITTEN. It never changes which instant, which zone, or the
 * §1.8 shape — UK first with "(UK)", then "your time" on a second line.
 */
const zone = vi.hoisted(() => ({ value: 'Europe/London' }));
vi.mock('../useViewerZone', () => ({ useViewerZone: () => zone.value }));
vi.mock('../../actions', () => ({ cancelShift: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const { ShiftTime, yourTimeLine } = await import('../ShiftTime');
const { UkTime } = await import('../UkTime');
const { CancelShift } = await import('../CancelShift');

// 17:00–23:30 UK on Saturday 19 September 2026 (BST).
const start = new Date('2026-09-19T16:00:00Z');
const end = new Date('2026-09-19T22:30:00Z');

const within = (format: TimeFormat, node: React.ReactNode) =>
  renderToStaticMarkup(<TimeFormatProvider format={format}>{node}</TimeFormatProvider>);

describe('<ShiftTime>', () => {
  it('is 24-hour with no provider at all', () => {
    expect(renderToStaticMarkup(<ShiftTime startsAt={start} endsAt={end} />)).toContain(
      '17:00 – 23:30',
    );
  });

  it('writes the window on the 12-hour clock for a worker who chose it', () => {
    const html = within('12h', <ShiftTime startsAt={start} endsAt={end} />);
    expect(html).toContain('5:00 pm – 11:30 pm');
    expect(html).not.toContain('17:00');
  });

  it('keeps the dual-zone shape: UK first with one "(UK)", then the viewer line on their clock', () => {
    zone.value = 'Asia/Tashkent';
    try {
      const html = within('12h', <ShiftTime startsAt={start} endsAt={end} />);
      expect(html).toContain('5:00 pm – 11:30 pm (UK)');
      expect(html).toContain('9:00 pm – 3:30 am your time');
      const day = within('24h', <ShiftTime startsAt={start} endsAt={end} />);
      expect(day).toContain('17:00 – 23:30 (UK)');
      expect(day).toContain('21:00 – 03:30 your time');
    } finally {
      zone.value = 'Europe/London';
    }
  });
});

describe('yourTimeLine', () => {
  it('takes the clock as its last argument, 24-hour by default', () => {
    const fri = new Date('2026-09-18T10:00:00Z');
    const friEnd = new Date('2026-09-18T15:00:00Z');
    expect(yourTimeLine(fri, friEnd, 'Asia/Tashkent')).toBe('15:00 – 20:00 your time');
    expect(yourTimeLine(fri, friEnd, 'Asia/Tashkent', '12h')).toBe('3:00 pm – 8:00 pm your time');
    expect(yourTimeLine(fri, friEnd, 'Europe/London', '12h')).toBeNull();
  });
});

describe('<UkTime>', () => {
  it('writes one scheduled instant on the worker’s clock, still saying (UK)', () => {
    expect(within('24h', <UkTime at={start} />)).toBe('17:00 (UK)');
    expect(within('12h', <UkTime at={start} />)).toBe('5:00 pm (UK)');
  });

  it('adds "your time" on their clock when the phone is elsewhere', () => {
    zone.value = 'America/New_York';
    try {
      expect(within('12h', <UkTime at={start} />)).toContain('5:00 pm (UK) · 12:00 pm your time');
    } finally {
      zone.value = 'Europe/London';
    }
  });
});

describe('<CancelShift>', () => {
  it('words the 72 h deadline on the worker’s clock, in UK time', () => {
    // Deadline: 72 h before 17:00 UK on 19 Sep = 17:00 UK on 16 Sep.
    expect(within('24h', <CancelShift bookingId="b1" startsAt={start} />)).toContain(
      '16 Sep, 17:00 (UK)',
    );
    expect(within('12h', <CancelShift bookingId="b1" startsAt={start} />)).toContain(
      '16 Sep, 5:00 pm (UK)',
    );
  });
});
