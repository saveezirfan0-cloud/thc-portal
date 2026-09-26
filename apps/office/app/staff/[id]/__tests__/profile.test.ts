import { describe, expect, it } from 'vitest';
import {
  blockBanner,
  canBlock,
  canReset,
  complianceSummary,
  documentOrder,
  feedbackState,
  formatLocalStamp,
  formatUkStamp,
  formatUkWindow,
  hoursThisWeek,
  hoursTone,
  isActionable,
  noShowTone,
  payableHours,
  reviewLabel,
  shiftOutcome,
  shiftsInRange,
} from '../profile';
import type { DocumentRow, FeedbackRow, ShiftRow } from '../types';

const SHIFT: ShiftRow = {
  booking_id: 'b1',
  booking_status: 'worked',
  cancel_cause: null,
  self_cancelled: false,
  starts_at: '2026-09-16T10:00:00Z',
  ends_at: '2026-09-16T15:00:00Z',
  role_name: 'Waiting Staff',
  event_id: 'e1',
  event_title: 'Corporate Lunch',
  event_date: '2026-09-16',
  client_name: 'The Dorchester',
  venue_name: 'The Dorchester',
  check_in_at: '2026-09-16T09:52:00Z',
  check_out_at: '2026-09-16T15:04:00Z',
  kind: 'worked',
  pay: { status: 'settled', payableMin: 300, floorApplied: false },
  violation_count: 0,
  unresolved_violation_count: 0,
};

const doc = (over: Partial<DocumentRow>): DocumentRow => ({
  id: 'd1',
  doc_type: 'passport',
  doc_label: 'Passport',
  review_status: 'verified',
  superseded: false,
  file_path: null,
  uploaded_at: '2026-07-10T11:00:00Z',
  expiry_date: null,
  expires_on: null,
  ai_confidence: null,
  needs_manual_review: false,
  rejection_reason: null,
  reviewed_at: null,
  reviewed_by_name: null,
  share_code: null,
  right_to_work_until: null,
  rtw_no_time_limit: false,
  completion_date: null,
  awarding_institution: null,
  ...over,
});

describe('hours this week (§9.6, RULE-20)', () => {
  it('is amber at the limit', () => {
    expect(hoursTone(20, 20)).toBe('warn');
    expect(hoursTone(20, 21)).toBe('warn');
  });

  it('is not amber below it', () => {
    expect(hoursTone(20, 18)).toBe('default');
  });

  it('is never amber when there is no ceiling to reach', () => {
    // The 48h opt-out and an uncalculable cap are both null, and neither
    // is "at the limit" — the first has no ceiling, the second belongs to
    // a worker who cannot be booked at all.
    expect(hoursTone(null, 60)).toBe('default');
  });
});

describe('no-shows (§9.6)', () => {
  it('is red above zero and plain at zero', () => {
    expect(noShowTone(1)).toBe('danger');
    expect(noShowTone(0)).toBe('default');
  });
});

describe('the closing compliance line (§9.6)', () => {
  it('carries the contract timestamp in UK time when one is signed', () => {
    expect(
      complianceSummary({ status: 'compliant', contract_signed_at: '2026-07-12T13:42:00Z' }),
    ).toBe(
      'Documents verified, quiz passed. Contract signed electronically: 12.07.2026 14:42 UK time',
    );
  });

  it('never ends with an empty slot before the contract is signed', () => {
    const line = complianceSummary({ status: 'compliant', contract_signed_at: null });
    expect(line).toBe('Documents verified, quiz passed. Compliant and bookable.');
    expect(line).not.toMatch(/:\s*$/);
  });

  it('opens with the real state, so a blocked worker is not "onboarding in progress"', () => {
    expect(
      complianceSummary({ status: 'blocked', contract_signed_at: '2026-07-12T13:42:00Z' }),
    ).toBe(
      'Blocked — not bookable until the block is lifted. Contract signed electronically: 12.07.2026 14:42 UK time',
    );
  });

  it('never calls a candidate "compliant and bookable"', () => {
    const line = complianceSummary({ status: 'documents', contract_signed_at: null });
    expect(line).toBe('Onboarding in progress — not bookable yet. Contract not yet signed.');
    expect(line).not.toMatch(/Compliant and bookable/);
  });

  // Every branch: no clause contradicts another, "Compliant and bookable"
  // belongs to a compliant worker alone, a contract is "not yet signed"
  // only for somebody still onboarding, and no section number is printed.
  it.each([
    ['compliant', false, null, 'Documents verified, quiz passed. Compliant and bookable.'],
    ['blocked', false, null, 'Blocked — not bookable until the block is lifted.'],
    ['inactive', false, null, 'Left through the app — not bookable.'],
    [
      'inactive',
      false,
      '2026-07-12T13:42:00Z',
      'Left through the app — not bookable. Contract signed electronically: 12.07.2026 14:42 UK time',
    ],
    ['rejected', false, null, 'Application rejected — not bookable.'],
    ['removed', true, null, 'Removed — personal data anonymised; the history stays.'],
    ['compliant', true, null, 'Removed — personal data anonymised; the history stays.'],
    [
      'interview_requested',
      false,
      null,
      'Onboarding in progress — not bookable yet. Contract not yet signed.',
    ],
    [
      'contract',
      false,
      '2026-07-12T13:42:00Z',
      'Onboarding in progress — not bookable yet. Contract signed electronically: 12.07.2026 14:42 UK time',
    ],
  ])('status %s (removed %s, signed %s) reads "%s"', (status, removed, signed, expected) => {
    const line = complianceSummary({ status, removed, contract_signed_at: signed });
    expect(line).toBe(expected);
    if (status !== 'compliant' || removed) expect(line).not.toMatch(/Compliant and bookable/);
    if (signed) expect(line).not.toMatch(/not yet signed/);
    expect(line).not.toMatch(/§|RULE-/);
  });
});

describe('time zones (§1.8)', () => {
  it('states UK time on an audit stamp, and converts BST correctly', () => {
    // 13:42 UTC in July is 14:42 in London.
    expect(formatUkStamp('2026-07-12T13:42:00Z')).toBe('12.07.2026 14:42 UK time');
  });

  it('shows a scheduled window in UK time', () => {
    expect(formatUkWindow('2026-09-16T10:00:00Z', '2026-09-16T15:00:00Z')).toBe('11:00 – 16:00');
  });

  it('renders a missing stamp as a dash rather than Invalid Date', () => {
    expect(formatUkStamp(null)).toBe('—');
    expect(formatUkStamp('not a date')).toBe('—');
  });

  it("stamps a violation in the viewer's own zone, as the monitor does (§9.5, §9.6)", () => {
    // 16:03 UTC on Thu 17 Sep 2026 is 17:03 in London and 18:03 in Madrid.
    expect(formatLocalStamp('2026-09-17T16:03:00Z', 'Europe/London')).toBe('Thu 17 Sep · 17:03');
    expect(formatLocalStamp('2026-09-17T16:03:00Z', 'Europe/Madrid')).toBe('Thu 17 Sep · 18:03');
    expect(formatLocalStamp(null, 'Europe/London')).toBe('—');
  });
});

describe('documents (§9.6)', () => {
  it('puts what needs a decision first and history last', () => {
    const rows = [
      doc({ id: 'old', review_status: 'superseded', superseded: true }),
      doc({ id: 'live' }),
      doc({ id: 'review', review_status: 'pending' }),
    ];
    expect([...rows].sort(documentOrder).map((row) => row.id)).toEqual(['review', 'live', 'old']);
  });
});

describe('shift outcomes (§9.6)', () => {
  it('names a worked shift', () => {
    expect(shiftOutcome(SHIFT)).toBe('Worked');
  });

  it('does not call a turned-away worker a no-show', () => {
    // RULE-15 pays someone turned away at the door on time. Labelling it
    // a no-show on their profile reads as their fault.
    expect(shiftOutcome({ ...SHIFT, kind: 'turned_away' })).toBe('Turned away (buffer)');
  });

  it('separates a self-cancellation from a cancellation', () => {
    expect(
      shiftOutcome({ ...SHIFT, booking_status: 'cancelled', kind: null, self_cancelled: true }),
    ).toBe('Self-cancelled');
    expect(
      shiftOutcome({ ...SHIFT, booking_status: 'cancelled', kind: null, self_cancelled: false }),
    ).toBe('Cancelled');
  });

  it('names a hand-over as one, not as a self-cancellation (ADR-0046)', () => {
    // take_offered_shift sets self_cancelled = true on the original booking
    // too (the event bar, Q15) — the cause is what tells the two apart.
    expect(
      shiftOutcome({
        ...SHIFT,
        booking_status: 'cancelled',
        kind: null,
        cancel_cause: 'handed_over',
        self_cancelled: true,
      }),
    ).toBe('Handed over (offered up)');
    expect(
      shiftOutcome({
        ...SHIFT,
        booking_status: 'cancelled',
        kind: null,
        cancel_cause: 'self_cancel',
        self_cancelled: true,
      }),
    ).toBe('Self-cancelled');
  });
});

describe('payable hours (RULE-01)', () => {
  it('reports the figure the database settled', () => {
    expect(payableHours(SHIFT)).toBe('5 h');
    expect(
      payableHours({ ...SHIFT, pay: { status: 'settled', payableMin: 390, floorApplied: false } }),
    ).toBe('6.5 h');
  });

  it('shows a dash rather than a zero when there is no verdict yet', () => {
    // A shift with no pay row has not been settled; printing "0 h" would
    // claim it was worked for nothing.
    expect(payableHours({ ...SHIFT, pay: null })).toBe('—');
  });
});

describe('feedback (§9.10)', () => {
  const entry = (over: Partial<FeedbackRow>): FeedbackRow => ({
    id: 'f1',
    author_kind: 'client',
    author_name: 'Leonardo Hotel',
    rating: 5,
    text: 'Excellent',
    read_at: null,
    counts_toward_rating: false,
    created_at: '2026-09-06T10:00:00Z',
    event_title: 'Gala Dinner',
    event_date: '2026-09-05',
    ...over,
  });

  it('says an unread client entry is not in the rating yet', () => {
    expect(feedbackState(entry({}))).toBe('Unread — not in the rating yet');
  });

  it('and that a read one is', () => {
    expect(feedbackState(entry({ read_at: '2026-09-07T09:00:00Z' }))).toBe('Read');
  });

  it('marks an office entry as one — it counts immediately', () => {
    expect(feedbackState(entry({ author_kind: 'office' }))).toBe('Office entry');
  });
});

describe('the manager buttons (§9.6, §2.12, §1.7)', () => {
  it('offers Reset to candidate only on a blocked, rejected or inactive profile', () => {
    expect(canReset('blocked')).toBe(true);
    expect(canReset('rejected')).toBe(true);
    expect(canReset('inactive')).toBe(true);
    expect(canReset('compliant')).toBe(false);
    expect(canReset('documents')).toBe(false);
  });

  it('offers nothing on a removed profile, which stays openable', () => {
    expect(isActionable('removed')).toBe(false);
    expect(isActionable('compliant')).toBe(true);
  });

  it('offers Block only where §2.12 has the edge — compliant, not a leaver or a candidate', () => {
    expect(canBlock('compliant')).toBe(true);
    expect(canBlock('inactive')).toBe(false);
    expect(canBlock('rejected')).toBe(false);
    expect(canBlock('documents')).toBe(false);
    expect(canBlock('blocked')).toBe(false);
    expect(canBlock('additional_info')).toBe(false);
  });
});

describe('the blocked banner says how THIS block lifts (§9.6, §4.3, §10.7)', () => {
  it('a document block lifts by itself once the document is verified', () => {
    const banner = blockBanner({ block_kind: 'auto_document', block_reason: null });
    expect(banner.title).toBe('Blocked automatically — a document is out of date');
    expect(banner.detail).toMatch(/lifts by itself once the document is verified/);
  });

  it('a conviction review does NOT lift "once the document is verified"', () => {
    const banner = blockBanner({
      block_kind: 'conviction_review',
      block_reason: 'Criminal conviction declared — under review',
    });
    expect(banner.title).toBe('Blocked — Criminal conviction declared — under review');
    expect(banner.detail).not.toMatch(/document is verified/);
    expect(banner.detail).toMatch(/Verify it on the Documents tab/);
    expect(banner.detail).toMatch(/reject it and it becomes a manual block/);
  });

  it('a manual block is lifted by a manager only, and says so', () => {
    const banner = blockBanner({ block_kind: 'manual', block_reason: 'Client complaint' });
    expect(banner.title).toBe('Blocked — Client complaint');
    expect(banner.detail).toMatch(/Only a manager’s Unblock lifts it/);
  });

  it('prints no section number', () => {
    for (const kind of ['auto_document', 'manual', 'conviction_review', null] as const) {
      const banner = blockBanner({ block_kind: kind, block_reason: null });
      expect(`${banner.title} ${banner.detail}`).not.toMatch(/§|RULE-/);
    }
  });
});

describe('hours this week is worked / limit (§9.6)', () => {
  it('shows worked hours over the cap, with booked underneath', () => {
    expect(
      hoursThisWeek({ weekly_worked_hours: 8, weekly_booked_hours: 18, weekly_cap_hours: 20 }),
    ).toEqual({ value: '8 / 20', booked: '18 h booked', tone: 'default' });
  });

  it('is amber once the committed hours reach the cap, even while fewer are worked', () => {
    expect(
      hoursThisWeek({ weekly_worked_hours: 12, weekly_booked_hours: 20, weekly_cap_hours: 20 })
        .tone,
    ).toBe('warn');
  });

  it('reads numeric strings and fractions the way the office does', () => {
    expect(
      hoursThisWeek({
        weekly_worked_hours: '7.5000',
        weekly_booked_hours: '48',
        weekly_cap_hours: 48,
      }),
    ).toEqual({ value: '7.5 / 48', booked: '48 h booked', tone: 'warn' });
  });

  it('has no cap to show when there is no ceiling', () => {
    expect(
      hoursThisWeek({ weekly_worked_hours: null, weekly_booked_hours: 60, weekly_cap_hours: null }),
    ).toEqual({ value: '0 / —', booked: '60 h booked', tone: 'default' });
  });
});

describe('labels, never enums (§9.6)', () => {
  it("names a declaration's review state", () => {
    expect(reviewLabel('pending')).toBe('Under review');
    expect(reviewLabel('verified')).toBe('Verified');
    expect(reviewLabel('rejected')).toBe('Rejected');
    expect(reviewLabel('superseded')).toBe('Superseded');
  });

  it('never prints a raw booking status', () => {
    expect(shiftOutcome({ ...SHIFT, kind: null, booking_status: 'closed' })).toBe(
      'Did not go ahead',
    );
    expect(shiftOutcome({ ...SHIFT, kind: null, booking_status: 'worked' })).toBe('Worked');
    expect(shiftOutcome({ ...SHIFT, kind: null, booking_status: 'something_new' })).toBe('Other');
  });
});

describe('the Shifts tab range (wireframe: Last 90 days / All)', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  const rows = [
    { id: 'future', starts_at: '2026-10-02T17:00:00Z' },
    { id: 'recent', starts_at: '2026-09-01T17:00:00Z' },
    { id: 'edge', starts_at: '2026-06-27T12:00:00Z' },
    { id: 'old', starts_at: '2026-06-01T17:00:00Z' },
  ];

  it('keeps the last 90 days and anything still ahead', () => {
    expect(shiftsInRange(rows, '90', now).map((row) => row.id)).toEqual([
      'future',
      'recent',
      'edge',
    ]);
  });

  it('All is everything', () => {
    expect(shiftsInRange(rows, 'all', now)).toHaveLength(4);
  });
});
