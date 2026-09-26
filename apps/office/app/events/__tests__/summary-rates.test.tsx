import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SummaryPanel } from '../_components/SummaryPanel';

const FORECAST = {
  payableHours: 78,
  chargePence: 179166,
  basePayPence: 109200,
  holidayPence: 13180,
  marginPence: 56786,
  marginPct: 31.7,
};

function render(ratesVisible: boolean): string {
  return renderToStaticMarkup(
    <SummaryPanel
      window={null}
      validRoles={1}
      erroredRoles={0}
      headcount={12}
      buffer={1}
      forecast={FORECAST}
      ratesVisible={ratesVisible}
    />,
  );
}

describe('the Shift Builder summary (§3.2, ADR-0061)', () => {
  it('shows the forecast money to an office role with finance', () => {
    const html = render(true);
    expect(html).toContain('Charge (forecast)');
    expect(html).toContain('Pay incl. holiday');
    expect(html).toContain('Margin');
  });

  it('and to a scheduler only the hours, with a short note in place of the money', () => {
    const html = render(false);
    expect(html).toContain('Payable hours (forecast)');
    expect(html).toContain('Rates hidden for your role');
    for (const absent of ['Charge', 'Pay incl. holiday', 'Margin', '£']) {
      expect(html).not.toContain(absent);
    }
  });
});
