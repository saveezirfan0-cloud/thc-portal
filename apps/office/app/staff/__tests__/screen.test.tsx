import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StaffRow } from '../types';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { StaffScreen } = await import('../StaffScreen');

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
