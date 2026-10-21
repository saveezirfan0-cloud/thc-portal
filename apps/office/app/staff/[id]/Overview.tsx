'use client';

import { Note, Panel, Pill, useTimeFormat } from '@thc/ui';
import { RTW_LABEL, capReason, formatDateRange, formatUkDate } from '../staff';
import { formatUkStamp, reviewLabel, reviewStamp } from './profile';
import { EmergencyContactCard } from './EmergencyContactCard';
import { DobCorrection } from '../../_components/DobCorrection';
import { EditTermPeriods } from '../../_components/TermPeriods';
import { RtwBranchChange } from './RtwBranchChange';
import { ReferralsCard } from './ReferralsCard';
import { PayRateCard } from './PayRateCard';
import { GenderField } from './GenderField';
import { PassportCountryField } from './PassportCountryField';
import { PayrollIdField } from './PayrollIdField';
import { SchedulingField } from './SchedulingField';
import { LanguagesField } from './LanguagesField';
import type {
  DeclarationRow,
  EmergencyContact,
  PersonalPayRate,
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
  plan5: 'Plan 5',
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
  gender,
  canEditGender = false,
  passportCountry,
  canEditPassportCountry = false,
  languages,
  canEditLanguages = false,
  spudbros,
  thcShifts,
  canEditScheduling = false,
  payrollId,
  canEditPayrollId = false,
  willoReviewUrl,
  emergencyContact = null,
  emergencyContactProblem = null,
  referrals = null,
  referralsProblem = null,
  canCorrectDob = false,
  payRate = null,
  payRateProblem = null,
  payFloorPence,
  showPayRate = false,
  canEditPayRate = false,
  termLetterId = null,
  termLetterUploadedAt = null,
  canEditTermPeriods = false,
}: {
  profile: ProfileRow;
  references: ReferenceRow[];
  declarations: DeclarationRow[];
  /** The address moved and the pin could not follow (20260926110000). */
  locationStale?: boolean;
  /** ADR-0079: `staff.gender`; undefined when it could not be read. */
  gender?: 'M' | 'F' | null;
  /** Any office login that may write (ADR-0079). */
  canEditGender?: boolean;
  /** ADR-0159: `staff.passport_country`; undefined when it could not be read. */
  passportCountry?: string | null;
  /** Any office login that may write (ADR-0159). */
  canEditPassportCountry?: boolean;
  /** ADR-0080: `staff.languages`; null = never asked, undefined = not read. */
  languages?: string[] | null;
  /** Any office login that may write (ADR-0080). */
  canEditLanguages?: boolean;
  /** ADR-0106: SpudBros Express staff, and THC scheduling switched on for them. */
  spudbros?: boolean;
  thcShifts?: boolean;
  /** Any office login that may write (ADR-0106). */
  canEditScheduling?: boolean;
  /** ADR-0107: `staff.payroll_id`; null = none, undefined = not read. */
  payrollId?: string | null;
  canEditPayrollId?: boolean;
  /** ADR-0098: the Willo interview link; null/undefined = none to show. */
  willoReviewUrl?: string | null;
  /** ADR-0044 — null reads "Not provided". */
  emergencyContact?: EmergencyContact | null;
  emergencyContactProblem?: string | null;
  /** ADR-0047. */
  referrals?: Referrals | null;
  referralsProblem?: string | null;
  /** ADR-0070: `officeCan(role, 'identity')` — owners and managers see "Correct". */
  canCorrectDob?: boolean;
  /** ADR-0072: the personal pay rate, null for none. */
  payRate?: PersonalPayRate | null;
  payRateProblem?: string | null;
  /** Today's National Living Wage, pence (ADR-0137). */
  payFloorPence?: number;
  /** `officeCan(role, 'finance')` — the card is money, never drawn for a scheduler. */
  showPayRate?: boolean;
  /** Finance and write: owners and managers edit; a viewer only reads. */
  canEditPayRate?: boolean;
  /** ADR-0178: the worker's verified University Term Dates Letter, if any. */
  termLetterId?: string | null;
  /** ADR-0183: its upload instant — the calendar-year fallback expiry counts from it. */
  termLetterUploadedAt?: string | null;
  /** ADR-0178: any office login that may write corrects its holiday periods. */
  canEditTermPeriods?: boolean;
}) {
  const format = useTimeFormat();
  return (
    <div className="grid c2">
      <Panel title="Contacts &amp; identity">
        <div className="kv">
          <span className="k">Email</span>
          <span>{value(profile.email)}</span>
          <span className="k">Mobile</span>
          <span>{value(profile.phone)}</span>
          <span className="k">Date of birth</span>
          <span>
            {profile.dob ? formatUkDate(profile.dob) : value(null)}{' '}
            {/* ADR-0070: gov.uk matches the share code against this date. */}
            <DobCorrection
              staffId={profile.id}
              name={profile.display_name}
              dob={profile.dob}
              display={profile.dob ? formatUkDate(profile.dob) : '—'}
              allowed={canCorrectDob && !profile.removed}
            />
          </span>
          <span className="k">Gender</span>
          <GenderField
            staffId={profile.id}
            gender={gender}
            editable={canEditGender && !profile.removed}
            removed={profile.removed}
          />
          <span className="k">Passport country</span>
          <PassportCountryField
            staffId={profile.id}
            country={passportCountry}
            editable={canEditPassportCountry && !profile.removed}
            removed={profile.removed}
          />
          <span className="k">Languages</span>
          <LanguagesField
            staffId={profile.id}
            languages={languages}
            editable={canEditLanguages && !profile.removed}
            removed={profile.removed}
          />
          <span className="k">Payroll ID</span>
          <PayrollIdField
            staffId={profile.id}
            payrollId={payrollId}
            editable={canEditPayrollId && !profile.removed}
            removed={profile.removed}
          />
          <span className="k">Scheduling</span>
          <SchedulingField
            staffId={profile.id}
            spudbros={spudbros}
            thcShifts={thcShifts}
            editable={canEditScheduling && !profile.removed}
            removed={profile.removed}
          />
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
            {/* ADR-0182: what the Employer Checking Service form needs. */}
            {profile.rtw_branch === 'home_office_check' ? (
              profile.home_office_ref ? (
                <>
                  {' · Home Office reference '}
                  <span className="mono">{profile.home_office_ref}</span>
                </>
              ) : (
                <span className="amber"> · no Home Office reference — add it with Change</span>
              )
            ) : null}
            {profile.right_to_work_until ? (
              <>
                {' '}
                · valid until <b>{formatUkDate(profile.right_to_work_until)}</b>
              </>
            ) : null}{' '}
            <RtwBranchChange
              staffId={profile.id}
              name={profile.display_name}
              branch={profile.rtw_branch}
              until={profile.right_to_work_until}
              homeOfficeRef={profile.home_office_ref ?? null}
              allowed={canCorrectDob && !profile.removed}
            />
          </span>
          <span className="k">48h opt-out</span>
          <span>
            {profile.wtr_optout ? 'Signed' : <span className="muted">Not signed</span>}
            {profile.rtw_branch === 'international_student' ? (
              <span className="muted xs"> — a visa condition beats the opt-out in term time</span>
            ) : null}
          </span>
          <span className="k">Interview</span>
          <span>
            {willoReviewUrl ? (
              <a href={willoReviewUrl} target="_blank" rel="noreferrer">
                Review interview on Willo ↗
              </a>
            ) : (
              <span className="muted">No interview link on file</span>
            )}
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
                  <b>{row.answer ? 'Yes' : 'No'}</b> · declared{' '}
                  {formatUkStamp(row.declared_at, format)}
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
                    {row.answer && row.reviewed_at && row.review_status !== 'pending' ? (
                      <span className="muted xs">
                        {' '}
                        {reviewStamp(
                          row.review_status,
                          row.reviewed_by_name,
                          row.reviewed_at,
                          format,
                        )}
                      </span>
                    ) : null}
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
              <span className="green">✓ {formatUkStamp(profile.hmrc_declared_at, format)}</span>
            ) : (
              value(null)
            )}
          </span>
        </div>
      </Panel>

      {/* ADR-0072: the third level of pay rate — finance roles only. */}
      {showPayRate ? (
        <PayRateCard
          staffId={profile.id}
          payRate={payRate}
          problem={payRateProblem}
          {...(payFloorPence ? { floorPence: payFloorPence } : {})}
          editable={canEditPayRate && !profile.removed}
        />
      ) : null}

      <Panel
        className="span-2"
        title="Term dates &amp; calculated weekly limit"
        actions={
          <>
            {/* ADR-0178: a vacation the AI missed, added after verification. */}
            {termLetterId ? (
              <EditTermPeriods
                docId={termLetterId}
                ranges={profile.term_dates}
                allowed={canEditTermPeriods && !profile.removed}
                name={profile.display_name}
                uploadedAt={termLetterUploadedAt ?? new Date().toISOString()}
              />
            ) : null}
            <Pill>read-only · calculated</Pill>
          </>
        }
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
          Documents tab, or the holiday periods here, changes it from that moment.
        </Note>
      </Panel>
    </div>
  );
}
