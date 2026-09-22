import { describe, expect, it } from 'vitest';
import { lockFor, reachableTabs } from '../lock';
import type { WorkerLockFacts } from '../lock';

/**
 * §10.1's four app-lock cases. They are four because they mean four
 * different things to the worker, and the failure mode this file exists to
 * prevent is collapsing them into "blocked".
 */
const worker = (facts: Partial<WorkerLockFacts> = {}): WorkerLockFacts => ({
  status: 'compliant',
  blockKind: null,
  quizAttempts: 0,
  leftAt: null,
  ...facts,
});

describe('app lock (§10.1)', () => {
  it('a compliant worker is not locked and keeps all four tabs', () => {
    expect(lockFor(worker())).toEqual({ kind: 'none' });
    expect(reachableTabs(lockFor(worker()))).toHaveLength(4);
  });

  it('case 1 — an expired document leaves ONLY Documents (§4.3)', () => {
    const lock = lockFor(worker({ status: 'blocked', blockKind: 'auto_document' }));
    expect(lock).toEqual({ kind: 'documents', because: 'compliance' });
    expect(reachableTabs(lock)).toEqual(['/documents']);
  });

  it('case 1 — a conviction under review is the same lock with its own copy (§10.7)', () => {
    const lock = lockFor(worker({ status: 'blocked', blockKind: 'conviction_review' }));
    expect(lock).toEqual({ kind: 'documents', because: 'conviction' });
    expect(reachableTabs(lock)).toEqual(['/documents']);
  });

  it('case 2 — a manual block offers NOTHING, not even Documents (§9.6)', () => {
    const lock = lockFor(worker({ status: 'blocked', blockKind: 'manual' }));
    expect(lock).toEqual({ kind: 'hold' });
    // The worker has nothing to fix, so there is no tab to send them to.
    expect(reachableTabs(lock)).toEqual([]);
  });

  it('a block with no kind recorded is treated as a manual hold, never as documents', () => {
    // Safe end of the choice: "contact the office" is true of any block,
    // whereas the documents screen tells them to upload something that
    // will not unblock them.
    expect(lockFor(worker({ status: 'blocked', blockKind: null }))).toEqual({ kind: 'hold' });
  });

  it('case 3 — three quiz failures is the terminal H&S screen (§2.9)', () => {
    expect(lockFor(worker({ status: 'rejected', quizAttempts: 3 }))).toEqual({
      kind: 'rejected',
      quiz: true,
    });
  });

  it('a rejection that is not the quiz does not claim it was', () => {
    expect(lockFor(worker({ status: 'rejected', quizAttempts: 0 }))).toEqual({
      kind: 'rejected',
      quiz: false,
    });
  });

  it('case 4 — a leaver is locked to the leaver screen (§10.6)', () => {
    const lock = lockFor(worker({ status: 'inactive', leftAt: '2026-09-18T09:00:00Z' }));
    expect(lock).toEqual({ kind: 'leaver', leftAt: '2026-09-18T09:00:00Z' });
    expect(reachableTabs(lock)).toEqual([]);
  });

  it('`left_at` alone is enough, before any job has moved the status', () => {
    expect(lockFor(worker({ status: 'compliant', leftAt: '2026-09-18T09:00:00Z' })).kind).toBe(
      'leaver',
    );
  });

  it('a removed worker (§1.7) never falls through to a working app', () => {
    expect(lockFor(worker({ status: 'removed' }))).toEqual({ kind: 'removed' });
  });

  it('every onboarding status lands on Documents, not on Shifts (§10.3)', () => {
    for (const status of [
      'interview_requested',
      'interview_completed',
      'documents',
      'quiz',
      'additional_info',
      'contract',
    ] as const) {
      const lock = lockFor(worker({ status }));
      expect(lock).toEqual({ kind: 'documents', because: 'onboarding' });
      expect(reachableTabs(lock)).toEqual(['/documents']);
    }
  });

  it('a leaver outranks a block: the P45 screen is the one they must see', () => {
    const lock = lockFor(
      worker({ status: 'inactive', blockKind: 'manual', leftAt: '2026-09-18T09:00:00Z' }),
    );
    expect(lock.kind).toBe('leaver');
  });
});
