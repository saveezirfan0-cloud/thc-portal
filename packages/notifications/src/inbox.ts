/**
 * The office inbox — which sends the platform addresses TO THC (ADR-0052).
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

import { DOCUMENT_EMAILS } from './documents.ts';
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
  // The Staff App additions (main #76): the office is told of a name or
  // photo change request (RC1, ADR-0045), payroll of an approved name change
  // (RC4, as E7), and the office of a cover request inside 72 hours (OF5, ADR-0046).
  { code: 'RC1', label: 'Name or photo change requested' },
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
