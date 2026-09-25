import { describe, expect, it } from 'vitest';
import {
  appLock,
  canReachPayments,
  canReachProfileDetails,
  describeBlockers,
  p45Availability,
  reachableTabs,
  showsBottomNav,
} from '../lock';
import type { StaffProfile } from '../types';

type LockInput = Pick<
  StaffProfile,
  'status' | 'blockKind' | 'quizAttempts' | 'blockers' | 'rejectionCause'
> & {
  checkedIn: boolean;
};

const base: LockInput = {
  status: 'compliant',
  blockKind: null,
  quizAttempts: 0,
  blockers: [],
  rejectionCause: null,
  checkedIn: false,
};

const worker = (over: Partial<LockInput> = {}): LockInput => ({ ...base, ...over });

describe('appLock — §10.1 four cases', () => {
  it('lets a compliant worker with no blockers through', () => {
    expect(appLock(worker())).toBe('none');
    expect(reachableTabs('none')).toEqual(['/shifts', '/invites', '/radar', '/profile']);
  });

  it('(1) leaves ONLY Profile — where Documents lives — when a document has expired', () => {
    const lock = appLock(worker({ blockers: ['document_expired:passport'] }));
    expect(lock).toBe('documents');
    // ADR-0035: Documents moved inside the Profile tab.
    expect(reachableTabs(lock)).toEqual(['/profile']);
  });

  it('(1) a compliant worker with a replacement in review is NOT locked (§4.3)', () => {
    // The old passport still counts until it expires; the database keeps
    // rostering them, so the app must not close Shifts on them.
    expect(appLock(worker({ blockers: ['document_unverified:passport'] }))).toBe('none');
  });

  it('(1) …but the same worker IS locked once the old one has expired', () => {
    expect(
      appLock(worker({ blockers: ['document_unverified:passport', 'document_expired:passport'] })),
    ).toBe('documents');
  });

  it('(1) an auto-block by status is the same case as an expired document', () => {
    expect(appLock(worker({ status: 'blocked', blockKind: 'auto_document' }))).toBe('documents');
  });

  it('(1) a conviction under review locks to Documents, not to the hold screen (§10.7)', () => {
    expect(appLock(worker({ status: 'blocked', blockKind: 'conviction_review' }))).toBe(
      'documents',
    );
  });

  it('(2) a manual block shows no Documents action at all', () => {
    const lock = appLock(worker({ status: 'blocked', blockKind: 'manual' }));
    expect(lock).toBe('hold');
    expect(reachableTabs(lock)).toEqual([]);
    expect(showsBottomNav(lock)).toBe(false);
  });

  it('(2) a manual block outranks an expired document — neither is fixable by the worker', () => {
    const lock = appLock(
      worker({
        status: 'blocked',
        blockKind: 'manual',
        blockers: ['document_expired:passport'],
      }),
    );
    expect(lock).toBe('hold');
  });

  it('(3) three failed quiz attempts is the terminal screen', () => {
    expect(appLock(worker({ status: 'rejected', quizAttempts: 3 }))).toBe('quiz_failed');
  });

  it('(3) a rejection that is not the quiz does not borrow E4’s copy', () => {
    expect(appLock(worker({ status: 'rejected', quizAttempts: 1 }))).toBe('rejected');
  });

  it('(4) a leaver keeps the nav, all four closed', () => {
    const lock = appLock(worker({ status: 'inactive' }));
    expect(lock).toBe('leaver');
    expect(reachableTabs(lock)).toEqual([]);
    expect(showsBottomNav(lock)).toBe(true);
  });

  it('(4) leaving outranks everything else on the record', () => {
    expect(
      appLock(
        worker({
          status: 'inactive',
          blockKind: 'manual',
          quizAttempts: 3,
          blockers: ['document_expired:passport'],
        }),
      ),
    ).toBe('leaver');
  });

  it('a removed worker is terminal (§1.7 — they cannot sign in at all)', () => {
    expect(appLock(worker({ status: 'removed' }))).toBe('removed');
  });

  it('an onboarding status routes to the wizard, not to a lock', () => {
    for (const status of ['interview_requested', 'documents', 'quiz', 'contract'] as const) {
      expect(appLock(worker({ status }))).toBe('onboarding');
    }
  });
});

describe('which screens a lock leaves reachable', () => {
  it('a leaver keeps Payment information and nothing else (§10.6 step 7)', () => {
    expect(canReachPayments('leaver')).toBe(true);
    expect(canReachProfileDetails('leaver')).toBe(false);
  });

  it('a manual hold reaches neither', () => {
    expect(canReachPayments('hold')).toBe(false);
    expect(canReachProfileDetails('hold')).toBe(false);
  });

  it('a document auto-block still has a profile and bank details', () => {
    expect(canReachPayments('documents')).toBe(true);
    expect(canReachProfileDetails('documents')).toBe(true);
  });
});

describe('p45Availability — §10.6 step 3', () => {
  it('is available to a compliant worker who is not checked in', () => {
    expect(p45Availability(worker())).toEqual({ available: true });
  });

  it('is disabled with the scope’s own hint while checked in', () => {
    expect(p45Availability(worker({ checkedIn: true }))).toEqual({
      available: false,
      hint: "Available once you've checked out",
    });
  });

  it('is disabled while checked in even for a blocked worker', () => {
    expect(
      p45Availability(worker({ status: 'blocked', blockKind: 'auto_document', checkedIn: true }))
        .available,
    ).toBe(false);
  });

  it('is absent, not disabled, for someone who has already left', () => {
    expect(p45Availability(worker({ status: 'inactive' }))).toEqual({
      available: false,
      hint: null,
    });
  });

  it('is absent for a rejected candidate — there is nothing to leave', () => {
    expect(p45Availability(worker({ status: 'rejected', quizAttempts: 3 }))).toEqual({
      available: false,
      hint: null,
    });
  });
});

describe('describeBlockers', () => {
  it('says nothing when there is nothing wrong', () => {
    expect(describeBlockers([])).toBeNull();
  });

  it('counts expired and unverified documents separately', () => {
    const text = describeBlockers([
      'document_expired:passport',
      'document_unverified:right_to_work',
    ]);
    expect(text).toContain('1 expired document');
    expect(text).toContain('1 document awaiting verification');
  });

  it('never repeats a conviction declaration back at the worker (§10.7)', () => {
    const text = describeBlockers(['conviction_unreviewed']);
    expect(text).toContain('reviews your declaration');
    expect(text).not.toContain('conviction');
  });
});

describe('appLock — which rejection (§2.9 quiz vs §2.3 manager / Willo)', () => {
  it('a third failed attempt is the quiz screen (E4 wording) when the cause says so', () => {
    expect(
      appLock(worker({ status: 'rejected', quizAttempts: 3, rejectionCause: 'quiz_failed' })),
    ).toBe('quiz_failed');
  });

  it('a candidate who passed on the third attempt and was rejected later is NOT told they failed the quiz', () => {
    // Three attempts on the row, the last one a pass; the manager pressed
    // Reject candidate at Contract (E2b). The count alone would say E4.
    expect(
      appLock(worker({ status: 'rejected', quizAttempts: 3, rejectionCause: 'manager' })),
    ).toBe('rejected');
    expect(appLock(worker({ status: 'rejected', quizAttempts: 3, rejectionCause: 'willo' }))).toBe(
      'rejected',
    );
  });

  it('falls back to the attempt count while staff_me() does not expose the cause', () => {
    expect(appLock(worker({ status: 'rejected', quizAttempts: 3, rejectionCause: null }))).toBe(
      'quiz_failed',
    );
    expect(appLock(worker({ status: 'rejected', quizAttempts: 1, rejectionCause: null }))).toBe(
      'rejected',
    );
  });
});
