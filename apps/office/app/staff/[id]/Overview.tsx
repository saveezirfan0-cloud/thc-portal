'use client';

import { Note, Panel, Pill } from '@thc/ui';
import { RTW_LABEL, capReason, formatDateRange, formatUkDate } from '../staff';
import { formatUkStamp, reviewLabel } from './profile';
import { EmergencyContactCard } from './EmergencyContactCard';
import { ReferralsCard } from './ReferralsCard';
import type {
  DeclarationRow,
  EmergencyContact,
  ProfileRow,
  ReferenceRow,
  Referrals,
} from './types';

/**
 * The Overview tab (§9.6): "everything collected during onboarding, in
 * one place".
 *
 * A removed worker still has this tab — §1.7 keeps the profile openable
 * with the non-personal history visible — and the view has already
 * replaced every personal column with null, so the panels render as
 * dashes rather than disappearing. Hiding them would make the record look
 * corrupt instead of anonymised.
 */
const LOAN_LABEL: Record<string, string> = {
  none: 'None',
  plan1: 'Plan 1',
  plan2: 'Plan 2',
  plan4: 'Plan 4',
};

function value(text: string | null | undefined) {
  return text === null || text === undefined || text === '' ? (
    <span className="muted">—</span>
  ) : (
    text
  );
}

export function Overview({
  profile,
  references,
  declarations,
  locationStale = false,
  emergencyContact = null,
  emergencyContactProblem = null,
  referrals = null,
  referralsProblem = null,
}: {
  profile: ProfileRow;
  references: ReferenceRow[];
  declarations: DeclarationRow[];
  /** The address moved and the pin could not follow (20260926110000). */
  locationStale?: boolean;
  /** ADR-0044 — null reads "Not provided". */
  emergencyContact?: EmergencyContact | null;
  emergencyContactProblem?: string | null;
  /** ADR-0047. */
  referrals?: Referrals | null;
  referralsProblem?: string | null;
}) {
  return (
    <div className="grid c2">
      <Panel title="Contacts &amp; identity">
        <div className="kv">
          <span className="k">Email</span>
          <span>{value(profile.email)}</span>
          <span className="k">Mobile</span>
          <span>{value(profile.phone)}</span>
          <span className="k">Date of birth</span>
          <span>{profile.dob ? formatUkDate(profile.dob) : value(null)}</span>
          <span className="k">Home address</span>
          <span>
            {value(profile.home_address)}
            {locationStale ? (
              <>
                {' '}
                <Pill tone="amber">location out of date</Pill>
                <br />
                <span className="muted sm">
                  This address changed but its postcode could not be looked up, so venue distances
                  (auto-assign proximity) still use the previous location.
                </span>
              </>
            ) : null}
          </span>
          <span className="k">Right to Work</span>
          <span>
            {value(profile.rtw_branch ? RTW_LABEL[profile.rtw_branch] : null)}
            {profile.share_code ? (
              <>
                {' · share code '}
                <span className="mono">{profile.share_code}</span>
              </>
            ) : null}
            {profile.right_to_work_until ? (
              <>
                {' '}
                · valid until <b>{formatUkDate(profile.right_to_work_until)}</b>
              </>
            ) : null}
          </span>
          <span className="k">48h opt-out</span>
          <span>
            {profile.wtr_optout ? 'Signed' : <span className="muted">Not signed</span>}
            {profile.rtw_branch === 'international_student' ? (
              <span className="muted xs"> — a visa condition beats the opt-out in term time</span>
            ) : null}
          </span>
          <span className="k">Joined</span>
          <span>{formatUkDate(profile.joined_at)}</span>
        </div>
      </Panel>

      {/* ADR-0044: office-only, never on a client document. */}
      <EmergencyContactCard
        staffId={profile.id}
        contact={emergencyContact}
        problem={emergencyContactProblem}
        editable={!profile.removed}
      />

      <Panel
        title="Two references"
        actions={<span className="muted sm">not reviewed · supporting information only</span>}
      >
        {references.length === 0 ? (
          <Note>No references on file.</Note>
        ) : (
          <div className="grid c2">
            {references.map((ref, index) => (
              <div className="card" key={ref.id}>
                <div className="label">Referee {index + 1}</div>
                <div className="kv tight mt-8">
                  <span className="k">Name</span>
                  <span>{ref.name}</span>
                  <span className="k">Relationship</span>
                  <span>{ref.relationship}</span>
                  <span className="k">Phone</span>
                  <span>{ref.phone}</span>
                  <span className="k">Email</span>
                  <span>{ref.email}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ADR-0047: who referred them, and who applied with their code. */}
      <ReferralsCard referrals={referrals} problem={referralsProblem} />

      <Panel
        title="Criminal convictions · history"
        actions={<span className="muted sm">declarations are never edited or overwritten</span>}
      >
        {declarations.length === 0 ? (
          <Note>No declaration on file.</Note>
        ) : (
          <div className="stack">
            {declarations.map((row) => (
              <div className="kv" key={row.id}>
                <span className="k">
                  {row.source === 'onboarding' ? 'Onboarding' : 'In employment'}
                </span>
                <span>
                  <b>{row.answer ? 'Yes' : 'No'}</b> · declared {formatUkStamp(row.declared_at)}
                  {row.answer ? null : (
                    <span className="muted xs">
                      {' '}
                      — auto-verified on submission, no admin action
                    </span>
                  )}
                  {row.answer && row.details ? <div className="sm">{row.details}</div> : null}
                  <div className="mt-8">
                    <Pill
                      tone={
                        row.review_status === 'verified'
                          ? 'green'
                          : row.review_status === 'rejected'
                            ? 'coral'
                            : row.review_status === 'superseded'
                              ? undefined
                              : 'amber'
                      }
                    >
                      {reviewLabel(row.review_status)}
                    </Pill>
                  </div>
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="National Insurance · Bank &amp; payroll · HMRC">
        <div className="kv">
          <span className="k">NI number</span>
          <span>
            <span className="mono">{value(profile.ni_number_masked)}</span>{' '}
            {profile.has_ni_number ? <Pill>locked</Pill> : null}{' '}
            <span className="muted xs">corrections go through the office</span>
          </span>
          <span className="k">Account holder</span>
          <span>{value(profile.bank_account_holder)}</span>
          <span className="k">Sort code / account</span>
          <span className="mono">
            {profile.bank_sort_code_masked ? (
              <>
                {profile.bank_sort_code_masked} · {profile.bank_account_masked}
              </>
            ) : (
              value(null)
            )}
          </span>
          <span className="k">HMRC statement</span>
          <span>
            {profile.hmrc_statement ? (
              <>
                <b>{profile.hmrc_statement}</b> <Pill tone="cyan">derived</Pill>
              </>
            ) : (
              value(null)
            )}
          </span>
          <span className="k">Student loan</span>
          <span>
            {profile.hmrc_student_loan
              ? `${LOAN_LABEL[profile.hmrc_student_loan] ?? profile.hmrc_student_loan}${
                  profile.hmrc_postgraduate_loan ? ' · Postgraduate ✓' : ''
                }`
              : value(null)}
          </span>
          <span className="k">Declaration</span>
          <span>
            {profile.hmrc_declared_at ? (
              <span className="green">✓ {formatUkStamp(profile.hmrc_declared_at)}</span>
            ) : (
              value(null)
            )}
          </span>
        </div>
      </Panel>

      <Panel
        className="span-2"
        title="Term dates &amp; calculated weekly limit"
        actions={<Pill>read-only · calculated</Pill>}
      >
        <div className="row wrap" style={{ gap: 24 }}>
          <div>
            <span className="label">This week</span>
            <div>
              <b>
                {capReason(
                  profile.weekly_cap_band,
                  profile.weekly_cap_hours,
                  profile.weekly_cap_until,
                )}
              </b>
            </div>
          </div>
          <div>
            <span className="label">Holiday ranges</span>
            <div className="row sm wrap">
              {profile.term_dates && profile.term_dates.length > 0 ? (
                profile.term_dates.map((range) => (
                  <span className="chip" key={range}>
                    {formatDateRange(range)} → 48 h
                  </span>
                ))
              ) : (
                <span className="muted sm">None on file — the cap is calculated without them</span>
              )}
            </div>
          </div>
        </div>
        <Note>
          The cap is calculated live from this evidence, never stored. Correcting a date on the
          Documents tab changes it from that moment.
        </Note>
      </Panel>
    </div>
  );
}
