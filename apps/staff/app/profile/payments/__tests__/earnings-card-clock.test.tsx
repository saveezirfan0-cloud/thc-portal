import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TimeFormat } from '@thc/domain';
import { TimeFormatProvider } from '@thc/ui';
import type { EarningsRow } from '../../types';

/**
 * ADR-0085 on Earnings history: the shift window is a scheduled time, so it
 * stays UK-first with a "your time" line abroad (§1.8) — and is written on the
 * clock the worker chose.
 */
const zone = vi.hoisted(() => ({ value: 'Europe/London' }));
vi.mock('../../../_components/useViewerZone', () => ({ useViewerZone: () => zone.value }));

const { EarningsCard } = await import('../EarningsCard');

const row: EarningsRow = {
  bookingId: 'b1',
  eventTitle: 'Autumn Partners Dinner',
  venueName: 'The Dorchester',
  venueAddress: '53 Park Lane',
  roleName: 'Waiting Staff',
  startsAt: new Date('2026-09-05T16:00:00Z'), // 17:00 UK
  endsAt: new Date('2026-09-05T22:30:00Z'), // 23:30 UK
  payRate: 14.5,
  checkInAt: null,
  checkOutAt: null,
  unpaidBreakMin: 0,
  payableMin: 390,
  floorApplied: false,
  payDate: '2026-09-11',
  basePence: 9425,
};

const render = (format: TimeFormat) =>
  renderToStaticMarkup(
    <TimeFormatProvider format={format}>
      <EarningsCard row={row} />
    </TimeFormatProvider>,
  );

describe('<EarningsCard> and the worker’s clock', () => {
  it('is 24-hour by default', () => {
    expect(render('24h')).toContain('Sat 5 Sep · 17:00 – 23:30');
  });

  it('writes the window on the 12-hour clock for a worker who chose it', () => {
    const html = render('12h');
    expect(html).toContain('5:00 pm – 11:30 pm');
    expect(html).not.toContain('17:00');
  });

  it('keeps UK first and adds "your time" on their clock abroad', () => {
    zone.value = 'Asia/Tashkent';
    try {
      const html = render('12h');
      expect(html).toContain('5:00 pm (UK) – 11:30 pm (UK)');
      expect(html).toContain('9:00 pm your time – 3:30 am your time');
    } finally {
      zone.value = 'Europe/London';
    }
  });
});
