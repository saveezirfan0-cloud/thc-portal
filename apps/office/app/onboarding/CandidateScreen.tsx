'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Chip,
  DocRow,
  EmptyState,
  Input,
  KpiTile,
  Modal,
  Note,
  Panel,
  Pill,
  Textarea,
  useTimeFormat,
} from '@thc/ui';
import { contractClause28Pending, formatLanguages, groupRolesByArea } from '@thc/domain';
import { OfficeShell } from '../_components/OfficeShell';
import {
  RTW_LABEL,
  employeeId,
  formatDateRange,
  formatUkDate,
  rtwUntilLabel,
} from '../staff/staff';
import { formatUkStamp } from '../staff/[id]/profile';
import {
  acceptCandidate,
  addQualifiedRole,
  grantClientQualifications,
  documentLink,
  markInterviewComplete,
  rejectCandidate,
  rejectDeclaration,
  rejectDocument,
  removeQualifiedRole,
  resendActivationLink,
  revokeClientQualification,
  verifyDeclaration,
  verifyDocument,
} from './actions';
import {
  COLUMNS,
  DOC_LABEL,
  QUIZ_MAX_ATTEMPTS,
  QUIZ_PASS_MARK,
  REVIEW_PILL,
  RTW_BRANCH_NO,
  RTW_REQUIRED,
  aiBadge,
  canResendActivation,
  candidateActions,
  candidateCap,
  columnFor,
  groupQualifications,
  matchesName,
  newEntryCount,
  orDash,
  parsePeriod,
  periodsProblem,
  phaseIndex,
  phaseLabel,
  quizGate,
  referredByLabel,
  stageAge,
  stageEnteredAt,
  studentLoanLabel,
} from './view-model';
import type { Period } from './view-model';
import { rtwDateProblem, rtwDateRule, rtwDateValue } from '../compliance/rtw';
import {
  canAttachReport,
  canUploadCompletionLetter,
  niEvidenceLine,
} from '../compliance/conditions';
import {
  CompletionLetterUpload,
  RtwConditionsEditor,
  RtwReportUpload,
} from '../compliance/EvidenceUploads';
import { RtwCheckPanel } from '../_components/RtwCheckPanel';
import { DobCorrection } from '../_components/DobCorrection';
import { DobClaimNote } from '../_components/DobClaimNote';
import type { DobClaim } from '../_lib/dobCorrection';
import {
  checksByDocument,
  rtwCheckView,
  rtwLockedLabel,
  rtwLockedValue,
  ukDateOnly,
} from '../_lib/rtwCheck';
import type { RtwCheckRow } from '../_lib/rtwCheck';
import type {
  ActionResult,
  CandidateData,
  CandidateDocument,
  CandidateRow,
  ContractVersion,
  Declaration,
} from './types';
import './onboarding.css';

const STATE = {
  verified: 'verified',
  pending: 'review',
  rejected: 'rejected',
  superseded: 'pending',
} as const;
const ICON: Record<string, string> = {
  passport: 'PDF',
  birth_certificate: 'PDF',
  ni_evidence: 'IMG',
  national_id: 'IMG',
  visa_document: 'PDF',
  status_document: 'PDF',
  university_term_dates_letter: 'PDF',
  university_completion_letter: 'PDF',
  share_code_report: 'GOV',
};

type Reject =
  | { kind: 'candidate' }
  | { kind: 'document'; doc: CandidateDocument; suggested?: string }
  | { kind: 'declaration'; declaration: Declaration }
  | null;

/**
 * /onboarding/:id (BO4). One profile organised by phase: only the fields
 * relevant to the phase exist on the screen, with the matching stepper
 * (§2.3). The only top-area action is Reject candidate; documents carry
 * Verify / Reject; the quiz, the references and the contract are read
 * only — the candidate does those in the app.
 *
 * A rejected or signed profile is read-only. Rejection is final on the
 * record (§2.3), and a signed contract makes the person Staff (§2.7).
 */
export function CandidateScreen({
  data,
  now,
  canCorrectDob = false,
  canMarkInterview = false,
}: {
  data: CandidateData;
  now: string;
  /** ADR-0070: `officeCan(role, 'identity')` — owners and managers see "Correct". */
  canCorrectDob?: boolean;
  /** ADR-0077: `canMarkInterviewComplete(role)` — owners and managers may skip Willo. */
  canMarkInterview?: boolean;
}) {
  const router = useRouter();
  const at = useMemo(() => new Date(now), [now]);
  const row = data.candidate as CandidateRow;
  const [reject, setReject] = useState<Reject>(null);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [resent, setResent] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markReason, setMarkReason] = useState('');

  const actions = candidateActions(row.status);
  const readOnly = row.status === 'rejected' || row.status === 'compliant';
  const phase = phaseIndex(row);
  const column =
    row.status === 'compliant' ? 'contract' : (columnFor(row) ?? 'interview_requested');
  const age = stageAge(stageEnteredAt(row, column), at);
  // A phase that is done stays open to look at: the stepper can be pointed at
  // any step up to the current one. `picked` is remembered against the phase it
  // was chosen in, so when the candidate moves on the profile follows them.
  const [picked, setPicked] = useState<{ phase: number; index: number } | null>(null);
  const viewing = picked && picked.phase === phase && picked.index <= phase ? picked.index : phase;
  const shown = COLUMNS[viewing]?.key ?? column;
  const past = viewing < phase;

  const run = (work: () => Promise<ActionResult>, after?: () => void) => {
    setProblem(null);
    start(async () => {
      // A server action that throws (rather than returning { ok: false })
      // must not leave the click looking like it did nothing.
      let result: ActionResult;
      try {
        result = await work();
      } catch {
        result = { ok: false, message: 'Something went wrong on the server. Try again.' };
      }
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setProblem(result.message);
      }
    });
  };

  const confirmReject = () => {
    if (!reject) return;
    const close = () => {
      setReject(null);
      setReason('');
    };
    if (reject.kind === 'candidate') run(() => rejectCandidate(row.id, reason), close);
    else if (reject.kind === 'document')
      run(() => rejectDocument(row.id, reject.doc.id, reason), close);
    else run(() => rejectDeclaration(row.id, reject.declaration.id, reason), close);
  };

  const open = (docId: string, which: 'file' | 'report') => {
    setProblem(null);
    start(async () => {
      const result = await documentLink(docId, which);
      if (result.ok && result.url) window.open(result.url, '_blank', 'noopener');
      else if (!result.ok) setProblem(result.message);
    });
  };

  const doc: DocHandlers = {
    // Looking back at a finished phase never offers its actions again.
    readOnly: readOnly || past,
    busy,
    staffId: row.id,
    branch: row.rtw_branch,
    onVerify: (d: CandidateDocument, input: VerifyChoice = {}) =>
      run(() =>
        verifyDocument(row.id, d.id, {
          periods: input.periods ?? null,
          expiry: input.expiry ?? null,
        }),
      ),
    onReject: (d: CandidateDocument, suggested?: string) => {
      // ADR-0041: a share code the gov.uk check recommends rejecting opens
      // with its suggested N8 text, editable.
      setReason(suggested ?? '');
      setReject({ kind: 'document', doc: d, suggested });
    },
    onOpen: open,
  };

  return (
    <OfficeShell
      activeHref="/onboarding"
      title="Candidate"
      crumbs={
        <>
          <Link href="/onboarding">Onboarding</Link> / <b>{row.display_name}</b>
        </>
      }
    >
      <div className="stack">
        {problem ? <Alert tone="coral">{problem}</Alert> : null}

        {row.status === 'rejected' ? (
          <Alert tone="coral">
            <b>Rejected{row.rejected_at ? ` ${formatUkStamp(row.rejected_at)}` : ''}</b>
            {row.rejection_cause === 'willo'
              ? ' — in Willo; the system rejected automatically and sent E2.'
              : row.rejection_cause === 'quiz_failed'
                ? ' — Health & Safety quiz failed three times; E4 and the terminal screen in the app.'
                : ` — by ${row.rejected_by_name ?? 'the office'}${row.rejection_reason ? `: “${row.rejection_reason}”` : ''}.`}{' '}
            Final on this record: a new application routes here as a returning applicant.
          </Alert>
        ) : null}

        <div className="cand-head">
          {/* §2.7: the onboarding selfie follows them through the whole system. */}
          <Avatar size="xl" name={row.display_name} src={row.photo_url ?? undefined} />
          <div className="who">
            <div className="row wrap">
              <h2>{row.display_name}</h2>
              <Pill>{row.status === 'compliant' ? 'Staff' : 'Candidate'}</Pill>
              <Pill
                tone={
                  row.status === 'rejected'
                    ? 'coral'
                    : phase === 2
                      ? 'amber'
                      : phase === 5
                        ? 'green'
                        : 'cyan'
                }
              >
                {phaseLabel(row)}
              </Pill>
              {readOnly ? null : <Pill>{age.days} d in stage</Pill>}
              {phase >= 2 ? row.role_names.map((role) => <Chip key={role}>{role}</Chip>) : null}
            </div>
            <Facts row={row} data={data} phase={phase} canCorrectDob={canCorrectDob} />
          </div>
          <div className="actions">
            {canResendActivation(row.status, row.activated) ? (
              <Button
                tone="outline"
                disabled={busy || resent}
                title="A fresh personal link and a new E3, for a candidate whose link has expired. Once every 10 minutes."
                onClick={() =>
                  run(
                    () => resendActivationLink(row.id),
                    () => setResent(true),
                  )
                }
              >
                {resent ? 'Activation link sent ✓' : 'Resend activation link'}
              </Button>
            ) : null}
            {actions.includes('reject') ? (
              <Button tone="danger" onClick={() => setReject({ kind: 'candidate' })}>
                Reject candidate
              </Button>
            ) : row.status === 'compliant' ? (
              <Button
                tone="danger"
                disabled
                title="Signed → now Staff; use Block on the staff profile"
              >
                Reject candidate
              </Button>
            ) : null}
          </div>
        </div>

        <PhaseStepper
          phase={phase}
          viewing={viewing}
          onView={(index) => setPicked({ phase, index })}
        />

        {past ? (
          <Alert tone="cyan">
            Viewing <b>{COLUMNS[viewing]?.label}</b>, a step already completed. Read-only —{' '}
            <button type="button" className="linkish" onClick={() => setPicked(null)}>
              back to {COLUMNS[phase]?.label}
            </button>
            .
          </Alert>
        ) : null}

        {shown === 'interview_requested' ? (
          <InterviewRequested
            row={row}
            data={data}
            onMarkComplete={
              canMarkInterview && !past && row.status === 'interview_requested'
                ? () => {
                    setMarkReason('');
                    setMarking(true);
                  }
                : null
            }
          />
        ) : null}
        {shown === 'interview_completed' ? (
          <InterviewCompleted
            row={row}
            data={data}
            past={past}
            canAccept={actions.includes('accept') && !past}
            busy={busy}
            problem={problem}
            onAccept={(roles, note) => run(() => acceptCandidate(row.id, roles, note))}
            onReject={() => setReject({ kind: 'candidate' })}
          />
        ) : null}
        {shown === 'documents' ? (
          <DocumentsPhase
            row={row}
            data={data}
            doc={doc}
            onToggleRole={(roleId, on) =>
              run(() =>
                on ? addQualifiedRole(row.id, roleId) : removeQualifiedRole(row.id, roleId),
              )
            }
            onGrantClients={(clientIds, roleIds, after) =>
              run(() => grantClientQualifications(row.id, clientIds, roleIds), after)
            }
            onRevokeClients={(ids) =>
              run(async () => {
                for (const id of ids) {
                  const result = await revokeClientQualification(row.id, id);
                  if (!result.ok) return result;
                }
                return { ok: true } as const;
              })
            }
            onVerifyDeclaration={(d) => run(() => verifyDeclaration(row.id, d.id, ''))}
            onRejectDeclaration={(d) => {
              setReason('');
              setReject({ kind: 'declaration', declaration: d });
            }}
          />
        ) : null}
        {shown === 'quiz' ? <QuizPhase row={row} data={data} past={past} /> : null}
        {shown === 'additional_info' ? <AdditionalInfo row={row} data={data} /> : null}
        {shown === 'contract' ? <ContractPhase row={row} contract={data.contract} /> : null}
      </div>

      <Modal
        open={marking}
        title="Mark interview complete"
        onClose={() => setMarking(false)}
        footer={
          <>
            <Button tone="ghost" onClick={() => setMarking(false)}>
              Cancel
            </Button>
            <Button
              tone="primary"
              disabled={busy || markReason.trim() === ''}
              onClick={() =>
                run(
                  () => markInterviewComplete(row.id, markReason),
                  () => setMarking(false),
                )
              }
            >
              {busy ? 'Saving…' : 'Mark complete'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <div className="sm muted">
            {row.display_name} moves to <b>Interview completed</b> without waiting for Willo.
            Nothing is sent to the candidate.
          </div>
          <Textarea
            label="Reason *"
            placeholder="e.g. test candidate · interviewed in person · Willo webhook never arrived"
            value={markReason}
            onChange={(event) => setMarkReason(event.target.value)}
            hint="Kept for the office with your name, and shown on the profile."
          />
          <Note>
            Then pick the role(s) and <b>Accept — move to Documents</b> (E3 goes out), or Reject,
            exactly as after a Willo interview. A later Willo response for this candidate changes
            nothing. Owners and managers only.
          </Note>
          {problem ? <Alert tone="coral">{problem}</Alert> : null}
        </div>
      </Modal>

      <Modal
        open={reject !== null}
        title={
          reject?.kind === 'candidate'
            ? 'Reject candidate'
            : reject?.kind === 'declaration'
              ? 'Reject declaration'
              : 'Reject document'
        }
        onClose={() => setReject(null)}
        footer={
          <>
            <Button tone="ghost" onClick={() => setReject(null)}>
              Cancel
            </Button>
            <Button
              tone="danger"
              solid
              disabled={busy || reason.trim() === ''}
              onClick={confirmReject}
            >
              {reject?.kind === 'candidate' ? 'Reject candidate' : `Reject ${reject?.kind ?? ''}`}
            </Button>
          </>
        }
      >
        {reject ? (
          <div className="stack">
            {reject.kind === 'document' ? (
              <>
                <div className="row">
                  <Pill tone="coral">{reject.doc.doc_label}</Pill>
                </div>
                <div className="sm muted">
                  {row.display_name} · uploaded {formatUkStamp(reject.doc.uploaded_at)}
                  {reject.doc.ai_confidence !== null
                    ? ` · AI ${Math.round(reject.doc.ai_confidence * 100)}%`
                    : ''}
                </div>
                {reject.suggested ? (
                  <Note tone="amber">
                    The automatic gov.uk check recommends Reject. The reason below is its suggestion
                    — edit it before it goes to the worker.
                  </Note>
                ) : null}
              </>
            ) : null}
            <Textarea
              label="Reason *"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              hint={
                reject.kind === 'candidate'
                  ? 'Kept for the office. The candidate receives THC’s rejection email — E2 once the interview is done, E2b before it — never this reason.'
                  : 'Sent to the worker word for word in push N8: “Document rejected — [reason]” with a Re-upload button. The new upload returns to review.'
              }
            />
            {reject.kind === 'candidate' ? (
              <Note>
                Rejecting a candidate is final — there is no un-reject on this record. Their pending
                documents drop out of Compliance → Needs review.
              </Note>
            ) : (
              <Note>
                The {reject.kind} becomes <b>Rejected</b>; the candidate stays in Documents. Nothing
                else on the profile changes. Rejecting a document is not rejecting the candidate.
              </Note>
            )}
            {problem ? <Alert tone="coral">{problem}</Alert> : null}
          </div>
        ) : null}
      </Modal>
    </OfficeShell>
  );
}

// ---------------------------------------------------------------------
// Header facts, per phase
// ---------------------------------------------------------------------
function Facts({
  row,
  data,
  phase,
  canCorrectDob,
}: {
  row: CandidateRow;
  data: CandidateData;
  phase: number;
  canCorrectDob: boolean;
}) {
  const facts: ReactNode[] = [];
  // ADR-0070: the date gov.uk matches the share code against, correctable
  // by an owner or a manager from here as from /staff/:id.
  const correct = row.dob ? (
    <DobCorrection
      staffId={row.id}
      name={row.display_name}
      dob={row.dob}
      display={formatUkDate(row.dob)}
      allowed={canCorrectDob && row.status !== 'removed'}
    />
  ) : null;
  if (phase <= 1) {
    facts.push(
      <span key="applied">
        Applied <b>{formatUkStamp(row.applied_at).replace(' UK time', '')}</b>
        {data.application ? ' via /apply' : ''}
      </span>,
    );
    if (row.age !== null)
      facts.push(
        <span key="age">
          Age <b>{row.age}</b> {correct}
        </span>,
      );
  } else {
    if (row.dob)
      facts.push(
        <span key="dob">
          DOB <b>{formatUkDate(row.dob)}</b> {correct}
        </span>,
      );
    // The wireframe's Additional info header leads with the quiz result.
    const passed = phase === 4 ? data.attempts.find((attempt) => attempt.passed) : undefined;
    if (passed) {
      facts.push(
        <span key="quiz">
          Quiz <b className="green">passed {Math.round(passed.score)}%</b> (attempt{' '}
          {passed.attempt_no})
        </span>,
      );
    }
    const branchNo = row.rtw_branch ? RTW_BRANCH_NO[row.rtw_branch] : undefined;
    facts.push(
      <span key="rtw">
        Right to Work{' '}
        <b>{row.rtw_branch ? (RTW_LABEL[row.rtw_branch] ?? row.rtw_branch) : 'not chosen yet'}</b>
        {phase === 2 && branchNo ? ` (branch ${branchNo})` : ''}
        {row.right_to_work_until ? ` · until ${formatUkDate(row.right_to_work_until)}` : ''}
      </span>,
    );
  }
  if (phase >= 3 && data.profile) {
    facts.push(
      <span key="cap">
        Weekly limit{' '}
        <b>
          {candidateCap(
            data.profile.weekly_cap_band,
            data.profile.weekly_cap_hours,
            data.profile.weekly_cap_until,
          )}
        </b>
      </span>,
    );
  }
  if (phase === 5 && row.employee_id !== null) {
    facts.push(
      <span key="emp">
        Employee ID <b className="cyan">{employeeId(row.employee_id)}</b>
      </span>,
    );
  }
  if (phase <= 2) {
    facts.push(
      <span key="email">
        <b>{row.email}</b>
      </span>,
    );
  }
  // The mobile stays through Quiz (candidate.html): the office may need to
  // call about an attempt; from Additional info on it is on the profile.
  if (phase <= 3) {
    facts.push(
      <span key="phone">
        <b>{row.phone}</b>
      </span>,
    );
  }
  if (phase <= 0 && row.gdpr_consent_at) {
    facts.push(
      <span key="gdpr">
        GDPR consent <b>✓ {formatUkDate(row.gdpr_consent_at)}</b>
      </span>,
    );
  }
  if (phase === 2 && data.profile?.home_address) {
    facts.push(
      <span key="addr">
        Address <b>{data.profile.home_address}</b>
      </span>,
    );
  }
  // ADR-0080: the languages they gave on step 2, once they have.
  if (data.facts?.languages) {
    facts.push(
      <span key="languages">
        Speaks <b>{formatLanguages(data.facts.languages)}</b>
      </span>,
    );
  }
  // ADR-0047: who referred them, on every phase — the office's to see,
  // never the applicant's. The name opens the referrer's profile.
  if (data.referralProblem) {
    // Audit D18: a failed read is not "not referred".
    facts.push(
      <span key="referral" className="coral">
        Referral could not be read: {data.referralProblem}
      </span>,
    );
  } else if (data.referral) {
    facts.push(
      <span key="referral">
        <Link href={`/staff/${data.referral.referrerId}`} className="cyan">
          <b>{referredByLabel(data.referral)}</b>
        </Link>
      </span>,
    );
  }
  if (phase === 2) {
    // "Activated 13.09.2026 (E3)" — candidate.html; the date is when the
    // password was set (activated_at, 20260928110000).
    facts.push(
      <span key="act">
        {row.activated && row.activated_at ? (
          <>
            Activated <b>{formatUkDate(row.activated_at)}</b> (E3)
          </>
        ) : row.activated ? (
          'Activated (E3)'
        ) : (
          'Not activated yet — E3 sent'
        )}
      </span>,
    );
  }
  return <div className="facts">{facts}</div>;
}

// ---------------------------------------------------------------------
// 1 · Interview requested
// ---------------------------------------------------------------------
/**
 * The phase strip (§2.3). Same markup and classes as the design system's
 * Stepper, but every step up to the current one is a button: a phase that is
 * done is still worth reading, and the strip is how you get back to it.
 */
function PhaseStepper({
  phase,
  viewing,
  onView,
}: {
  phase: number;
  viewing: number;
  onView: (index: number) => void;
}) {
  return (
    <ol className="stepper">
      {COLUMNS.map((c, index) => {
        const inner = (
          <>
            <span className="k">{index + 1}</span>
            <span className="t">{c.label}</span>
          </>
        );
        return (
          <li
            key={c.key}
            className={`st${index < phase ? ' done' : ''}${index === phase ? ' now' : ''}${index === viewing && viewing !== phase ? ' viewing' : ''}`}
            aria-current={index === viewing ? 'step' : undefined}
          >
            {index <= phase ? (
              <button type="button" className="st-btn" onClick={() => onView(index)}>
                {inner}
              </button>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ol>
  );
}

function WilloButton({ url, primary }: { url: string | null; primary?: boolean }) {
  if (!url) {
    return (
      <Button
        tone="ghost"
        disabled
        aria-disabled="true"
        title="Willo is not connected yet — the link appears once THC's Willo account is set up in Settings"
      >
        Review interview on Willo — not connected
      </Button>
    );
  }
  return (
    <a
      className={primary ? 'btn primary' : 'btn outline'}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      Review interview on Willo ↗
    </a>
  );
}

function InterviewRequested({
  row,
  data,
  onMarkComplete,
}: {
  row: CandidateRow;
  data: CandidateData;
  /** ADR-0077: set for an owner or a manager on a live Interview requested profile. */
  onMarkComplete: (() => void) | null;
}) {
  const answers =
    (row.willo_answers_done ?? 0) > 0
      ? `in progress (${row.willo_answers_done} of ${row.willo_answers_total ?? '?'} answers)`
      : 'not started';
  return (
    <div className="grid c2">
      <Panel title="Application" actions={<Pill>/apply</Pill>}>
        <div className="kv">
          <span className="k">First name</span>
          <span>{row.first_name}</span>
          <span className="k">Surname</span>
          <span>{row.last_name}</span>
          <span className="k">Email</span>
          <span>{row.email}</span>
          <span className="k">Mobile</span>
          <span>{row.phone}</span>
          <span className="k">Age</span>
          <span>
            {row.age ?? row.applied_age_band ?? '—'}{' '}
            <span className="muted sm">(18 or over — checked on the form and on the server)</span>
          </span>
          <span className="k">GDPR consent</span>
          <span className="green">
            {data.application
              ? `✓ given ${formatUkStamp(data.application.consented_at)}`
              : row.gdpr_consent_at
                ? `✓ ${formatUkStamp(row.gdpr_consent_at)}`
                : '—'}
          </span>
          <span className="k">Duplicate check</span>
          <span className="muted">
            {data.application?.outcome === 'returning_applicant'
              ? 'Matched an existing record — reset to candidate on this record'
              : 'No match on email or mobile + DOB → new record created'}
          </span>
        </div>
      </Panel>
      <Panel
        title="AI video interview · Willo"
        actions={
          <Pill tone="amber">{row.willo_linked ? 'Invitation sent' : 'Not yet in Willo'}</Pill>
        }
      >
        <div className="stack">
          <div className="kv">
            <span className="k">Created in Willo</span>
            <span>
              {row.willo_invited_at
                ? `${formatUkStamp(row.willo_invited_at)} — automatically on submission (E1)`
                : 'Pending — the Willo integration is not connected yet (needs THC’s API key)'}
            </span>
            <span className="k">Invitation</span>
            <span>
              {row.willo_linked ? (
                <>
                  Sent by Willo by email · <span className="amber">{answers}</span>
                </>
              ) : (
                '—'
              )}
            </span>
            <span className="k">Tracking</span>
            <span>Status arrives from the Willo webhook by itself — nothing to update by hand</span>
          </div>
          <div className="row wrap">
            <WilloButton url={row.willo_review_url} />
            {onMarkComplete ? (
              <Button
                tone="ghost"
                title="Owners and managers: move to Interview completed without Willo, with a reason"
                onClick={onMarkComplete}
              >
                Mark interview complete
              </Button>
            ) : null}
          </div>
          <Note>
            No documents are held on this phase — the Documents panel appears only once the
            candidate is accepted.
          </Note>
        </div>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------
// 2 · Interview completed — Accept with the role type(s)
// ---------------------------------------------------------------------
function InterviewCompleted({
  row,
  data,
  past,
  canAccept,
  busy,
  problem,
  onAccept,
  onReject,
}: {
  row: CandidateRow;
  data: CandidateData;
  /** Looking back from a later phase: the decision has been made. */
  past: boolean;
  canAccept: boolean;
  busy: boolean;
  /** The last refusal — shown here as well as at the top, which is off-screen once scrolled to Accept. */
  problem: string | null;
  onAccept: (roles: string[], note: string) => void;
  onReject: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(row.role_ids);
  const [note, setNote] = useState('');
  const toggle = (id: string) =>
    setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));

  return (
    <div className="grid c2">
      <Panel
        title="AI video interview · Willo"
        actions={
          row.willo_completed_at ? (
            <Pill tone="green">
              Completed {formatUkStamp(row.willo_completed_at).replace(' UK time', '')}
            </Pill>
          ) : (
            <Pill>Completed</Pill>
          )
        }
      >
        <div className="stack">
          <div className="kv">
            <span className="k">Completed</span>
            {data.interviewOverride ? (
              <span>
                {formatUkStamp(data.interviewOverride.at)} — marked complete by{' '}
                {data.interviewOverride.byName ?? 'the office'} without Willo
                {data.interviewOverride.reason ? `: “${data.interviewOverride.reason}”` : ''}
              </span>
            ) : (
              <span>
                {row.willo_completed_at ? formatUkStamp(row.willo_completed_at) : '—'} — card moved
                here on its own (Willo &quot;New Response&quot; webhook)
              </span>
            )}
            <span className="k">Answers</span>
            <span>
              {row.willo_answers_total
                ? `${row.willo_answers_done ?? row.willo_answers_total} of ${row.willo_answers_total} video answers`
                : '—'}
            </span>
            <span className="k">Decision</span>
            {data.interviewOverride ? (
              past ? (
                <span className="green">Accepted by the office</span>
              ) : (
                <span className="amber">Awaiting — Accept or Reject here</span>
              )
            ) : past ? (
              <span className="green">
                Accepted — made inside Willo, where the video is watched
              </span>
            ) : (
              <span className="amber">
                Awaiting — made inside Willo, where the video is watched
              </span>
            )}
          </div>
          <div>
            <WilloButton url={row.willo_review_url} primary />
          </div>
          <Note>
            Rejected in Willo → the system rejects automatically and sends E2 (THC wording).
            Accepted in Willo → the profile advances to Documents by itself and E3 (activation +
            password + &quot;download the app&quot;) goes out. The decision is not repeated here.
          </Note>
        </div>
      </Panel>
      {past ? (
        <Panel title="Qualified role type(s)">
          {row.role_names.length > 0 ? (
            <div className="row wrap">
              {row.role_names.map((role) => (
                <Chip key={role}>{role}</Chip>
              ))}
            </div>
          ) : (
            <span className="muted sm">None picked.</span>
          )}
        </Panel>
      ) : (
        <Panel title="Accept → qualified role type(s)">
          <div className="stack">
            <p className="sm muted">
              On acceptance the manager selects the role(s) the candidate is qualified for — this is
              what makes them eligible for shifts of that role later. Multi-select; editable later
              on the staff profile.
            </p>
            <RolePick roles={data.roles} picked={picked} onToggle={toggle} />
            <div className="row wrap">
              <Button
                tone="primary"
                disabled={!canAccept || busy || picked.length === 0}
                onClick={() => onAccept(picked, note)}
              >
                {busy ? 'Accepting…' : 'Accept — move to Documents'}
              </Button>
              <Button tone="danger" disabled={busy} onClick={onReject}>
                Reject (E2)
              </Button>
            </div>
            {problem ? <Alert tone="coral">{problem}</Alert> : null}
            <Input
              label="Internal note (optional)"
              placeholder="e.g. strong English, has silver-service experience"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </Panel>
      )}
    </div>
  );
}

function RolePick({
  roles,
  picked,
  onToggle,
}: {
  roles: CandidateData['roles'];
  picked: string[];
  onToggle: (id: string) => void;
}) {
  if (roles.length === 0)
    return <EmptyState>No roles exist yet — add them under Roles.</EmptyState>;
  return <RoleGroups roles={roles} picked={picked} onToggle={onToggle} />;
}

/**
 * The role tick-boxes, grouped Front of House / Back of House (then Other for
 * a role the grouping does not know), each A → Z. Display only — see
 * `roleArea` in @thc/domain.
 */
function RoleGroups({
  roles,
  picked,
  onToggle,
  disabled = false,
}: {
  roles: CandidateData['roles'];
  picked: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="stack">
      {groupRolesByArea(roles).map((group) => (
        <section key={group.area} aria-label={group.label} className="rolegroup">
          <div className="rolegroup-head">
            <b>{group.label}</b>
            <span className="muted sm">{group.roles.length}</span>
          </div>
          <div className="rolepick">
            {group.roles.map((role) => {
              const on = picked.includes(role.id);
              return (
                <label key={role.id} className={on ? 'check sel' : 'check'}>
                  <input
                    type="checkbox"
                    className="check-input"
                    checked={on}
                    disabled={disabled}
                    onChange={() => onToggle(role.id)}
                  />
                  <span className={on ? 'box on' : 'box'} />
                  {role.name}
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// 3 · Documents
// ---------------------------------------------------------------------
/**
 * What a Verify carries: the term periods for the term letter, and for a
 * visa document, status document or share code report the right-to-work
 * date the manager confirmed (20260923200000 refuses those three without it).
 */
interface VerifyChoice {
  periods?: Period[] | null;
  expiry?: string | null;
}

interface DocHandlers {
  readOnly: boolean;
  busy: boolean;
  /** Whose documents: the office's uploads go under this worker's folder. */
  staffId: string;
  /** The candidate's right-to-work branch (§2.5): decides whether settled status may be confirmed. */
  branch: string | null;
  onVerify: (doc: CandidateDocument, input?: VerifyChoice) => void;
  /** `suggested`: the gov.uk check's N8 text to pre-fill the reason with (ADR-0041). */
  onReject: (doc: CandidateDocument, suggested?: string) => void;
  onOpen: (docId: string, which: 'file' | 'report') => void;
}

function docMeta(doc: CandidateDocument, niNumber: string | null): ReactNode {
  const parts: string[] = [`Uploaded ${formatUkStamp(doc.uploaded_at)}`];
  if (doc.awarding_institution) parts.push(doc.awarding_institution);
  if (doc.doc_type === 'university_term_dates_letter') {
    parts.push(`${(doc.term_dates ?? []).length} holiday range(s) found`);
    if (doc.expires_on)
      parts.push(`Letter expires ${formatUkDate(doc.expires_on)} (calendar-year rule)`);
  } else if (doc.doc_type === 'university_completion_letter') {
    if (doc.completion_date) parts.push(`Course completion ${formatUkDate(doc.completion_date)}`);
  } else if (doc.expiry_date) {
    parts.push(`AI expiry ${formatUkDate(doc.expiry_date)}`);
  }
  if (doc.doc_type === 'ni_evidence') {
    // D43: the full number beside the evidence it has to match — or, not
    // entered yet, that it comes back to Needs review once it is.
    parts.push(niEvidenceLine(niNumber));
    if (doc.ni_recheck && niNumber) parts.push('waiting in Needs review to be compared');
  }
  if (doc.review_status === 'verified' && doc.reviewed_at) {
    parts.push(
      `Verified${doc.reviewed_by_name ? ` by ${doc.reviewed_by_name}` : ''} · ${formatUkStamp(doc.reviewed_at)}`,
    );
  }
  if (doc.review_status === 'rejected' && doc.rejection_reason) {
    parts.push(`Rejected: “${doc.rejection_reason}” — awaiting re-upload (N8 sent)`);
  }
  return parts.join(' · ');
}

function DocumentLine({
  doc,
  handlers,
  niNumber,
  periods,
}: {
  doc: CandidateDocument;
  handlers: DocHandlers;
  niNumber: string | null;
  periods?: Period[] | null;
}) {
  const badge = aiBadge(doc.ai_confidence, doc.needs_manual_review);
  const pill = REVIEW_PILL[doc.review_status];
  const actionable = !handlers.readOnly && doc.review_status === 'pending';
  // A visa or status document is verified on its expiry: the one the
  // candidate typed at step 1 (or the AI read) is pre-filled to confirm.
  const rule = rtwDateRule(doc.doc_type, handlers.branch);
  const [expiry, setExpiry] = useState(doc.expiry_date ?? '');
  const expiryProblem = rtwDateProblem(rule, expiry, false);
  return (
    <DocRow
      icon={ICON[doc.doc_type] ?? 'DOC'}
      state={STATE[doc.review_status]}
      title={
        <>
          {doc.doc_label}
          {badge ? <span className={`ai ${badge.tone}`}>{badge.label}</span> : null}
        </>
      }
      meta={docMeta(doc, niNumber)}
      actions={
        <>
          <Pill tone={pill.tone}>{pill.label}</Pill>
          {actionable && doc.doc_type === 'university_completion_letter' ? (
            // A completion letter is approved, not verified: the reviewer
            // confirms the completion date AND the visa expiry, and the
            // database refuses a bare Verify (completion_letter_approval_guard,
            // 20260923100100). That form lives in the Needs review queue.
            <Link className="btn sm" href="/compliance">
              Review in Compliance
            </Link>
          ) : actionable ? (
            <>
              {rule ? (
                <input
                  className="input mono"
                  type="date"
                  aria-label={`${rule.label} — confirm against the document`}
                  title={rule.hint}
                  value={expiry}
                  onChange={(event) => setExpiry(event.target.value)}
                />
              ) : null}
              <Button
                size="sm"
                tone="green"
                disabled={
                  handlers.busy ||
                  (periods ? periodsProblem(periods) !== null : false) ||
                  expiryProblem !== null
                }
                title={expiryProblem ?? undefined}
                onClick={() =>
                  handlers.onVerify(doc, { periods: periods ?? null, expiry: rule ? expiry : null })
                }
              >
                Verify
              </Button>
              <Button
                size="sm"
                tone="danger"
                disabled={handlers.busy}
                onClick={() => handlers.onReject(doc)}
              >
                Reject
              </Button>
            </>
          ) : null}
          {doc.file_path ? (
            <Button size="sm" tone="ghost" onClick={() => handlers.onOpen(doc.id, 'file')}>
              Download
            </Button>
          ) : null}
        </>
      }
    />
  );
}

/**
 * The gov.uk share-code report (§2.3, §2.6): the worker typed the code with
 * their DOB, and the automated check (ADR-0025) asks gov.uk — a pass
 * verifies it by itself, with the right-to-work-until gov.uk returned and
 * the PDF stored here. Only a check that needs review (or the automation
 * switched off) puts the date in front of the manager to confirm — Verify is
 * refused without it, because it is the worker's right-to-work expiry and
 * the last day they can be rostered (ADR-0018). On the EU settled branch,
 * settled status is confirmed explicitly as no time limit.
 *
 * ADR-0041: every result now waits for the admin. A check that recommends
 * Verify shows gov.uk's date read-only — the admin compares the photos in
 * the panel and Verify sends exactly that date; one that recommends Reject
 * opens the Reject box with its suggested N8 text.
 */
function ShareCodeCard({
  doc,
  handlers,
  check,
  checkEnabled,
  claim = null,
}: {
  doc: CandidateDocument;
  handlers: DocHandlers;
  check: RtwCheckRow | null;
  checkEnabled: boolean;
  /** ADR-0070: a date of birth entered with this code, when it differs. */
  claim?: DobClaim | null;
}) {
  const format = useTimeFormat();
  const view = rtwCheckView(check, {
    docStatus: doc.review_status,
    enabled: checkEnabled,
    format,
  });
  const pill = view.status ?? REVIEW_PILL[doc.review_status];
  // ADR-0041: a check that recommends Verify or Reject is the check's own
  // pill ("Recommend verify — compare the photo", "Recommend reject"), not "Manual review".
  const recommended =
    check?.status === 'needs_review' &&
    (check.recommendation === 'verify' || check.recommendation === 'reject');
  const manual = check
    ? check.status === 'needs_review' && !recommended
    : doc.needs_manual_review && !checkEnabled;
  const actionable = !handlers.readOnly && doc.review_status === 'pending';
  // gov.uk's date, confirmed read-only on Verify (ADR-0041), else typed.
  const locked = actionable ? view.lockedUntil : null;
  const typing = actionable && view.manualAllowed && !locked;
  const rule = rtwDateRule(doc.doc_type, handlers.branch);
  // ADR-0041: gov.uk's date waits on the check (admin-only), not on the
  // worker-readable document, so a typed date starts from it.
  const [until, setUntil] = useState(
    doc.right_to_work_until ??
      (check?.outcome === 'right_to_work' ? check.right_to_work_until : null) ??
      '',
  );
  const [noTimeLimit, setNoTimeLimit] = useState(false);
  const problem = locked
    ? rtwDateProblem(rule, locked.date ?? '', locked.noTimeLimit)
    : rtwDateProblem(rule, until, noTimeLimit);
  return (
    <div className="pdfcard">
      <div className="thumb">
        GOV.UK
        <br />
        PDF
      </div>
      <div className="grow stack">
        <div className="row wrap">
          <b>gov.uk right-to-work report</b>
          <Pill tone={manual ? 'coral' : pill.tone}>{manual ? 'Manual review' : pill.label}</Pill>
          <span className={manual ? 'ai manual' : 'ai hi'}>
            {manual
              ? 'needs manual review'
              : recommended
                ? 'automatic check · your decision'
                : 'automatic check'}
          </span>
        </div>
        <div className="kv">
          <span className="k">Share code</span>
          <span className="mono">
            {orDash(doc.share_code)}{' '}
            <span className="muted xs">
              (entered by the candidate in the app with DOB — never by the manager)
            </span>
          </span>
          <span className="k">Right to work until</span>
          {locked ? (
            <span>
              <b className="mono">{rtwLockedLabel(locked)}</b>{' '}
              <span className="muted sm">
                — returned by gov.uk; Verify confirms it as it is. It becomes the expiry used for
                reminders and the last day they can be rostered
              </span>
            </span>
          ) : typing ? (
            <span className="stack">
              <span className="row wrap">
                <input
                  className="input mono"
                  type="date"
                  aria-label="Right to work until, from the gov.uk report"
                  value={noTimeLimit ? '' : until}
                  disabled={noTimeLimit}
                  onChange={(event) => setUntil(event.target.value)}
                />
                <span className="muted sm">
                  read off the report — becomes the expiry used for reminders and the last day they
                  can be rostered
                </span>
              </span>
              {rule?.allowNoTimeLimit ? (
                <label className="row sm">
                  <input
                    type="checkbox"
                    checked={noTimeLimit}
                    onChange={(event) => setNoTimeLimit(event.target.checked)}
                  />
                  Settled status — no time limit. Pre-settled has an end date: enter it.
                </label>
              ) : null}
            </span>
          ) : actionable && view.inFlight ? (
            <span className="muted sm">checking with gov.uk… — a pass fills this in by itself</span>
          ) : (
            <span>
              <b>{rtwUntilLabel(doc)}</b>{' '}
              <span className="muted sm">— becomes the expiry used for reminders</span>
            </span>
          )}
          {!check ? (
            <>
              <span className="k">Checked</span>
              <span>{formatUkStamp(doc.uploaded_at)} · gov.uk/view-right-to-work</span>
            </>
          ) : null}
        </div>
        <RtwCheckPanel
          row={check}
          docId={doc.id}
          docStatus={handlers.readOnly ? 'read_only' : doc.review_status}
          enabled={checkEnabled}
        />
        {doc.review_status === 'pending' ? <DobClaimNote claim={claim} /> : null}
        <div className="row wrap">
          {doc.gov_report_path && !check?.report_path ? (
            <Button size="sm" onClick={() => handlers.onOpen(doc.id, 'report')}>
              Download gov.uk report
            </Button>
          ) : null}
          {typing || locked ? (
            <Button
              size="sm"
              tone="green"
              disabled={handlers.busy || problem !== null}
              title={problem ?? undefined}
              onClick={() =>
                handlers.onVerify(doc, {
                  expiry: locked ? rtwLockedValue(locked) : rtwDateValue(until, noTimeLimit),
                })
              }
            >
              Verify
            </Button>
          ) : null}
          {actionable ? (
            <Button
              size="sm"
              tone="danger"
              disabled={handlers.busy}
              onClick={() => handlers.onReject(doc, view.suggestedReason ?? undefined)}
            >
              Reject
            </Button>
          ) : null}
          {!handlers.readOnly && canAttachReport(doc, check, checkEnabled) ? (
            // The manual path's report (D31): the automated check stores its own.
            <RtwReportUpload docId={doc.id} staffId={handlers.staffId} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * What else the AI read off the term letter (§2.3): when the course starts,
 * when it is expected to end, and anything the letter itself says about
 * working hours. For the reviewer to check against the letter, nothing more:
 * the weekly limit below is calculated from the confirmed holiday dates
 * (RULE-20), an expected end date lifts nothing, and only a verified
 * completion letter does. The hours line is the letter's own words, never a
 * number the system adopts.
 */
function CourseFacts({
  doc,
  badge,
}: {
  doc: CandidateDocument;
  badge: ReturnType<typeof aiBadge>;
}) {
  const facts = doc.ai_term_letter ?? null;
  // No answer stored: the read has not run (or the extractor is off).
  if (!facts) {
    return (
      <div className="kv">
        <span className="k">Course dates · hours</span>
        <span className="muted sm">
          Not read from the letter yet — the AI read runs shortly after upload. Check the letter
          yourself if it does not appear.
        </span>
      </div>
    );
  }
  const notPrinted = <span className="muted">not printed on the letter</span>;
  return (
    <div className="kv">
      <span className="k">Course starts</span>
      <span>
        {facts.courseStart ? <b className="mono">{ukDateOnly(facts.courseStart)}</b> : notPrinted}{' '}
        {facts.courseStart && badge ? (
          <span className={`ai ${badge.tone}`}>{badge.label}</span>
        ) : null}
      </span>
      <span className="k">Expected end</span>
      <span>
        {facts.courseEnd ? <b className="mono">{ukDateOnly(facts.courseEnd)}</b> : notPrinted}{' '}
        {facts.courseEnd && badge ? (
          <span className={`ai ${badge.tone}`}>{badge.label}</span>
        ) : null}
        <br />
        <span className="muted sm">
          For reference. It does not change the weekly limit — only a verified completion letter
          lifts the term-time cap.
        </span>
      </span>
      <span className="k">The letter says about hours</span>
      <span>
        {facts.hoursStatement ? <>“{facts.hoursStatement}”</> : notPrinted}
        <br />
        <span className="muted sm">
          The letter’s own words. The weekly limit below is calculated from the dates, not from
          this.
        </span>
      </span>
    </div>
  );
}

/**
 * Term dates read off the letter (§2.3): every AI period shown, "+ Add
 * period" for one the AI missed, remove for a wrong one. The manager
 * confirms the DATES, not the hours — the cap below is calculated from
 * them (RULE-20) and there is no field to type a number into.
 */
function TermDates({
  doc,
  periods,
  setPeriods,
  editable,
  capText,
}: {
  doc: CandidateDocument;
  periods: Period[];
  setPeriods: (next: Period[]) => void;
  editable: boolean;
  capText: string;
}) {
  const badge = aiBadge(doc.ai_confidence, doc.needs_manual_review);
  const aiCount = (doc.term_dates ?? []).length;
  const problem = periodsProblem(periods);
  const update = (index: number, patch: Partial<Period>) =>
    setPeriods(periods.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  return (
    <div className="card term stack">
      <div className="row wrap">
        <h4>Term dates read from the letter</h4>
        <span className="muted sm">
          Verify the dates against the letter — the manager confirms the dates, not the hours
        </span>
      </div>
      <CourseFacts doc={doc} badge={badge} />
      <hr />
      {periods.length === 0 ? (
        <div className="muted sm">No holiday periods — add any the letter shows.</div>
      ) : (
        <div className="periods">
          <div className="period head">
            <span className="label">#</span>
            <span className="label">Period</span>
            <span className="label">From</span>
            <span />
            <span className="label">To</span>
            <span className="label">Source</span>
            <span />
          </div>
          {periods.map((period, index) => (
            <div className="period" key={index}>
              <span className="mono muted">{index + 1}</span>
              <span>Holiday {index + 1}</span>
              <input
                className="input mono"
                type="date"
                aria-label={`Period ${index + 1} from`}
                value={period.from}
                disabled={!editable}
                onChange={(event) => update(index, { from: event.target.value })}
              />
              <span className="muted">→</span>
              <input
                className="input mono"
                type="date"
                aria-label={`Period ${index + 1} to`}
                value={period.to}
                disabled={!editable}
                onChange={(event) => update(index, { to: event.target.value })}
              />
              {index < aiCount && badge ? (
                <span className={`ai ${badge.tone}`}>{badge.label}</span>
              ) : (
                <span className="ai">added by hand</span>
              )}
              {editable ? (
                <button
                  type="button"
                  className="rm"
                  onClick={() => setPeriods(periods.filter((_, i) => i !== index))}
                >
                  remove
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}
      {editable ? (
        <div className="row wrap">
          <Button size="sm" onClick={() => setPeriods([...periods, { from: '', to: '' }])}>
            + Add period
          </Button>
          <span className="muted xs">
            for a range the AI missed (poor scan, non-standard letter) — any number of periods, zero
            to four is typical
          </span>
        </div>
      ) : null}
      {problem ? <div className="coral sm">{problem}</div> : null}
      <hr />
      <div className="kv">
        <span className="k">Weekly limit (calculated)</span>
        <span>
          <b>{capText}</b> <Pill>read-only</Pill>
          <br />
          <span className="muted sm">
            Derived live from the verified dates; never typed, never stored; a Mon–Sun week
            straddling term and holiday takes the lower cap. The 48 h opt-out does not apply in term
            (visa condition).
          </span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Roles and clients (§2.4, §9.6)
// ---------------------------------------------------------------------
/**
 * The qualified role type(s) and the client qualifications, editable for
 * as long as the candidate is onboarding. They are the same two lists the
 * staff profile edits (add_staff_role / grant_client_qualification), so
 * nothing picked here is lost at the contract.
 *
 * This is where roles are set when Willo's Accept moved the card on before
 * the office picked any (§2.4: "roles are picked on the profile"), and where
 * a candidate gets more than one role, or any client, at all.
 */
function RolesAndClients({
  row,
  data,
  readOnly,
  busy,
  onToggleRole,
  onGrantClients,
  onRevokeClients,
}: {
  row: CandidateRow;
  data: CandidateData;
  readOnly: boolean;
  busy: boolean;
  onToggleRole: (roleId: string, on: boolean) => void;
  onGrantClients: (clientIds: string[], roleIds: string[], after: () => void) => void;
  onRevokeClients: (ids: string[]) => void;
}) {
  // §9.6: a client entry names one of the roles the person already holds.
  const held = data.roles.filter((role) => row.role_ids.includes(role.id));

  return (
    <div className="grid c2">
      <Panel
        title="Qualified role type(s)"
        actions={
          row.role_ids.length === 0 ? (
            <Pill tone="amber">none yet</Pill>
          ) : (
            <Pill tone="green">{row.role_ids.length} selected</Pill>
          )
        }
      >
        <div className="stack">
          <div className="sm muted">
            {row.role_ids.length === 0
              ? 'Pick the role(s) the candidate is qualified for — without one they receive no invitations later. '
              : ''}
            Tick as many as apply; each tick saves straight away. Editable later on the staff
            profile.
          </div>
          {data.roles.length === 0 ? (
            <EmptyState>No roles exist yet — add them under Roles.</EmptyState>
          ) : (
            <RoleGroups
              roles={data.roles}
              picked={row.role_ids}
              disabled={readOnly || busy}
              onToggle={(id) => onToggleRole(id, !row.role_ids.includes(id))}
            />
          )}
          <Note>
            Un-ticking a role also removes the client entries that name it. A &ldquo;Do not
            return&rdquo; entry is kept.
          </Note>
        </div>
      </Panel>

      <ClientQualification
        held={held}
        clients={data.clients ?? []}
        qualifications={data.qualifications ?? []}
        readOnly={readOnly}
        busy={busy}
        onGrant={onGrantClients}
        onRevoke={onRevokeClients}
      />
    </div>
  );
}

/**
 * Client qualification (§9.6): who the candidate is cleared for at which
 * client. Two halves, so the list never grows the page:
 *
 *   Add — search the clients, tick as many as needed, one button; each client
 *   is cleared for every role the candidate holds. A client already
 *   cleared for every chosen role is shown as done, not offered again.
 *
 *   Cleared at — one line per client with its roles as chips, scrolling
 *   inside the panel and searchable once there are more than a few.
 */
function ClientQualification({
  held,
  clients,
  qualifications,
  readOnly,
  busy,
  onGrant,
  onRevoke,
}: {
  held: CandidateData['roles'];
  clients: NonNullable<CandidateData['clients']>;
  qualifications: NonNullable<CandidateData['qualifications']>;
  readOnly: boolean;
  busy: boolean;
  onGrant: (clientIds: string[], roleIds: string[], after: () => void) => void;
  onRevoke: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  // The ticks on the left are the role list: every client added is cleared for
  // all of them, so there is no second role pick here.
  const roleIds = held.map((role) => role.id);
  const groups = useMemo(() => groupQualifications(qualifications), [qualifications]);
  const cleared = useMemo(
    () => new Set(qualifications.map((q) => `${q.client_id}:${q.role_id}`)),
    [qualifications],
  );
  const doneAt = (clientId: string) =>
    roleIds.length > 0 && roleIds.every((roleId) => cleared.has(`${clientId}:${roleId}`));
  const shown = clients.filter((client) => matchesName(client.name, search));
  const pickable = shown.filter((client) => !doneAt(client.id)).map((client) => client.id);
  const toggleClient = (id: string) =>
    setChosen((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  const entries = newEntryCount(chosen, roleIds, qualifications);
  const listed = groups.filter((group) => matchesName(group.client_name, listSearch));

  return (
    <Panel
      title="Client qualification"
      actions={
        <>
          {groups.length > 0 ? (
            <Pill tone="green">
              {groups.length} client{groups.length === 1 ? '' : 's'}
            </Pill>
          ) : null}
          <span className="muted sm">auto-assign&rsquo;s first wave</span>
        </>
      }
    >
      <div className="stack">
        {readOnly ? null : held.length === 0 ? (
          <div className="sm muted">Pick at least one role first, then add clients.</div>
        ) : clients.length === 0 ? (
          <EmptyState>No clients exist yet — add them under Clients.</EmptyState>
        ) : (
          <div className="stack">
            <span className="label">
              Add clients — each is cleared for all {held.length}{' '}
              {held.length === 1 ? 'role' : 'roles'} saved on the left
            </span>
            <Input
              type="search"
              aria-label="Search clients to add"
              placeholder={`Search ${clients.length} clients…`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="row wrap sm">
              <button
                type="button"
                className="linkish"
                disabled={busy || pickable.length === 0}
                onClick={() => setChosen((now) => [...new Set([...now, ...pickable])])}
              >
                {search.trim() === '' ? 'Select all' : `Select the ${pickable.length} shown`}
              </button>
              <button
                type="button"
                className="linkish"
                disabled={busy || chosen.length === 0}
                onClick={() => setChosen([])}
              >
                Clear selection
              </button>
              <span className="muted">
                {chosen.length} selected · {shown.length} shown
              </span>
            </div>
            <div className="cq-pick" role="group" aria-label="Clients">
              {shown.length === 0 ? (
                <span className="muted sm">No client matches &ldquo;{search.trim()}&rdquo;.</span>
              ) : (
                shown.map((client) => {
                  const done = doneAt(client.id);
                  const on = chosen.includes(client.id);
                  return (
                    <label key={client.id} className={on ? 'check sel' : 'check'}>
                      <input
                        type="checkbox"
                        className="check-input"
                        checked={on}
                        disabled={busy || done}
                        onChange={() => toggleClient(client.id)}
                      />
                      <span className={on ? 'box on' : 'box'} />
                      <span className="grow">{client.name}</span>
                      {done ? <span className="muted xs">already cleared</span> : null}
                    </label>
                  );
                })
              )}
            </div>
            <div>
              <Button
                tone="primary"
                disabled={busy || entries === 0}
                onClick={() =>
                  onGrant(chosen, roleIds, () => {
                    setChosen([]);
                    setSearch('');
                  })
                }
              >
                {busy
                  ? 'Adding…'
                  : entries === 0
                    ? 'Add clients'
                    : `Add ${chosen.length} client${chosen.length === 1 ? '' : 's'} · ${entries} entr${entries === 1 ? 'y' : 'ies'}`}
              </Button>
            </div>
          </div>
        )}

        <div className="stack">
          <div className="row wrap">
            <b>Cleared at</b>
            <span className="muted sm">
              {groups.length === 0
                ? ''
                : `${groups.length} client${groups.length === 1 ? '' : 's'} · ${qualifications.length} entr${qualifications.length === 1 ? 'y' : 'ies'}`}
            </span>
          </div>
          {groups.length === 0 ? (
            <span className="muted sm">Not cleared at any client yet.</span>
          ) : (
            <>
              {groups.length > 5 ? (
                <Input
                  type="search"
                  aria-label="Search the clients cleared"
                  placeholder="Search these clients…"
                  value={listSearch}
                  onChange={(event) => setListSearch(event.target.value)}
                />
              ) : null}
              <div className="cq-list">
                {listed.length === 0 ? (
                  <span className="muted sm">
                    Nothing matches &ldquo;{listSearch.trim()}&rdquo;.
                  </span>
                ) : (
                  listed.map((group) => {
                    const removable = group.entries.filter((q) => !q.do_not_return);
                    return (
                      <div key={group.client_id} className="cq-row">
                        <b className="cq-name">{group.client_name}</b>
                        <div className="cq-chips">
                          {group.entries.map((q) =>
                            q.do_not_return ? (
                              <Pill
                                key={q.id}
                                tone="coral"
                                title="Do not return — switch it off on the staff profile first"
                              >
                                {q.role_name} · do not return
                              </Pill>
                            ) : (
                              <Chip
                                key={q.id}
                                onRemove={readOnly || busy ? undefined : () => onRevoke([q.id])}
                              >
                                {q.role_name}
                              </Chip>
                            ),
                          )}
                        </div>
                        {readOnly || removable.length < 2 ? null : (
                          <Button
                            size="sm"
                            tone="ghost"
                            disabled={busy}
                            onClick={() => onRevoke(removable.map((q) => q.id))}
                          >
                            Remove all
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
        <Note>
          Optional. Choose the roles, tick the clients, add them in one go — each role is its own
          entry. A clean shift also adds entries by itself, and the list is editable later on the
          staff profile and the client card.
        </Note>
      </div>
    </Panel>
  );
}

function DocumentsPhase({
  row,
  data,
  doc,
  onToggleRole,
  onGrantClients,
  onRevokeClients,
  onVerifyDeclaration,
  onRejectDeclaration,
}: {
  row: CandidateRow;
  data: CandidateData;
  doc: DocHandlers;
  onToggleRole: (roleId: string, on: boolean) => void;
  onGrantClients: (clientIds: string[], roleIds: string[], after: () => void) => void;
  onRevokeClients: (ids: string[]) => void;
  onVerifyDeclaration: (d: Declaration) => void;
  onRejectDeclaration: (d: Declaration) => void;
}) {
  const live = data.documents.filter((d) => !d.superseded);
  const superseded = data.documents.filter((d) => d.superseded);
  const termLetter = live.find((d) => d.doc_type === 'university_term_dates_letter');
  const [periods, setPeriods] = useState<Period[]>(() =>
    (termLetter?.term_dates ?? []).map(parsePeriod).filter((p): p is Period => p !== null),
  );
  const shareCode = live.filter((d) => d.doc_type === 'share_code_report');
  const checks = checksByDocument(data.rtwChecks ?? []);
  const others = live.filter((d) => d.doc_type !== 'share_code_report');
  const declarations = data.declarations.filter((d) => !d.superseded);
  const gate = quizGate(row);
  const niNumber = data.facts?.niNumber ?? null;
  const capText = data.profile
    ? candidateCap(
        data.profile.weekly_cap_band,
        data.profile.weekly_cap_hours,
        data.profile.weekly_cap_until,
      )
    : '—';
  const verifiedItems =
    row.docs_verified +
    (row.declaration_answer === true && row.declaration_status === 'verified' ? 1 : 0);
  const totalItems = row.docs_total + (row.declaration_answer === true ? 1 : 0);

  return (
    <>
      <RolesAndClients
        row={row}
        data={data}
        readOnly={doc.readOnly}
        busy={doc.busy}
        onToggleRole={onToggleRole}
        onGrantClients={onGrantClients}
        onRevokeClients={onRevokeClients}
      />

      <Alert tone={gate.unlocked ? 'green' : 'amber'}>
        <b>
          {verifiedItems} of {totalItems} items verified.
        </b>{' '}
        The quiz stays locked until every document <i>and</i> the Criminal Record declaration
        (answered Yes) are verified — then the candidate advances to Quiz by themselves. The AI
        pre-fills and shows confidence; it never verifies — the final word is the manager’s.
        {gate.outstanding.length > 0 ? (
          <>
            <br />
            <span className="sm">Outstanding: {gate.outstanding.join(' · ')}</span>
          </>
        ) : null}
      </Alert>

      <Panel
        title={`Right to Work · ${row.rtw_branch ? (RTW_LABEL[row.rtw_branch] ?? row.rtw_branch) : 'branch not chosen yet'}`}
        actions={
          <>
            {/* §2.5: which of the five branches, and the document set it collects. */}
            {row.rtw_branch && RTW_BRANCH_NO[row.rtw_branch] ? (
              <>
                <Pill tone="cyan">Branch {RTW_BRANCH_NO[row.rtw_branch]} of 5</Pill>
                <span className="muted sm">{RTW_REQUIRED[row.rtw_branch]}</span>
              </>
            ) : null}
            <span className="muted xs">PDF · JPG · PNG · HEIC · ≤10 MB</span>
          </>
        }
      >
        <div className="stack">
          {live.length === 0 ? (
            <EmptyState>
              Nothing uploaded yet. The candidate uploads at wizard step 4/11 after activating their
              account.
            </EmptyState>
          ) : null}
          {others.map((d) => (
            <div key={d.id} className="stack">
              <DocumentLine
                doc={d}
                handlers={doc}
                niNumber={niNumber}
                periods={d.doc_type === 'university_term_dates_letter' ? periods : undefined}
              />
              {d.doc_type === 'university_term_dates_letter' ? (
                <TermDates
                  doc={d}
                  periods={periods}
                  setPeriods={setPeriods}
                  editable={!doc.readOnly && d.review_status === 'pending'}
                  capText={capText}
                />
              ) : null}
            </div>
          ))}
          {shareCode.map((d) => (
            <ShareCodeCard
              key={d.id}
              doc={d}
              handlers={doc}
              check={checks.get(d.id) ?? null}
              checkEnabled={data.rtwCheckEnabled ?? false}
              claim={(data.dobClaims ?? []).find((c) => c.documentId === d.id) ?? null}
            />
          ))}
          {!doc.readOnly && canUploadCompletionLetter(row, data.documents) ? (
            <CompletionLetterUpload staffId={row.id} />
          ) : null}
          {row.share_code && shareCode.length === 0 ? (
            <Note>
              Share code <span className="mono">{row.share_code}</span> saved by the candidate, not
              yet submitted for checking — the gov.uk check starts when they submit their documents,
              and its report appears here. Progress is under Compliance → gov.uk checks.
            </Note>
          ) : null}

          {/* §2.7: the selfie is part of the document set the wireframe lists. */}
          <DocRow
            icon="IMG"
            title="Profile selfie"
            meta={
              row.photo_path
                ? 'Taken in the app at wizard step 4 · becomes the avatar across the whole system · locked after onboarding'
                : 'Not taken yet — the candidate takes it in the app at wizard step 4'
            }
            state={row.photo_path ? 'verified' : 'pending'}
            actions={
              row.photo_path ? <Pill tone="green">Set</Pill> : <Pill tone="amber">Not taken</Pill>
            }
          />

          {superseded.length > 0 ? (
            <div className="superseded-group stack">
              <div className="label">Superseded · read-only</div>
              {superseded.map((d) => (
                <DocRow
                  key={d.id}
                  title={d.doc_label}
                  meta={docMeta(d, null)}
                  state="pending"
                  actions={<Pill>Superseded</Pill>}
                />
              ))}
            </div>
          ) : null}
        </div>
      </Panel>

      {row.rtw_branch === 'international_student' ||
      row.rtw_branch === 'work_visa' ||
      row.rtw_branch === 'dependant_other' ? (
        <Panel
          title={
            row.rtw_branch === 'international_student'
              ? 'Course level · weekly limit in term time'
              : 'Hours limit on the visa'
          }
        >
          <RtwConditionsEditor
            staffId={row.id}
            branch={row.rtw_branch}
            belowDegreeLevel={data.facts?.belowDegreeLevel ?? false}
            visaHourLimit={data.facts?.visaHourLimit ?? null}
            checkTermLimit={
              shareCode
                .map((d) => checks.get(d.id)?.term_time_limit_hours ?? null)
                .find((hours) => hours !== null) ?? null
            }
            readOnly={doc.readOnly}
          />
        </Panel>
      ) : null}

      <Panel
        title="Criminal Record declaration"
        actions={<Pill>legal declaration, unspent convictions only</Pill>}
      >
        <div className="stack">
          {declarations.length === 0 ? (
            <div className="muted sm">Not declared yet — it is part of wizard step 4/11.</div>
          ) : null}
          {declarations.map((d) => (
            <DocRow
              key={d.id}
              icon="DECL"
              state={STATE[d.review_status]}
              title={
                <>
                  Answer:{' '}
                  <b className={d.answer ? 'coral' : undefined}>{d.answer ? 'Yes' : 'No'}</b> ·
                  declared {formatUkStamp(d.declared_at)} (
                  {d.source === 'onboarding' ? 'onboarding' : 'in employment'})
                </>
              }
              meta={
                d.answer
                  ? `Details: “${orDash(d.details)}”${d.conviction_date ? ` · Conviction date: ${formatUkDate(d.conviction_date)}` : ''} · No file — text only${d.review_note ? ` · Note: ${d.review_note}` : ''}`
                  : `No · auto-verified ${d.reviewed_at ? formatUkDate(d.reviewed_at) : formatUkDate(d.declared_at)}`
              }
              actions={
                <>
                  <Pill tone={REVIEW_PILL[d.review_status].tone}>
                    {REVIEW_PILL[d.review_status].label}
                  </Pill>
                  {d.answer && d.review_status === 'pending' && !doc.readOnly ? (
                    <>
                      <Button
                        size="sm"
                        tone="green"
                        disabled={doc.busy}
                        onClick={() => onVerifyDeclaration(d)}
                      >
                        Verify
                      </Button>
                      <Button
                        size="sm"
                        tone="danger"
                        disabled={doc.busy}
                        onClick={() => onRejectDeclaration(d)}
                      >
                        Reject
                      </Button>
                    </>
                  ) : null}
                </>
              }
            />
          ))}
          <Note>
            Verify / Reject appear <b>only</b> when the answer is Yes. A <b>No</b> answer is
            auto-verified on submission and never needs a manual action. Declarations are a history,
            never overwritten.
          </Note>
        </div>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------
// 4 · Quiz (read-only: taken in the app)
// ---------------------------------------------------------------------
function QuizPhase({ row, data, past }: { row: CandidateRow; data: CandidateData; past: boolean }) {
  const gate = quizGate(row);
  const best = row.quiz_best_score;
  const bestAttempt = data.attempts.find((a) => a.score === best);
  const verified = data.documents.filter((d) => !d.superseded && d.review_status === 'verified');
  const yes = data.declarations.find(
    (d) => !d.superseded && d.answer && d.review_status === 'verified',
  );

  return (
    <div className="grid c2">
      {gate.unlocked ? (
        <Panel
          title="Health & Safety quiz"
          actions={
            <>
              <Pill tone="green">Unlocked</Pill>
              {past ? null : (
                <span className="muted sm">
                  unlocked {formatUkStamp(row.stage_entered_at)} — the moment the last item was
                  verified
                </span>
              )}
            </>
          }
        >
          <div className="stack">
            <div className="grid c3">
              <KpiTile
                flat
                label="Pass mark"
                value={`${QUIZ_PASS_MARK}%`}
                description="from THC’s “Health and Safety Presentation Questions”"
              />
              <KpiTile
                flat
                tone={
                  row.quiz_attempts_used >= QUIZ_MAX_ATTEMPTS - 1
                    ? 'danger'
                    : row.quiz_attempts_used > 0
                      ? 'warn'
                      : 'default'
                }
                label="Attempts"
                value={`${row.quiz_attempts_used} / ${QUIZ_MAX_ATTEMPTS}`}
                description="third failure → automatic rejection (E4)"
              />
              <KpiTile
                flat
                tone={best === null ? 'default' : best >= QUIZ_PASS_MARK ? 'ok' : 'danger'}
                label="Best score"
                value={best === null ? '—' : `${Math.round(best)}%`}
                description={bestAttempt ? `attempt ${bestAttempt.attempt_no}` : 'no attempt yet'}
              />
            </div>
            <div>
              <div className="attempt head">
                <span className="label">Attempt</span>
                <span className="label">When</span>
                <span className="label">Score</span>
                <span className="label">Result</span>
              </div>
              {Array.from({ length: QUIZ_MAX_ATTEMPTS }, (_, i) => {
                const attempt = data.attempts[i];
                return (
                  <div className="attempt" key={i}>
                    <span className="mono">{i + 1}</span>
                    <span className={attempt ? undefined : 'muted'}>
                      {attempt
                        ? formatUkStamp(attempt.taken_at)
                        : i === data.attempts.length
                          ? 'not started'
                          : '—'}
                    </span>
                    <span
                      className={
                        attempt ? (attempt.passed ? 'mono green' : 'mono coral') : 'mono muted'
                      }
                    >
                      {attempt ? `${Math.round(attempt.score)}%` : '—'}
                    </span>
                    <span>
                      {attempt ? (
                        <Pill tone={attempt.passed ? 'green' : 'coral'}>
                          {attempt.passed ? 'Passed' : 'Failed'}
                        </Pill>
                      ) : (
                        <Pill>{i === QUIZ_MAX_ATTEMPTS - 1 ? 'Last attempt' : 'Available'}</Pill>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <Note>
              Read-only for the manager: the quiz is taken in the app (wizard step 6/11 after the
              H&amp;S induction, step 5). Multiple choice; questions and answers come from THC’s own
              document. Passing moves the card to Additional info.
            </Note>
          </div>
        </Panel>
      ) : (
        <Panel title="Health & Safety quiz" actions={<Pill tone="amber">Locked</Pill>}>
          <EmptyState>
            <h3>Quiz locked</h3>
            {gate.outstanding.join(' · ')} — the worker sees “Unlocks once your documents are
            verified” in the app. No attempts can be started.
          </EmptyState>
        </Panel>
      )}
      <Panel title="Gate — why it is unlocked">
        <div className="stack">
          {verified.map((d) => (
            <DocRow
              key={d.id}
              icon={ICON[d.doc_type] ?? 'DOC'}
              state="verified"
              title={DOC_LABEL[d.doc_type] ?? d.doc_label}
              meta={`Verified ${d.reviewed_at ? formatUkStamp(d.reviewed_at) : ''}${d.doc_type === 'university_term_dates_letter' ? ` · ${(d.term_dates ?? []).length} periods confirmed` : ''}`}
              actions={<Pill tone="green">Verified</Pill>}
            />
          ))}
          {yes ? (
            <DocRow
              icon="DECL"
              state="verified"
              title="Criminal Record declaration · Yes"
              meta={`Verified ${yes.reviewed_at ? formatUkStamp(yes.reviewed_at) : ''}${yes.review_note ? ` · note: “${yes.review_note}”` : ''}`}
              actions={<Pill tone="green">Verified</Pill>}
            />
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------
// 5 · Additional info (§2.10) — displayed, never verified
// ---------------------------------------------------------------------
function yesNo(value: boolean | null): string {
  return value === null ? '—' : value ? 'Yes' : 'No';
}

function AdditionalInfo({ row, data }: { row: CandidateRow; data: CandidateData }) {
  const refs = data.references;
  const hmrc = data.hmrc;
  const money = data.profile;
  const capText = money
    ? candidateCap(money.weekly_cap_band, money.weekly_cap_hours, money.weekly_cap_until)
    : '—';

  return (
    <>
      <Alert tone="cyan">
        Everything from wizard steps 7–9 lands here, in one place, without hunting through tabs:
        HMRC New Starter Checklist · Two references · Bank &amp; payroll · National Insurance. None
        of these has a Verify / Reject action or a queue entry.
      </Alert>
      <div className="grid c2">
        <Panel
          title="Two references"
          actions={
            <>
              <Pill tone={refs.length >= 2 ? 'green' : 'amber'}>
                {Math.min(refs.length, 2)} of 2
              </Pill>
              <span className="muted sm">
                step 8/11 · mandatory · no relatives · tutors / coaches accepted
              </span>
            </>
          }
        >
          <div className="grid c2">
            {refs.length === 0 ? <div className="muted sm">Not submitted yet.</div> : null}
            {refs.map((ref, index) => (
              <div className="card" key={ref.id}>
                <div className="label">Referee {index + 1}</div>
                <div className="kv narrow">
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
            <div className="muted xs" style={{ gridColumn: '1 / -1' }}>
              Collected and displayed only — not reviewed or verified; the office contacts a referee
              off-system if it wants to.
            </div>
          </div>
        </Panel>
        <Panel title="National Insurance · Bank & payroll" actions={<Pill>step 9/11</Pill>}>
          <div className="kv">
            <span className="k">NI number</span>
            <span className="mono">
              {money?.ni_number_masked ?? '—'}{' '}
              {money?.ni_number_masked ? <Pill>locked</Pill> : null}{' '}
              <span className="muted sm">
                {money?.ni_number_masked
                  ? 'masked once entered; corrections go through the office.'
                  : 'Blank — payroll still runs; E6 is sent when it is later added.'}
              </span>
            </span>
            <span className="k">Account holder</span>
            <span>{orDash(money?.bank_account_holder)}</span>
            <span className="k">Sort code</span>
            <span className="mono">{orDash(money?.bank_sort_code_masked)}</span>
            <span className="k">Account number</span>
            <span className="mono">{orDash(money?.bank_account_masked)}</span>
            <span className="k">Saved</span>
            <span>
              {money?.bank_updated_at
                ? `${formatUkStamp(money.bank_updated_at)} · E5 sent to payroll`
                : 'Not saved yet'}
            </span>
            <span className="k">48h opt-out (WTR)</span>
            <span className="muted">
              {money?.wtr_optout ? 'Signed' : 'Not signed'}
              {row.rtw_branch === 'international_student'
                ? ' — not effective in term: a visa condition an opt-out cannot lift.'
                : ''}
            </span>
          </div>
        </Panel>
        <Panel
          title="HMRC New Starter Checklist"
          actions={
            <>
              <Pill tone={hmrc ? 'green' : 'amber'}>
                {hmrc
                  ? `Submitted ${formatUkStamp(hmrc.submitted_at).replace(' UK time', '')}`
                  : 'Not submitted'}
              </Pill>
              <span className="muted sm">
                step 7/11 · no P45 upload — every worker completes this form
              </span>
            </>
          }
        >
          {hmrc ? (
            <div className="kv">
              <span className="k">Q1 Another job?</span>
              <span>{yesNo(hmrc.q1_other_job)}</span>
              <span className="k">Q2 Pension?</span>
              <span>
                {hmrc.q1_other_job ? (
                  <span className="muted">not asked (Q1 = Yes)</span>
                ) : (
                  yesNo(hmrc.q2_pension)
                )}
              </span>
              <span className="k">Q3 Since 6 April…</span>
              <span>
                {hmrc.q1_other_job || hmrc.q2_pension ? (
                  <span className="muted">not asked</span>
                ) : (
                  yesNo(hmrc.q3_since_6_april)
                )}
              </span>
              <span className="k">HMRC Statement</span>
              <span>
                <b>{hmrc.statement}</b> <Pill tone="cyan">derived</Pill>{' '}
                <span className="muted sm">
                  — the worker never sees the letter; it goes into the New Starter report.
                </span>
              </span>
              <span className="k">Student loan</span>
              <span>{studentLoanLabel(hmrc.student_loan, hmrc.postgraduate_loan)}</span>
              <span className="k">Declaration</span>
              <span className="green">
                {hmrc.declared
                  ? '✓ “I confirm that the information I’ve given on this form is correct.”'
                  : '—'}{' '}
                — {formatUkStamp(hmrc.submitted_at)}
              </span>
            </div>
          ) : (
            <div className="muted sm">The candidate has not submitted the checklist yet.</div>
          )}
        </Panel>
        <Panel title="Term dates & weekly limit" actions={<Pill>read-only</Pill>}>
          <div className="stack">
            <div className="kv">
              <span className="k">Weekly limit</span>
              <span>
                <b>{capText}</b>
              </span>
            </div>
            {(money?.term_dates ?? []).length > 0 ? (
              <div className="row wrap sm">
                {(money?.term_dates ?? []).map((range) => (
                  <Chip key={range}>{formatDateRange(range)}</Chip>
                ))}
              </div>
            ) : null}
            <div className="muted xs">
              From the verified University Term Dates Letter where there is one. Correcting a date
              on the Documents phase changes the cap from that moment on — nothing else to update.
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// 6 · Contract (§2.11)
// ---------------------------------------------------------------------
/**
 * §2.11: "The scrollable text of the zero-hours agreement + a tick-box 'I
 * agree' = the signature." The text shown is the version the candidate
 * signed — or, before signature, the one in force now — never a
 * description of it; the tick is drawn ticked only once the signature
 * exists, and the reviewer cannot tick it.
 */
function ContractPhase({ row, contract }: { row: CandidateRow; contract: ContractVersion | null }) {
  const signed = row.contract_signed_at;
  const version = row.contract_version ?? contract?.version ?? null;
  return (
    <div className="grid c2">
      <Panel title="Zero-hours agreement · T&C" actions={<Pill>step 10/11</Pill>}>
        <div className="stack">
          <div className="contract-text">
            <h4>
              {contract?.title ?? 'The Hospitality Company — Zero-hours worker agreement'}
              {version ? ` (${version})` : ''}
            </h4>
            {contract ? (
              contract.body
                .split(/\n\s*\n/)
                .filter((paragraph) => paragraph.trim() !== '')
                .map((paragraph, index) => <p key={index}>{paragraph.trim()}</p>)
            ) : (
              <p>No published agreement could be read — see contract_versions.</p>
            )}
          </div>
          {contract?.is_placeholder ? (
            <Note>
              {contractClause28Pending(contract.version)
                ? 'Clause 28, the ongoing duty to disclose an unspent conviction, is awaiting THC’s approval.'
                : 'Placeholder wording until THC supplies the agreement text.'}{' '}
              Every version carries the ongoing duty to disclose an unspent conviction.
            </Note>
          ) : null}
          <label className={signed ? 'check sel' : 'check'}>
            <input
              type="checkbox"
              className="check-input"
              checked={Boolean(signed)}
              disabled
              readOnly
              aria-label="I agree — this timestamp is my signature"
            />
            <span className={signed ? 'box on' : 'box'} />I agree — this timestamp is my signature
          </label>
          {signed ? (
            <Alert tone="green">
              <b>Signed electronically · {formatUkStamp(signed)}</b> — shown in UK time and never
              converted: it is an audit record, not an operational time.
            </Alert>
          ) : (
            <Alert tone="amber">
              Quiz passed {formatUkStamp(row.quiz_passed_at ?? row.stage_entered_at)} · additional
              info complete · <b>not yet signed</b> — the agreement is in front of them at wizard
              step 10.
            </Alert>
          )}
        </div>
      </Panel>
      <div className="stack">
        {signed ? (
          <Panel
            title="What happened on signature"
            actions={<Pill tone="green">Candidate → Staff</Pill>}
          >
            <div className="stack sm">
              <div>
                ✓ Status <b>compliant</b> — the card left the onboarding kanban
              </div>
              <div>
                ✓ Employee ID <b>{employeeId(row.employee_id)}</b> auto-generated — used in payroll
                and printed on every timesheet
              </div>
              <div>✓ Selfie avatar follows them through the whole system</div>
              <div>
                ✓ Wizard step 11 &ldquo;How it works&rdquo; shown in the app; Shifts · Radar ·
                Invites unlocked
              </div>
              <div>
                ✓ Eligible for {row.role_names.join(' and ') || 'their roles’'} invitations from the
                next auto-staffing round
              </div>
              <div className="row mt-8">
                <Link className="btn primary sm" href={`/staff/${row.id}`}>
                  Open staff profile →
                </Link>
              </div>
            </div>
          </Panel>
        ) : null}
        <Panel title="Compliance summary">
          <div className="sm">
            Documents verified, quiz passed.{' '}
            {signed ? (
              <>
                Contract signed electronically: <b>{formatUkStamp(signed)}</b>.
              </>
            ) : (
              'Contract not yet signed — the person becomes Staff, and bookable, the moment they sign.'
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
