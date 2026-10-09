import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppliedEntry, RosterEntry } from '../data';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../../../_components/OfficeShell', () => ({
  OfficeShell: ({ crumbs, children }: { crumbs: React.ReactNode; children: React.ReactNode }) => (
    <div>
      <div data-testid="crumbs">{crumbs}</div>
      {children}
    </div>
  ),
}));

vi.mock('../actions', () => ({ loadRoster: vi.fn(), removeRosterEntries: vi.fn() }));

const { RosterScreen } = await import('../RosterScreen');

/**
 * /staff/roster says who has applied (ADR-0107 follow-up): the waiting rows
 * are deleted on use, so the Applied panel reads invite_list_applied_v.
 */
const WAITING: RosterEntry = {
  id: 'r1',
  email: 'waiting@example.com',
  first_name: 'Wanda',
  last_name: 'Waiting',
  payroll_id: '1500',
  grp: 'thc',
  loaded_at: '2026-10-08T09:00:00Z',
};

const APPLIED: AppliedEntry = {
  staff_id: 's1',
  applied_at: '2026-10-09T10:30:00Z',
  how: 'applied',
  grp: 'spudbros',
  email: 'ada@example.com',
  display_name: 'Ada Applied',
  payroll_id: '1641A',
  payroll_id_taken: false,
  status: 'documents',
  removed: false,
};

const render = (applied: AppliedEntry[], waiting: RosterEntry[] = [WAITING]) =>
  renderToStaticMarkup(<RosterScreen waiting={waiting} applied={applied} problem={null} canEdit />);

describe('/staff/roster — who has applied', () => {
  it('lists each person who applied, with when, group, Payroll ID and where they are now', () => {
    const html = render([APPLIED]);
    expect(html).toContain('Applied (1)');
    expect(html).toContain('Ada Applied');
    expect(html).toContain('href="/staff/s1"');
    expect(html).toContain('ada@example.com');
    expect(html).toContain('1641A');
    expect(html).toContain('SpudBros Express');
    expect(html).toContain('09.10.2026');
    expect(html).toContain('Onboarding');
  });

  it('keeps the waiting list as it was, and counts both in the crumb', () => {
    const html = render([APPLIED]);
    expect(html).toContain('Invited, not applied yet (1)');
    expect(html).toContain('waiting@example.com');
    expect(html).toMatch(/1 applied[\s\S]*1 waiting/);
  });

  it('says so when nobody has applied yet', () => {
    const html = render([]);
    expect(html).toContain('Applied (0)');
    expect(html).toContain('Nobody on the list has applied yet');
  });

  it('flags a different name, a person already here, and an ID held by someone else', () => {
    const html = render([
      { ...APPLIED, staff_id: 's2', how: 'name_mismatch' },
      { ...APPLIED, staff_id: 's3', how: 'already_here' },
      { ...APPLIED, staff_id: 's4', payroll_id: null, payroll_id_taken: true },
    ]);
    expect(html).toContain('Applied — name differs from the list');
    expect(html).toContain('Already in the system');
    expect(html).toContain('ID already held by someone else');
  });

  it('prints a removed person as the anonymised label, with no email or ID', () => {
    const html = render([
      {
        ...APPLIED,
        display_name: 'Deleted account #873',
        email: null,
        payroll_id: null,
        removed: true,
        status: 'removed',
      },
    ]);
    expect(html).toContain('Deleted account #873');
    expect(html).toContain('Removed');
    expect(html).not.toContain('ada@example.com');
  });
});
