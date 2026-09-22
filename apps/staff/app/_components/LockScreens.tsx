import type { ReactNode } from 'react';
import { Alert, Button, Pill } from '@thc/ui';
import type { Lock } from '../lock';

/**
 * The app-lock screens — §10.1, wireframes/staff/locks.html.
 *
 * Copy here is contractual, not decorative: the quiz rejection is THC's
 * own wording, identical to email E4, and the hold screen is the exact
 * sentence §10.1 specifies. Neither is paraphrased, and neither carries
 * anything the office knows and the worker must not (§9.6).
 *
 * `LockPanel` is a local component rather than `@thc/ui`'s `StaticScreen`
 * because the wireframe puts a status pill ABOVE the heading and more than
 * one paragraph below it, and `StaticScreen` renders its children inside a
 * single <p>. It uses the shared `.static-screen` class, so it is the same
 * surface — the markup order is the only difference, and packages/ui is
 * owned by another session (docs/10 §3).
 */

export const OFFICE_EMAIL = 'admin@thehospitalitycompany.co.uk';

function LockPanel({
  badge,
  title,
  children,
  actions,
}: {
  badge?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="static-screen">
      {badge}
      <h2>{title}</h2>
      {children}
      {actions}
    </div>
  );
}

/** "Please contact us at: admin@…", rendered the one way everywhere. */
export function ContactLine({ lead = 'If you have any questions, please contact us at:' }) {
  return (
    <p>
      {lead}{' '}
      <b className="cyan">
        <a href={`mailto:${OFFICE_EMAIL}`}>{OFFICE_EMAIL}</a>
      </b>
    </p>
  );
}

/** Sign out is the only action a terminal screen offers. */
function SignOut() {
  return (
    <form action="/auth/signout" method="post" style={{ alignSelf: 'stretch' }}>
      <Button type="submit" tone="ghost" block>
        Sign out
      </Button>
    </form>
  );
}

/**
 * Case 2 (§9.6). No Documents action, no reason, nothing to press but
 * sign out — because there is genuinely nothing the worker can do, and a
 * screen that implies otherwise wastes their afternoon.
 */
export function OnHoldScreen() {
  return (
    <LockPanel
      badge={
        <Pill tone="amber" large>
          On hold
        </Pill>
      }
      title="Your account is on hold."
      actions={<SignOut />}
    >
      <ContactLine lead="Please contact the office at:" />
    </LockPanel>
  );
}

/**
 * Case 3 (§2.9). Verbatim from the scope, which took it from THC, which
 * sends the same words as email E4. Do not reword.
 */
export function QuizRejectedScreen() {
  return (
    <LockPanel
      badge={
        <Pill tone="coral" large>
          Application closed
        </Pill>
      }
      title="Health & Safety Assessment — Unsuccessful"
      actions={<SignOut />}
    >
      <p>
        Unfortunately, you haven’t passed the Health &amp; Safety assessment after three attempts,
        which is the maximum number permitted at this stage. As passing this assessment is a
        required part of onboarding, we’re unable to progress your application any further at this
        time.
      </p>
      <ContactLine />
    </LockPanel>
  );
}

/** A rejection that is not the quiz: the same shape, none of E4's claims. */
export function ApplicationClosedScreen() {
  return (
    <LockPanel
      badge={
        <Pill tone="coral" large>
          Application closed
        </Pill>
      }
      title="Your application is closed."
      actions={<SignOut />}
    >
      <p>We’re unable to progress your application any further at this time.</p>
      <ContactLine />
    </LockPanel>
  );
}

/**
 * Case 4 (§10.6). Shifts, Radar, Invites and Documents are closed;
 * Payment information stays reachable so the earnings history a worker
 * may need for a tax return does not disappear with them.
 */
export function LeaverScreen({ leftAt }: { leftAt: string | null }) {
  const date = leftAt
    ? new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Europe/London',
      }).format(new Date(leftAt))
    : null;

  return (
    <LockPanel
      badge={<Pill large>{date ? `Left · ${date}` : 'Left'}</Pill>}
      title="You’ve left The Hospitality Company."
      actions={
        <>
          {/* The Payment information screen is §10.1's, built in its own
              session. Until it exists this is the one door that must not
              404, so it is shown disabled rather than as a link to
              nowhere — the wireframe's button, minus the lie. */}
          <Button type="button" tone="outline" block disabled aria-disabled="true">
            Payment information — earnings history
          </Button>
          <div className="xs muted">Your earnings history stays available to you here.</div>
          <SignOut />
        </>
      }
    >
      <p>
        Your P45 has been requested and the office will be in touch. If this was a mistake, please
        contact us at:{' '}
        <b className="cyan">
          <a href={`mailto:${OFFICE_EMAIL}`}>{OFFICE_EMAIL}</a>
        </b>
        .
      </p>
    </LockPanel>
  );
}

/** A session that outlived a GDPR removal (§1.7). It should not exist. */
export function RemovedScreen() {
  return (
    <LockPanel title="This account has been closed." actions={<SignOut />}>
      <ContactLine />
    </LockPanel>
  );
}

/**
 * Case 1 (§4.3, §10.7). The one lock with something to do, so the
 * Documents tab stays open and this is what the other three tabs show if
 * a worker reaches them by URL, a stale push or the back button.
 *
 * The three reasons carry different copy on purpose: an expired passport
 * and a conviction under review are not the same message, and §10.7 is
 * explicit that the second must be factual rather than punitive.
 */
export function DocumentsOnlyNotice({
  because,
}: {
  because: 'compliance' | 'conviction' | 'onboarding';
}) {
  if (because === 'conviction') {
    return (
      <Alert tone="amber">
        <b>Thanks for telling us.</b>
        <br />
        <span className="xs">
          We’ve paused your upcoming shifts while the office reviews your declaration, and we’ll be
          in touch. If you need to speak to someone, contact us at:{' '}
          <b className="cyan">{OFFICE_EMAIL}</b>
        </span>
      </Alert>
    );
  }

  if (because === 'onboarding') {
    return (
      <Alert tone="cyan">
        <b>Your documents are with the office.</b>
        <br />
        <span className="xs">
          Shifts, Invites and Radar open as soon as everything is verified and in date. You’ll get a
          notification the moment that happens.
        </span>
      </Alert>
    );
  }

  return (
    <Alert tone="coral">
      <b>You have been blocked — update your document.</b>
      <br />
      <span className="xs">
        You’ve been removed from your upcoming shifts and your invitations have been withdrawn.
        Upload a valid document; once the office verifies it — and everything else is in date —
        you’re unblocked automatically.
      </span>
    </Alert>
  );
}

/**
 * What a locked tab shows when it is reached anyway. Not a redirect:
 * §10.1 locks the tab rather than moving the worker, and a silent bounce
 * to Documents from a tapped push reads as a broken app.
 */
export function TabLockedScreen({
  because,
}: {
  because: 'compliance' | 'conviction' | 'onboarding';
}) {
  return (
    <>
      <DocumentsOnlyNotice because={because} />
      <LockPanel title="Locked until your documents are in order">
        <p>
          Shifts, Invites and Radar are closed while your compliance is outstanding. Documents is
          the one tab still open to you — everything reopens automatically once the office has
          verified what is missing and nothing else has expired (§4.3).
        </p>
      </LockPanel>
    </>
  );
}

/** Which lock, rendered. `none` renders nothing — the app does. */
export function LockScreen({ lock }: { lock: Lock }) {
  switch (lock.kind) {
    case 'hold':
      return <OnHoldScreen />;
    case 'rejected':
      return lock.quiz ? <QuizRejectedScreen /> : <ApplicationClosedScreen />;
    case 'leaver':
      return <LeaverScreen leftAt={lock.leftAt} />;
    case 'removed':
      return <RemovedScreen />;
    case 'documents':
      return <TabLockedScreen because={lock.because} />;
    default:
      return null;
  }
}
