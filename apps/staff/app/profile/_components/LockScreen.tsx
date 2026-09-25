import Link from 'next/link';
import type { ReactNode } from 'react';
import { Pill, SignOut } from '@thc/ui';
import { QUIZ_FAILED_COPY, QUIZ_FAILED_TITLE } from '@thc/domain';
import { HELP_EMAIL } from '../types';
import type { AppLock } from '../lock';

/**
 * The terminal screens of §10.1, `wireframes/staff/locks.html`.
 *
 * Three of the four lock cases have no way forward, and the copy is not
 * ours to improve:
 *
 *   hold        "Your account is on hold. Please contact the office at:
 *               admin@thehospitalitycompany.co.uk" — and nothing else. The
 *               manager's reason is internal and is NEVER shown, so it is
 *               not passed to this component and `staff_me()` does not
 *               return it. There is no prop here to leak it through.
 *   quiz_failed THC's own wording, identical to email E4 (§8). One string,
 *               `QUIZ_FAILED_COPY` from @thc/domain, which E4's template is
 *               also held to — the worker has the email in their inbox and
 *               the two cannot drift apart.
 *   leaver      §10.6 step 7, with the one live action a leaver keeps —
 *               Payment information, so their earnings history stays
 *               available to them after they leave.
 *
 * The markup is the wireframe's `.static-screen`: badge, heading, one
 * paragraph, then the actions.
 */

function Static({
  badge,
  title,
  children,
  detail,
  actions,
}: {
  badge?: ReactNode;
  title: ReactNode;
  children: ReactNode;
  /** Between the copy and the actions — the quiz screen's attempt list. */
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="static-screen">
      {badge}
      <h2>{title}</h2>
      <p>{children}</p>
      {detail}
      {actions}
    </div>
  );
}

export function LockScreen({
  lock,
  leftAt,
  detail,
}: {
  lock: AppLock;
  leftAt?: string | null;
  /**
   * Rendered ahead of the actions, where the wireframe puts the quiz
   * attempts (onboarding-2.html, "Terminal — failed 3 times"): contact
   * line, the three attempts, then Sign out.
   */
  detail?: ReactNode;
}) {
  if (lock === 'leaver') {
    return (
      <Static
        badge={<Pill large>Left · {formatLeft(leftAt)}</Pill>}
        title="You’ve left The Hospitality Company."
        actions={
          <>
            <Link className="btn outline block" href="/profile/payments">
              Payment information — earnings history
            </Link>
            <SignOut size="md" block />
          </>
        }
      >
        Your P45 has been requested and the office will be in touch. If this was a mistake, please
        contact us at: <b className="cyan">{HELP_EMAIL}</b>.
      </Static>
    );
  }

  if (lock === 'quiz_failed') {
    return (
      <Static
        badge={
          <Pill tone="coral" large>
            Application closed
          </Pill>
        }
        title={QUIZ_FAILED_TITLE}
        detail={
          <>
            <p className="sm muted">
              If you have any questions, please contact us at: <b className="cyan">{HELP_EMAIL}</b>
            </p>
            {detail}
          </>
        }
        actions={<SignOut size="md" block />}
      >
        {QUIZ_FAILED_COPY}
      </Static>
    );
  }

  if (lock === 'rejected') {
    return (
      <Static
        badge={
          <Pill tone="coral" large>
            Application closed
          </Pill>
        }
        title="Your application is closed."
        actions={<SignOut size="md" block />}
      >
        Please contact us at: <b className="cyan">{HELP_EMAIL}</b>
      </Static>
    );
  }

  if (lock === 'removed') {
    // §1.7: a removed worker cannot sign in at all, "so no screen applies".
    // This exists only for a session that outlived the removal.
    return (
      <Static title="This account is closed." actions={<SignOut size="md" block />}>
        Please contact us at: <b className="cyan">{HELP_EMAIL}</b>
      </Static>
    );
  }

  // Manual block (§9.6). One sentence and an address — the worker has
  // nothing to do here, and pretending otherwise wastes their time.
  return (
    <Static
      badge={
        <Pill tone="amber" large>
          On hold
        </Pill>
      }
      title="Your account is on hold."
      actions={<SignOut size="md" block />}
    >
      Please contact the office at: <b className="cyan">{HELP_EMAIL}</b>
    </Static>
  );
}

/** "18.09.2026" on the leaver badge — an audit stamp, so UK only (§1.8). */
function formatLeft(leftAt?: string | null): string {
  if (!leftAt) return 'today';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(new Date(leftAt))
    .replace(/\//g, '.');
}
