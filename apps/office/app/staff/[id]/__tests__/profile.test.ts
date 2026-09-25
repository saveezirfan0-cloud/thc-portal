import { describe, expect, it } from 'vitest';
import {
  canBlock,
  canReset,
  complianceSummary,
  documentOrder,
  feedbackState,
  formatLocalStamp,
  formatUkStamp,
  formatUkWindow,
  hoursTone,
  isActionable,
  noShowTone,
  payableHours,
  shiftOutcome,
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
      'Blocked — see the reason above. Contract signed electronically: 12.07.2026 14:42 UK time',
    );
  });

  it('never calls a candidate "compliant and bookable"', () => {
    const line = complianceSummary({ status: 'documents', contract_signed_at: null });
    expect(line).toBe('Onboarding in progress. Contract not yet signed.');
    expect(line).not.toMatch(/bookable/);
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

  it('names a hand-over as one, not as a self-cancellation (ADR-0039)', () => {
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
