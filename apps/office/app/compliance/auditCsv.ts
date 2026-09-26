/**
 * The completion letter requirement's audit export (§4, acceptance criterion
 * 7): "Store the document, upload timestamp, reviewer identity, approval
 * timestamp, completion date and rejection reasons — full audit trail", and
 * "all documents and decisions are auditable and exportable".
 *
 * One row per event in `compliance_evidence_audit_v`, which reads the
 * append-only `audit_log`. Timestamps are UK (§1.8: audit stamps are UK-only)
 * and dates ISO, so a spreadsheet sorts them without being told how.
 */
import type { AuditRow } from './types';

export const AUDIT_COLUMNS: { header: string; value: (row: AuditRow) => string }[] = [
  { header: 'Recorded at (UK)', value: (r) => ukTimestamp(r.at) },
  { header: 'Record', value: (r) => RECORD_LABEL[r.record_type] ?? r.record_type },
  { header: 'Event', value: (r) => r.event },
  { header: 'Employee ID', value: (r) => (r.employee_id === null ? '' : String(r.employee_id)) },
  { header: 'Worker', value: (r) => r.worker ?? '' },
  { header: 'By', value: (r) => r.actor_name ?? '' },
  { header: 'Document ID', value: (r) => r.document_id ?? '' },
  { header: 'Form', value: (r) => r.evidence_form ?? '' },
  { header: 'File', value: (r) => r.file_path ?? '' },
  { header: 'Uploaded at (UK)', value: (r) => (r.uploaded_at ? ukTimestamp(r.uploaded_at) : '') },
  { header: 'Completion date (worker)', value: (r) => r.completion_date_claimed ?? '' },
  { header: 'Completion date (confirmed)', value: (r) => r.completion_date ?? '' },
  { header: 'Visa expiry (confirmed)', value: (r) => r.visa_expiry ?? '' },
  { header: 'Rejection reason', value: (r) => r.reason ?? '' },
  {
    header: 'Opt-out notice (days)',
    value: (r) => (r.notice_days === null ? '' : String(r.notice_days)),
  },
  { header: 'Ceiling returns from', value: (r) => r.effective_from ?? '' },
  { header: 'Retained until', value: (r) => r.retain_until ?? '' },
  // Right-to-work changes and decisions (20260930130400).
  { header: 'Document type', value: (r) => r.doc_type ?? '' },
  { header: 'Route before', value: (r) => r.branch_before ?? '' },
  { header: 'Route', value: (r) => r.branch ?? '' },
  { header: 'Right to work until (before)', value: (r) => r.rtw_until_before ?? '' },
  { header: 'Right to work until', value: (r) => r.rtw_until ?? '' },
  { header: 'No time limit', value: (r) => yesNo(r.rtw_no_time_limit) },
  { header: 'Condition set', value: (r) => r.condition ?? '' },
  { header: 'Below degree level', value: (r) => yesNo(r.below_degree_level) },
  {
    header: 'Visa hours limit',
    value: (r) =>
      r.visa_hour_limit === null || r.visa_hour_limit === undefined
        ? ''
        : String(r.visa_hour_limit),
  },
  { header: 'Check source', value: (r) => r.check_source ?? '' },
  { header: 'Check outcome', value: (r) => r.check_outcome ?? '' },
];

function yesNo(value: boolean | null | undefined): string {
  return value === true ? 'yes' : value === false ? 'no' : '';
}

const RECORD_LABEL: Record<string, string> = {
  completion_letter: 'Completion letter',
  wtr_optout: '48-hour opt-out',
  rtw: 'Right to work',
  rtw_check: 'Automated gov.uk check',
};

/** `2026-09-23 14:05` in Europe/London. */
export function ukTimestamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * RFC 4180 quoting, plus the spreadsheet-formula guard: a cell a worker or
 * reviewer typed (a reason, an institution) that starts with = + - @ is
 * prefixed with an apostrophe so Excel shows it rather than running it.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function auditCsv(rows: readonly AuditRow[]): string {
  const lines = [AUDIT_COLUMNS.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(AUDIT_COLUMNS.map((c) => csvCell(c.value(row))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function auditFileName(now: Date = new Date()): string {
  return `thc-completion-letter-audit-${ukTimestamp(now.toISOString()).slice(0, 10)}.csv`;
}
