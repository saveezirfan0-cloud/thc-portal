import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TimeFormatProvider } from '@thc/ui';
import { ClientEvents } from '../ClientEvents';
import type { ClientEventRow } from '../types';

const ROW: ClientEventRow = {
  id: 'e1',
  title: 'Gala Dinner',
  po_number: '4471-A',
  event_date: '2026-10-23',
  // 07:00 – 23:30 UK (BST, +01:00).
  starts_at: '2026-10-23T06:00:00Z',
  ends_at: '2026-10-23T22:30:00Z',
  venue_name: 'Leonardo Royal Hotel',
  cancelled_at: null,
  status: 'upcoming',
  section_count: 1,
  roles_summary: 'Waiting Staff 6 (+1)',
  margin_gbp: 218,
  margin_pct: 0.25,
};

/** ADR-0085: the client card's Events window is written on the operator's clock. */
describe('Client card events window (ADR-0085)', () => {
  it('is 24-hour by default', () => {
    const html = renderToStaticMarkup(<ClientEvents rows={[ROW]} />);
    expect(html).toContain('07:00 – 23:30');
  });

  it('follows a 12-hour choice', () => {
    const html = renderToStaticMarkup(
      <TimeFormatProvider format="12h">
        <ClientEvents rows={[ROW]} />
      </TimeFormatProvider>,
    );
    expect(html).not.toContain('07:00 – 23:30');
    expect(html).toMatch(/7:00\s?am – 11:30\s?pm/);
  });
});
