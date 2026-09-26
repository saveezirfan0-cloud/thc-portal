import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RateCardRow, RoleOption } from '../types';

// Outside Next there is no server; the actions are not under test.
vi.mock('../actions', () => ({ addRole: vi.fn(), updateRole: vi.fn(), removeRole: vi.fn() }));

const { RateCard } = await import('../RateCard');

const ROW: RateCardRow = {
  id: 'rc1',
  role_id: 'r1',
  role_name: 'Waiting Staff',
  role_description: null,
  charge_rate: 22.97,
  base_pay_rate: 14,
  final_pay_rate: 15.69,
  margin_per_hour: 7.28,
  margin_pct: 31.7,
  dress_codes: ['Black & whites'],
  section_count: 0,
};

const ROLES: RoleOption[] = [
  { id: 'r1', name: 'Waiting Staff', pay_rate: 14 },
  { id: 'r2', name: 'Barista', pay_rate: 14.5 },
];

describe('the rate card (§9.7, client-card.html)', () => {
  it('heads the charge-rate column as editable and offers only unlisted roles to add', () => {
    const html = renderToStaticMarkup(<RateCard clientId="c1" rows={[ROW]} roles={ROLES} />);
    expect(html).toContain('Charge rate ✎');
    expect(html).toContain('Barista · base £14.50');
    expect(html).not.toContain('Waiting Staff · base');
  });

  it('shows the empty state until a role is picked, and no draft row is saved by itself', () => {
    const html = renderToStaticMarkup(<RateCard clientId="c1" rows={[]} roles={ROLES} />);
    expect(html).toContain('No roles on this rate card');
    expect(html).not.toContain('placeholder="0.00"');
  });

  it('ADR-0061: without finance it lists roles and dress codes — no rate, no margin, no controls', () => {
    const hidden: RateCardRow = {
      ...ROW,
      charge_rate: null,
      base_pay_rate: null,
      final_pay_rate: null,
      margin_per_hour: null,
      margin_pct: null,
    };
    const html = renderToStaticMarkup(
      <RateCard clientId="c1" rows={[hidden]} roles={ROLES} ratesVisible={false} />,
    );
    expect(html).toContain('Waiting Staff');
    expect(html).toContain('Black &amp; whites');
    expect(html).toContain('Rates hidden for your role');
    for (const absent of [
      'Charge rate',
      'Base pay',
      'Margin',
      '£',
      '—',
      'Edit',
      'Remove',
      '+ Add role',
    ]) {
      expect(html).not.toContain(absent);
    }
  });
});
