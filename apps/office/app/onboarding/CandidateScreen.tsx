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
  Stepper,
  Textarea,
} from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { RTW_LABEL, capReason, employeeId, formatDateRange, formatUkDate } from '../staff/staff';
import { formatUkStamp } from '../staff/[id]/profile';
import {
  acceptCandidate,
  addQualifiedRole,
  documentLink,
  rejectCandidate,
  rejectDeclaration,
  rejectDocument,
  verifyDeclaration,
  verifyDocument,
} from './actions';
import {
  COLUMNS,
  DOC_LABEL,
  QUIZ_MAX_ATTEMPTS,
  QUIZ_PASS_MARK,
  REVIEW_PILL,
  aiBadge,
  candidateActions,
  columnFor,
  orDash,
  parsePeriod,
  periodsProblem,
  phaseIndex,
  phaseLabel,
  quizGate,
  stageAge,
  studentLoanLabel,
} from './view-model';
import type { Period } from './view-model';
import { rtwDateProblem, rtwDateRule, rtwDateValue } from '../compliance/rtw';
import type {
  ActionResult,
  CandidateData,
  CandidateDocument,
  CandidateRow,
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
  | { kind: 'document'; doc: CandidateDocument }
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
export function CandidateScreen({ data, now }: { data: CandidateData; now: string }) {
  const router = useRouter();
  const at = useMemo(() => new Date(now), [now]);
  const row = data.candidate as CandidateRow;
  const [reject, setReject] = useState<Reject>(null);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const actions = candidateActions(row.status);
  const readOnly = row.status === 'rejected' || row.status === 'compliant';
  const phase = phaseIndex(row);
  const column =
    row.status === 'compliant' ? 'contract' : (columnFor(row) ?? 'interview_requested');
  const age = stageAge(row.stage_entered_at, at);

  const run = (work: () => Promise<ActionResult>, after?: () => void) => {
    setProblem(null);
    start(async () => {
      const result = await work();
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
    readOnly,
    busy,
    branch: row.rtw_branch,
    onVerify: (d: CandidateDocument, input: VerifyChoice = {}) =>
      run(() =>
        verifyDocument(row.id, d.id, {
          periods: input.periods ?? null,
          expiry: input.expiry ?? null,
        }),
      ),
    onReject: (d: CandidateDocument) => {
      setReason('');
      setReject({ kind: 'document', doc: d });
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
                ? ' — Health & Safety quiz failed three times; E4 and the terminal screen in the app (§2.9).'
                : ` — by ${row.rejected_by_name ?? 'the office'}${row.rejection_reason ? `: “${row.rejection_reason}”` : ''}.`}{' '}
            Final on this record: a new application routes here as a returning applicant (§2.12).
          </Alert>
        ) : null}

        <div className="cand-head">
          <Avatar size="xl" name={row.display_name} />
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
            <Facts row={row} data={data} phase={phase} />
          </div>
          <div className="actions">
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

        <Stepper
          steps={COLUMNS.map((c, i) => ({ key: String(i + 1), label: c.label }))}
          current={phase}
        />

        {column === 'interview_requested' ? <InterviewRequested row={row} data={data} /> : null}
        {column === 'interview_completed' ? (
          <InterviewCompleted
            row={row}
            data={data}
            canAccept={actions.includes('accept')}
            busy={busy}
            onAccept={(roles, note) => run(() => acceptCandidate(row.id, roles, note))}
            onReject={() => setReject({ kind: 'candidate' })}
          />
        ) : null}
        {column === 'documents' ? (
          <DocumentsPhase
            row={row}
            data={data}
            doc={doc}
            onAddRole={(roleId) => run(() => addQualifiedRole(row.id, roleId))}
            onVerifyDeclaration={(d) => run(() => verifyDeclaration(row.id, d.id, ''))}
            onRejectDeclaration={(d) => {
              setReason('');
              setReject({ kind: 'declaration', declaration: d });
            }}
          />
        ) : null}
        {column === 'quiz' ? <QuizPhase row={row} data={data} /> : null}
        {column === 'additional_info' ? <AdditionalInfo row={row} data={data} /> : null}
        {column === 'contract' ? <ContractPhase row={row} /> : null}
      </div>

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
              </>
            ) : null}
            <Textarea
              label="Reason *"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              hint={
                reject.kind === 'candidate'
                  ? 'Kept for the office. The candidate receives E2 in THC’s wording, never this reason.'
                  : 'Sent to the worker word for word in push N8: “Document rejected — [reason]” with a Re-upload button. The new upload returns to review (§2.3, §4.1).'
              }
            />
            {reject.kind === 'candidate' ? (
              <Note>
                Rejecting a candidate is final — there is no un-reject on this record (§2.3). Their
                pending documents drop out of Compliance → Needs review.
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
function Facts({ row, data, phase }: { row: CandidateRow; data: CandidateData; phase: number }) {
  const facts: ReactNode[] = [];
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
          Age <b>{row.age}</b>
        </span>,
      );
  } else {
    if (row.dob)
      facts.push(
        <span key="dob">
          DOB <b>{formatUkDate(row.dob)}</b>
        </span>,
      );
    facts.push(
      <span key="rtw">
        Right to Work{' '}
        <b>{row.rtw_branch ? (RTW_LABEL[row.rtw_branch] ?? row.rtw_branch) : 'not chosen yet'}</b>
        {row.right_to_work_until ? ` · until ${formatUkDate(row.right_to_work_until)}` : ''}
      </span>,
    );
  }
  if (phase >= 3 && data.profile) {
    facts.push(
      <span key="cap">
        Weekly limit{' '}
        <b>
          {capReason(
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
        Employee ID <b className="cyan">{employeeId(row.employee_id)}</b>{' '}
        <span className="annot">generated at signature (§2.7)</span>
      </span>,
    );
  }
  if (phase <= 2) {
    facts.push(
      <span key="email">
        <b>{row.email}</b>
      </span>,
    );
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
  if (phase === 2) {
    facts.push(
      <span key="act">{row.activated ? 'Activated (E3)' : 'Not activated yet — E3 sent'}</span>,
    );
  }
  return <div className="facts">{facts}</div>;
}

// ---------------------------------------------------------------------
// 1 · Interview requested
// ---------------------------------------------------------------------
function WilloButton({ url, primary }: { url: string | null; primary?: boolean }) {
  if (!url) {
    return (
      <Button
        tone="outline"
        disabled
        title="Set settings.willo_review_url_template once THC supplies the Willo account (§2.4)"
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

function InterviewRequested({ row, data }: { row: CandidateRow; data: CandidateData }) {
  const answers =
    (row.willo_answers_done ?? 0) > 0
      ? `in progress (${row.willo_answers_done} of ${row.willo_answers_total ?? '?'} answers)`
      : 'not started';
  return (
    <div className="grid c2">
      <Panel title="Application" actions={<Pill>/apply · §2.1</Pill>}>
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
              ? 'Matched an existing record — reset to candidate on this record (§2.12)'
              : 'No match on email or mobile + DOB → new record created (§2.12)'}
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
          <div>
            <WilloButton url={row.willo_review_url} />
          </div>
          <Note>
            No documents are held on this phase — the Documents panel appears only once the
            candidate is accepted (§2.3).
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
  canAccept,
  busy,
  onAccept,
  onReject,
}: {
  row: CandidateRow;
  data: CandidateData;
  canAccept: boolean;
  busy: boolean;
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
            <span>
              {row.willo_completed_at ? formatUkStamp(row.willo_completed_at) : '—'} — card moved
              here on its own (Willo &quot;New Response&quot; webhook)
            </span>
            <span className="k">Answers</span>
            <span>
              {row.willo_answers_total
                ? `${row.willo_answers_done ?? row.willo_answers_total} of ${row.willo_answers_total} video answers`
                : '—'}
            </span>
            <span className="k">Decision</span>
            <span className="amber">Awaiting — made inside Willo, where the video is watched</span>
          </div>
          <div>
            <WilloButton url={row.willo_review_url} primary />
          </div>
          <Note>
            Rejected in Willo → the system rejects automatically and sends E2 (THC wording).
            Accepted in Willo → the profile advances to Documents by itself and E3 (activation +
            password + &quot;download the app&quot;) goes out. The decision is not repeated here
            (§2.4).
          </Note>
        </div>
      </Panel>
      <Panel title="Accept → qualified role type(s)" actions={<Pill>§2.4 · §9.6</Pill>}>
        <div className="stack">
          <p className="sm muted">
            On acceptance the manager selects the role(s) the candidate is qualified for — this is
            what makes them eligible for shifts of that role later. Multi-select; editable later on
            the staff profile.
          </p>
          <RolePick roles={data.roles} picked={picked} onToggle={toggle} />
          <div className="row wrap">
            <Button
              tone="primary"
              disabled={!canAccept || busy || picked.length === 0}
              onClick={() => onAccept(picked, note)}
            >
              Accept — move to Documents
            </Button>
            <Button tone="danger" disabled={busy} onClick={onReject}>
              Reject (E2)
            </Button>
            <span className="annot">
              mirrors the Willo stage change; roles are mandatory before Accept
            </span>
          </div>
          <Input
            label="Internal note (optional)"
            placeholder="e.g. strong English, has silver-service experience"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </Panel>
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
  return (
    <div className="rolepick">
      {roles.map((role) => {
        const on = picked.includes(role.id);
        return (
          <label key={role.id} className={on ? 'check sel' : 'check'}>
            <input
              type="checkbox"
              className="hide"
              checked={on}
              onChange={() => onToggle(role.id)}
            />
            <span className={on ? 'box on' : 'box'} />
            {role.name}
          </label>
        );
      })}
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
  /** The candidate's right-to-work branch (§2.5): decides whether settled status may be confirmed. */
  branch: string | null;
  onVerify: (doc: CandidateDocument, input?: VerifyChoice) => void;
  onReject: (doc: CandidateDocument) => void;
  onOpen: (docId: string, which: 'file' | 'report') => void;
}

function docMeta(doc: CandidateDocument, niMasked: string | null): ReactNode {
  const parts: string[] = [`Uploaded ${formatUkStamp(doc.uploaded_at)}`];
  if (doc.awarding_institution) parts.push(doc.awarding_institution);
  if (doc.doc_type === 'university_term_dates_letter') {
    parts.push(`${(doc.term_dates ?? []).length} holiday range(s) found`);
    if (doc.expires_on)
      parts.push(`Letter expires ${formatUkDate(doc.expires_on)} (calendar-year rule, §4.2)`);
  } else if (doc.doc_type === 'university_completion_letter') {
    if (doc.completion_date) parts.push(`Course completion ${formatUkDate(doc.completion_date)}`);
  } else if (doc.expiry_date) {
    parts.push(`AI expiry ${formatUkDate(doc.expiry_date)}`);
  }
  if (doc.doc_type === 'ni_evidence') {
    parts.push(
      niMasked
        ? `Profile NI: ${niMasked} — check the number on the document matches (§2.5 pt 7)`
        : 'No NI number on the profile yet',
    );
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
  niMasked,
  periods,
}: {
  doc: CandidateDocument;
  handlers: DocHandlers;
  niMasked: string | null;
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
      meta={docMeta(doc, niMasked)}
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
 * The gov.uk share-code report (§2.6): the worker typed the code; the date is
 * read off the report (the extractor pre-fills it, ADR-0002) and the manager
 * confirms it — Verify is refused without it, because it is the worker's
 * right-to-work expiry and the last day they can be rostered. On the EU
 * settled branch, settled status is confirmed explicitly as no time limit.
 */
function ShareCodeCard({ doc, handlers }: { doc: CandidateDocument; handlers: DocHandlers }) {
  const pill = REVIEW_PILL[doc.review_status];
  const manual = doc.needs_manual_review;
  const actionable = !handlers.readOnly && doc.review_status === 'pending';
  const rule = rtwDateRule(doc.doc_type, handlers.branch);
  const [until, setUntil] = useState(doc.right_to_work_until ?? '');
  const [noTimeLimit, setNoTimeLimit] = useState(false);
  const problem = rtwDateProblem(rule, until, noTimeLimit);
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
            {manual ? 'needs manual review' : 'automatic check'}
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
          {actionable ? (
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
                  can be rostered (§2.6, §4.4)
                </span>
              </span>
              {rule?.allowNoTimeLimit ? (
                <label className="row sm">
                  <input
                    type="checkbox"
                    checked={noTimeLimit}
                    onChange={(event) => setNoTimeLimit(event.target.checked)}
                  />
                  Settled status — no time limit (§2.5 pt 2). Pre-settled has an end date: enter it.
                </label>
              ) : null}
            </span>
          ) : (
            <span>
              <b>{doc.right_to_work_until ? formatUkDate(doc.right_to_work_until) : '—'}</b>{' '}
              <span className="muted sm">— becomes the expiry used for reminders (§2.6, §4.4)</span>
            </span>
          )}
          <span className="k">Checked</span>
          <span>{formatUkStamp(doc.uploaded_at)} · gov.uk/view-right-to-work</span>
        </div>
        <div className="row wrap">
          {doc.gov_report_path ? (
            <Button size="sm" onClick={() => handlers.onOpen(doc.id, 'report')}>
              Open PDF report
            </Button>
          ) : null}
          {actionable ? (
            <>
              <Button
                size="sm"
                tone="green"
                disabled={handlers.busy || problem !== null}
                title={problem ?? undefined}
                onClick={() => handlers.onVerify(doc, { expiry: rtwDateValue(until, noTimeLimit) })}
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
          <span className="annot">
            on failure or low confidence the check is flagged “manual review” instead of a date
          </span>
        </div>
      </div>
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
          Verify the dates against the letter — the manager confirms the dates, not the hours (§2.3)
        </span>
      </div>
      {periods.length === 0 ? (
        <div className="muted sm">No holiday periods — add any the letter shows.</div>
      ) : (
        <div>
          <div className="period head">
            <span className="label">#</span>
            <span className="label">Period</span>
            <span className="label">From</span>
            <span />
            <span className="label">To</span>
            <span />
          </div>
          {periods.map((period, index) => (
            <div className="period" key={index}>
              <span className="mono muted">{index + 1}</span>
              <span>
                Holiday {index + 1}
                {index < aiCount && badge ? (
                  <span className={`ai ${badge.tone}`}>{badge.label}</span>
                ) : (
                  <span className="ai">added by hand</span>
                )}
              </span>
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
            Derived live from the verified dates (RULE-20, §4.4); never typed, never stored; a
            Mon–Sun week straddling term and holiday takes the lower cap. The 48 h opt-out does not
            apply in term (visa condition).
          </span>
        </span>
      </div>
    </div>
  );
}

function DocumentsPhase({
  row,
  data,
  doc,
  onAddRole,
  onVerifyDeclaration,
  onRejectDeclaration,
}: {
  row: CandidateRow;
  data: CandidateData;
  doc: DocHandlers;
  onAddRole: (roleId: string) => void;
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
  const others = live.filter((d) => d.doc_type !== 'share_code_report');
  const declarations = data.declarations.filter((d) => !d.superseded);
  const gate = quizGate(row);
  const niMasked = data.profile?.ni_number_masked ?? null;
  const capText = data.profile
    ? capReason(
        data.profile.weekly_cap_band,
        data.profile.weekly_cap_hours,
        data.profile.weekly_cap_until,
      )
    : '—';
  const verifiedItems =
    row.docs_verified +
    (row.declaration_answer === true && row.declaration_status === 'verified' ? 1 : 0);
  const totalItems = row.docs_total + (row.declaration_answer === true ? 1 : 0);
  const unheld = data.roles.filter((role) => !row.role_ids.includes(role.id));

  return (
    <>
      {row.role_names.length === 0 && !doc.readOnly ? (
        <Panel title="Qualified role type(s)" actions={<Pill tone="amber">none yet</Pill>}>
          <div className="stack">
            <div className="sm muted">
              Accepted in Willo before any role was picked. Pick the role(s) the candidate is
              qualified for — without one they receive no invitations later (§2.4, §6).
            </div>
            <div className="row wrap">
              {unheld.map((role) => (
                <Button
                  key={role.id}
                  size="sm"
                  disabled={doc.busy}
                  onClick={() => onAddRole(role.id)}
                >
                  + {role.name}
                </Button>
              ))}
            </div>
          </div>
        </Panel>
      ) : null}

      <Alert tone={gate.unlocked ? 'green' : 'amber'}>
        <b>
          {verifiedItems} of {totalItems} items verified.
        </b>{' '}
        The quiz stays locked until every document <i>and</i> the Criminal Record declaration
        (answered Yes) are verified — then the candidate advances to Quiz by themselves (§2.3,
        RULE-10). The AI pre-fills and shows confidence; it never verifies — the final word is the
        manager’s (§2.6).
        {gate.outstanding.length > 0 ? (
          <>
            <br />
            <span className="sm">Outstanding: {gate.outstanding.join(' · ')}</span>
          </>
        ) : null}
      </Alert>

      <Panel
        title={`Right to Work · ${row.rtw_branch ? (RTW_LABEL[row.rtw_branch] ?? row.rtw_branch) : 'branch not chosen yet'}`}
        actions={<span className="muted xs">PDF · JPG · PNG · HEIC · ≤10 MB</span>}
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
                niMasked={niMasked}
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
            <ShareCodeCard key={d.id} doc={d} handlers={doc} />
          ))}
          {row.share_code && shareCode.length === 0 ? (
            <Note>
              Share code <span className="mono">{row.share_code}</span> entered by the candidate —
              the gov.uk report appears here once the automatic check has run (§2.6).
            </Note>
          ) : null}

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

      <Panel
        title="Criminal Record declaration"
        actions={<Pill>§2.10 · legal declaration, unspent convictions only</Pill>}
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
function QuizPhase({ row, data }: { row: CandidateRow; data: CandidateData }) {
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
              <span className="muted sm">
                unlocked {formatUkStamp(row.stage_entered_at)} — the moment the last item was
                verified
              </span>
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
              document (§2.9). Passing moves the card to Additional info.
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
      <Panel title="Gate — why it is unlocked" actions={<Pill>RULE-10</Pill>}>
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
    ? capReason(money.weekly_cap_band, money.weekly_cap_hours, money.weekly_cap_until)
    : '—';

  return (
    <>
      <Alert tone="cyan">
        Everything from wizard steps 7–9 lands here, in one place, without hunting through tabs
        (§2.10): HMRC New Starter Checklist · Two references · Bank &amp; payroll · National
        Insurance. None of these has a Verify / Reject action or a queue entry.
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
              off-system if it wants to (§2.10).
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
                ? `${formatUkStamp(money.bank_updated_at)} · E5 sent to payroll (§8)`
                : 'Not saved yet'}
            </span>
            <span className="k">48h opt-out (WTR)</span>
            <span className="muted">
              {money?.wtr_optout ? 'Signed' : 'Not signed'}
              {row.rtw_branch === 'international_student'
                ? ' — not effective in term: a visa condition an opt-out cannot lift (§4.4).'
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
                step 7/11 · no P45 upload — every worker completes this form (§2.8)
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
                  — the worker never sees the letter; it goes into the New Starter report (§9.9).
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
        <Panel title="Term dates & weekly limit" actions={<Pill>read-only · RULE-20</Pill>}>
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
function ContractPhase({ row }: { row: CandidateRow }) {
  const signed = row.contract_signed_at;
  return (
    <div className="grid c2">
      <Panel title="Zero-hours agreement · T&C" actions={<Pill>§2.11 · step 10/11</Pill>}>
        <div className="stack">
          <div className="contract-text">
            <h4>
              The Hospitality Company — Zero-hours worker agreement
              {row.contract_version ? ` (${row.contract_version})` : ''}
            </h4>
            The candidate reads the versioned agreement in the app and ticks “I agree”; the tick is
            the signature. The agreement includes the ongoing duty to disclose any unspent criminal
            conviction that arises during the engagement, using the declaration route in the app
            (§10.7).
          </div>
          {signed ? (
            <Alert tone="green">
              <b>Signed electronically · {formatUkStamp(signed)}</b> — shown in UK time and never
              converted: it is an audit record, not an operational time (§1.8).
            </Alert>
          ) : (
            <Alert tone="amber">
              Presented in the app {formatUkStamp(row.stage_entered_at)} · <b>not yet signed</b>.
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
                ✓ Status <b>compliant</b> — the card left the onboarding kanban (§2.7)
              </div>
              <div>
                ✓ Employee ID <b>{employeeId(row.employee_id)}</b> auto-generated — used in payroll
                and printed on every timesheet (§9.9, §11.3)
              </div>
              <div>✓ Selfie avatar follows them through the whole system</div>
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
