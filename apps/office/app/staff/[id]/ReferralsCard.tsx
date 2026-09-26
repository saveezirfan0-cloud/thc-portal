'use client';

import Link from 'next/link';
import { Alert, Note, Panel, Pill } from '@thc/ui';
import { employeeId, statusLabel } from '../staff';
import type { StaffStatus } from '../types';
import type { ReferralPerson, Referrals } from './types';

/**
 * The Referrals card on the Overview tab (ADR-0046),
 * `wireframes/backoffice/change-requests.html` → "Overview cards".
 *
 * Who referred this worker, their own code, and everyone who applied with
 * it. The office sees names and outcomes; the worker in the app sees only a
 * count, and an applicant never sees who referred them (Q20). No reward and
 * no money anywhere (Q19). A removed person reads "Deleted account #id"
 * (§1.7) — the database has already said so.
 */
function Person({ person }: { person: ReferralPerson }) {
  const status = statusLabel({ status: person.status as StaffStatus, removed: person.removed });
  return (
    <span>
      <Link href={`/staff/${person.staffId}`}>{person.name}</Link>{' '}
      <span className="mono xs muted">{employeeId(person.employeeId)}</span>{' '}
      <Pill tone={status.tone === 'neutral' ? undefined : status.tone}>{status.label}</Pill>
    </span>
  );
}

export function ReferralsCard({
  referrals,
  problem,
}: {
  referrals: Referrals | null;
  problem?: string | null;
}) {
  const referred = referrals?.referred ?? [];
  return (
    <Panel
      title="Referrals"
      actions={<span className="muted sm">recorded from /apply?ref= · no reward (Q19)</span>}
    >
      {problem ? (
        <Alert tone="coral">The referrals could not be read: {problem}</Alert>
      ) : (
        <div className="kv">
          <span className="k">Referred by</span>
          <span>
            {referrals?.referredBy ? (
              <Person person={referrals.referredBy} />
            ) : (
              <span className="muted">— applied without a referral</span>
            )}
          </span>
          <span className="k">Their code</span>
          <span>
            {referrals?.code ? (
              <>
                <span className="mono">{referrals.code}</span>
                {referrals.codeRevokedAt ? (
                  <>
                    {' '}
                    <Pill>revoked</Pill>
                  </>
                ) : null}
              </>
            ) : (
              <span className="muted">
                — none yet (made when they first open Refer a friend in the app)
              </span>
            )}
          </span>
          <span className="k">Applied with it</span>
          <span>
            {referred.length === 0 ? (
              <span className="muted">0</span>
            ) : (
              <span className="stack" style={{ gap: 'var(--sp-4)' }}>
                <b>{referred.length}</b>
                {referred.map((person) => (
                  <Person key={person.staffId} person={person} />
                ))}
              </span>
            )}
          </span>
        </div>
      )}
      {!problem && referred.length > 0 ? (
        <Note>
          The worker sees only the count in the app; the names are for the office (ADR-0046).
        </Note>
      ) : null}
    </Panel>
  );
}
