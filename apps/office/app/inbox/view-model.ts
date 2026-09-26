/**
 * /inbox — turning a `notification_outbox` row addressed to the office
 * into something a person reads (ADR-0052). Pure, and tested.
 */
import type { Tone } from '@thc/ui';
import type { OfficeInboxCode } from '@thc/notifications';
import { OFFICE_INBOX_CODES, officeInboxLabel, officeInboxSubject } from '@thc/notifications';
import { type InboxStatus, STATUSES } from './filters';

export type { InboxStatus } from './filters';

export interface InboxRow {
  id: number;
  key: string;
  template: string;
  recipient_emails: string[] | null;
  payload: Record<string, unknown> | null;
  queued_at: string;
  send_after: string;
  sent_at: string | null;
  failed_at: string | null;
  error: string | null;
  attempts: number;
}

/** Only an office email is a type here; anything else is "every type". */
export function parseType(value: unknown): OfficeInboxCode | null {
  return typeof value === 'string' && (OFFICE_INBOX_CODES as readonly string[]).includes(value)
    ? (value as OfficeInboxCode)
    : null;
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

export interface About {
  /** The person or the week the email is about. */
  primary: string;
  /** Employee ID, or the event · role · date. */
  secondary: string | null;
  /** The staff profile, when the row's key names the worker. */
  href: string | null;
}

/**
 * Whom or what the email is about, from the values the row was rendered
 * with. The office emails carry the worker's name and Employee ID; E10 also
 * names the event, role and date; BG08 names the payroll week. The worker's
 * profile is linked when the outbox key carries their id
 * (`E8:staff:<id>`, `CL5:staff:<id>:…`).
 */
export function about(row: Pick<InboxRow, 'key' | 'template' | 'payload'>): About {
  const p = row.payload;
  const match = STAFF_KEY.exec(row.key);
  const href = match ? `/staff/${match[1]!.toLowerCase()}` : null;
  const name = text(p, 'name');
  const employeeId = text(p, 'employeeId');
  const event = [text(p, 'event'), text(p, 'role'), text(p, 'date')].filter(Boolean).join(' · ');
  if (name) {
    const parts = [employeeId ? `Employee ID ${employeeId}` : null, event || null].filter(
      (part): part is string => Boolean(part),
    );
    return { primary: name, secondary: parts.length ? parts.join(' · ') : null, href };
  }
  if (event) return { primary: event, secondary: null, href };
  const start = text(p, 'periodStart');
  const end = text(p, 'periodEnd');
  if (start && end) return { primary: `Week ${start} – ${end}`, secondary: null, href };
  return { primary: '—', secondary: null, href };
}

export function typeLabel(code: string): string {
  return officeInboxLabel(code);
}

/** The subject line the email went out with, rendered from the register. */
export function subjectOf(row: Pick<InboxRow, 'template' | 'payload'>): string | null {
  return officeInboxSubject(row.template, row.payload);
}

export function recipientsOf(row: Pick<InboxRow, 'recipient_emails'>): string {
  const list = (row.recipient_emails ?? []).filter(Boolean);
  return list.length ? list.join(', ') : '—';
}

/** One row as the table shows it. Stamps are audit-style: UK only (§1.8). */
export interface InboxEntry {
  id: number;
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
    type: typeLabel(row.template),
    subject: subjectOf(row),
    about: about(row),
    to: recipientsOf(row),
    queuedAt: formatUk(new Date(row.queued_at)),
    status,
    statusLabel: statusLabel(status),
    tone: statusTone(status),
    settledAt: settled ? `${statusLabel(status)} ${formatUk(new Date(settled))}` : null,
    detail: statusDetail(row),
  };
}
