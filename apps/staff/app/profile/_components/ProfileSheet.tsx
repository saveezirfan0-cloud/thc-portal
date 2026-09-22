'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Pill } from '@thc/ui';
import { p45Availability } from '../lock';
import { HELP_EMAIL } from '../types';
import type { StaffProfile } from '../types';
import { P45Flow } from './P45Flow';

/**
 * The profile sheet — §10.1, `wireframes/staff/profile.html`.
 *
 * "Tap the avatar: the worker's details, links (Profile details / Security
 * settings / Payment information), sign-out, and a 'Need help? Please
 * contact us at: admin@thehospitalitycompany.co.uk' contact line — not a
 * separate tappable screen."
 *
 * That last clause is a requirement, not a note: the help line is TEXT on
 * this sheet. It is not a link to a help screen, because THC asked for the
 * address itself to be the answer.
 *
 * Request my P45 sits below sign-out, behind a dashed rule, in muted
 * underlined text (§10.6). While the worker is checked in it is disabled
 * and carries the scope's own hint — the same rule `request_p45()` refuses
 * on, so the button and the server cannot disagree.
 */
export function ProfileSheet({
  profile,
  photoUrl,
  futureShifts,
}: {
  profile: StaffProfile;
  photoUrl: string | null;
  futureShifts: number;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const p45 = p45Availability(profile);

  return (
    <>
      {/* Tapping away from the sheet goes back to where the avatar was. */}
      <div className="sheet-back" onClick={() => router.push('/shifts')} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Your profile">
        <span className="grab" />

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

        <div className="sheet-links">
          <Link className="sheet-link" href="/profile/details">
            Profile details<span className="chev">›</span>
          </Link>
          <Link className="sheet-link" href="/profile/security">
            Security settings<span className="chev">›</span>
          </Link>
          <Link className="sheet-link" href="/profile/payments">
            Payment information<span className="chev">›</span>
          </Link>
        </div>

        <form action="/auth/signout" method="post">
          <button className="btn block" type="submit">
            Sign out
          </button>
        </form>

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
              {p45.available
                ? 'Request my P45 — leaving The Hospitality Company'
                : 'Request my P45'}
            </button>
            {p45.available ? null : <span className="p45-hint">{p45.hint}</span>}
          </div>
        )}
      </div>

      <P45Flow open={leaving} onClose={() => setLeaving(false)} futureShifts={futureShifts} />
    </>
  );
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
