'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Avatar, Pill, SignOut } from '@thc/ui';
import type { Tone } from '@thc/ui';
import { appLock, canReachProfileDetails, p45Availability } from '../lock';
import { HELP_EMAIL } from '../types';
import type { StaffProfile } from '../types';
import { expiryLine } from '../document-expiry';
import type { ExpiringDocument } from '../document-expiry';
import { formatMoney } from '../payments/earnings';
import { formatPayDate } from '../payments/pay-date';
import { loadProblemCopy } from '../../_components/LoadProblem';
import { RetryButton } from '../../_components/RetryButton';
import { P45Flow } from './P45Flow';

/**
 * The Profile tab — §10.1's profile sheet, as a screen (ADR-0041).
 *
 * §10.1 opens the sheet from the avatar: "the worker's details, links
 * (Profile details / Security settings / Payment information), sign-out,
 * and a 'Need help? …' contact line". All of that is still here, in that
 * order. What ADR-0041 changes is where it lives and what it carries:
 *
 *   - It is a tab, not a modal over another screen, so there is no backdrop
 *     to tap away and nothing to dismiss.
 *   - Documents is the first row. It left the bottom navigation for this
 *     list, and brings its status with it — "Action needed" in coral when
 *     it is what lock case 1 is waiting on — so moving it out of the nav
 *     never hides a problem.
 *   - "Edit profile" sits under the worker's name. Profile details was
 *     always editable (phone, email, address, a missing NI number) but was
 *     one link among three; this is the button workers were looking for.
 *
 * The help line is still TEXT (§10.1 — "not a separate tappable screen"),
 * and Request my P45 is still the quietest thing on the screen, below
 * sign-out behind a dashed rule (§10.6).
 */
export function ProfileHub({
  profile,
  photoUrl,
  futureShifts,
  nextPay = null,
  expiring = null,
  emergencyContactSet = null,
  unread = {},
}: {
  profile: StaffProfile;
  photoUrl: string | null;
  futureShifts: number;
  /** `nextPay()` — the soonest Friday still owed, base pay only. Null hides the line. */
  nextPay?: { payDate: string; totalPence: number } | null;
  /** `expiringDocument()` — a verified document inside §4.2's first reminder rung. */
  expiring?: ExpiringDocument | null;
  /**
   * ADR-0043: false draws the amber "Emergency contact not set" subline on
   * Profile details — a nudge, never a lock (Q11). Null (unknown, or a
   * read that failed) draws nothing.
   */
  emergencyContactSet?: boolean | null;
  /**
   * The sub-line reads that FAILED (audit D18). A failed read is not
   * "nothing owed", "nothing expiring" or "contact not set": the row says
   * it could not load, in `LoadProblem`'s words, and the hub offers the
   * retry (and pull-to-refresh) once.
   */
  unread?: { nextPay?: boolean; documents?: boolean; emergencyContact?: boolean };
}) {
  const [leaving, setLeaving] = useState(false);
  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const p45 = p45Availability(profile);
  const lock = appLock(profile);
  // A candidate still in the wizard has neither: `/profile/details` sends
  // them back here and `/documents` is the wizard's step 4, not this list.
  const working = canReachProfileDetails(lock);
  const documents = documentsStatus(profile);
  const anyUnread =
    working && Boolean(unread.nextPay || unread.documents || unread.emergencyContact);

  return (
    <div className="profile-hub">
      <section className="profile-id" aria-label="You">
        <div className="sheet-id">
          <Avatar name={name} {...(photoUrl ? { src: photoUrl } : {})} size="xl" />
          <div>
            <div className="n">{name}</div>
            <div className="mono xs muted">{employeeLabel(profile.employeeId)}</div>
            {profile.roles.length > 0 ? (
              <div className="xs muted">{profile.roles.join(' · ')}</div>
            ) : null}
            <div className="chips">
              {profile.status === 'compliant' && profile.blockers.length === 0 ? (
                <Pill tone="green">Compliant</Pill>
              ) : null}
              {profile.reliability !== null ? (
                <Pill>Show-rate {Math.round(profile.reliability)}%</Pill>
              ) : null}
            </div>
          </div>
        </div>
        {working ? (
          <Link className="btn outline block" href="/profile/details">
            Edit profile
          </Link>
        ) : null}
      </section>

      <nav className="hub-list" aria-label="Your account">
        {working ? (
          <HubRow
            href="/documents"
            title="Documents"
            sub={
              unread.documents
                ? loadProblemCopy('your documents')
                : expiring
                  ? expiryLine(expiring)
                  : 'Right to work, ID, declarations'
            }
            subTone={unread.documents ? 'coral' : expiring ? 'amber' : null}
            status={documents}
          />
        ) : null}
        <HubRow
          href="/profile/details"
          title="Profile details"
          sub="Mobile, email, home address"
          {...(working && unread.emergencyContact
            ? { note: loadProblemCopy('your emergency contact'), noteTone: 'coral' as const }
            : working && emergencyContactSet === false
              ? { note: 'Emergency contact not set' }
              : {})}
        />
        {/* ADR-0042: only for a worker auto-assign can invite at all. */}
        {lock === 'none' ? (
          <HubRow href="/profile/availability" title="Availability" sub="Days you can’t work" />
        ) : null}
        {/* ADR-0046: compliant workers only — no reward copy (Q19). */}
        {lock === 'none' && profile.status === 'compliant' ? (
          <HubRow href="/profile/refer" title="Refer a friend" sub="Share your link to apply" />
        ) : null}
        <HubRow
          href="/profile/payments"
          title="Payment information"
          sub={
            working && unread.nextPay
              ? loadProblemCopy('your next pay')
              : (nextPayLine(nextPay) ?? 'Earnings history, bank details')
          }
          subTone={working && unread.nextPay ? 'coral' : null}
        />
        <HubRow
          href="/profile/security"
          title="Security settings"
          sub="Password, signed-in devices"
        />
        <HubRow
          href="/notifications"
          title="Notifications"
          sub="Invites, shift changes and reminders on this phone"
        />
      </nav>

      {anyUnread ? <RetryButton /> : null}

      <SignOut tone="default" size="md" block />

      {/* Text, not a link (§10.1). */}
      <div className="xs muted" style={{ textAlign: 'center' }}>
        Need help? Please contact us at: <b className="cyan">{HELP_EMAIL}</b>
      </div>

      {/* Gone entirely for someone who has already left; disabled with
          the scope's hint while they are checked in (§10.6 step 3). */}
      {!p45.available && p45.hint === null ? null : (
        <div className="p45-slot">
          <button
            type="button"
            className="p45-link"
            disabled={!p45.available}
            onClick={() => setLeaving(true)}
          >
            {p45.available ? 'Request my P45 — leaving The Hospitality Company' : 'Request my P45'}
          </button>
          {p45.available ? null : <span className="p45-hint">{p45.hint}</span>}
        </div>
      )}

      <P45Flow open={leaving} onClose={() => setLeaving(false)} futureShifts={futureShifts} />
    </div>
  );
}

function HubRow({
  href,
  title,
  sub,
  subTone = null,
  note = null,
  noteTone = 'amber',
  status,
}: {
  href: string;
  title: string;
  sub: string;
  /** A second line under the sub — "Emergency contact not set". */
  note?: string | null;
  /** Amber for a nudge; coral when the read behind it failed (audit D18). */
  noteTone?: 'amber' | 'coral';
  /**
   * Amber for something that needs the worker soon (a document expiring);
   * coral when the read behind the line failed (audit D18).
   */
  subTone?: 'amber' | 'coral' | null;
  status?: DocumentsStatus | null;
}) {
  return (
    <Link className="hub-row" href={href}>
      <span className="hub-copy">
        <span className="t">{title}</span>
        <span className={subTone ? `s ${subTone}` : 's'}>{sub}</span>
        {note ? <span className={`s ${noteTone}`}>{note}</span> : null}
      </span>
      <span className="right">
        {status ? (
          <Pill tone={status.tone} dot>
            {status.text}
          </Pill>
        ) : null}
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </span>
    </Link>
  );
}

export interface DocumentsStatus {
  tone: Tone;
  text: string;
}

/**
 * The badge on the Documents row. It says what the Documents screen's own
 * status pill would, in fewer words, from the same `compliance_blockers()`
 * output `appLock()` reads — so the row can never call a locked worker
 * "Up to date".
 *
 *   Action needed  Lock case 1 on a document: Shifts, Invites and Radar
 *                  are closed until they upload (§4.3).
 *   In review      A declaration under review (§10.7), or a replacement
 *                  document waiting on the office while the old one still
 *                  counts. Nothing for the worker to do.
 *   Up to date     Compliant, nothing outstanding.
 */
export function documentsStatus(
  profile: Pick<
    StaffProfile,
    'status' | 'blockKind' | 'quizAttempts' | 'blockers' | 'rejectionCause'
  >,
): DocumentsStatus | null {
  const lock = appLock(profile);
  const reviewing =
    profile.blockKind === 'conviction_review' || profile.blockers.includes('conviction_unreviewed');

  if (lock === 'documents') {
    return reviewing
      ? { tone: 'amber', text: 'In review' }
      : { tone: 'coral', text: 'Action needed' };
  }
  if (lock !== 'none') return null;
  if (profile.blockers.some((b) => b.startsWith('document_unverified:'))) {
    return { tone: 'amber', text: 'In review' };
  }
  if (profile.status === 'compliant' && profile.blockers.length === 0) {
    return { tone: 'green', text: 'Up to date' };
  }
  return null;
}

/**
 * "Next pay Fri 2 Oct · £123.45" — the Payment information row's sub-line,
 * from the same base figures Earnings history shows (holiday pay is never
 * blended in, §9.8). Null when nothing is owed, and the row keeps its usual
 * description.
 */
export function nextPayLine(
  next: { payDate: string; totalPence: number } | null | undefined,
): string | null {
  if (!next || next.totalPence <= 0) return null;
  return `Next pay ${formatPayDate(next.payDate)} · ${formatMoney(next.totalPence)}`;
}

/**
 * "Employee ID THC-00417". The number is issued at contract signature
 * (§2.7) and a worker part-way through onboarding does not have one yet,
 * so the label says so rather than printing "THC-null".
 */
export function employeeLabel(employeeId: number | null): string {
  if (employeeId === null) return 'Employee ID — issued when you sign your contract';
  return `Employee ID THC-${String(employeeId).padStart(5, '0')}`;
}
