/**
 * Pure helpers for /compliance (§4.1–4.3). Everything that decides WHAT the
 * screen shows lives here, so it is tested without a database or a browser;
 * the components only lay it out.
 */
import type { RtwCheckRow } from '../_lib/rtwCheck';
import { rtwDateRule } from './rtw';
import type { QueueRow, RadarRow, RadarState } from './types';

const UK = 'Europe/London';

// ---------------------------------------------------------------------
// UK formatting (§1.8: audit stamps and document dates are UK-only)
// ---------------------------------------------------------------------

/** `2026-12-31` → `31.12.2026`, the format the wireframes and profile use. */
export function ukDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

// A fixed table rather than Intl's `month: 'short'`: newer ICU builds write
// September as "Sept" in en-GB, and the wireframes (and every other screen)
// write "Sep". The server and the browser must not disagree on a label.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ukParts(iso: string): { day: string; month: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: get('day'),
    month: MONTHS[Number(get('month')) - 1] ?? '',
    hour: get('hour'),
    minute: get('minute'),
  };
}

/** `13 Sep` in UK time. */
export function ukDayMonth(iso: string): string {
  const p = ukParts(iso);
  return `${p.day} ${p.month}`;
}

/** `13 Sep 15:02` in UK time — the Uploaded column. */
export function ukStamp(iso: string): string {
  const p = ukParts(iso);
  return `${p.day} ${p.month} ${p.hour}:${p.minute}`;
}

/** The UK calendar day of an instant, `YYYY-MM-DD`. */
export function ukDay(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: UK }).format(instant);
}

/** "today", "yesterday", "5 days ago" — counted in UK calendar days. */
export function ageLabel(iso: string, now: Date = new Date()): string {
  const days = Math.round(
    (Date.parse(`${ukDay(now)}T00:00:00Z`) - Date.parse(`${ukDay(new Date(iso))}T00:00:00Z`)) /
      86_400_000,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// ---------------------------------------------------------------------
// Needs review
// ---------------------------------------------------------------------

export type WhoFilter = 'all' | 'candidates' | 'staff';

/** The document filter's options, in the wireframe's order. */
export const DOCUMENT_FILTERS: { value: string; label: string; types: string[] }[] = [
  { value: 'any', label: 'Any document', types: [] },
  { value: 'id', label: 'Passport / ID', types: ['passport', 'national_id', 'birth_certificate'] },
  { value: 'visa', label: 'Visa document', types: ['visa_document', 'status_document'] },
  { value: 'rtw', label: 'Right to work (share code)', types: ['share_code_report'] },
  { value: 'term', label: 'University Term Dates Letter', types: ['university_term_dates_letter'] },
  {
    value: 'completion',
    label: 'Official University Completion Letter',
    types: ['university_completion_letter'],
  },
  { value: 'ni', label: 'NI evidence', types: ['ni_evidence'] },
  { value: 'declaration', label: 'Criminal Record declaration', types: ['criminal_declaration'] },
];

export interface QueueFilter {
  query: string;
  who: WhoFilter;
  document: string;
}

/**
 * Oldest first: "the menu counter is this number", and the one that has
 * waited longest is the one to do next (§4.1).
 */
export function filterQueue(rows: readonly QueueRow[], filter: QueueFilter): QueueRow[] {
  const needle = filter.query.trim().toLowerCase();
  const types = DOCUMENT_FILTERS.find((f) => f.value === filter.document)?.types ?? [];
  return rows
    .filter((row) => (needle ? row.display_name.toLowerCase().includes(needle) : true))
    .filter((row) =>
      filter.who === 'candidates'
        ? row.is_candidate
        : filter.who === 'staff'
          ? !row.is_candidate
          : true,
    )
    .filter((row) => (types.length ? types.includes(row.item_type) : true))
    .sort(
      (a, b) => a.submitted_at.localeCompare(b.submitted_at) || a.item_id.localeCompare(b.item_id),
    );
}

const STATUS_LABEL: Record<string, string> = {
  interview_requested: 'Interview requested',
  interview_completed: 'Interview completed',
  documents: 'Documents',
  quiz: 'Quiz',
  contract: 'Contract',
  compliant: 'Compliant',
  blocked: 'Blocked',
  inactive: 'Inactive',
};

const BRANCH_LABEL: Record<string, string> = {
  uk_irish: 'UK / Irish citizen',
  eu_settled: 'EU settled / pre-settled',
  work_visa: 'Work visa',
  international_student: 'International student',
  dependant_other: 'Dependant / other',
};

/**
 * The line under the name: "Candidate · Documents · International student",
 * or "Staff · Blocked — <reason>". A blocked worker's reason is the first
 * thing the reviewer needs, because it says whether this upload could lift it.
 */
export function whoLine(row: QueueRow): { text: string; blocked: string | null } {
  const role = row.is_candidate ? 'Candidate' : 'Staff';
  if (row.status === 'blocked') {
    return { text: role, blocked: `Blocked — ${row.block_reason ?? 'no reason recorded'}` };
  }
  const parts = [role, STATUS_LABEL[row.status] ?? row.status];
  if (row.rtw_branch) parts.push(BRANCH_LABEL[row.rtw_branch] ?? row.rtw_branch);
  return { text: parts.join(' · '), blocked: null };
}

export const EVIDENCE_FORM_LABEL: Record<string, string> = {
  letter: 'Official completion letter',
  transcript: 'Final / completers transcript',
  university_email: 'Official university email',
};

function fileSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fileKind(mime: string | null): string | null {
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'image/jpeg') return 'JPG';
  if (mime === 'image/png') return 'PNG';
  return null;
}

// ---------------------------------------------------------------------
// The automated gov.uk check (ADR-0025)
// ---------------------------------------------------------------------

/** The latest check on a queue row, in the shape the shared panel reads. */
export function queueRowCheck(row: QueueRow): RtwCheckRow | null {
  if (!row.rtw_check_id || !row.rtw_check_status) return null;
  return {
    check_id: row.rtw_check_id,
    document_id: row.kind === 'document' ? row.item_id : '',
    staff_id: row.staff_id,
    status: row.rtw_check_status,
    source: row.rtw_check_source ?? null,
    outcome: row.rtw_check_outcome ?? null,
    attempts: row.rtw_check_attempts ?? 0,
    max_attempts: 5,
    next_attempt_at: null,
    created_at: row.rtw_checked_at ?? row.submitted_at,
    started_at: null,
    finished_at: row.rtw_checked_at ?? null,
    right_to_work_until: row.rtw_check_until ?? null,
    no_time_limit: row.rtw_check_no_time_limit === true,
    conditions: row.rtw_check_conditions ?? [],
    term_time_limit_hours: null,
    record_name: null,
    reference_number: null,
    review_reason: row.rtw_check_reason ?? null,
    worker_reason: null,
    error: null,
    report_path: row.rtw_check_report_path ?? null,
    reviewed_at: null,
    // In flight, yet the database allows the hand-typed date: stuck.
    stuck:
      row.rtw_manual_allowed === true &&
      (row.rtw_check_status === 'queued' || row.rtw_check_status === 'running'),
  };
}

/**
 * Whether Verify may be pressed on this row with a hand-typed date. While the
 * automated check is on, a share code is verified by the check itself, and by
 * hand only once its check is in needs_review — the database refuses anything
 * else (rtw_check_required). The kind `rtw_check` item has no Verify at all:
 * its document is already decided.
 */
export function verifyAllowed(row: QueueRow): boolean {
  if (row.kind === 'rtw_check') return false;
  if (row.item_type !== 'share_code_report') return true;
  return row.rtw_manual_allowed !== false;
}

/** The wording of the 'rtw_date' row when the view sends none (it always does; this is the fallback). */
export const RTW_DATE_MISSING = 'Right-to-work date missing — re-verify';

/** The sub-line under the document name. */
export function documentLine(row: QueueRow): string {
  if (row.kind === 'rtw_date') {
    // Verified before the date was required (20260923200000): the reason
    // is the whole story, plus the share code the office re-runs on gov.uk.
    return [
      row.review_reason ?? RTW_DATE_MISSING,
      row.share_code ? `share code ${row.share_code}` : 'no share code on file',
    ].join(' · ');
  }
  if (row.kind === 'rtw_check') {
    return 'gov.uk returned no right to work — the worker has been asked to re-enter the share code (N8)';
  }
  if (row.kind === 'declaration') {
    const source =
      row.declaration_source === 'in_employment' ? 'declared from the app (§10.7)' : 'onboarding';
    return `Answer: Yes · ${source}`;
  }
  const parts: string[] = [];
  if (row.item_type === 'university_completion_letter') {
    if (row.evidence_form) parts.push(EVIDENCE_FORM_LABEL[row.evidence_form] ?? row.evidence_form);
    parts.push('optional document, International student branch');
  }
  if (row.awarding_institution) parts.push(row.awarding_institution);
  const kind = fileKind(row.mime_type);
  const size = fileSize(row.size_bytes);
  if (kind || size) parts.push([kind, size].filter(Boolean).join(' '));
  if (row.is_reupload && row.previous_rejection) {
    parts.push(`previously rejected ("${row.previous_rejection}")`);
  } else if (row.is_reupload) {
    parts.push('replaces an earlier document');
  }
  return parts.join(' · ');
}

/** The "AI found" column, or what stands in for it. */
export function foundLine(row: QueueRow): {
  text: string;
  confidence: 'hi' | 'mid' | 'manual' | null;
} {
  if (row.kind === 'declaration') return { text: '— no AI extraction', confidence: null };
  if (row.kind === 'rtw_date') {
    // No upload for an extractor to read: only a human can close this one.
    return {
      text: 'No right-to-work date on file — re-run the gov.uk check',
      confidence: 'manual',
    };
  }
  if (row.item_type === 'share_code_report' && row.rtw_check_status) {
    // The automated check replaces the AI here: the panel beside it says
    // what gov.uk returned and why it is waiting on the office.
    return {
      text: row.rtw_check_until
        ? `gov.uk: right to work until ${ukDate(row.rtw_check_until)}`
        : row.rtw_check_no_time_limit
          ? 'gov.uk: no time limit'
          : 'gov.uk check',
      confidence: row.rtw_check_status === 'needs_review' ? 'manual' : null,
    };
  }
  if (row.item_type === 'university_completion_letter') {
    return {
      text: row.completion_date_claimed
        ? `Completion date entered by the worker: ${ukDate(row.completion_date_claimed)}`
        : 'No completion date entered',
      confidence: row.needs_manual_review ? 'manual' : null,
    };
  }
  const found: string[] = [];
  if (row.expiry_date) found.push(`Expiry ${ukDate(row.expiry_date)}`);
  if (row.doc_right_to_work_until)
    found.push(`Right to work until ${ukDate(row.doc_right_to_work_until)}`);
  if (row.term_dates?.length) {
    found.push(`${row.term_dates.length} holiday range${row.term_dates.length === 1 ? '' : 's'}`);
  }
  const confidence =
    row.needs_manual_review || row.ai_confidence === null
      ? row.ai_confidence === null
        ? null
        : 'manual'
      : row.ai_confidence >= 0.85
        ? 'hi'
        : 'mid';
  return { text: found.join(' · ') || '—', confidence };
}

/** compliance_docs.manual_review_reason for a term letter whose every holiday range is past (20260928110300). */
export const LETTER_EXPIRED = 'letter expired';

/**
 * Why the extractor sent this upload to a human beyond its confidence
 * (manual_review_reason, 20260928110900), rendered beside the AI badge in
 * the wireframe's style for a flagged document — a pill and a muted note.
 * Today one reason: a University Term Dates Letter whose every holiday
 * range is already past. "An already-expired letter is not accepted"
 * (§4.2): Verify refuses it, so the reviewer rejects it and the worker
 * uploads the current one (§4.1 N8). Anything else the column may carry
 * later is shown as it is, so a new reason is never silently hidden.
 */
export function reviewFlag(row: QueueRow): { label: string; detail: string } | null {
  if (row.kind !== 'document' || !row.manual_review_reason) return null;
  if (row.manual_review_reason === LETTER_EXPIRED) {
    return {
      label: 'Letter expired',
      detail: 'every term date on it is in the past — not accepted (§4.2)',
    };
  }
  return { label: 'Flagged', detail: row.manual_review_reason };
}

/** The "Uploaded" cell's sub-line: how long it has waited, and for the rtw_date row, what the stamp is. */
export function uploadedLine(row: QueueRow, now: Date = new Date()): string {
  const age = ageLabel(row.submitted_at, now);
  return row.kind === 'rtw_date' ? `verified without a date · ${age}` : age;
}

/**
 * The buttons a row offers. Every pending item has Verify and Reject
 * (§4.1). The rtw_date row is already verified — there is nothing to
 * reject, and compliance_reject_document() would refuse it (not_pending) —
 * so it offers only the date confirmation; if the gov.uk check no longer
 * passes, the worker is blocked from the profile (§9.6).
 */
export function actionsFor(row: QueueRow): { verify: string; reject: boolean } {
  if (row.kind === 'rtw_date') return { verify: 'Confirm date', reject: false };
  // ADR-0025: the check's document is already rejected; Mark reviewed is on its panel.
  if (row.kind === 'rtw_check') return { verify: 'Verify', reject: false };
  return { verify: 'Verify', reject: true };
}

/**
 * What pressing Verify on a row does — the one decision every screen that
 * verifies shares (/compliance and the /staff/:id Documents tab):
 *   - `approve`: the completion letter, approved with its completion date
 *     and visa expiry (requirement §2.2) — approve_completion_letter();
 *   - `confirm_date`: a visa document, status document or share code
 *     report, verified on the right-to-work date it carries (20260923200000),
 *     or an rtw_date row, whose date alone is confirmed (20260927160000);
 *   - `verify`: everything else, on the click.
 */
export type VerifyStep = 'approve' | 'confirm_date' | 'verify';

export function verifyStep(row: QueueRow): VerifyStep {
  if (row.item_type === 'university_completion_letter') return 'approve';
  if (
    (row.kind === 'document' || row.kind === 'rtw_date') &&
    rtwDateRule(row.item_type, row.rtw_branch)
  ) {
    return 'confirm_date';
  }
  return 'verify';
}

/**
 * One worker's queue rows keyed by the record they act on, for the
 * /staff/:id Documents tab: a pending document, a pending Yes declaration,
 * or a verified share code report whose right-to-work date is missing
 * (`rtw_date`) — each keyed by that document's or declaration's id. The
 * `rtw_check` item is keyed by the check, not a document, and is cleared
 * from the check's own panel (Mark reviewed), so it is left out.
 */
export function queueByRecord(rows: readonly QueueRow[]): Map<string, QueueRow> {
  const map = new Map<string, QueueRow>();
  for (const row of rows) {
    if (row.kind === 'rtw_check') continue;
    map.set(row.item_id, row);
  }
  return map;
}

/** What pressing Verify will do, spelled out where it matters (§4.3, §4.5). */
export function verifyHint(row: QueueRow): string | null {
  if (row.kind === 'rtw_date') {
    return 'Confirm the date off the gov.uk report → it becomes the worker’s right-to-work date: no shift after it can be rostered, and the reminder ladder counts down to it';
  }
  if (row.kind === 'rtw_check') {
    return 'Act on it (contact the worker, block if needed), then Mark reviewed';
  }
  if (row.item_type === 'share_code_report' && !verifyAllowed(row)) {
    return 'Verified by the automatic gov.uk check — run it again from here';
  }
  if (row.item_type === 'university_completion_letter') {
    return 'Approve → confirm the completion date and visa expiry → 48 h/week from the completion date, never past the visa';
  }
  if (row.kind === 'document' && row.manual_review_reason === LETTER_EXPIRED) {
    // compliance_verify_document() raises term_letter_expired on this row
    // (20260928110300); the screen says so before the button does.
    return 'Verify is refused — an already-expired letter is not accepted (§4.2) · Reject → N8 with Re-upload, the worker sends the current year’s letter';
  }
  if (row.kind === 'declaration' && row.declaration_source === 'in_employment') {
    return 'Verify → re-check → N15 "your shifts are open again" · Reject → converts to a manual block';
  }
  if (row.status === 'blocked') {
    return 'Verify → full compliance re-check → unblocks only if everything else is valid (§4.3)';
  }
  return null;
}

// ---------------------------------------------------------------------
// Radar
// ---------------------------------------------------------------------

export type RadarFilter = 'all' | 'expired' | 'expiring';

export function radarCounts(rows: readonly RadarRow[]): {
  expired: number;
  expiring: number;
  termLetters: number;
} {
  return {
    expired: rows.filter((r) => r.state === 'expired').length,
    expiring: rows.filter((r) => r.state === 'expiring').length,
    termLetters: rows.filter((r) => r.doc_type === 'university_term_dates_letter').length,
  };
}

/** Soonest first, so the already-expired rows lead (§4.1). */
export function filterRadar(
  rows: readonly RadarRow[],
  state: RadarFilter,
  query: string,
  document: string,
): RadarRow[] {
  const needle = query.trim().toLowerCase();
  const types = DOCUMENT_FILTERS.find((f) => f.value === document)?.types ?? [];
  return rows
    .filter((r) => (state === 'all' ? true : r.state === state))
    .filter((r) => (needle ? r.display_name.toLowerCase().includes(needle) : true))
    .filter((r) => (types.length ? types.includes(r.doc_type) : true))
    .sort((a, b) => a.days_left - b.days_left || a.display_name.localeCompare(b.display_name));
}

export function daysLabel(days: number): string {
  return days < 0 ? `−${Math.abs(days)} d` : `${days} d`;
}

export function daysTone(state: RadarState): 'neg' | 'soon' | 'ok' {
  return state === 'expired' ? 'neg' : state === 'expiring' ? 'soon' : 'ok';
}

/** "N1 02 Aug · N2 19 Aug" — the rungs the ladder actually queued, nothing inferred. */
export function remindersLine(row: RadarRow): string {
  const rungs: [string, string | null][] = [
    ['N1', row.n1_at],
    ['N2', row.n2_at],
    ['N3', row.n3_at],
    ['N4', row.n4_at],
  ];
  const sent = rungs
    .filter(([, at]) => at !== null)
    .map(([code, at]) => `${code} ${ukDayMonth(at!)}`);
  if (sent.length > 0) return sent.join(' · ');
  if (row.state === 'valid') {
    // The ladder opens 30 days out (§4.2).
    const first = new Date(Date.parse(`${row.expires_on}T00:00:00Z`) - 30 * 86_400_000);
    return `first reminder ${ukDate(first.toISOString().slice(0, 10))}`;
  }
  return '—';
}

export function radarStatus(row: RadarRow): { tone: 'coral' | 'amber' | 'neutral'; label: string } {
  if (row.state === 'expired') {
    return {
      tone: 'coral',
      label: row.days_left === 0 ? 'Expires today · blocked 05:00' : 'Expired · blocked',
    };
  }
  if (row.state === 'expiring') return { tone: 'amber', label: 'Expiring' };
  return { tone: 'neutral', label: 'Valid' };
}
