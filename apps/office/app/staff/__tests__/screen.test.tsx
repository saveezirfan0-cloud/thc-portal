import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StaffRow } from '../types';

// The list's tab and view come from the URL (release audit L1).
const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/staff',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { StaffScreen } = await import('../StaffScreen');

afterEach(() => {
  nav.search = '';
});

const WORKER: StaffRow = {
  id: 'w1',
  employee_id: 873,
  status: 'compliant',
  removed: false,
  display_name: 'Amara K.',
  photo_path: 'w1/selfie.jpg',
  photo_url: 'https://signed/w1',
  rating: 4.6,
  reliability: 98,
  block_kind: null,
  block_reason: null,
  rtw_branch: 'international_student',
  right_to_work_until: '2028-03-31',
  graduated_at: null,
  wtr_optout: false,
  left_at: null,
  leave_reason: null,
  role_names: ['Waiting Staff'],
  unresolved_violations: 0,
  do_not_return_clients: [],
  weekly_cap_hours: 20,
  weekly_cap_band: 'student_term_20',
  weekly_booked_hours: 18,
  weekly_cap_until: null,
  last_shift_at: null,
  released_shift_count: 0,
  p45_requested_at: null,
};

describe('/staff directory (§9.6)', () => {
  it('draws the selfie from its signed URL', () => {
    const html = renderToStaticMarkup(
      <StaffScreen staff={[WORKER]} students={[]} problem={null} />,
    );
    expect(html).toContain('src="https://signed/w1"');
  });

  it('keeps initials when there is no signed URL, and no photo on a removed worker', () => {
    const html = renderToStaticMarkup(
      <StaffScreen
        staff={[
          { ...WORKER, photo_url: null },
          { ...WORKER, id: 'w2', removed: true, status: 'removed', photo_url: 'https://x' },
        ]}
        students={[]}
        problem={null}
      />,
    );
    expect(html).not.toContain('<img');
  });

  it('labels the sort as the wireframe does: "newest"', () => {
    const html = renderToStaticMarkup(<StaffScreen staff={[]} students={[]} problem={null} />);
    expect(html).toContain('>Sort: newest</option>');
    expect(html).not.toContain('newest leaver');
  });
});

describe('/staff lists workers, and the Inactive tab as the wireframe draws it (§9.6)', () => {
  it('neither lists nor counts a candidate or a rejected applicant', () => {
    const html = renderToStaticMarkup(
      <StaffScreen
        staff={[
          WORKER,
          { ...WORKER, id: 'c1', display_name: 'Hana K.', status: 'documents' },
          { ...WORKER, id: 'r1', display_name: 'Dina F.', status: 'rejected' },
        ]}
        students={[]}
        problem={null}
      />,
    );
    expect(html).toContain('Amara K.');
    expect(html).not.toContain('Hana K.');
    expect(html).not.toContain('Dina F.');
    expect(html).toContain('<b>1 workers</b>');
    expect(html).not.toContain('pill amber">Onboarding');
  });
});

describe('the Inactive tab carries what the office works through (§9.6, §10.6)', () => {
  const LEAVER: StaffRow = {
    ...WORKER,
    id: 'l1',
    display_name: 'Rosa T.',
    status: 'inactive',
    left_at: '2026-09-17T20:14:00Z',
    leave_reason: 'Moving back to Spain in October',
    last_shift_at: '2026-09-16T22:30:00Z',
    released_shift_count: 2,
    p45_requested_at: '2026-09-17T20:14:00Z',
  };

  it('shows the last completed shift, the released count and the P45 request', () => {
    nav.search = 'tab=inactive';
    const html = renderToStaticMarkup(
      <StaffScreen staff={[LEAVER]} students={[]} problem={null} />,
    );
    expect(html).toMatch(/<th[^>]*>Last completed shift<\/th>/);
    expect(html).toMatch(/<th[^>]*>Released shifts<\/th>/);
    expect(html).toMatch(/<th[^>]*>P45<\/th>/);
    expect(html).toContain('16.09.2026');
    expect(html).toContain('>2</td>');
    expect(html).toContain('Requested');
    expect(html).toContain('E8 sent 17.09.2026 21:14 UK time');
  });

  it('reads "— none worked" and no pill for a leaver who never worked or asked', () => {
    nav.search = 'tab=inactive';
    const html = renderToStaticMarkup(
      <StaffScreen
        staff={[
          { ...LEAVER, last_shift_at: null, released_shift_count: 0, p45_requested_at: null },
        ]}
        students={[]}
        problem={null}
      />,
    );
    expect(html).toContain('— none worked');
    expect(html).not.toContain('Requested');
  });

  it('dates the cap the worker is at the limit of (§9.6 "until 13.12.2026")', () => {
    const html = renderToStaticMarkup(
      <StaffScreen
        staff={[{ ...WORKER, weekly_booked_hours: 20, weekly_cap_until: '2026-12-13' }]}
        students={[]}
        problem={null}
      />,
    );
    expect(html).toContain('20 h — term time until 13.12.2026');
  });

  it('links to the change-request queue with the pending count (ADR-0045)', () => {
    const html = renderToStaticMarkup(
      <StaffScreen staff={[WORKER]} students={[]} problem={null} pendingRequests={2} />,
    );
    expect(html).toContain('href="/staff/requests"');
    expect(html).toContain('Change requests (2)');
  });

  it('never claims "(0)" when the count could not be read (audit D18)', () => {
    const html = renderToStaticMarkup(
      <StaffScreen staff={[WORKER]} students={[]} problem={null} pendingRequests={null} />,
    );
    expect(html).toContain('Change requests (?)');
    expect(html).not.toContain('Change requests (0)');
    expect(html).toContain('The pending count could not be read');
  });
});

describe('the Payroll ID has a column of its own (ADR-0107)', () => {
  const cells = (html: string) => [...html.matchAll(/data-label="Payroll ID"[^>]*>(.*?)<\/td>/g)];

  it('heads the column after Employee ID and prints each worker’s ID in it', () => {
    const html = renderToStaticMarkup(
      <StaffScreen
        staff={[
          { ...WORKER, employee_id: 6096, payroll_id: '6096' },
          { ...WORKER, id: 'w2', display_name: 'Ben L.', employee_id: 2200, payroll_id: '1641A' },
        ]}
        students={[]}
        problem={null}
      />,
    );
    expect(html.indexOf('>Employee ID</th>')).toBeLessThan(html.indexOf('>Payroll ID</th>'));
    expect(cells(html).map((m) => m[1])).toEqual(['6096', '1641A']);
    // The old second line under the Employee ID is gone: it said the same thing twice.
    expect(html).not.toContain('Payroll 6096');
  });

  it('is a dash when there is none, and blank for a removed worker', () => {
    const html = renderToStaticMarkup(
      <StaffScreen
        staff={[
          { ...WORKER, payroll_id: null },
          { ...WORKER, id: 'w2', removed: true, status: 'removed', payroll_id: '9' },
        ]}
        students={[]}
        problem={null}
      />,
    );
    expect(cells(html).map((m) => m[1])).toEqual([
      '<span class="muted">—</span>',
      '<span class="muted">—</span>',
    ]);
  });

  it('keeps the tick and the avatar on one centred line', () => {
    const html = renderToStaticMarkup(
      <StaffScreen staff={[WORKER]} students={[]} problem={null} canMessage />,
    );
    expect(html).toMatch(/<td class="cell-lead"><div class="lead"><label class="pick-hit">/);
  });
});
