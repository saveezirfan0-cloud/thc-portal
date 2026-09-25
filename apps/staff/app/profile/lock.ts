import type { StaffProfile } from './types';

/**
 * App lock — §10.1, `wireframes/staff/locks.html`.
 *
 * The scope names four cases and a fifth non-case, and they are not
 * interchangeable. Each one decides a different thing: which tabs exist,
 * whether the worker has any action at all, and what the screen says. They
 * are resolved here, once, as a pure function of the profile, because the
 * same answer is needed by the bottom nav, by every screen's guard and by
 * the Playwright seeds — and three copies of this ordering would be three
 * chances to show a blocked worker the Documents tab.
 *
 *   documents   (1) Not compliant, or a document has expired (§4.3). ONLY
 *               Documents is reachable. The worker has something to fix,
 *               so they are shown it.
 *   hold        (2) A manager blocked them by hand (§9.6). There is
 *               nothing to fix, so Documents is not offered either — a
 *               static screen and the office's address, and never the
 *               manager's reason.
 *   quiz_failed (3) Rejected after three failed H&S attempts (§2.9). The
 *               wizard is replaced by THC's own copy, word for word.
 *   leaver      (4) They left through Request my P45 (§10.6). Everything
 *               closed except Payment information, so their earnings
 *               history stays available to them.
 *   removed     GDPR removal (§1.7) — "cannot log in at all, so no screen
 *               applies". It is here so that a session that somehow
 *               survives the removal lands somewhere terminal rather than
 *               on a working app.
 *
 * Order is the whole rule. A leaver can also be non-compliant; a manually
 * blocked worker can also have an expired passport. Showing either of them
 * the Documents tab would offer an action that changes nothing.
 */
export type AppLock =
  'none' | 'onboarding' | 'documents' | 'hold' | 'quiz_failed' | 'rejected' | 'leaver' | 'removed';

/** §2.9 — three attempts is the maximum permitted at this stage. */
export const QUIZ_MAX_ATTEMPTS = 3;

/** The statuses that mean the worker is still inside the §10.3 wizard. */
const ONBOARDING: ReadonlySet<string> = new Set([
  'interview_requested',
  'interview_completed',
  'documents',
  'quiz',
  'additional_info',
  'contract',
]);

export function appLock(
  profile: Pick<
    StaffProfile,
    'status' | 'blockKind' | 'quizAttempts' | 'blockers' | 'rejectionCause'
  >,
): AppLock {
  if (profile.status === 'removed') return 'removed';
  if (profile.status === 'inactive') return 'leaver';

  if (profile.status === 'rejected') {
    // §2.9's rejection and a manager's rejection are the same status but
    // not the same screen: only the quiz one carries E4's copy. The cause
    // the database stamped decides; the attempt count is the fallback for
    // a `staff_me()` that does not expose it yet — and it is wrong for the
    // candidate who passed on the third attempt and was rejected later.
    if (profile.rejectionCause)
      return profile.rejectionCause === 'quiz_failed' ? 'quiz_failed' : 'rejected';
    return profile.quizAttempts >= QUIZ_MAX_ATTEMPTS ? 'quiz_failed' : 'rejected';
  }

  if (profile.status === 'blocked') {
    // A manual block is the only one with no action behind it. A
    // conviction under review locks to Documents with its own copy
    // (§10.7), which is the auto-block's screen, not the hold screen.
    return profile.blockKind === 'manual' ? 'hold' : 'documents';
  }

  if (ONBOARDING.has(profile.status)) return 'onboarding';

  // Compliant on the row, but §4.3 re-checks the documents themselves: an
  // expired passport blocks before the nightly job gets to it.
  //
  // §10.1 case 1 is "not compliant OR has an expired document" — and a
  // `document_unverified:*` blocker on a COMPLIANT worker is neither. It is
  // a replacement in review (or re-uploaded after a rejection) while the
  // verified one it replaces still counts: `current_verified_docs()` keeps
  // measuring expiry off that one, compliance_daily keeps them in the pool,
  // and the wireframe says it in words — "You stay compliant while a
  // replacement is in review before the old one expires". Locking them here
  // would close Shifts on a worker the database is still rostering.
  return profile.blockers.some(locksCompliantWorker) ? 'documents' : 'none';
}

/** The blockers that lock a worker whose status is still `compliant` (§10.1 case 1). */
function locksCompliantWorker(blocker: string): boolean {
  return blocker.startsWith('document_expired:') || blocker === 'conviction_unreviewed';
}

/** Which of the four tabs a lock leaves reachable (§10.1). */
export function reachableTabs(lock: AppLock): readonly string[] {
  switch (lock) {
    case 'none':
      return ['/documents', '/shifts', '/invites', '/radar'];
    case 'documents':
      return ['/documents'];
    default:
      // hold · quiz_failed · rejected · leaver · removed · onboarding:
      // a static screen with no navigation behind it.
      return [];
  }
}

/**
 * Whether the bottom navigation is drawn at all.
 *
 * The leaver screen keeps it with all four tabs greyed out — the wireframe
 * is explicit about that, and it is the honest picture: those screens still
 * exist, they are just closed to this worker now. A manual hold and a
 * rejected candidate get no navigation, because §10.1 says the Documents
 * tab "is not shown as an action either" when there is nothing to fix, and
 * a row of dead tabs would read as one.
 */
export function showsBottomNav(lock: AppLock): boolean {
  return lock === 'none' || lock === 'documents' || lock === 'leaver';
}

/**
 * Payment information is the one screen a leaver keeps (§10.6 step 7): "the
 * worker can still sign in and still reach Payment information, so their
 * earnings history stays available to them after they leave."
 */
export function canReachPayments(lock: AppLock): boolean {
  return lock === 'none' || lock === 'documents' || lock === 'leaver';
}

/** The everyday profile screens. A leaver's details are frozen. */
export function canReachProfileDetails(lock: AppLock): boolean {
  return lock === 'none' || lock === 'documents';
}

export type P45Availability =
  { available: true } | { available: false; hint: string } | { available: false; hint: null };

/**
 * §10.6 step 3: "A worker who is checked in cannot submit the request at
 * all: the action is disabled for the duration of that shift, with the hint
 * 'Available once you've checked out'."
 *
 * The hint is the scope's words. `request_p45()` refuses the same case with
 * `on_shift`, so this greys out a button that would otherwise fail rather
 * than inventing a second rule.
 */
export function p45Availability(
  profile: Pick<StaffProfile, 'status' | 'checkedIn' | 'blockKind' | 'quizAttempts' | 'blockers'>,
): P45Availability {
  const lock = appLock(profile);
  if (lock === 'leaver' || lock === 'removed' || lock === 'rejected' || lock === 'quiz_failed') {
    // Already gone. The action is not disabled, it is absent.
    return { available: false, hint: null };
  }
  if (profile.checkedIn) {
    return { available: false, hint: "Available once you've checked out" };
  }
  return { available: true };
}

/**
 * The document that put the worker in lock case 1, for the alert at the top
 * of Documents. `compliance_blockers()` returns machine reasons; this turns
 * one into the noun the worker recognises. Deliberately generic where the
 * reason is a conviction under review — §10.7's copy is factual, not
 * punitive, and never repeats the declaration back at them.
 */
export function describeBlockers(blockers: readonly string[]): string | null {
  if (blockers.length === 0) return null;
  if (blockers.includes('conviction_unreviewed')) {
    return 'We’ve paused your upcoming shifts while the office reviews your declaration, and we’ll be in touch.';
  }
  const expired = blockers.filter((b) => b.startsWith('document_expired:')).length;
  const unverified = blockers.filter((b) => b.startsWith('document_unverified:')).length;
  const parts: string[] = [];
  if (expired > 0) parts.push(`${expired} expired ${expired === 1 ? 'document' : 'documents'}`);
  if (unverified > 0) {
    parts.push(
      `${unverified} ${unverified === 1 ? 'document' : 'documents'} awaiting verification`,
    );
  }
  if (parts.length === 0) return 'Your documents need attention.';
  return `${parts.join(' and ')}. Upload a valid document; once the office verifies it — and everything else is in date — you’re unblocked automatically.`;
}
