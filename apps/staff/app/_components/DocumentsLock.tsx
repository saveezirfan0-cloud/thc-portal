import Link from 'next/link';
import { Alert } from '@thc/ui';
import { describeBlockers } from '../profile/lock';
import { HELP_EMAIL } from '../profile/types';

/**
 * Lock case 1 — §4.3, §10.7. The ONE lock with something behind it.
 *
 * The other four cases are terminal and are `profile/_components/
 * LockScreen.tsx`'s; this is the case that one does not draw, because it
 * is not a terminal screen: the worker keeps Documents, keeps their
 * profile and keeps their bank details, and only Shifts, Invites and Radar
 * close. What lives here is what those three tabs show when a locked
 * worker reaches them anyway — from a stale push, the back button or a
 * typed URL.
 *
 * Not a redirect to Documents. §10.1 LOCKS the tab rather than moving the
 * worker, and a silent bounce out of a notification they just tapped reads
 * as an app that has lost their shift.
 *
 * The reason comes from `describeBlockers()` (#42) rather than from a
 * `because` flag of our own: it reads the same `compliance_blockers()`
 * output §4.3 unblocks on, so the screen names the actual document —
 * "1 expired document" — instead of guessing from the status.
 */
/** §10.7 step 5's first sentence — the same words `describeBlockers()` uses. */
const CONVICTION_PAUSED =
  'We’ve paused your upcoming shifts while the office reviews your declaration, and we’ll be in touch.';

export function documentsNotice(
  blockers: readonly string[],
  blockKind: 'auto_document' | 'manual' | 'conviction_review' | null,
  onboarding: boolean,
): { tone: 'coral' | 'amber' | 'cyan'; headline: string; detail: string } {
  if (onboarding) {
    return {
      tone: 'cyan',
      headline: 'Your documents are with the office.',
      detail:
        'Shifts, Invites and Radar open as soon as everything is verified and in date. You’ll get a notification the moment that happens.',
    };
  }

  const described = describeBlockers(blockers);

  if (blockKind === 'conviction_review' || blockers.includes('conviction_unreviewed')) {
    return {
      // The wireframe's post-submit alert is cyan: this is information, not
      // a warning (§10.7 "factual rather than punitive").
      tone: 'cyan',
      headline: 'Thanks for telling us.',
      // §10.7 step 5, word for word: "Thanks for telling us. We've paused
      // your upcoming shifts while the office reviews your declaration, and
      // we'll be in touch. If you need to speak to someone, contact us at:
      // admin@thehospitalitycompany.co.uk." The declaration is never read
      // back to them — and an expired document on top does not change the
      // copy, because the declaration is what the worker just did.
      detail: `${CONVICTION_PAUSED} If you need to speak to someone, contact us at: ${HELP_EMAIL}.`,
    };
  }

  if (!described) {
    // Blocked, with nothing `compliance_blockers()` can name. That happens
    // when a block carries no `block_kind` — #42's rule reads anything
    // that is not 'manual' as the documents case, so this screen is where
    // such a row lands. Telling that worker to "update your document"
    // would send them uploading something that cannot unblock them, so
    // this says the one thing that is true of every block instead.
    return {
      tone: 'coral',
      headline: 'Your account is blocked.',
      detail: `Shifts, Invites and Radar are closed. There is nothing for you to upload — please contact the office at: ${HELP_EMAIL}`,
    };
  }

  return {
    tone: 'coral',
    headline: 'You have been blocked — update your document.',
    detail: `${described} You’ve been removed from your upcoming shifts and your invitations have been withdrawn.`,
  };
}

export function DocumentsOnlyNotice({
  blockers,
  blockKind,
  onboarding,
}: {
  blockers: readonly string[];
  blockKind: 'auto_document' | 'manual' | 'conviction_review' | null;
  onboarding: boolean;
}) {
  const notice = documentsNotice(blockers, blockKind, onboarding);
  return (
    <Alert tone={notice.tone}>
      <b>{notice.headline}</b>
      <br />
      <span className="xs">{notice.detail}</span>
    </Alert>
  );
}

/** What a locked Shifts / Invites / Radar shows (§10.1 case 1). */
export function TabLockedScreen({
  blockers,
  blockKind,
  onboarding,
}: {
  blockers: readonly string[];
  blockKind: 'auto_document' | 'manual' | 'conviction_review' | null;
  onboarding: boolean;
}) {
  return (
    <>
      <DocumentsOnlyNotice blockers={blockers} blockKind={blockKind} onboarding={onboarding} />
      <div className="static-screen">
        <h2>{onboarding ? 'Not open to you yet' : 'Locked until your documents are in order'}</h2>
        <p>
          Shifts, Invites and Radar are closed while your compliance is outstanding. Your Documents,
          under Profile, stay open to you — everything reopens automatically once the office has
          verified what is missing and nothing else has expired.
        </p>
        {onboarding ? (
          // §10.3: for a candidate the wizard is the way forward.
          <Link className="btn primary block" href="/onboarding">
            Continue onboarding
          </Link>
        ) : (
          // Documents left the nav for the Profile tab (ADR-0041), so the
          // one thing this worker can do gets a button of its own here
          // rather than a two-tap detour.
          <Link className="btn primary block" href="/documents">
            Go to Documents
          </Link>
        )}
      </div>
    </>
  );
}
