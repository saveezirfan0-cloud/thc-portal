import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeRequestView } from '../../requests/types';
import type { AvailabilityRow, Referrals } from '../types';

// Server actions are not under test here; the markup is.
vi.mock('../actions', () => ({
  saveEmergencyContact: vi.fn(),
  clearEmergencyContact: vi.fn(),
}));
vi.mock('../../requests/actions', () => ({
  decideChangeRequest: vi.fn(),
  changeEvidenceLink: vi.fn(),
}));

const { EmergencyContactCard } = await import('../EmergencyContactCard');
const { ReferralsCard } = await import('../ReferralsCard');
const { Availability } = await import('../Availability');
const { ChangeRequestBanner } = await import('../ChangeRequestBanner');

describe('Emergency contact card (ADR-0043)', () => {
  it('reads "Not provided" when there is none, and offers Add but not Clear', () => {
    const html = renderToStaticMarkup(
      <EmergencyContactCard staffId="s1" contact={null} editable />,
    );
    expect(html).toContain('Not provided');
    expect(html).toContain('>Add<');
    expect(html).not.toContain('>Clear<');
    expect(html).toContain('never on a client document');
  });

  it('shows the contact with Edit and Clear, and who saved it', () => {
    const html = renderToStaticMarkup(
      <EmergencyContactCard
        staffId="s1"
        editable
        contact={{
          name: 'Grace Kalu',
          relationship: 'Parent',
          phone: '+447700900456',
          updatedAt: '2026-09-18T13:36:00Z',
          updatedBy: 'worker',
          updatedByName: null,
        }}
      />,
    );
    expect(html).toContain('Grace Kalu');
    expect(html).toContain('+44 7700 900456');
    expect(html).toContain('>Edit<');
    expect(html).toContain('>Clear<');
    expect(html).toContain('by the worker');
  });

  it('offers nothing to edit on a removed profile (§1.7)', () => {
    const html = renderToStaticMarkup(
      <EmergencyContactCard staffId="s1" contact={null} editable={false} />,
    );
    expect(html).not.toContain('>Add<');
    expect(html).not.toContain('>Edit<');
  });
});

describe('Referrals card (ADR-0046)', () => {
  const referrals: Referrals = {
    code: 'K7M4Q2XP',
    codeRevokedAt: null,
    referredBy: {
      staffId: 'r1',
      name: 'Luca Moretti',
      employeeId: 701,
      status: 'compliant',
      removed: false,
      recordedAt: '2026-06-01T10:00:00Z',
    },
    referred: [
      {
        staffId: 'c1',
        name: 'Priya Sharma',
        employeeId: 655,
        status: 'compliant',
        removed: false,
        recordedAt: '2026-08-01T10:00:00Z',
      },
      {
        staffId: 'c2',
        name: 'Deleted account #1042',
        employeeId: 1042,
        status: 'removed',
        removed: true,
        recordedAt: '2026-08-02T10:00:00Z',
      },
    ],
  };

  it('names the referrer, the code and everyone who applied with it', () => {
    const html = renderToStaticMarkup(<ReferralsCard referrals={referrals} />);
    expect(html).toContain('Luca Moretti');
    expect(html).toContain('THC-00701');
    expect(html).toContain('K7M4Q2XP');
    expect(html).toContain('Priya Sharma');
    expect(html).toContain('Deleted account #1042');
    expect(html).toContain('href="/staff/r1"');
  });

  it('never mentions a reward (Q19)', () => {
    const html = renderToStaticMarkup(<ReferralsCard referrals={referrals} />);
    expect(html.replace('no reward (Q19)', '')).not.toMatch(/reward|bonus|£/i);
  });

  it('says so when nobody referred them', () => {
    const html = renderToStaticMarkup(
      <ReferralsCard
        referrals={{ code: null, codeRevokedAt: null, referredBy: null, referred: [] }}
      />,
    );
    expect(html).toContain('applied without a referral');
  });
});

describe('Availability tab (ADR-0042)', () => {
  const row: AvailabilityRow = {
    id: 'u1',
    starts_at: '2026-09-22T23:00:00Z',
    ends_at: '2026-09-23T23:00:00Z',
    all_day: true,
    series_id: null,
    series_count: 0,
    series_last_start: null,
    created_at: '2026-09-18T10:00:00Z',
    bookings: [
      {
        bookingId: 'b1',
        eventId: 'e1',
        eventTitle: 'Awards Night',
        roleName: 'Waiting Staff',
        startsAt: '2026-09-23T15:00:00Z',
        endsAt: '2026-09-24T01:00:00Z',
      },
    ],
  };

  it('is read-only, in UK time, and lists an overlapping confirmed booking', () => {
    const html = renderToStaticMarkup(<Availability rows={[row]} name="Amara Kalu" />);
    expect(html).toContain('read-only');
    expect(html).toContain('Wed 23 Sep · all day');
    expect(html).toContain('Awards Night · Waiting Staff');
    expect(html).toContain('href="/events/e1"');
    expect(html).toContain('Confirmed');
    expect(html).not.toMatch(/<button[^>]*>(Delete|Remove|Add)</);
  });

  it('has an empty state', () => {
    const html = renderToStaticMarkup(<Availability rows={[]} name="Amara Kalu" />);
    expect(html).toContain('Nothing marked in the next 8 weeks');
  });
});

describe('Pending change-request banner (ADR-0044)', () => {
  const request = {
    id: 'r1',
    staff_id: 's1',
    kind: 'name',
    status: 'pending',
    display_name: 'Amara Kalu',
    employee_id: 873,
    removed: false,
    staff_status: 'compliant',
    rtw_branch: 'uk_irish',
    right_to_work_until: null,
    current_first_name: 'Amara',
    current_last_name: 'Kalu',
    current_photo_path: null,
    proposed_first_name: 'Amara',
    proposed_last_name: 'Okafor',
    proposed_photo_path: null,
    evidence_path: 's1/change-requests/r1.jpg',
    worker_note: 'Married in August.',
    previous_value: null,
    created_at: '2026-09-18T13:37:00Z',
    decided_at: null,
    decided_by_name: null,
    decision_reason: null,
    current_photo_url: null,
    proposed_photo_url: null,
  } satisfies ChangeRequestView;

  it('shows now → requested with the UK stamp and a Review button', () => {
    const html = renderToStaticMarkup(<ChangeRequestBanner requests={[request]} />);
    expect(html).toContain('Name change requested');
    expect(html).toContain('Amara Kalu → Amara Okafor');
    expect(html).toContain('18.09.2026 14:37 UK time');
    expect(html).toContain('>Review<');
  });

  it('renders nothing when nothing is pending', () => {
    expect(renderToStaticMarkup(<ChangeRequestBanner requests={[]} />)).toBe('');
  });
});
