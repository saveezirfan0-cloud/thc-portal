/**
 * /inbox — turning an email row of `notification_outbox` into something a
 * person reads: the office's and payroll's (ADR-0058), and the candidates',
 * workers' and clients' (ADR-0086). Pure, and tested.
 */
import type { Tone } from '@thc/ui';
import {
  emailAudienceCodes,
  emailAudienceOf,
  emailLogLabel,
  emailLogSubject,
} from '@thc/notifications';
import { type Audience, DEFAULT_AUDIENCE, type InboxStatus, STATUSES } from './filters';

export type { InboxStatus } from './filters';

export interface InboxRow {
  id: number;
  key: string;
  template: string;
  recipient_emails: string[] | null;
  /**
   * Only the values that fill the subject line: `office_email_log()` strips
   * every link and attachment out of the payload before it leaves the
   * database (ADR-0086), so nothing on this row can leak a set-up link.
   */
  payload: Record<string, unknown> | null;
  queued_at: string;
  send_after?: string;
  /** The staff or candidate record the address resolved to, if any. */
  staff_id?: string | null;
  /** That record's name ("Deleted account #id" once removed). */
  recipient_name?: string | null;
  staff_status?: string | null;
  staff_removed?: boolean | null;
  sent_at: string | null;
  failed_at: string | null;
  error: string | null;
  attempts: number;
}

/** Only a code of the audience on screen is a type; anything else is "every type". */
export function parseType(value: unknown, audience: Audience = DEFAULT_AUDIENCE): string | null {
  return typeof value === 'string' && emailAudienceCodes(audience).includes(value) ? value : null;
}

/** A row is failed once it has failed_at, sent once it has sent_at, and queued until either. */
export function statusOf(row: Pick<InboxRow, 'sent_at' | 'failed_at'>): InboxStatus {
  if (row.failed_at) return 'failed';
  if (row.sent_at) return 'sent';
  return 'queued';
}

export function statusTone(status: InboxStatus): Tone {
  return status === 'sent' ? 'green' : status === 'failed' ? 'coral' : 'amber';
}

export function statusLabel(status: InboxStatus): string {
  return STATUSES.find((s) => s.value === status)?.label ?? status;
}

/**
 * What the pill says. A row that has neither sent nor failed is "Queued"
 * until the drain has tried: with the channel unconfigured it is "Held", and
 * after a failed attempt it is "Retrying". Sent and failed read as they are.
 */
export function phaseLabel(row: Pick<InboxRow, 'sent_at' | 'failed_at' | 'error'>): string {
  const status = statusOf(row);
  if (status !== 'queued') return statusLabel(status);
  if (!row.error) return 'Queued';
  return /^not configured/i.test(row.error) ? 'Held' : 'Retrying';
}

/**
 * The line under the status. A failure says why. A queued row with an
 * error is being retried, or held because the channel has no keys
 * (release_outbox_claim writes "not configured: …"); one without is simply
 * waiting for the next minute's drain.
 */
export function statusDetail(row: InboxRow): string | null {
  const status = statusOf(row);
  if (status === 'sent') return null;
  if (status === 'failed') return row.error?.trim() || 'Failed, with no reason recorded.';
  if (!row.error) return row.attempts > 0 ? `Sending (attempt ${row.attempts})` : null;
  if (/^not configured/i.test(row.error)) return `Held — ${row.error}`;
  return `Retrying after attempt ${row.attempts} — ${row.error}`;
}

function text(payload: InboxRow['payload'], key: string): string | null {
  const value = payload?.[key];
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

const STAFF_KEY = /:staff:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::|$)/i;

/** Statuses of a person still being onboarded (or turned down): /onboarding/:id owns them. */
const PIPELINE_STATUSES: ReadonlySet<string> = new Set([
  'interview_requested',
  'interview_completed',
  'documents',
  'quiz',
  'additional_info',
  'contract',
  'rejected',
]);

/** A candidate opens on the onboarding board's profile, a worker on the directory's. */
export function profileHref(
  staffId: string,
  status: string | null | undefined,
  removed?: boolean | null,
): string {
  const id = staffId.toLowerCase();
  return !removed && status && PIPELINE_STATUSES.has(status) ? `/onboarding/${id}` : `/staff/${id}`;
}

export interface About {
  /** The person or the week the email is about. */
  primary: string;
  /** Employee ID, or the event · role · date. */
  secondary: string | null;
  /** The staff or candidate profile, when the address resolves to one. */
  href: string | null;
}

/** Said under a candidate's or worker's email that matched nobody (ADR-0086). */
export const NO_RECORD = 'No staff or candidate record has this address.';

/**
 * Whom or what the email is about. The database resolves the recipient to a
 * staff or candidate record (`staff_id`, `recipient_name`); failing that the
 * row's key may carry the worker's id (`E8:staff:<id>`). The office emails
 * carry the worker's name and Employee ID; E10 also names the event, role
 * and date; BG08 names the payroll week; a client's email names the event.
 * A candidate's or worker's email that matched no record says so.
 */
export function about(
  row: Pick<InboxRow, 'key' | 'template' | 'payload'> &
    Partial<Pick<InboxRow, 'staff_id' | 'recipient_name' | 'staff_status' | 'staff_removed'>>,
): About {
  const p = row.payload;
  const match = STAFF_KEY.exec(row.key);
  const href = row.staff_id
    ? profileHref(row.staff_id, row.staff_status, row.staff_removed)
    : match
      ? `/staff/${match[1]!.toLowerCase()}`
      : null;
  const name = row.recipient_name?.trim() || text(p, 'name');
  const employeeId = text(p, 'employeeId');
  const event = [text(p, 'event'), text(p, 'role'), text(p, 'date')].filter(Boolean).join(' · ');
  if (name) {
    const parts = [employeeId ? `Employee ID ${employeeId}` : null, event || null].filter(
      (part): part is string => Boolean(part),
    );
    if (!href && !parts.length && emailAudienceOf(row.template) === 'people') parts.push(NO_RECORD);
    return { primary: name, secondary: parts.length ? parts.join(' · ') : null, href };
  }
  if (event) return { primary: event, secondary: text(p, 'client'), href };
  const start = text(p, 'periodStart');
  const end = text(p, 'periodEnd');
  if (start && end) return { primary: `Week ${start} – ${end}`, secondary: null, href };
  if (!href && emailAudienceOf(row.template) === 'people') {
    return { primary: '—', secondary: NO_RECORD, href };
  }
  return { primary: '—', secondary: null, href };
}

export function typeLabel(code: string): string {
  return emailLogLabel(code);
}

/** The subject line the email went out with, rendered from the register. */
export function subjectOf(row: Pick<InboxRow, 'template' | 'payload'>): string | null {
  return emailLogSubject(row.template, row.payload);
}

export function recipientsOf(row: Pick<InboxRow, 'recipient_emails'>): string {
  const list = (row.recipient_emails ?? []).filter(Boolean);
  return list.length ? list.join(', ') : '—';
}

/** One row as the table shows it. Stamps are audit-style: UK only (§1.8). */
export interface InboxEntry {
  id: number;
  /** The register code ("E3"), for the office to quote. */
  code: string;
  type: string;
  subject: string | null;
  about: About;
  to: string;
  queuedAt: string;
  status: InboxStatus;
  statusLabel: string;
  tone: Tone;
  /** "Sent 05 Oct, 14:31" / "Failed …" — the settling stamp, when there is one. */
  settledAt: string | null;
  detail: string | null;
}

export function present(row: InboxRow, formatUk: (instant: Date) => string): InboxEntry {
  const status = statusOf(row);
  const settled = row.failed_at ?? row.sent_at;
  return {
    id: row.id,
    code: row.template,
    type: typeLabel(row.template),
    subject: subjectOf(row),
    about: about(row),
    to: recipientsOf(row),
    queuedAt: formatUk(new Date(row.queued_at)),
    status,
    statusLabel: phaseLabel(row),
    tone: statusTone(status),
    settledAt: settled ? `${statusLabel(status)} ${formatUk(new Date(settled))}` : null,
    detail: statusDetail(row),
  };
}
