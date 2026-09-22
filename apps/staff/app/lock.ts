/**
 * App lock — Scope §10.1, four cases, and they are four for a reason.
 *
 *   1. AUTO-BLOCK ON DOCUMENTS (§4.3). Not compliant, or an expired
 *      document, or a conviction declaration under review (§10.7). There
 *      IS something the worker can do, so Documents stays open and the
 *      other three tabs are locked until the full compliance re-check
 *      passes. Verifying one document alone does not unblock.
 *   2. MANUAL BLOCK by a manager (§9.6). There is nothing for the worker
 *      to fix, so Documents is NOT offered either — offering it would
 *      send them off uploading a document that changes nothing. A static
 *      "Your account is on hold" screen, and THE MANAGER'S REASON IS
 *      NEVER SHOWN. It is not loaded by this module at all.
 *   3. REJECTED after three quiz failures (§2.9). A terminal screen
 *      carrying THC's own wording, identical to email E4.
 *   4. LEAVER via Request my P45 (§10.6). Everything closed except
 *      Payment information, so their earnings history stays reachable.
 *
 * A GDPR-removed worker cannot sign in at all (§1.7), so no screen
 * applies — but if a session outlives the removal, `removed` is handled
 * rather than falling through to a normal app.
 *
 * The decision is a pure function of four fields so the four cases can be
 * tested without a database; collapsing them into "blocked" is the single
 * most likely way to get §10.1 wrong.
 */

export type StaffStatus =
  | 'interview_requested'
  | 'interview_completed'
  | 'documents'
  | 'quiz'
  | 'additional_info'
  | 'contract'
  | 'compliant'
  | 'blocked'
  | 'inactive'
  | 'rejected'
  | 'removed';

export type BlockKind = 'auto_document' | 'manual' | 'conviction_review';

export interface WorkerLockFacts {
  status: StaffStatus;
  /** Never carries the reason — only which KIND of block it is. */
  blockKind: BlockKind | null;
  quizAttempts: number;
  leftAt: string | null;
}

export type Lock =
  | { kind: 'none' }
  | { kind: 'documents'; because: 'compliance' | 'conviction' | 'onboarding' }
  | { kind: 'hold' }
  | { kind: 'rejected'; quiz: boolean }
  | { kind: 'leaver'; leftAt: string | null }
  | { kind: 'removed' };

/** The onboarding statuses: the wizard's, not the app's (§10.3). */
const ONBOARDING: StaffStatus[] = [
  'interview_requested',
  'interview_completed',
  'documents',
  'quiz',
  'additional_info',
  'contract',
];

export function lockFor(worker: WorkerLockFacts): Lock {
  if (worker.status === 'removed') return { kind: 'removed' };

  // §10.6: `left_at` is set at the moment of the request, and the status
  // goes inactive. Either alone is enough — a leaver must never be shown
  // the working screens while a job catches up.
  if (worker.status === 'inactive' || worker.leftAt !== null) {
    return { kind: 'leaver', leftAt: worker.leftAt };
  }

  if (worker.status === 'rejected') {
    // §2.9 is the rejection this screen has copy for. A rejection from
    // anywhere else gets the neutral version rather than being told they
    // failed a quiz they may never have sat.
    return { kind: 'rejected', quiz: worker.quizAttempts >= 3 };
  }

  if (worker.status === 'blocked') {
    if (worker.blockKind === 'auto_document') return { kind: 'documents', because: 'compliance' };
    if (worker.blockKind === 'conviction_review') {
      return { kind: 'documents', because: 'conviction' };
    }
    // 'manual', and also a block with no kind recorded. Defaulting to the
    // hold screen is the safe end of the choice: the hold screen is true
    // of any block ("contact the office"), whereas showing the documents
    // screen tells a manually blocked worker to upload a document that
    // will not unblock them, and implies a reason we must not imply.
    return { kind: 'hold' };
  }

  if (ONBOARDING.includes(worker.status)) return { kind: 'documents', because: 'onboarding' };

  return { kind: 'none' };
}

/** Which of the four tabs this lock leaves reachable (§10.1). */
export function reachableTabs(lock: Lock): string[] {
  switch (lock.kind) {
    case 'none':
      return ['/documents', '/shifts', '/invites', '/radar'];
    case 'documents':
      return ['/documents'];
    default:
      // Manual hold, quiz rejection and the leaver screen all close every
      // tab. The leaver keeps Payment information, which is not a tab.
      return [];
  }
}
