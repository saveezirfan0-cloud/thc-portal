import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PayrollLine } from '../data';

/**
 * §9.9 Tab 2, one expanded shift line: what a manager reads against the
 * scheduled window. Pending is only a "No check-out" when the violation is
 * actually raised (RULE-02); the deducted break shows under Payable hours
 * whether or not the 4-hour floor lifted the figure.
 */
const { ShiftRow } = await import('../_components/PeopleTable');

const LINE: PayrollLine = {
  booking_id: 'b1',
  shift_id: 's1',
  staff_id: 'w1',
  employee_id: 412,
  staff_name: 'Luca Moretti',
  removed: false,
  event_title: 'Gala Dinner',
  client_name: 'Leonardo Hotel St Pauls',
  role_name: 'Waiting Staff',
  shift_date: '2026-10-12',
  starts_at: '2026-10-12T16:00:00Z',
  ends_at: '2026-10-12T22:30:00Z',
  check_in_at: '2026-10-12T15:55:00Z',
  check_out_at: '2026-10-12T22:30:00Z',
  attempted_at: null,
  kind: 'worked',
  status: 'settled',
  no_check_out_unresolved: false,
  late_check_in: false,
  early_check_out: false,
  unpaid_break_min: 0,
  worked_min: 390,
  payable_min: 390,
  floor_applied: false,
  rate: '14.00',
  base: '91.00',
  holiday: '10.98',
  total: '101.98',
  in_export: true,
  exported_at: null,
  exported_payable_min: null,
  exported_total: null,
  changed_since_export: false,
};

const render = (line: Partial<PayrollLine>) =>
  renderToStaticMarkup(
    <table>
      <tbody>
        <ShiftRow line={{ ...LINE, ...line }} />
      </tbody>
    </table>,
  );

describe('Payroll · one shift line', () => {
  it('a shift still running is Pending, not "No check-out"', () => {
    const html = render({
      status: 'pending',
      check_out_at: null,
      worked_min: null,
      payable_min: null,
      base: null,
      holiday: null,
      total: null,
      in_export: false,
    });
    expect(html).toContain('Pending');
    expect(html).toContain('Not checked out yet');
    expect(html).not.toContain('No check-out');
  });

  it('an unresolved No check-out violation says so', () => {
    const html = render({
      status: 'pending',
      no_check_out_unresolved: true,
      check_out_at: null,
      worked_min: null,
      payable_min: null,
      base: null,
      holiday: null,
      total: null,
      in_export: false,
    });
    expect(html).toContain('No check-out — unresolved');
  });

  it('shows the deducted break under Payable hours', () => {
    const html = render({ unpaid_break_min: 30, worked_min: 360, payable_min: 360 });
    expect(html).toContain('6.00');
    expect(html).toContain('6.50 − 0:30 break');
  });

  it('shows the break even when the 4-hour floor lifted the figure', () => {
    // 16:00–19:40 with a 20-minute break: 200 min worked, paid 240.
    const html = render({
      ends_at: '2026-10-12T19:40:00Z',
      check_out_at: '2026-10-12T19:40:00Z',
      unpaid_break_min: 20,
      worked_min: 200,
      payable_min: 240,
      floor_applied: true,
    });
    expect(html).toContain('4.00');
    expect(html).toContain('3.67 − 0:20 break');
    expect(html).toContain('4 h minimum');
  });
});
