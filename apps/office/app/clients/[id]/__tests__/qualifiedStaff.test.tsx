import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { QualifiedStaffRow } from '../types';

// Outside Next there is no server; the actions are not under test.
vi.mock('../actions', () => ({
  qualifyStaff: vi.fn(),
  searchQualifyPicker: vi.fn(async () => ({ ok: true, workers: [], total: 0 })),
  revokeQualification: vi.fn(),
  setDoNotReturn: vi.fn(),
}));

const { QualifiedStaff } = await import('../QualifiedStaff');

const ROLES = ['Bar Staff', 'Barista', 'Cloakroom Staff', 'Runner', 'Waiting Staff'];

const ROW: QualifiedStaffRow = {
  staff_id: 's1',
  display_name: 'Bethan Vickers',
  employee_id: 10010,
  photo_path: null,
  status: 'active',
  rating: 4.6,
  reliability: 0.98,
  role_names: ROLES,
  role_ids: ROLES.map((_, i) => `r${i}`),
  qualification_ids: ROLES.map((_, i) => `q${i}`),
  do_not_return: false,
  first_granted_at: '2026-09-05T10:00:00Z',
  last_granted_at: '2026-09-05T10:00:00Z',
  granted_how: 'manual',
  granted_by_name: 'Gisela M.',
  granted_from_event_title: null,
  granted_from_event_date: null,
  notes: null,
};

describe('qualified staff (§9.7, ADR-0125)', () => {
  it('collapses a worker’s roles to one "N roles" button instead of a chip per role', () => {
    const html = renderToStaticMarkup(<QualifiedStaff clientId="c1" rows={[ROW]} rateCard={[]} />);
    expect(html).toContain('5 roles');
    expect(html).toContain('aria-haspopup="dialog"');
    // The full list is only in the tooltip until the pop-up opens.
    expect(html).toContain(`title="${ROLES.join(', ')}"`);
    expect(html).not.toContain('<span class="chip">Cloakroom Staff</span>');
  });

  it('says "1 role" for a worker cleared for one', () => {
    const html = renderToStaticMarkup(
      <QualifiedStaff
        clientId="c1"
        rows={[{ ...ROW, role_names: ['Bar Staff'], role_ids: ['r0'], qualification_ids: ['q0'] }]}
        rateCard={[]}
      />,
    );
    expect(html).toContain('1 role');
    expect(html).not.toContain('1 roles');
  });
});

describe('the qualified list (ADR-0146)', () => {
  it('lists a worker barred but never cleared here on their own, as all roles (ADR-0146)', () => {
    const html = renderToStaticMarkup(
      <QualifiedStaff
        clientId="c1"
        rows={[
          {
            ...ROW,
            role_names: ['Bar Staff'],
            role_ids: ['r0'],
            qualification_ids: ['q0'],
            do_not_return: true,
            bar_only: true,
          },
        ]}
        rateCard={[]}
      />,
    );
    expect(html).toContain('Do not return · not cleared here');
    expect(html).toContain('All roles');
    expect(html).toContain('barred — not cleared here');
    expect(html).not.toContain('0 qualified');
  });
});
