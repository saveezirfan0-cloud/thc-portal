import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CAP_FILTER_LABEL, hoursText, matchesCapFilter } from '../staff';
import type { StaffRow, StudentRow } from '../types';

/**
 * /staff against wireframes/backoffice/staff.html: the Student visa view's
 * cap filter (All caps · 20 h · term time · 48 h · holiday · 48 h ·
 * graduated · Blocked) and the directory pager's "15 / page · 50 / page".
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { StaffScreen } = await import('../StaffScreen');
const { StudentVisaView } = await import('../StudentVisaView');

const WORKER: StaffRow = {
  id: 'w1',
  employee_id: 873,
  status: 'compliant',
  removed: false,
  display_name: 'Amara K.',
  photo_path: null,
  rating: 4.6,
  reliability: 98,
  block_kind: null,
  block_reason: null,
  rtw_branch: 'uk_irish',
  right_to_work_until: null,
  graduated_at: null,
  wtr_optout: false,
  left_at: null,
  leave_reason: null,
  role_names: ['Waiting Staff'],
  unresolved_violations: 0,
  do_not_return_clients: [],
  weekly_cap_hours: 48,
  weekly_cap_band: 'standard_48',
  weekly_booked_hours: 8,
  weekly_cap_until: null,
  last_shift_at: null,
  released_shift_count: 0,
  p45_requested_at: null,
};

const student = (over: Partial<StudentRow> & Pick<StudentRow, 'id' | 'display_name'>) =>
  ({
    employee_id: 512,
    photo_path: null,
    status: 'compliant',
    weekly_cap_hours: 20,
    weekly_cap_band: 'student_term_20',
    weekly_booked_hours: 18,
    right_to_work_until: '2027-11-30',
    graduated_at: null,
    wtr_optout: false,
    term_letter_verified_at: '2026-07-11T10:00:00Z',
    term_letter_expires_at: '2026-12-31',
    completion_letter_verified_at: null,
    completion_letter_in_review: false,
    below_degree_level: false,
    course_completion_date: null,
    completion_letter_status: null,
    completion_letter_rejection: null,
    completion_date_claimed: null,
    completion_effective_from: null,
    wtr_optout_cancelled_from: null,
    optout_eligible: true,
    rtw_days_left: 400,
    ...over,
  }) as StudentRow;

const TERM = student({ id: 's1', display_name: 'Isla Term' });
const HOLIDAY = student({
  id: 's2',
  display_name: 'Omar Holiday',
  weekly_cap_band: 'student_holiday_48',
  weekly_cap_hours: 48,
});
const GRADUATED = student({
  id: 's3',
  display_name: 'Priya Graduated',
  weekly_cap_band: 'graduated_48',
  weekly_cap_hours: 48,
  graduated_at: '2026-07-01',
});
const BLOCKED = student({
  id: 's4',
  display_name: 'Ben Blocked',
  status: 'blocked',
  weekly_cap_band: null,
  weekly_cap_hours: null,
});
const ALL = [TERM, HOLIDAY, GRADUATED, BLOCKED];

describe('the Student visa view filters by cap (wireframe)', () => {
  it('offers every cap in the toolbar', () => {
    const html = renderToStaticMarkup(
      <StaffScreen staff={[]} students={ALL} problem={null} initialView="student" />,
    );
    expect(html).toContain('aria-label="Filter by weekly cap"');
    for (const label of Object.values(CAP_FILTER_LABEL)) {
      expect(html).toContain(`>${label}</option>`);
    }
  });

  it('lists only the students under the chosen cap', () => {
    const names = (capFilter: Parameters<typeof StudentVisaView>[0]['capFilter']) => {
      const html = renderToStaticMarkup(
        <StudentVisaView students={ALL} query="" capFilter={capFilter} />,
      );
      return ALL.filter((row) => html.includes(row.display_name)).map((row) => row.display_name);
    };
    expect(names('all')).toEqual(ALL.map((row) => row.display_name));
    expect(names('term')).toEqual(['Isla Term']);
    expect(names('holiday')).toEqual(['Omar Holiday']);
    expect(names('graduated')).toEqual(['Priya Graduated']);
    expect(names('blocked')).toEqual(['Ben Blocked']);
  });

  it('files each student under exactly one cap', () => {
    const band = (weekly_cap_band: StudentRow['weekly_cap_band'], extra = {}) => ({
      status: 'compliant' as const,
      weekly_cap_band,
      graduated_at: null,
      ...extra,
    });
    expect(matchesCapFilter(band('student_term_20'), 'term')).toBe(true);
    expect(matchesCapFilter(band('student_term_10'), 'term')).toBe(true);
    expect(matchesCapFilter(band('student_holiday_48'), 'holiday')).toBe(true);
    expect(matchesCapFilter(band('graduated_48'), 'graduated')).toBe(true);
    expect(matchesCapFilter(band('uncapped'), 'holiday')).toBe(true);
    expect(matchesCapFilter(band('uncapped', { graduated_at: '2026-07-01' }), 'graduated')).toBe(
      true,
    );
    const blocked = band(null, { status: 'blocked' as const });
    expect(matchesCapFilter(blocked, 'blocked')).toBe(true);
    expect(matchesCapFilter(blocked, 'term')).toBe(false);
    expect(matchesCapFilter(band('student_term_20'), 'blocked')).toBe(false);
    expect(matchesCapFilter(band('student_term_20'), 'all')).toBe(true);
  });
});

describe('the directory pager offers 15 or 50 per page (wireframe)', () => {
  const many = Array.from({ length: 20 }, (_, index) => ({
    ...WORKER,
    id: `w${index}`,
    display_name: `Worker ${String(index).padStart(2, '0')}`,
  }));

  it('shows 15 by default, with both sizes to choose from', () => {
    const html = renderToStaticMarkup(<StaffScreen staff={many} students={[]} problem={null} />);
    expect(html).toContain('Showing 1–15 of 20');
    expect(html).toContain('aria-label="Rows per page"');
    expect(html).toMatch(/<option value="15"[^>]*>15 \/ page<\/option>/);
    expect(html).toMatch(/<option value="50"[^>]*>50 \/ page<\/option>/);
  });

  it('has no pager at all for one page', () => {
    const html = renderToStaticMarkup(
      <StaffScreen staff={many.slice(0, 15)} students={[]} problem={null} />,
    );
    expect(html).not.toContain('Rows per page');
  });
});

describe('hours as the office reads them', () => {
  it('prints no trailing noise', () => {
    expect(hoursText(18)).toBe('18');
    expect(hoursText('7.5000')).toBe('7.5');
    expect(hoursText(19.75)).toBe('19.8');
    expect(hoursText(null)).toBe('0');
    expect(hoursText('not a number')).toBe('0');
  });
});
