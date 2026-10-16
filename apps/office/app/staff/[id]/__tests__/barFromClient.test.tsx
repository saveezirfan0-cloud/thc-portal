import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProfileRow, QualificationRow } from '../types';

// Outside Next there is no server; the actions are not under test.
vi.mock('../actions', () => ({
  barFromClient: vi.fn(),
  grantQualification: vi.fn(),
  revokeQualification: vi.fn(),
  setDoNotReturn: vi.fn(),
}));

const { Qualifications } = await import('../Qualifications');

const PROFILE = {
  id: 's1',
  display_name: 'Amara K.',
  removed: false,
  role_names: ['Waiting Staff'],
} as unknown as ProfileRow;

const BAR_ONLY: QualificationRow = {
  id: 'q1',
  client_id: 'c1',
  client_name: 'Mandarin Oriental',
  role_id: 'r1',
  role_name: 'Waiting Staff',
  granted_how: 'manual',
  granted_by_name: 'Gisela M.',
  granted_from_event: null,
  granted_from_event_title: null,
  granted_from_event_date: null,
  granted_at: '2026-10-15T10:00:00Z',
  do_not_return: true,
  note: 'Client asked for them not to return',
  bar_only: true,
};

const render = (rows: QualificationRow[], profile: ProfileRow = PROFILE) =>
  renderToStaticMarkup(
    <Qualifications
      profile={profile}
      qualifications={rows}
      clients={[{ id: 'c1', name: 'Mandarin Oriental' }]}
      roles={[{ id: 'r1', name: 'Waiting Staff' }]}
    />,
  );

describe('Bar from a client (ADR-0146)', () => {
  it('is on the tab even when the worker is cleared nowhere', () => {
    const html = render([]);
    expect(html).toContain('Bar from a client');
    expect(html).toContain('Not cleared at any client yet');
  });

  it('is switched off on a removed worker', () => {
    const html = render([], { ...PROFILE, removed: true } as ProfileRow);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Bar from a client<\/button>/);
  });

  it('shows a bar-only row as all roles, not as a clearance', () => {
    const html = render([BAR_ONLY]);
    expect(html).toContain('All roles');
    expect(html).toContain('not cleared here');
    expect(html).not.toContain('<span class="chip">Waiting Staff</span>');
    expect(html).toContain('Do not return · Mandarin Oriental · All roles');
  });

  it('leaves an ordinary entry as it was', () => {
    const html = render([{ ...BAR_ONLY, bar_only: false, do_not_return: false, note: null }]);
    expect(html).not.toContain('All roles');
    expect(html).toContain('manual by Gisela M.');
  });
});
