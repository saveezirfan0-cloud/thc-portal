import { describe, expect, it } from 'vitest';
import { STAFF_STATUSES, canTransitionStaff } from '@thc/domain';
import {
  ACTION_TARGET,
  COLUMNS,
  additionalInfoComplete,
  aiBadge,
  blockerLabel,
  boardColumns,
  boardCounts,
  canResendActivation,
  candidateActions,
  cardLines,
  columnFor,
  parsePeriod,
  periodToRange,
  periodsProblem,
  phaseIndex,
  quizGate,
  rejectedColumn,
  rejectedPill,
  returningActions,
  stageAge,
  ukDaysBetween,
} from '../view-model';
import type { CandidateRow, ReturningRow, StaffStatus } from '../types';

const NOW = new Date('2026-09-23T10:00:00Z');

function candidate(over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: 'c-1',
    first_name: 'Hana',
    last_name: 'Kowalska',
    display_name: 'Hana Kowalska',
    email: 'hana.k@example.com',
    phone: '+44 7700 900456',
    dob: '2005-04-03',
    age: 21,
    applied_age_band: '21',
    photo_path: null,
    status: 'interview_requested',
    stage_entered_at: '2026-09-20T09:00:00Z',
    onboarding_started_at: '2026-09-10T08:58:00Z',
    applied_at: '2026-09-10T08:58:00Z',
    gdpr_consent_at: '2026-09-10T08:58:00Z',
    employee_id: null,
    rtw_branch: null,
    right_to_work_until: null,
    share_code: null,
    activated: false,
    role_names: [],
    role_ids: [],
    willo_linked: false,
    willo_review_url: null,
    willo_invited_at: null,
    willo_answers_done: null,
    willo_answers_total: null,
    willo_completed_at: null,
    willo_decision: null,
    willo_decided_at: null,
    willo_decided_via: null,
    docs_total: 0,
    docs_verified: 0,
    docs_pending: 0,
    docs_rejected: 0,
    last_doc_rejected_at: null,
    docs_missing: [],
    quiz_blockers: [],
    declaration_answer: null,
    declaration_status: null,
    quiz_attempts_used: 0,
    quiz_best_score: null,
    quiz_passed_at: null,
    hmrc_submitted_at: null,
    references_count: 0,
    bank_saved: false,
    ni_entered: false,
    contract_signed_at: null,
    contract_version: null,
    rejected_at: null,
    rejected_from: null,
    rejection_cause: null,
    rejection_reason: null,
    rejected_by_name: null,
    ...over,
  };
}

const EVERY_STATUS: StaffStatus[] = [...STAFF_STATUSES, 'additional_info'];

const ALL_IN = { hmrc_submitted_at: '2026-09-17T11:03:00Z', references_count: 2, bank_saved: true };

describe('columns (§2.2, ADR-0013)', () => {
  it('has the six approved columns in order', () => {
    expect(COLUMNS.map((c) => c.label)).toEqual([
      'Interview requested',
      'Interview completed',
      'Documents',
      'Quiz',
      'Additional info',
      'Contract',
    ]);
  });

  it('maps each onboarding status straight to its column', () => {
    for (const status of [
      'interview_requested',
      'interview_completed',
      'documents',
      'quiz',
    ] as const) {
      expect(columnFor(candidate({ status }))).toBe(status);
    }
  });

  it('puts a passed-quiz candidate under Additional info until steps 7-9 are all in', () => {
    expect(columnFor(candidate({ status: 'contract' }))).toBe('additional_info');
    expect(columnFor(candidate({ status: 'contract', ...ALL_IN, references_count: 1 }))).toBe(
      'additional_info',
    );
    expect(columnFor(candidate({ status: 'contract', ...ALL_IN, bank_saved: false }))).toBe(
      'additional_info',
    );
    expect(columnFor(candidate({ status: 'contract', ...ALL_IN }))).toBe('contract');
  });

  it('NI is optional, so it never holds a card back (§2.8)', () => {
    expect(additionalInfoComplete({ ...ALL_IN })).toBe(true);
  });

  it('takes Staff, leavers and removed people off the board entirely', () => {
    for (const status of ['compliant', 'blocked', 'inactive', 'removed'] as const) {
      expect(columnFor(candidate({ status }))).toBeNull();
    }
  });

  it('puts a rejected card in the column it was rejected from', () => {
    expect(columnFor(candidate({ status: 'rejected', rejected_from: 'documents' }))).toBe(
      'documents',
    );
    expect(columnFor(candidate({ status: 'rejected', rejected_from: 'contract', ...ALL_IN }))).toBe(
      'contract',
    );
    expect(columnFor(candidate({ status: 'rejected', rejected_from: 'contract' }))).toBe(
      'additional_info',
    );
  });

  it('places a rejection older than the stamp by its evidence', () => {
    expect(rejectedColumn(candidate({ status: 'rejected', rejection_cause: 'quiz_failed' }))).toBe(
      'quiz',
    );
    expect(rejectedColumn(candidate({ status: 'rejected', quiz_attempts_used: 3 }))).toBe('quiz');
    expect(rejectedColumn(candidate({ status: 'rejected', rejection_cause: 'willo' }))).toBe(
      'interview_completed',
    );
    expect(rejectedColumn(candidate({ status: 'rejected', docs_total: 2 }))).toBe('documents');
    expect(rejectedColumn(candidate({ status: 'rejected' }))).toBe('interview_completed');
  });
});

describe('every transition the board offers is legal (§2.12)', () => {
  it('candidate actions are all edges of canTransitionStaff, for every status', () => {
    for (const status of EVERY_STATUS) {
      for (const action of candidateActions(status)) {
        expect(STAFF_STATUSES as readonly string[]).toContain(status);
        expect(
          canTransitionStaff(status as (typeof STAFF_STATUSES)[number], ACTION_TARGET[action]),
        ).toBe(true);
      }
    }
  });

  it('Resend activation link is offered only to someone accepted who has not activated', () => {
    expect(canResendActivation('documents', false)).toBe(true);
    expect(canResendActivation('compliant', false)).toBe(true);
    expect(canResendActivation('documents', true)).toBe(false);
    for (const status of [
      'interview_requested',
      'interview_completed',
      'rejected',
      'inactive',
      'removed',
    ] as const) {
      expect(canResendActivation(status, false)).toBe(false);
    }
  });

  it('returning-applicant Reset is offered only where the machine has the edge', () => {
    for (const status of EVERY_STATUS) {
      const offered = returningActions(status).includes('reset');
      const legal =
        (STAFF_STATUSES as readonly string[]).includes(status) &&
        status !== 'interview_requested' &&
        canTransitionStaff(status as (typeof STAFF_STATUSES)[number], 'interview_requested');
      expect(offered).toBe(legal);
    }
    expect(returningActions('blocked')).toEqual(['reset', 'reject_application']);
    expect(returningActions('rejected')).toEqual(['reset', 'reject_application']);
    expect(returningActions('inactive')).toEqual(['reset', 'reject_application']);
    expect(returningActions('compliant')).toEqual(['reject_application']);
  });

  it('Accept exists only on Interview completed', () => {
    for (const status of EVERY_STATUS) {
      expect(candidateActions(status).includes('accept')).toBe(status === 'interview_completed');
    }
  });

  it('Reject candidate is on every onboarding stage and nowhere else', () => {
    const onboarding = [
      'interview_requested',
      'interview_completed',
      'documents',
      'quiz',
      'contract',
    ];
    for (const status of EVERY_STATUS) {
      expect(candidateActions(status).includes('reject')).toBe(onboarding.includes(status));
    }
  });

  it('rejection is final: a rejected profile offers nothing (§2.3)', () => {
    expect(candidateActions('rejected')).toEqual([]);
  });

  it('additional_info is outside the machine and offers nothing, as the database refuses it', () => {
    expect(candidateActions('additional_info')).toEqual([]);
  });

  it('never offers a skip over the quiz or the contract', () => {
    for (const status of EVERY_STATUS) {
      const targets = candidateActions(status).map((a) => ACTION_TARGET[a]);
      expect(targets).not.toContain('compliant');
      expect(targets).not.toContain('contract');
      expect(targets).not.toContain('quiz');
    }
  });
});

describe('the board', () => {
  const rows = [
    candidate({
      id: 'a',
      display_name: 'Noor Ahmed',
      status: 'interview_requested',
      stage_entered_at: '2026-09-20T09:00:00Z',
    }),
    candidate({
      id: 'b',
      display_name: 'Sam West',
      status: 'interview_requested',
      stage_entered_at: '2026-09-17T09:00:00Z',
    }),
    candidate({
      id: 'c',
      display_name: 'Mateo Garcia',
      status: 'documents',
      role_names: ['Bar Staff'],
    }),
    candidate({
      id: 'd',
      display_name: 'Carl Voss',
      status: 'rejected',
      rejected_from: 'interview_completed',
      rejection_cause: 'willo',
    }),
    candidate({
      id: 'e',
      display_name: 'Pavel Kral',
      status: 'rejected',
      rejection_cause: 'quiz_failed',
      rejected_from: 'quiz',
    }),
  ];
  const returning: ReturningRow[] = [
    {
      application_id: 'app-1',
      applied_at: '2026-09-23T08:00:00Z',
      applicant_name: 'Jonah West',
      matched_on: 'email_dob',
      staff_id: 's-9',
      existing_name: 'Jonah West',
      employee_id: 412,
      status: 'blocked',
      block_kind: 'auto_document',
      block_reason: null,
      rating: 4.5,
      reliability: 96,
      shifts_worked: 41,
    },
  ];
  const q = { filter: 'active' as const, query: '', roleName: '', reason: 'any' as const };

  it('Active hides rejected cards and shows the returning applicant first in Interview requested', () => {
    const columns = boardColumns(rows, returning, q);
    const first = columns[0]!;
    expect(first.returning.map((r) => r.application_id)).toEqual(['app-1']);
    expect(first.candidates.map((r) => r.id)).toEqual(['b', 'a']); // longest waiting first
    expect(first.count).toBe(3);
    expect(columns.flatMap((c) => c.candidates).some((r) => r.status === 'rejected')).toBe(false);
  });

  it('Rejected shows only rejected cards, each in its column, and no returning card', () => {
    const columns = boardColumns(rows, returning, { ...q, filter: 'rejected' });
    expect(
      columns.find((c) => c.key === 'interview_completed')!.candidates.map((r) => r.id),
    ).toEqual(['d']);
    expect(columns.find((c) => c.key === 'quiz')!.candidates.map((r) => r.id)).toEqual(['e']);
    expect(columns.every((c) => c.returning.length === 0)).toBe(true);
  });

  it('filters by reason on the Rejected view', () => {
    const columns = boardColumns(rows, returning, { ...q, filter: 'rejected', reason: 'willo' });
    expect(columns.flatMap((c) => c.candidates).map((r) => r.id)).toEqual(['d']);
  });

  it('searches by name and filters by role', () => {
    expect(
      boardColumns(rows, returning, { ...q, query: 'sam' })
        .flatMap((c) => c.candidates)
        .map((r) => r.id),
    ).toEqual(['b']);
    const byRole = boardColumns(rows, returning, { ...q, roleName: 'Bar Staff' });
    expect(byRole.flatMap((c) => c.candidates).map((r) => r.id)).toEqual(['c']);
    expect(byRole[0]!.returning).toEqual([]);
  });

  it('counts active (including returning applicants) and rejected', () => {
    expect(boardCounts(rows, returning)).toEqual({ active: 4, rejected: 2 });
  });

  it('labels the rejection by cause', () => {
    expect(rejectedPill({ rejection_cause: 'willo', rejected_by_name: null })).toBe(
      'Rejected · in Willo',
    );
    expect(rejectedPill({ rejection_cause: 'quiz_failed', rejected_by_name: null })).toBe(
      'Rejected · quiz failed 3×',
    );
    expect(rejectedPill({ rejection_cause: 'manager', rejected_by_name: 'Gisela M.' })).toBe(
      'Rejected · by Gisela M.',
    );
  });
});

describe('days in stage, in UK days (§1.8)', () => {
  it('counts calendar days in Europe/London, not 24-hour blocks', () => {
    // 23:30 UTC on 22 Sep is 00:30 BST on the 23rd: the same UK day as NOW.
    expect(ukDaysBetween('2026-09-22T23:30:00Z', NOW)).toBe(0);
    expect(ukDaysBetween('2026-09-22T22:30:00Z', NOW)).toBe(1);
  });

  it('turns amber at four days and coral at six', () => {
    expect(stageAge('2026-09-20T09:00:00Z', NOW).tone).toBe('ok');
    expect(stageAge('2026-09-19T09:00:00Z', NOW).tone).toBe('warn');
    expect(stageAge('2026-09-17T09:00:00Z', NOW)).toEqual({ days: 6, tone: 'bad', label: '6 d' });
  });
});

describe('card lines', () => {
  it('flags a Willo invite with no response for six days', () => {
    const row = candidate({ willo_linked: true, willo_invited_at: '2026-09-17T09:00:00Z' });
    expect(cardLines(row, 'interview_requested', NOW)[1]).toEqual({
      text: 'No response to the Willo invite in 6 days',
      tone: 'coral',
    });
  });

  it('says plainly when the candidate is not in Willo yet', () => {
    expect(cardLines(candidate(), 'interview_requested', NOW)[1]!.text).toMatch(/not connected/);
  });

  it('warns that a third quiz failure rejects', () => {
    const lines = cardLines(
      candidate({ status: 'quiz', quiz_attempts_used: 2, quiz_best_score: 70 }),
      'quiz',
      NOW,
    );
    expect(lines[0]!.text).toBe('Attempts 2 / 3 · best 70% (pass mark 80%)');
    expect(lines[1]).toEqual({
      text: 'One attempt left — a third failure rejects automatically (E4)',
      tone: 'amber',
    });
  });

  it('shows a rejected document and a Yes declaration waiting on the office', () => {
    const lines = cardLines(
      candidate({
        status: 'documents',
        rtw_branch: 'international_student',
        docs_total: 5,
        docs_verified: 3,
        docs_pending: 1,
        docs_rejected: 1,
        last_doc_rejected_at: '2026-09-14T10:00:00Z',
        declaration_answer: true,
        declaration_status: 'pending',
      }),
      'documents',
      NOW,
    );
    expect(lines.map((l) => l.text)).toEqual([
      'International student · 3 of 5 verified · 1 under review',
      '1 document rejected — awaiting re-upload (push N8 sent Mon 14 Sep)',
      'Criminal Record: Yes — needs manual Verify',
    ]);
  });

  it('summarises steps 7-9 on Additional info', () => {
    const lines = cardLines(
      candidate({
        status: 'contract',
        quiz_best_score: 90,
        hmrc_submitted_at: 'x',
        references_count: 2,
      }),
      'additional_info',
      NOW,
    );
    expect(lines[0]!.text).toBe('Quiz passed 90% · HMRC ✓ · References ✓ · Bank ✗');
  });
});

describe('the candidate profile', () => {
  it('puts a signed contract on the last step', () => {
    expect(
      phaseIndex(candidate({ status: 'compliant', contract_signed_at: '2026-09-18T08:14:00Z' })),
    ).toBe(5);
    expect(phaseIndex(candidate({ status: 'contract' }))).toBe(4);
    expect(phaseIndex(candidate({ status: 'documents' }))).toBe(2);
  });

  it('the quiz gate reads the database’s reasons in words', () => {
    expect(quizGate(candidate({ quiz_blockers: [] }))).toEqual({ unlocked: true, outstanding: [] });
    expect(
      quizGate(
        candidate({
          quiz_blockers: ['document_unverified:passport', 'conviction_unreviewed', 'share_code'],
        }),
      ).outstanding,
    ).toEqual([
      'Passport under review or rejected',
      'Criminal Record declaration (Yes) not yet verified',
      'Share code not entered',
    ]);
    expect(blockerLabel('university_term_dates_letter')).toBe(
      'University Term Dates Letter not uploaded',
    );
  });

  it('never shows a weak AI read as a number (§2.6)', () => {
    expect(aiBadge(0.96, false)).toEqual({ tone: 'hi', label: 'AI 96%' });
    expect(aiBadge(0.71, false)).toEqual({ tone: 'mid', label: 'AI 71%' });
    expect(aiBadge(0.41, false)).toEqual({ tone: 'manual', label: 'needs manual review' });
    expect(aiBadge(0.95, true)).toEqual({ tone: 'manual', label: 'needs manual review' });
    expect(aiBadge(null, false)).toBeNull();
  });
});

describe('term periods (+ Add period)', () => {
  it('reads a half-open daterange as inclusive days and writes it back', () => {
    const period = parsePeriod('[2026-12-13,2027-01-11)');
    expect(period).toEqual({ from: '2026-12-13', to: '2027-01-10' });
    expect(periodToRange(period!)).toBe('[2026-12-13,2027-01-11)');
  });

  it('rejects a period with a missing date or that ends before it starts', () => {
    expect(periodsProblem([{ from: '2027-03-27', to: '' }])).toBe('Period 1 needs both dates.');
    expect(periodsProblem([{ from: '2027-03-27', to: '2027-03-01' }])).toBe(
      'Period 1 ends before it starts.',
    );
    expect(periodsProblem([])).toBeNull();
  });
});
