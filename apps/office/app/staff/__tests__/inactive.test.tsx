import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CAP_FILTER_LABEL,
  hoursText,
  lastShiftLine,
  limitHover,
  matchesCapFilter,
  matchesQuery,
  p45Status,
  releasedLine,
} from '../staff';
import type { StaffRow, StudentRow } from '../types';

/**
 * /staff, as `wireframes/backoffice/staff.html` draws its three states
 * (§9.6, §4.5): the Inactive tab's own table, the Student visa view's cap
 * filter, the "15 / 50 per page" pager, the wireframe's search placeholders
 * and the "Limit reached" hover with its "until" date.
 */
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
  photo_path: null,
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
  weekly_booked_hours: 20,
  weekly_cap_until: '2026-12-13',
  phone: '+44 7700 900602',
};

const LEAVER: StaffRow = {
  ...WORKER,
  id: 'l1',
  employee_id: 566,
  display_name: 'Rosa T.',
  status: 'inactive',
  rtw_branch: 'uk_irish',
  weekly_cap_band: 'standard_48',
  weekly_cap_hours: 48,
  weekly_booked_hours: 0,
  weekly_cap_until: null,
  left_at: '2026-09-17T20:14:00Z',
  leave_reason: 'Moving back to Spain in October',
  last_worked_event: 'Corporate Lunch',
  last_worked_venue: 'The Dorchester',
  last_worked_at: '2026-09-16T11:00:00Z',
  released_shifts: [
    { title: 'Gala Dinner', startsAt: '2026-09-19T16:00:00Z' },
    { title: 'Awards Night', startsAt: '2026-09-23T17:00:00Z' },
  ],
  p45_notice_sent_at: '2026-09-17T20:14:30Z',
  p45_notice_failed_at: null,
};

const STUDENT: StudentRow = {
  id: 's1',
  display_name: 'Isla M.',
  employee_id: 512,
  photo_path: null,
  status: 'inactive',
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
  weekly_cap_until: '2026-12-13',
};

/** The visible text, without the markup, so a § in an attribute is caught too. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ');

describe('the Inactive tab (§9.6, §10.6)', () => {
  const html = renderToStaticMarkup(
    <StaffScreen staff={[WORKER, LEAVER]} students={[]} problem={null} initialFilter="inactive" />,
  );

  it('has the wireframe columns', () => {
    for (const heading of [
      'Left',
      'Reason given',
      'Last completed shift',
      'Released shifts',
      'P45',
    ]) {
      expect(html).toContain(`<th>${heading}</th>`);
    }
    expect(html).not.toContain('<th>Role(s)</th>');
  });

  it('lists the leaver with what the office needs to settle final pay', () => {
    expect(html).toContain('Rosa T.');
    expect(html).not.toContain('Amara K.');
    expect(html).toContain('“Moving back to Spain in October”');
    expect(html).toContain('17.09.2026 21:14 UK time');
    expect(html).toContain('Corporate Lunch · The Dorchester · 16 Sep');
    expect(html).toContain('2 — Gala Dinner 19 Sep, Awards Night 23 Sep');
    expect(html).toContain('Requested');
    expect(html).toContain('E8 sent 17 Sep 21:14');
  });

  it('says newest first, searches name and Employee ID, and has no role or sort control', () => {
    expect(html).toContain('newest first');
    expect(html).toContain('placeholder="Search name, Employee ID"');
    expect(html).not.toContain('Sort: name A–Z');
  });

  it('prints no section number or rule id', () => {
    expect(html).not.toMatch(/§|RULE-/);
  });
});

describe('the directory (§9.6)', () => {
  const many = Array.from({ length: 20 }, (_, index) => ({
    ...WORKER,
    id: `w${index}`,
    display_name: `Worker ${String(index).padStart(2, '0')}`,
  }));

  it('searches name, Employee ID and phone, as the wireframe says', () => {
    const html = renderToStaticMarkup(
      <StaffScreen staff={[WORKER]} students={[]} problem={null} />,
    );
    expect(html).toContain('placeholder="Search name, Employee ID, phone"');
  });

  it('offers 15 or 50 per page on the pager', () => {
    const html = renderToStaticMarkup(<StaffScreen staff={many} students={[]} problem={null} />);
    expect(html).toContain('Showing 1–15 of 20');
    expect(html).toMatch(/<option value="15"[^>]*>15 \/ page<\/option>/);
    expect(html).toMatch(/<option value="50"[^>]*>50 \/ page<\/option>/);
  });

  it('puts the "until" date in the Limit reached hover', () => {
    const html = renderToStaticMarkup(
      <StaffScreen staff={[WORKER]} students={[]} problem={null} />,
    );
    expect(html).toContain('title="20 h — term time until 13.12.2026 · 20 h booked this week"');
  });

  it('prints no section number or rule id', () => {
    const html = renderToStaticMarkup(<StaffScreen staff={many} students={[]} problem={null} />);
    expect(text(html)).not.toMatch(/§|RULE-/);
  });
});

describe('the Student visa view (§4.5)', () => {
  const html = renderToStaticMarkup(
    <StaffScreen staff={[]} students={[STUDENT]} problem={null} initialView="student" />,
  );

  it('has the cap filter and the "Search name" box', () => {
    for (const label of Object.values(CAP_FILTER_LABEL)) {
      expect(html).toContain(`>${label}</option>`);
    }
    expect(html).toContain('placeholder="Search name"');
  });

  it('reads the band with its "until" date', () => {
    expect(html).toContain('20 h — term time until 13.12.2026 · 18 h booked this week');
  });

  it('never calls an inactive student Compliant', () => {
    expect(html).toContain('Inactive');
    expect(html).not.toContain('>Compliant<');
  });

  it('prints no section number or rule id', () => {
    expect(text(html)).not.toMatch(/§|RULE-/);
  });
});

describe('directory rules', () => {
  it('finds a worker by phone, in any shape, from four digits', () => {
    expect(matchesQuery(WORKER, '900602')).toBe(true);
    expect(matchesQuery(WORKER, '07700 900602')).toBe(true);
    expect(matchesQuery(WORKER, '+447700900602')).toBe(true);
    expect(matchesQuery(WORKER, '077')).toBe(false);
    expect(matchesQuery({ ...WORKER, phone: null }, '900602')).toBe(false);
  });

  it('files each student under exactly one cap filter', () => {
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

  it('writes the Inactive cells', () => {
    expect(lastShiftLine(LEAVER)).toBe('Corporate Lunch · The Dorchester · 16 Sep');
    expect(lastShiftLine({ ...LEAVER, last_worked_event: null })).toBeNull();
    expect(releasedLine({ released_shifts: [] })).toBe('0');
    expect(releasedLine({ released_shifts: null })).toBe('0');
    expect(p45Status({ p45_notice_sent_at: null, p45_notice_failed_at: null })).toEqual({
      label: 'Requested',
      tone: 'amber',
      note: 'E8 queued',
    });
    expect(
      p45Status({ p45_notice_sent_at: null, p45_notice_failed_at: '2026-09-17T20:15:00Z' }).tone,
    ).toBe('coral');
  });

  it('prints hours without trailing noise', () => {
    expect(hoursText(18)).toBe('18');
    expect(hoursText('7.5000')).toBe('7.5');
    expect(hoursText(null)).toBe('0');
    expect(limitHover({ ...WORKER, weekly_booked_hours: 19.75 })).toBe(
      '20 h — term time until 13.12.2026 · 19.8 h booked this week',
    );
  });
});
