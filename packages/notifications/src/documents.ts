/**
 * The three emails that carry a FILE — Scope §9.9 (BG-08) and §11.4.
 *
 * They are not in §8's register, and `TEMPLATES` is held to exactly that
 * register by its test, so they live here instead, beside it:
 *
 *   BG08  the Monday 09:00 finance email — payroll CSV always, the New
 *         Starter (HMRC) CSV only if there were new starters (§9.9, §7).
 *         From admin@ (§9.12: "the finance reports"), to the same two
 *         payroll addresses as E5/E6 — read from E5, not retyped.
 *   D1    "Send allocation sheet" from the event page (§11.4).
 *   D2    the sign-out timesheet, the same way, after the event.
 *         Both from timesheets@ (§9.12) to the contact emails on the client
 *         card (§9.7), which the outbox row carries.
 *
 * Every one goes through `notification_outbox` with a unique key like
 * everything else (BG08:<week>, D1:document:<id>). The row carries its
 * attachments as storage REFERENCES — bucket, path, file name — never as
 * content: an outbox payload is not where a list of NI numbers should sit.
 *
 * For the drain (P2): route a claimed row with `isDocumentEmail(row.template)`
 * to `documentMessageFor(row)` instead of `messageFor(row)`, download each
 * attachment from Storage with the service key, and send through Resend with
 * `attachments`. Like `messageFor`, everything this rejects is a fault in the
 * row, so throw it as UnsendableRow and fail the row rather than retry it.
 */

import type { EmailMessage, OutboxRow } from './outbox.ts';
import { UnsendableRow } from './outbox.ts';
import { TEMPLATES, render } from './templates.ts';

export type DocumentBucket = 'reports' | 'timesheets';

export interface DocumentEmailTemplate {
  code: string;
  channel: 'email';
  sender: 'admin' | 'timesheets';
  /** Fixed recipients, when the scope names them. Otherwise the row's. */
  recipients?: readonly string[];
  /** The only bucket this email may attach from. */
  bucket: DocumentBucket;
  title: string;
  body: string;
  trigger: string;
  timing: string;
}

export const DOCUMENT_EMAILS = {
  BG08: {
    code: 'BG08',
    channel: 'email',
    sender: 'admin',
    recipients: TEMPLATES.E5.recipients,
    bucket: 'reports',
    title: 'THC payroll — {periodStart} to {periodEnd}',
    body: 'Hello,\n\nAttached is the payroll for Monday {periodStart} to Sunday {periodEnd}: {rows} shifts, one row per shift, with base pay and holiday pay (+12.07%) in separate columns.\n\n{newStarterLine}{heldLine}\n\nThe Hospitality Company\nadmin@thehospitalitycompany.co.uk',
    trigger: 'BG-08 — every Monday at 09:00 UK (§9.9, §7)',
    timing: 'Monday 09:00 Europe/London; a missed Monday is caught up the same week',
  },
  D1: {
    code: 'D1',
    channel: 'email',
    sender: 'timesheets',
    bucket: 'timesheets',
    title: 'Staff allocation — {event}, {date}{poSuffix}',
    body: 'Hello,\n\nPlease find attached the staff allocation for the {event} on {date} — {staffCount} staff.{poLine}\n\nOn the day, please have your manager on site sign each person out, note any comments (breaks, early finishes) and sign the sheet at the bottom. The completed sign-out timesheet will follow by email after the event.\n\nAny questions, just reply to this email.\n\nBest regards,\nThe Hospitality Company\ntimesheets@thehospitalitycompany.co.uk · www.thehospitalitycompany.co.uk',
    trigger: '"Send allocation sheet" on the Back Office event page (§11.4)',
    timing: 'on the press — any time, including mid-event (§11.3)',
  },
  D2: {
    code: 'D2',
    channel: 'email',
    sender: 'timesheets',
    bucket: 'timesheets',
    title: 'Sign-out timesheet — {event}, {date}{poSuffix}',
    body: 'Hello,\n\nPlease find attached the sign-out timesheet for the {event} on {date} — {staffCount} staff, with finish times, breaks and hours worked from check-in and check-out.{poLine}\n\nAny questions, just reply to this email.\n\nBest regards,\nThe Hospitality Company\ntimesheets@thehospitalitycompany.co.uk · www.thehospitalitycompany.co.uk',
    trigger: '"Send timesheet" on the Back Office event page, after the event (§11.3, §11.4)',
    timing: 'on the press',
  },
} as const satisfies Record<string, DocumentEmailTemplate>;

export type DocumentEmailCode = keyof typeof DOCUMENT_EMAILS;

export function isDocumentEmail(code: string): code is DocumentEmailCode {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_EMAILS, code);
}

export interface Attachment {
  bucket: DocumentBucket;
  path: string;
  filename: string;
}

export interface EmailWithAttachments extends EmailMessage {
  attachments: Attachment[];
}

function parseAttachments(raw: unknown, code: DocumentEmailCode): Attachment[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      throw new UnsendableRow(`${code}: attachments is not JSON`);
    }
  }
  if (!Array.isArray(list) || list.length === 0) {
    throw new UnsendableRow(`${code}: an email that carries a file has no attachment`);
  }
  const bucket = DOCUMENT_EMAILS[code].bucket;
  return list.map((entry, index) => {
    const a = entry as Partial<Attachment>;
    if (a.bucket !== bucket) {
      throw new UnsendableRow(`${code}: attachment ${index} is not in the ${bucket} bucket`);
    }
    if (
      typeof a.path !== 'string' ||
      a.path === '' ||
      a.path.includes('..') ||
      a.path.startsWith('/')
    ) {
      throw new UnsendableRow(`${code}: attachment ${index} has no usable path`);
    }
    if (typeof a.filename !== 'string' || a.filename.trim() === '') {
      throw new UnsendableRow(`${code}: attachment ${index} has no file name`);
    }
    return { bucket, path: a.path, filename: a.filename };
  });
}

/** The copy values the rows do not carry themselves, derived once, here. */
function derivedValues(
  code: DocumentEmailCode,
  values: Record<string, string>,
): Record<string, string> {
  if (code === 'BG08') {
    const newStarters = Number(values.newStarters ?? 0);
    const held = Number(values.held ?? 0);
    return {
      ...values,
      newStarterLine:
        newStarters > 0
          ? `The New Starter (HMRC) report is attached too: ${newStarters} new starter${newStarters === 1 ? '' : 's'} who worked their first shift in this run.\n\n`
          : 'There were no new starters this week, so there is no New Starter (HMRC) report.\n\n',
      heldLine:
        held > 0
          ? `${held} shift${held === 1 ? ' is' : 's are'} held out of this file: ${held === 1 ? 'it has' : 'they have'} an unresolved "No check-out" and will go out with the first Monday run after a manager resolves ${held === 1 ? 'it' : 'them'}.`
          : 'No shifts were held back this week.',
    };
  }
  const po = (values.poNumber ?? '').trim();
  return { ...values, poLine: po ? ` Your PO number ${po} is on the sheet.` : '' };
}

export function documentMessageFor(row: OutboxRow): EmailWithAttachments {
  if (!isDocumentEmail(row.template)) {
    throw new UnsendableRow(`${row.template} is not a document email`);
  }
  const code = row.template;
  const entry: DocumentEmailTemplate = DOCUMENT_EMAILS[code];
  if (row.channel !== 'email') {
    throw new UnsendableRow(`${code} is an email but the row is ${row.channel}`);
  }
  const to = entry.recipients ?? row.recipient_emails;
  if (!to || to.length === 0) {
    throw new UnsendableRow(`${code} is an email with no recipient`);
  }
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const attachments = parseAttachments(payload.attachments, code);
  const values = derivedValues(
    code,
    Object.fromEntries(
      Object.entries(payload)
        .filter(([key]) => key !== 'attachments')
        .map(([key, value]) => [key, value === null || value === undefined ? '' : String(value)]),
    ),
  );
  return {
    kind: 'email',
    sender: entry.sender,
    to,
    subject: render(entry.title, values),
    body: render(entry.body, values),
    attachments,
  };
}
