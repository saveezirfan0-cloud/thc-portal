/**
 * The onboarding kanban and candidate profile, as pure functions (§2.2,
 * §2.3, §2.4, §2.12).
 *
 * Two rules decide everything the board offers, and both are asserted in
 * `__tests__/view-model.test.ts`:
 *
 *   1. Which COLUMN a person sits in. Six columns and a five-state machine
 *      (ADR-0013): a candidate in `contract` is under "Additional info"
 *      until the HMRC checklist, two references and bank details are all
 *      in, and under "Contract" after that. A rejected candidate sits in
 *      the column they were rejected from.
 *   2. Which TRANSITIONS a button may offer. Every one is asked of
 *      `canTransitionStaff` from @thc/domain, the §2.12 machine — and the
 *      database asks `staff_transitions` the same question on the row, so
 *      a button the machine would refuse is never drawn and a request the
 *      machine refuses never lands.
 */
import { STAFF_STATUSES, canTransitionStaff } from '@thc/domain';
import type { StaffStatus as MachineStatus } from '@thc/domain';
import type {
  CandidateRow,
  RejectionCause,
  ReturningRow,
  ReviewStatus,
  StaffStatus,
} from './types';

// ---------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------
export const COLUMNS = [
  { key: 'interview_requested', label: 'Interview requested', tone: 'c1' },
  { key: 'interview_completed', label: 'Interview completed', tone: '' },
  { key: 'documents', label: 'Documents', tone: 'c3' },
  { key: 'quiz', label: 'Quiz', tone: '' },
  { key: 'additional_info', label: 'Additional info', tone: '' },
  { key: 'contract', label: 'Contract', tone: 'c6' },
] as const;

export type ColumnKey = (typeof COLUMNS)[number]['key'];

/** The onboarding statuses a person can hold while on the board. */
const ON_BOARD: ReadonlySet<StaffStatus> = new Set([
  'interview_requested',
  'interview_completed',
  'documents',
  'quiz',
  'additional_info',
  'contract',
]);

/** §2.2: the quiz pass mark and attempt limit (RULE-09). */
export const QUIZ_PASS_MARK = 80;
export const QUIZ_MAX_ATTEMPTS = 3;

type Progress = Pick<CandidateRow, 'hmrc_submitted_at' | 'references_count' | 'bank_saved'>;

/**
 * Wizard steps 7-9 (§2.10): HMRC New Starter Checklist, two references,
 * bank details. NI is optional (§2.8) and so is not part of it.
 */
export function additionalInfoComplete(row: Progress): boolean {
  return row.hmrc_submitted_at !== null && row.references_count >= 2 && row.bank_saved;
}

function columnForStatus(status: StaffStatus | null, row: Progress): ColumnKey | null {
  switch (status) {
    case 'interview_requested':
    case 'interview_completed':
    case 'documents':
    case 'quiz':
    case 'additional_info':
      return status;
    case 'contract':
      return additionalInfoComplete(row) ? 'contract' : 'additional_info';
    default:
      return null;
  }
}

type ColumnInput = Progress &
  Pick<
    CandidateRow,
    'status' | 'rejected_from' | 'rejection_cause' | 'quiz_attempts_used' | 'docs_total'
  >;

/**
 * Where a rejected card sits: "in the column where they were rejected"
 * (board, Rejected state). `rejected_from` is stamped by the database on
 * every rejection since 20260923110000; for one older than that, the
 * evidence says where it most likely happened.
 */
export function rejectedColumn(row: ColumnInput): ColumnKey {
  const stamped = columnForStatus(row.rejected_from, row);
  if (stamped) return stamped;
  if (row.rejection_cause === 'quiz_failed' || row.quiz_attempts_used >= QUIZ_MAX_ATTEMPTS) {
    return 'quiz';
  }
  if (row.rejection_cause === 'willo') return 'interview_completed';
  if (row.docs_total > 0) return 'documents';
  return 'interview_completed';
}

/** The column for a person, or null when they are not on the board at all. */
export function columnFor(row: ColumnInput): ColumnKey | null {
  if (row.status === 'rejected') return rejectedColumn(row);
  return columnForStatus(row.status, row);
}

// ---------------------------------------------------------------------
// Transitions offered (§2.12 via canTransitionStaff)
// ---------------------------------------------------------------------
function isMachineStatus(status: string): status is MachineStatus {
  return (STAFF_STATUSES as readonly string[]).includes(status);
}

export type CandidateAction = 'accept' | 'reject';
export type ReturningAction = 'reset' | 'reject_application';

/** The status each action lands the person in. */
export const ACTION_TARGET: Record<CandidateAction | 'reset', MachineStatus> = {
  accept: 'documents',
  reject: 'rejected',
  reset: 'interview_requested',
};

/**
 * What the candidate profile may offer (§2.3): "no other top area
 * buttons — only Reject candidate", plus the phase-2 Accept that mirrors
 * the Willo stage change (§2.4, BO4). Rejection is final on the record, so
 * a rejected profile offers nothing. `additional_info` is outside the
 * machine and gets nothing either, which is also what the database does.
 */
export function candidateActions(status: StaffStatus): CandidateAction[] {
  if (!isMachineStatus(status) || !ON_BOARD.has(status)) return [];
  const actions: CandidateAction[] = [];
  if (status === 'interview_completed' && canTransitionStaff(status, ACTION_TARGET.accept)) {
    actions.push('accept');
  }
  if (canTransitionStaff(status, ACTION_TARGET.reject)) actions.push('reject');
  return actions;
}

/**
 * Statuses a "Resend activation link" is offered for — the same set
 * `activation_resend_refusal()` (20260924110000) allows: accepted, and not
 * rejected, inactive or removed. The database decides; this only keeps
 * the button off screens where it could only ever be refused.
 */
const RESENDABLE: ReadonlySet<StaffStatus> = new Set<StaffStatus>([
  'documents',
  'quiz',
  'additional_info',
  'contract',
  'compliant',
  'blocked',
]);

/** Offer "Resend activation link"? Only to someone accepted who has not activated. */
export function canResendActivation(status: StaffStatus, activated: boolean): boolean {
  return !activated && RESENDABLE.has(status);
}

/**
 * The returning-applicant card (§2.12): "the manager either presses Reset
 * to candidate on it or rejects the application". Reset is drawn only
 * where the machine has the edge — blocked, rejected or inactive — so a
 * compliant worker who re-applied is offered only the rejection.
 */
export function returningActions(status: StaffStatus): ReturningAction[] {
  const actions: ReturningAction[] = [];
  if (
    isMachineStatus(status) &&
    status !== ACTION_TARGET.reset &&
    canTransitionStaff(status, ACTION_TARGET.reset)
  ) {
    actions.push('reset');
  }
  actions.push('reject_application');
  return actions;
}

// ---------------------------------------------------------------------
// Time, in UK terms (§1.8)
// ---------------------------------------------------------------------
const UK = 'Europe/London';

function ukDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: UK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Whole UK calendar days between two instants. */
export function ukDaysBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  const a = Date.parse(`${ukDay(from)}T00:00:00Z`);
  const b = Date.parse(`${ukDay(now)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export type AgeTone = 'ok' | 'warn' | 'bad';

/**
 * Days in the current stage, as the card's corner shows it. Amber from
 * four days and coral from six, the two thresholds the approved board
 * draws ("Awaiting a Willo decision for 4 days", "No response to the
 * Willo invite in 6 days").
 */
export function stageAge(
  enteredAt: string,
  now: Date,
): { days: number; tone: AgeTone; label: string } {
  const days = ukDaysBetween(enteredAt, now);
  const tone: AgeTone = days >= 6 ? 'bad' : days >= 4 ? 'warn' : 'ok';
  return { days, tone, label: `${days} d` };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The UK calendar date of an instant as numbers. The month and weekday
 * names are ours rather than ICU's: en-GB prints September as "Sept" in
 * current ICU and "Sep" in older builds, and the approved board says Sep.
 */
function ukParts(iso: string): { month: number; day: number; weekday: number } {
  const [y, m, d] = ukDay(new Date(iso)).split('-').map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return { month: m!, day: d!, weekday };
}

/** "Tue 15 Sep" in UK time. */
export function shortDay(iso: string): string {
  const p = ukParts(iso);
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}`;
}

/** "18:44" in UK time. */
export function ukTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: UK,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** "15 Sep 10:02" in UK time — operational stamps on the card. */
export function shortStamp(iso: string): string {
  const p = ukParts(iso);
  return `${p.day} ${MONTHS[p.month - 1]} ${ukTime(iso)}`;
}

// ---------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------
export type LineTone = 'muted' | 'amber' | 'coral' | 'green';
export interface Line {
  text: string;
  tone?: LineTone;
}

export const RTW_SHORT: Record<string, string> = {
  uk_irish: 'UK citizen',
  eu_settled: 'EU settled',
  work_visa: 'Work visa',
  international_student: 'International student',
  dependant_other: 'Dependant / other visa',
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function scoreLabel(score: number | null): string {
  return score === null ? '—' : `${Math.round(score)}%`;
}

/** The Willo line on the two interview columns (§2.4). */
export function willoLine(row: CandidateRow, now: Date): Line {
  if (row.willo_completed_at) {
    const via = row.willo_decided_via === 'office' ? '' : ' (Willo webhook)';
    return {
      text: `Interview completed ${shortDay(row.willo_completed_at)} ${ukTime(row.willo_completed_at)}${via}`,
    };
  }
  if (!row.willo_linked) {
    return { text: 'Not yet created in Willo — the integration is not connected', tone: 'muted' };
  }
  const days = row.willo_invited_at ? ukDaysBetween(row.willo_invited_at, now) : 0;
  const done = row.willo_answers_done ?? 0;
  if (done === 0 && days >= 6) {
    return { text: `No response to the Willo invite in ${days} days`, tone: 'coral' };
  }
  const sent = row.willo_invited_at ? ` ${shortStamp(row.willo_invited_at)}` : '';
  const progress =
    done > 0 ? `in progress (${done} of ${row.willo_answers_total ?? '?'} answers)` : 'not started';
  return { text: `Willo invite sent${sent} · ${progress}` };
}

/** Every line a card carries under the name, by column (board, Active). */
export function cardLines(row: CandidateRow, column: ColumnKey, now: Date): Line[] {
  const lines: Line[] = [];
  const age = stageAge(row.stage_entered_at, now);

  switch (column) {
    case 'interview_requested': {
      const bits = [`Applied ${shortDay(row.applied_at)}`];
      if (row.age !== null) bits.push(`age ${row.age}`);
      bits.push(row.phone);
      lines.push({ text: bits.join(' · ') });
      lines.push(willoLine(row, now));
      break;
    }
    case 'interview_completed': {
      lines.push(willoLine(row, now));
      if (age.days >= 4) {
        lines.push({ text: `Awaiting a Willo decision for ${age.days} days`, tone: 'amber' });
      }
      break;
    }
    case 'documents': {
      const branch = row.rtw_branch
        ? (RTW_SHORT[row.rtw_branch] ?? row.rtw_branch)
        : 'Right to work not chosen yet';
      if (row.docs_total === 0) {
        lines.push({
          text: `${branch} · nothing uploaded yet${row.activated ? '' : ' · not activated'}`,
        });
      } else {
        const parts = [branch, `${row.docs_verified} of ${row.docs_total} verified`];
        if (row.docs_pending > 0) parts.push(`${row.docs_pending} under review`);
        lines.push({ text: parts.join(' · ') });
      }
      if (row.docs_rejected > 0) {
        const sent = row.last_doc_rejected_at
          ? ` (push N8 sent ${shortDay(row.last_doc_rejected_at)})`
          : '';
        lines.push({
          text: `${plural(row.docs_rejected, 'document')} rejected — awaiting re-upload${sent}`,
          tone: 'coral',
        });
      }
      if (row.declaration_answer === true && row.declaration_status === 'pending') {
        lines.push({ text: 'Criminal Record: Yes — needs manual Verify', tone: 'amber' });
      }
      break;
    }
    case 'quiz': {
      const used = row.quiz_attempts_used;
      if (used === 0) {
        lines.push({ text: `All documents verified → quiz unlocked automatically` });
        lines.push({ text: `Attempts 0 / ${QUIZ_MAX_ATTEMPTS} · not started` });
      } else {
        lines.push({
          text: `Attempts ${used} / ${QUIZ_MAX_ATTEMPTS} · best ${scoreLabel(row.quiz_best_score)} (pass mark ${QUIZ_PASS_MARK}%)`,
        });
      }
      if (used === QUIZ_MAX_ATTEMPTS - 1) {
        lines.push({
          text: 'One attempt left — a third failure rejects automatically (E4)',
          tone: 'amber',
        });
      }
      break;
    }
    case 'additional_info': {
      const refs =
        row.references_count >= 2 ? 'References ✓' : `References ${row.references_count} of 2`;
      lines.push({
        text: [
          `Quiz passed ${scoreLabel(row.quiz_best_score)}`,
          `HMRC ${row.hmrc_submitted_at ? '✓' : '✗'}`,
          refs,
          `Bank ${row.bank_saved ? '✓' : '✗'}`,
        ].join(' · '),
      });
      break;
    }
    case 'contract': {
      lines.push({
        text: `Contract presented in the app ${shortDay(row.stage_entered_at)} · not yet signed`,
      });
      break;
    }
  }
  return lines;
}

export function rejectedPill(
  row: Pick<CandidateRow, 'rejection_cause' | 'rejected_by_name'>,
): string {
  switch (row.rejection_cause) {
    case 'willo':
      return 'Rejected · in Willo';
    case 'quiz_failed':
      return 'Rejected · quiz failed 3×';
    case 'manager':
      return row.rejected_by_name
        ? `Rejected · by ${row.rejected_by_name}`
        : 'Rejected · by the office';
    default:
      return 'Rejected';
  }
}

export function rejectedLines(row: CandidateRow): Line[] {
  switch (row.rejection_cause) {
    case 'willo':
      return [
        {
          text: 'Rejected in Willo → the system rejected automatically and sent email E2 (THC wording, not Willo’s).',
        },
      ];
    case 'quiz_failed':
      return [
        {
          text: `Best ${scoreLabel(row.quiz_best_score)} over ${row.quiz_attempts_used} attempts — automatic rejection after the third failure; email E4 + terminal screen in the app (§2.9).`,
        },
      ];
    default:
      return row.rejection_reason ? [{ text: `Reason: “${row.rejection_reason}”` }] : [];
  }
}

// ---------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------
export type BoardFilter = 'active' | 'rejected';
export type ReasonFilter = 'any' | RejectionCause;

export interface BoardQuery {
  filter: BoardFilter;
  query: string;
  roleName: string;
  reason: ReasonFilter;
}

export interface BoardColumn {
  key: ColumnKey;
  label: string;
  tone: string;
  candidates: CandidateRow[];
  returning: ReturningRow[];
  count: number;
}

function matchesQuery(name: string, extra: readonly string[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [name, ...extra].some((part) => part.toLowerCase().includes(needle));
}

/**
 * The six columns for one toggle position. Rejected cards are hidden by
 * default and reachable through the toggle (§2.2); returning-applicant
 * cards belong to Interview requested and to the Active view only (§2.12).
 * Within a column the longest-waiting card comes first, because that is
 * the one the office is behind on.
 */
export function boardColumns(
  candidates: readonly CandidateRow[],
  returning: readonly ReturningRow[],
  q: BoardQuery,
): BoardColumn[] {
  const wanted = candidates.filter((row) => {
    if (q.filter === 'active' ? !ON_BOARD.has(row.status) : row.status !== 'rejected') return false;
    if (!matchesQuery(row.display_name, [row.email, row.phone], q.query)) return false;
    if (q.roleName && !row.role_names.includes(q.roleName)) return false;
    if (q.filter === 'rejected' && q.reason !== 'any' && row.rejection_cause !== q.reason)
      return false;
    return true;
  });
  const cards =
    q.filter === 'active' && !q.roleName
      ? returning.filter((r) => matchesQuery(r.applicant_name, [r.existing_name], q.query))
      : [];

  return COLUMNS.map((column) => {
    const inColumn = wanted
      .filter((row) => columnFor(row) === column.key)
      .sort((a, b) =>
        q.filter === 'rejected'
          ? (b.rejected_at ?? '').localeCompare(a.rejected_at ?? '')
          : a.stage_entered_at.localeCompare(b.stage_entered_at),
      );
    const back = column.key === 'interview_requested' ? cards : [];
    return {
      key: column.key,
      label: column.label,
      tone: column.tone,
      candidates: inColumn,
      returning: back,
      count: inColumn.length + back.length,
    };
  });
}

export function boardCounts(
  candidates: readonly CandidateRow[],
  returning: readonly ReturningRow[],
): { active: number; rejected: number } {
  return {
    active: candidates.filter((r) => ON_BOARD.has(r.status)).length + returning.length,
    rejected: candidates.filter((r) => r.status === 'rejected').length,
  };
}

// ---------------------------------------------------------------------
// The candidate profile
// ---------------------------------------------------------------------

/** The stepper position (0-5) for a person, by phase (§2.3). */
export function phaseIndex(row: ColumnInput & Pick<CandidateRow, 'contract_signed_at'>): number {
  if (row.status === 'compliant' && row.contract_signed_at) return 5;
  const column = columnFor(row);
  const index = COLUMNS.findIndex((c) => c.key === column);
  return index < 0 ? 0 : index;
}

/** The stage pill in the profile header. */
export function phaseLabel(row: ColumnInput & Pick<CandidateRow, 'contract_signed_at'>): string {
  if (row.status === 'rejected') return 'Rejected';
  if (row.status === 'compliant') return 'Contract signed';
  return COLUMNS[phaseIndex(row)]?.label ?? row.status;
}

/** Words for the tokens onboarding_quiz_blockers() returns. */
export function blockerLabel(token: string): string {
  const doc = (type: string) =>
    DOC_LABEL[type] ?? type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  if (token.startsWith('document_unverified:')) {
    return `${doc(token.slice('document_unverified:'.length))} under review or rejected`;
  }
  if (token.startsWith('document_expired:')) {
    return `${doc(token.slice('document_expired:'.length))} expired`;
  }
  switch (token) {
    case 'conviction_unreviewed':
      return 'Criminal Record declaration (Yes) not yet verified';
    case 'conviction_rejected':
      return 'Criminal Record declaration (Yes) rejected';
    case 'criminal_declaration':
      return 'Criminal Record declaration not yet made';
    case 'rtw_branch':
      return 'Right to Work branch not chosen';
    case 'dob':
      return 'Date of birth missing';
    case 'share_code':
      return 'Share code not entered';
    default:
      return `${doc(token)} not uploaded`;
  }
}

export const DOC_LABEL: Record<string, string> = {
  passport: 'Passport',
  birth_certificate: 'Birth certificate',
  ni_evidence: 'NI evidence',
  national_id: 'National ID',
  visa_document: 'Visa document',
  status_document: 'Status document',
  university_term_dates_letter: 'University Term Dates Letter',
  university_completion_letter: 'Official University Completion Letter',
  share_code_report: 'Right to work · share code',
};

export interface QuizGate {
  unlocked: boolean;
  outstanding: string[];
}

/** RULE-10: the quiz is unlocked only when nothing is outstanding. */
export function quizGate(row: Pick<CandidateRow, 'quiz_blockers'>): QuizGate {
  const outstanding = (row.quiz_blockers ?? []).map(blockerLabel);
  return { unlocked: outstanding.length === 0, outstanding };
}

export type AiTone = 'hi' | 'mid' | 'manual';

/**
 * The AI confidence badge (§2.6). The AI never verifies: at or below the
 * flag, or below 60%, the badge says "needs manual review" instead of a
 * number, so a weak read is never presented as a strong one.
 */
export function aiBadge(
  confidence: number | null,
  needsManualReview: boolean,
): { tone: AiTone; label: string } | null {
  if (needsManualReview || (confidence !== null && confidence < 0.6)) {
    return { tone: 'manual', label: 'needs manual review' };
  }
  if (confidence === null) return null;
  const pct = Math.round(confidence * 100);
  return { tone: pct >= 90 ? 'hi' : 'mid', label: `AI ${pct}%` };
}

export const REVIEW_PILL: Record<
  ReviewStatus,
  { tone: 'green' | 'amber' | 'coral' | 'neutral'; label: string }
> = {
  verified: { tone: 'green', label: 'Verified' },
  pending: { tone: 'amber', label: 'Under review' },
  rejected: { tone: 'coral', label: 'Rejected' },
  superseded: { tone: 'neutral', label: 'Superseded' },
};

// ---------------------------------------------------------------------
// Term periods (§2.3 "+ Add period")
// ---------------------------------------------------------------------
export interface Period {
  from: string;
  to: string;
}

function shiftDay(iso: string, days: number): string {
  const at = new Date(`${iso}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A Postgres daterange literal as the manager reads it: both ends
 * inclusive. The wire form is half-open, `[2026-12-13,2027-01-11)`, so the
 * printed last day is the day before the upper bound.
 */
export function parsePeriod(range: string): Period | null {
  const match = /^([[(])([^,]*),([^)\]]*)([)\]])$/.exec(range.trim());
  if (!match) return null;
  const [, open, rawFrom, rawTo, close] = match;
  if (!rawFrom || !rawTo || !ISO_DAY.test(rawFrom) || !ISO_DAY.test(rawTo)) return null;
  return {
    from: open === '(' ? shiftDay(rawFrom, 1) : rawFrom,
    to: close === ')' ? shiftDay(rawTo, -1) : rawTo,
  };
}

/** Back to the half-open literal verify_document() stores. */
export function periodToRange(period: Period): string {
  return `[${period.from},${shiftDay(period.to, 1)})`;
}

/** What is wrong with the periods the manager is about to confirm, if anything. */
export function periodsProblem(periods: readonly Period[]): string | null {
  for (const [index, period] of periods.entries()) {
    if (!ISO_DAY.test(period.from) || !ISO_DAY.test(period.to)) {
      return `Period ${index + 1} needs both dates.`;
    }
    if (period.to < period.from) {
      return `Period ${index + 1} ends before it starts.`;
    }
  }
  return null;
}

/** HMRC statement is derived from the three routed answers (§2.8). */
export function studentLoanLabel(plan: string, postgraduate: boolean): string {
  const main = plan === 'none' ? 'No plan' : `Plan ${plan.replace('plan', '')}`;
  return `${main} · Postgraduate Loan ${postgraduate ? '✓' : '☐'}`;
}

/** "●●●●●●●2B" and friends arrive masked from the view; this only labels a blank. */
export function orDash(value: string | null | undefined): string {
  return value && value.trim() !== '' ? value : '—';
}
