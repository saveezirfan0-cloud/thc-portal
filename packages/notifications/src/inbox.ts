/**
 * The office inbox — which sends the platform addresses TO THC (ADR-0058).
 *
 * /inbox in the Back Office lists the emails the platform sent to the
 * office and to payroll, so a manager can see that the P45 email went, or
 * why it did not. Which codes those are is a property of the register, not
 * of the screen: every email whose `recipients` are fixed in the register is
 * addressed to THC (§8 names them — admin@, gisela@, thc_payroll@), and
 * every email whose recipient the row carries goes to somebody outside
 * (a candidate, a worker, a new login, a client's contacts). The test holds
 * this list to that rule, so a new office email cannot be left off the page
 * and a candidate's E3 — which carries a live set-up link — cannot be put on
 * it.
 *
 * The labels are short names for the Type column and filter; the subject,
 * rendered from the register with the row's payload, says whom it is about.
 */

import { DOCUMENT_EMAILS, isDocumentEmail } from './documents.ts';
import { TEMPLATES, render } from './templates.ts';

/** The THC mailboxes §8 addresses. Anything else is not the office. */
export const OFFICE_ADDRESSES = [
  'admin@thehospitalitycompany.co.uk',
  'gisela@thehospitalitycompany.co.uk',
  'thc_payroll@topsourceworldwide.com',
] as const;

export const OFFICE_INBOX = [
  { code: 'E5', label: 'Bank & payroll details updated' },
  { code: 'E6', label: 'NI number entered' },
  { code: 'E7', label: 'Contact details updated' },
  { code: 'E8', label: 'P45 requested' },
  { code: 'E9', label: 'Criminal conviction declared' },
  { code: 'E10', label: 'Confirmed worker self-cancelled' },
  { code: 'CL3', label: 'Completion letter to review' },
  { code: 'CL4', label: 'Right to work expiring' },
  { code: 'CL5', label: '48-hour opt-out signed' },
  { code: 'CL6', label: '48-hour opt-out cancelled' },
  { code: 'BG08', label: 'Weekly payroll email' },
  // The Staff App additions (main #76): the office is told of a name, photo
  // or date-of-birth change request (RC1, ADR-0045, ADR-0070), payroll of an approved name change
  // (RC4, as E7), and the office of a cover request inside 72 hours (OF5, ADR-0046).
  { code: 'RC1', label: 'Profile change requested' },
  { code: 'RC4', label: 'Name change approved (payroll)' },
  { code: 'OF5', label: 'Cover requested' },
] as const;

export type OfficeInboxCode = (typeof OFFICE_INBOX)[number]['code'];

export const OFFICE_INBOX_CODES: readonly OfficeInboxCode[] = OFFICE_INBOX.map((e) => e.code);

export function isOfficeInboxCode(code: string): code is OfficeInboxCode {
  return (OFFICE_INBOX_CODES as readonly string[]).includes(code);
}

/** The Type column's name for a code; the code itself for one it does not know. */
export function officeInboxLabel(code: string): string {
  return OFFICE_INBOX.find((e) => e.code === code)?.label ?? code;
}

/** The register's subject line for an office email (TEMPLATES or DOCUMENT_EMAILS). */
function subjectTemplate(code: OfficeInboxCode): string {
  if (Object.prototype.hasOwnProperty.call(DOCUMENT_EMAILS, code)) {
    return DOCUMENT_EMAILS[code as keyof typeof DOCUMENT_EMAILS].title;
  }
  return TEMPLATES[code as keyof typeof TEMPLATES].title;
}

/**
 * The subject the email went out with — rendered from the register, as the
 * drain renders it — or null for a code that is not an office email. A value
 * the row does not carry reads "…" rather than a raw `{placeholder}`.
 */
export function officeInboxSubject(code: string, payload: unknown): string | null {
  if (!isOfficeInboxCode(code)) return null;
  const values: Record<string, string> = {};
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number') values[key] = String(value);
    }
  }
  return render(subjectTemplate(code), values).replace(/\{\w+\}/g, '…');
}

// ---------------------------------------------------------------------------
// The email log: every email-channel send, by who it went to (ADR-0086)
// ---------------------------------------------------------------------------

/**
 * The emails addressed to a person outside THC: a candidate, a worker or a
 * new login. Their recipient is on the row, never in the register. Several
 * of them (E3, OC2, E11) carry a one-time set-up link in the payload; the
 * log shows the subject and the recipient and never the body or the link
 * (the database function that feeds it does not return them).
 */
export const PEOPLE_INBOX = [
  { code: 'E2', label: 'Application rejected (after interview)' },
  { code: 'E2b', label: 'Application rejected' },
  { code: 'E3', label: 'Account activation' },
  { code: 'E4', label: 'Health & Safety quiz failed' },
  { code: 'E11', label: 'Back Office / Client Portal login invitation' },
  { code: 'E12', label: 'Documents approved' },
  { code: 'OC1', label: 'Video interview reminder' },
  { code: 'OC2', label: 'Account set-up reminder' },
] as const;

/** The emails to a client's contacts: the allocation sheet and the timesheet. */
export const CLIENT_INBOX = [
  { code: 'D1', label: 'Allocation Timesheet' },
  { code: 'D2', label: 'Completed Allocation Timesheet' },
] as const;

export type PeopleInboxCode = (typeof PEOPLE_INBOX)[number]['code'];
export type ClientInboxCode = (typeof CLIENT_INBOX)[number]['code'];
export type EmailLogCode = OfficeInboxCode | PeopleInboxCode | ClientInboxCode;

export type EmailAudience = 'office' | 'people' | 'clients';

export const EMAIL_AUDIENCES: readonly {
  value: EmailAudience;
  label: string;
  entries: readonly { code: string; label: string }[];
}[] = [
  { value: 'office', label: 'Office & payroll', entries: OFFICE_INBOX },
  { value: 'people', label: 'Candidates & workers', entries: PEOPLE_INBOX },
  { value: 'clients', label: 'Clients', entries: CLIENT_INBOX },
];

export function emailAudienceEntries(audience: EmailAudience) {
  return EMAIL_AUDIENCES.find((a) => a.value === audience)?.entries ?? OFFICE_INBOX;
}

export function emailAudienceCodes(audience: EmailAudience): string[] {
  return emailAudienceEntries(audience).map((e) => e.code);
}

export const ALL_EMAIL_LOG_CODES: readonly string[] = EMAIL_AUDIENCES.flatMap((a) =>
  a.entries.map((e) => e.code),
);

export function isEmailLogCode(code: string): code is EmailLogCode {
  return ALL_EMAIL_LOG_CODES.includes(code);
}

/** The audience a code belongs to, or null for a code the log does not list. */
export function emailAudienceOf(code: string): EmailAudience | null {
  return EMAIL_AUDIENCES.find((a) => a.entries.some((e) => e.code === code))?.value ?? null;
}

export function emailLogLabel(code: string): string {
  for (const audience of EMAIL_AUDIENCES) {
    const hit = audience.entries.find((e) => e.code === code);
    if (hit) return hit.label;
  }
  return code;
}

/**
 * Willo's own E1 invitation never passes through this system, so it is in no
 * outbox row. The log says so, so that its absence is not read as "not sent".
 */
export const WILLO_INVITE_NOTE =
  'The Willo interview invitation (E1) is sent by Willo, not by this system, so it never appears here. To check it, look in Willo.';

/**
 * The subject any logged email went out with, rendered from the register as
 * the drain renders it (a variant's own title when the row names one), or
 * null for a code the log does not list. A value the row lacks reads "…".
 */
export function emailLogSubject(code: string, payload: unknown): string | null {
  if (!isEmailLogCode(code)) return null;
  const values: Record<string, string> = {};
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number') values[key] = String(value);
    }
  }
  let title: string;
  if (isDocumentEmail(code)) {
    title = DOCUMENT_EMAILS[code].title;
  } else {
    const template = TEMPLATES[code as keyof typeof TEMPLATES] as {
      title: string;
      variants?: Readonly<Record<string, { title?: string }>>;
    };
    title = template.variants?.[values['variant'] ?? '']?.title ?? template.title;
  }
  return render(title, values).replace(/\{\w+\}/g, '…');
}
